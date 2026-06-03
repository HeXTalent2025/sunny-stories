import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

// ── Content moderation ──────────────────────────────────────────────────────
// Runs before Stripe session creation so we never take payment for content
// we can't generate. Uses Claude Haiku — fast, cheap, nuanced.
async function moderateInputs(children, selectedLocations, vibe, friends = []) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { safe: true }; // fail open if key missing

  const names     = [...children.map(c => c.name), ...(friends || [])].filter(Boolean).join(', ');
  const interests = children.map(c => (c.interests || []).join(', ')).filter(Boolean).join('; ');
  const locations = (selectedLocations || []).map(l => l.name || l).filter(Boolean).join(', ');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: `You are a content moderator for a children's story platform (ages 2–12). Check if these user-submitted inputs are appropriate for generating children's stories.

Child names: ${names || '(none)'}
Interests / loves: ${interests || '(none)'}
Locations: ${locations || '(none)'}
Family vibe: ${vibe || '(none)'}

Respond with JSON only — no extra text.
If all inputs are appropriate: {"safe":true}
If any input contains profanity, hate speech, graphic violence, adult/sexual themes, or anything unsuitable for young children: {"safe":false,"reason":"one short sentence explaining what was flagged"}

Treat children's toy guns, superhero fighting, sports, mild scary stories, and similar age-appropriate themes as safe.`,
        }],
      }),
    });

    if (!response.ok) return { safe: true }; // fail open on API error

    const data = await response.json();
    const text  = data.content?.[0]?.text?.trim() || '{"safe":true}';
    // Strip any accidental markdown fences
    const clean = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/,'').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('Moderation check error (non-fatal):', e);
    return { safe: true }; // always fail open — don't block legitimate purchases
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { children, friends, selectedLocations, vibe, storyLength, plan } = req.body;
  if (!children?.length) return res.status(400).json({ error: 'No children provided' });
  const isSingle = plan === 'single';

  // ── Moderate inputs before touching Stripe ──────────────────────────────
  const moderation = await moderateInputs(children, selectedLocations, vibe, friends);
  if (!moderation.safe) {
    return res.status(400).json({
      error: 'moderation',
      message: moderation.reason || 'One or more inputs contain content that isn\'t suitable for children\'s stories. Please review what you\'ve entered and try again.',
    });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const appUrl = process.env.APP_URL || 'https://sunnystories.co';

  // Save form data temporarily — retrieved after Stripe redirects back
  const tempKey = `form_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await redis.set(tempKey, { children, friends: friends || [], selectedLocations, vibe, storyLength, plan: plan || 'bundle' }, { ex: 7200 });

  const childNames = children.map(c => c.name).filter(Boolean).join(' & ') || 'your child';

  const productName = isSingle
    ? 'Sunny Stories — 1 Personalised Audio Story'
    : 'Sunny Stories — 10 Personalised Audio Stories';
  const productDesc = isSingle
    ? `A personalised audio story for ${childNames}, set in their favourite Australian location — narrated in a warm Australian accent.`
    : `10 personalised audio stories for ${childNames}, set in their favourite Australian locations — narrated in a warm Australian accent.`;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'aud',
        product_data: { name: productName, description: productDesc },
        unit_amount: isSingle ? 299 : 2500,
      },
      quantity: 1,
    }],
    mode: 'payment',
    allow_promotion_codes: true,
    metadata: { tempKey },
    success_url: `${appUrl}/app?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/app`,
  });

  res.json({ url: session.url });
}
