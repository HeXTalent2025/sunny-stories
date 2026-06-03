import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { children, selectedLocations, vibe, storyLength } = req.body;
  if (!children?.length) return res.status(400).json({ error: 'No children provided' });

  const priceId = process.env.STRIPE_SUB_PRICE_ID;
  if (!priceId) return res.status(500).json({ error: 'Subscription pricing not configured — add STRIPE_SUB_PRICE_ID to environment variables.' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const appUrl = process.env.APP_URL || 'https://sunnystories.co';

  // Save form data temporarily (2hr TTL) — retrieved after Stripe redirects back
  const tempKey = `sub_form_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await redis.set(tempKey, { children, selectedLocations, vibe, storyLength }, { ex: 7200 });

  const childNames = children.map(c => c.name).filter(Boolean).join(' & ') || 'your child';

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    allow_promotion_codes: true,
    metadata: { tempKey },
    subscription_data: {
      metadata: { tempKey },
      description: `Story of the Week for ${childNames}`,
    },
    success_url: `${appUrl}/app?sub_session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/app`,
  });

  res.json({ url: session.url });
}
