import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { stories, sessionId, giftRecipient, bundleUpgrade } = req.body;
  if (!stories?.length || !sessionId) return res.status(400).json({ error: 'Missing stories or sessionId' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid session' });
  }
  if (session.payment_status !== 'paid') return res.status(402).json({ error: 'Payment not verified' });

  // Idempotency — if already saved for this session, return the existing token
  const existingToken = await redis.get(`saved_${sessionId}`);
  if (existingToken) {
    return res.json({ token: existingToken, email: session.customer_details?.email });
  }

  const email = session.customer_details?.email;
  const token = crypto.randomUUID();
  const appUrl = process.env.APP_URL || 'https://sunnystories.co';
  const magicLink = `${appUrl}/app?token=${token}`;
  const giftLink = giftRecipient
    ? `${appUrl}/gift?token=${token}&name=${encodeURIComponent(giftRecipient)}`
    : `${appUrl}/gift?token=${token}`;

  // Save stories — 1 year TTL
  await redis.set(`stories_${token}`, { stories, email, bundleUpgrade: true, createdAt: Date.now() }, { ex: 31536000 });
  // Mark session as saved to prevent duplicate emails
  await redis.set(`saved_${sessionId}`, token, { ex: 31536000 });

  // Send email
  const resend = new Resend(process.env.RESEND_API_KEY);
  const childNames = [...new Set(stories.map(s => s.hero))].join(' & ');
  const previewTitles = stories.slice(0, 3)
    .map(s => `<li style="margin:6px 0;color:#4a6070;">${s.emoji || '✨'} ${s.title}</li>`)
    .join('');

  await resend.emails.send({
    from: 'Sunny Stories <stories@sunnystories.co>',
    to: email,
    subject: stories.length === 1
      ? `🎧 ${childNames}'s personalised story is ready to listen`
      : `🎧 ${childNames}'s ${stories.length} audio stories are ready to listen`,
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
        <div style="font-size:36px;line-height:1;margin-bottom:10px;">☀️</div>
        <div style="color:#ffffff;font-size:26px;font-weight:700;letter-spacing:1px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Sunny Stories</div>
        <div style="color:#c8e6f5;font-size:14px;margin-top:6px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Personalised audio stories for Australian families</div>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding:36px 40px;">
        <h1 style="margin:0 0 12px;font-size:24px;color:#1a2e3a;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${stories.length === 1 ? 'Your story is ready! 🎧' : `Your ${stories.length} stories are ready! 🎧`}</h1>
        <p style="margin:0 0 24px;color:#4a6070;font-size:16px;line-height:1.6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          We've written ${stories.length === 1 ? 'an original story' : `${stories.length} original stories`} starring <strong style="color:#306ca4;">${childNames}</strong>,
          set in ${stories.length === 1 ? 'their favourite Australian location' : 'their favourite Australian locations'} — narrated in a warm Australian accent.
          Tap the button to open ${stories.length === 1 ? 'it' : 'your collection'} and start listening.
        </p>

        <!-- Story preview -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td bgcolor="#f0f8fc" style="border-radius:12px;padding:16px 20px;margin-bottom:24px;">
              <div style="font-size:11px;font-weight:700;color:#38a2c2;letter-spacing:1px;margin-bottom:10px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${stories.length === 1 ? 'YOUR STORY' : 'A PEEK AT YOUR COLLECTION'}</div>
              <ul style="margin:0;padding:0 0 0 18px;color:#4a6070;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.8;">
                ${previewTitles}
                ${stories.length > 3 ? `<li style="margin:4px 0;">…and ${stories.length - 3} more ${stories.length - 3 === 1 ? 'story' : 'stories'}</li>` : ''}
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
                    <a href="${magicLink}" style="color:#ffffff;text-decoration:none;font-size:17px;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;display:block;white-space:nowrap;">🎧 Open my audio stories</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <p style="margin:0;font-size:13px;color:#4a6070;line-height:1.7;text-align:center;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          This link opens your full collection instantly — no password needed.<br>
          <strong>Save this email</strong> so you can come back to read them any time.
        </p>

        ${giftRecipient ? `
        <!-- Gift link -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
          <tr>
            <td bgcolor="#fff5f3" style="border-radius:14px;padding:20px 24px;border:1px solid #f0c8bc;">
              <div style="font-size:11px;font-weight:700;color:#d86e59;letter-spacing:1px;margin-bottom:10px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">🎁 GIFT LINK FOR ${giftRecipient.toUpperCase()}</div>
              <p style="margin:0 0 16px;font-size:14px;color:#4a6070;line-height:1.6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                Share this link with ${giftRecipient} — they'll see a beautiful gift page with all 10 stories waiting inside.
              </p>
              <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td bgcolor="#d86e59" style="border-radius:50px;padding:14px 32px;">
                          <a href="${giftLink}" style="color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;display:block;white-space:nowrap;">🎁 Open ${giftRecipient}'s gift</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0;font-size:11px;color:#4a6070;text-align:center;line-height:1.6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                Or copy this link: <span style="color:#d86e59;">${giftLink}</span>
              </p>
            </td>
          </tr>
        </table>
        ` : ''}
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td align="center" style="padding:20px 40px 28px;border-top:1px solid #eef6fa;">
        <p style="margin:0;font-size:12px;color:#4a6070;line-height:1.8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          Sunny Stories · Sunshine Coast, QLD<br>
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
