// Stripe webhook handler
// Handles subscription lifecycle events — cancellations, pauses, resumes
// Set up at: Stripe Dashboard → Developers → Webhooks → Add endpoint
// Endpoint URL: https://sunnystories.co/api/webhook
// Events to listen for: customer.subscription.deleted, customer.subscription.paused, customer.subscription.resumed

import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

// Disable body parsing — Stripe requires raw body for signature verification
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Read raw body for Stripe signature verification
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);
  const sig = req.headers['stripe-signature'];

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch(e) {
    console.error('Webhook signature verification failed:', e.message);
    return res.status(400).json({ error: `Webhook error: ${e.message}` });
  }

  const subscription = event.data.object;
  const customerId = subscription.customer;

  // Look up subscriber token from customerId
  const token = customerId ? await redis.get(`sub_customer_${customerId}`) : null;

  switch(event.type) {
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused': {
      if (token) {
        const sub = await redis.get(`sub_${token}`);
        if (sub) {
          await redis.set(`sub_${token}`, { ...sub, active: false }, { ex: 94608000 });
          await redis.srem('sub_active', token);
          console.log(`Subscription deactivated for token ${token.slice(0, 8)} (${event.type})`);
        }
      }
      break;
    }

    case 'customer.subscription.resumed':
    case 'customer.subscription.updated': {
      if (token && subscription.status === 'active') {
        const sub = await redis.get(`sub_${token}`);
        if (sub && !sub.active) {
          await redis.set(`sub_${token}`, { ...sub, active: true }, { ex: 94608000 });
          await redis.sadd('sub_active', token);
          console.log(`Subscription reactivated for token ${token.slice(0, 8)} (${event.type})`);
        }
      }
      break;
    }

    default:
      // Ignore unhandled event types
      break;
  }

  res.json({ received: true });
}
