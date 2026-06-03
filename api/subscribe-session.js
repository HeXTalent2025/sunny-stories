import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Session ID required' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(id);
  } catch(e) {
    return res.status(400).json({ error: 'Invalid session' });
  }

  if (session.status !== 'complete') {
    return res.status(402).json({ error: 'Subscription not complete' });
  }

  const tempKey = session.metadata?.tempKey;
  if (!tempKey) return res.status(400).json({ error: 'No form data key in session' });

  const formData = await redis.get(tempKey);
  if (!formData) {
    return res.status(404).json({ error: 'Form data expired — please contact hello@sunnystories.co with your receipt.' });
  }

  return res.json({
    formData,
    subscriptionId: session.subscription,
    customerId: session.customer,
    email: session.customer_details?.email,
  });
}
