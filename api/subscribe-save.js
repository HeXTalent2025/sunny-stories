import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const TTL = 94608000; // ~3 years in seconds

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { stories, sessionId, profile } = req.body;
  if (!stories?.length || !sessionId || !profile) {
    return res.status(400).json({ error: 'Missing required data' });
  }

  // Idempotency — if already saved for this session, return existing token
  const existingToken = await redis.get(`sub_saved_${sessionId}`);
  if (existingToken) {
    const sub = await redis.get(`sub_${existingToken}`);
    return res.json({ token: existingToken, email: sub?.email });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch(e) {
    return res.status(400).json({ error: 'Invalid session' });
  }
  if (session.status !== 'complete') return res.status(402).json({ error: 'Subscription not complete' });

  const token = crypto.randomUUID();
  const email = session.customer_details?.email;
  const subscriptionId = session.subscription;
  const customerId = session.customer;
  const appUrl = process.env.APP_URL || 'https://sunnystories.co';
  const magicLink = `${appUrl}/app?sub_token=${token}`;

  // Build initial passport from story locations
  const passportLocations = stories
    .filter(s => s.location)
    .map(s => ({ name: s.location, emoji: s.emoji || '📍', area: s.area || '' }));
  const passport = [...new Map(passportLocations.map(l => [l.name, l])).values()];

  // Save subscriber profile
  await redis.set(`sub_${token}`, {
    email,
    children: profile.children || [],
    selectedLocations: profile.selectedLocations || [],
    vibe: profile.vibe || '',
    storyLength: profile.storyLength || 3,
    subscriptionId,
    customerId,
    createdAt: Date.now(),
    active: true,
    passport,
    storyCount: stories.length,
    lastDelivery: Date.now(),
  }, { ex: TTL });

  // Save subscriber stories
  await redis.set(`sub_stories_${token}`, stories, { ex: TTL });

  // Lookup indexes for webhooks
  await redis.set(`sub_customer_${customerId}`, token, { ex: TTL });

  // Add to active subscribers set (used by weekly cron)
  await redis.sadd('sub_active', token);

  // Mark session saved (idempotency)
  await redis.set(`sub_saved_${sessionId}`, token, { ex: TTL });

  // Send welcome email
  const resend = new Resend(process.env.RESEND_API_KEY);
  const childNames = [...new Set(stories.map(s => s.hero).filter(Boolean))].join(' & ');
  const previewTitles = stories.slice(0, 3)
    .map(s => `<li style="margin:6px 0;color:#4a6070;">${s.emoji || '✨'} ${s.title}</li>`)
    .join('');

  await resend.emails.send({
    from: 'Sunny Stories <stories@sunnystories.co>',
    to: email,
    subject: `🗺️ ${childNames}'s Story Passport has begun — first ${stories.length === 1 ? 'story' : `${stories.length} stories`} inside!`,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f5fbfd;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5fbfd">
<tr><td align="center" style="padding:40px 16px;">
  <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:20px;overflow:hidden;">

    <!-- Header -->
    <tr>
      <td bgcolor="#306ca4" align="center" style="padding:36px 40px;">
        <div style="font-size:36px;line-height:1;margin-bottom:10px;">🗺️</div>
        <div style="color:#ffffff;font-size:26px;font-weight:700;letter-spacing:1px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Sunny Stories</div>
        <div style="color:#c8e6f5;font-size:14px;margin-top:6px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Australia Story Passport · Story of the Week</div>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding:36px 40px;">
        <h1 style="margin:0 0 12px;font-size:24px;color:#1a2e3a;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${childNames}'s passport has begun! 🎉</h1>
        <p style="margin:0 0 24px;color:#4a6070;font-size:16px;line-height:1.6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          Your first ${stories.length === 1 ? 'story is' : `${stories.length} stories are`} ready to explore. A brand new story will arrive every week — stamping a new Australian location into ${childNames}'s passport one adventure at a time.
        </p>

        <!-- Story preview -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td bgcolor="#f0f8fc" style="border-radius:12px;padding:16px 20px;margin-bottom:24px;">
              <div style="font-size:11px;font-weight:700;color:#38a2c2;letter-spacing:1px;margin-bottom:10px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">FIRST STORIES IN THE PASSPORT</div>
              <ul style="margin:0;padding:0 0 0 18px;color:#4a6070;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.8;">
                ${previewTitles}
              </ul>
            </td>
          </tr>
        </table>

        <!-- Button -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr>
            <td align="center">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#38a2c2" style="border-radius:50px;padding:16px 40px;">
                    <a href="${magicLink}" style="color:#ffffff;text-decoration:none;font-size:17px;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;display:block;white-space:nowrap;">🗺️ Open my Story Passport</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <p style="margin:0;font-size:13px;color:#4a6070;line-height:1.7;text-align:center;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          A new story arrives every week. <strong>Save this email</strong> to always find your passport — no login needed, just click the button above.
        </p>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td align="center" style="padding:20px 40px 28px;border-top:1px solid #eef6fa;">
        <p style="margin:0;font-size:12px;color:#4a6070;line-height:1.8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          Sunny Stories · Australia<br>
          <a href="https://sunnystories.co" style="color:#38a2c2;text-decoration:none;">sunnystories.co</a>
          &nbsp;·&nbsp;
          <a href="https://www.instagram.com/sunnystoriesco/" style="color:#38a2c2;text-decoration:none;">@sunnystoriesco</a>
        </p>
      </td>
    </tr>

  </table>
</td></tr>
</table>
</body>
</html>`,
  });

  res.json({ token, email });
}
