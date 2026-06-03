// Vercel Cron Job — runs every Monday at 8am AEST (10pm Sunday UTC)
// Generates one new personalised story for every active subscriber
// and sends a notification email with their passport magic link.

import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export const config = { maxDuration: 300 };

const ARCS = [
  { name: 'Discovery',  brief: 'Hero finds something unexpected that changes how they see the world' },
  { name: 'Challenge',  brief: 'Hero faces a difficulty, persists, and grows because of it' },
  { name: 'Friendship', brief: 'Hero makes a meaningful connection — with a person, animal, or place' },
  { name: 'Wonder',     brief: 'Hero experiences pure awe and delight at the beauty of something' },
  { name: 'Adventure',  brief: 'Hero embarks on a quest, gets lost (a little), and finds their way' },
  { name: 'Mystery',    brief: 'Hero discovers something curious and pieces together the answer' },
];

export default async function handler(req, res) {
  // Verify cron authenticity — Vercel sets x-vercel-cron-signature in production
  // Also accept manual trigger via CRON_SECRET for testing
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const appUrl = process.env.APP_URL || 'https://sunnystories.co';

  // Get all active subscriber tokens
  let tokens;
  try {
    tokens = await redis.smembers('sub_active');
  } catch(e) {
    console.error('Failed to fetch active subscribers:', e);
    return res.status(500).json({ error: 'Could not fetch subscribers' });
  }

  if (!tokens?.length) {
    return res.json({ delivered: 0, message: 'No active subscribers' });
  }

  console.log(`Weekly delivery: processing ${tokens.length} subscriber(s)`);

  const results = { delivered: 0, failed: 0, skipped: 0, errors: [] };

  for (const token of tokens) {
    try {
      const sub = await redis.get(`sub_${token}`);
      if (!sub) { results.skipped++; continue; }
      if (!sub.active) { results.skipped++; continue; }
      if (!sub.children?.length || !sub.selectedLocations?.length) { results.skipped++; continue; }

      // Generate 1 new story for this subscriber
      const story = await generateStory(sub, apiKey);
      if (!story) { results.skipped++; continue; }

      // Append to their collection
      const existing = await redis.get(`sub_stories_${token}`) || [];
      const updated = [...existing, story];
      await redis.set(`sub_stories_${token}`, updated, { ex: 94608000 });

      // Update passport — add new location if not already visited
      const passport = sub.passport || [];
      if (story.location && !passport.some(p => p.name === story.location)) {
        passport.push({ name: story.location, emoji: story.emoji || '📍', area: story.area || '' });
      }

      // Update subscriber record
      await redis.set(`sub_${token}`, {
        ...sub,
        passport,
        storyCount: updated.length,
        lastDelivery: Date.now(),
      }, { ex: 94608000 });

      // Send notification email
      await sendWeeklyNotification({
        email: sub.email,
        story,
        storyCount: updated.length,
        passportCount: passport.length,
        magicLink: `${appUrl}/app?sub_token=${token}`,
      });

      results.delivered++;
      console.log(`Delivered story #${updated.length} to subscriber ${token.slice(0, 8)}`);

    } catch(e) {
      results.failed++;
      results.errors.push({ token: token.slice(0, 8), error: e.message });
      console.error(`Failed for ${token.slice(0, 8)}:`, e);
    }
  }

  console.log(`Weekly delivery complete:`, results);
  return res.json(results);
}

// ── Story generation ──────────────────────────────────────────────────────────

async function generateStory(sub, apiKey) {
  const { children, selectedLocations, vibe, storyLength, storyCount = 0, passport = [] } = sub;

  // Pick hero — rotate through children each week
  const hero = children[storyCount % children.length];

  // Pick location — prefer unvisited ones
  const visitedNames = passport.map(p => p.name);
  const unvisited = selectedLocations.filter(l => !visitedNames.includes(l.name));
  const pool = unvisited.length > 0 ? unvisited : selectedLocations;
  const location = pool[storyCount % pool.length];

  // Pick arc — rotate through arcs
  const arc = ARCS[storyCount % ARCS.length];

  const interests = hero.interests?.join(', ') || 'exploring';
  const heroAge = hero.age || 6;
  const locDetail = `${location.name} (${location.area || 'Australia'})${location.desc ? ': ' + location.desc : ''}`;
  const wordTarget = storyLength >= 5 ? '550–700' : '300–400';
  const pageCount = 3;

  const prompt = `You are a warm, lyrical children's story author writing for Sunny Stories — personalised audio stories for Australian families.

Generate exactly 1 children's story using this brief:

STORY BRIEF:
- HERO = ${hero.name} (age ${heroAge})
- LOCATION = ${locDetail}
- MAIN INTEREST = ${interests}
- VIBE = ${vibe || 'adventurous and exciting'}
- ARC = ${arc.name}: ${arc.brief}

WRITING RULES:
- ${wordTarget} words total. Write for reading aloud — lyrical, warm, vivid.
- Hero appears by name within first 2 sentences.
- Location described with real, specific sensory details from the description provided.
- Interest drives the plot — not a background detail.
- Arc shape must be followed.
- Warm, joyful ending. Child feels seen and proud.
- Split into exactly ${pageCount} pages using [PAGE] as the separator.
- For well-known Australian landmarks, weave in 1–2 genuine facts as things the child discovers — never as narration.

AGE LANGUAGE:
- Ages 4–5: Short sentences, simple words, safe and magical world.
- Ages 6–7: Medium sentences, gentle challenge, curious and capable child.
- Ages 8–10: Richer vocabulary, real emotional depth, genuine Australian facts woven naturally.

OUTPUT: Respond ONLY with a valid JSON object. No markdown fences, no commentary.
{
  "title": "Specific evocative story title",
  "emoji": "🌊",
  "location": "${location.name}",
  "area": "${location.area || 'Australia'}",
  "hero": "${hero.name}",
  "costar": null,
  "interest": "${interests}",
  "sceneColor": "linear-gradient(135deg, #38a2c2, #306ca4)",
  "pages": ["page 1 text", "page 2 text", "page 3 text"]
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5', // Haiku: fast + cost-effective for batch cron delivery
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic ${response.status}: ${await response.text()}`);

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// ── Weekly notification email ─────────────────────────────────────────────────

async function sendWeeklyNotification({ email, story, storyCount, passportCount, magicLink }) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: 'Sunny Stories <stories@sunnystories.co>',
    to: email,
    subject: `✨ Story #${storyCount} just landed in ${story.hero}'s passport — ${story.title}`,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f5fbfd;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5fbfd">
<tr><td align="center" style="padding:40px 16px;">
  <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:20px;overflow:hidden;">
    <tr>
      <td bgcolor="#306ca4" align="center" style="padding:30px 40px;">
        <div style="font-size:40px;line-height:1;margin-bottom:8px;">${story.emoji || '✨'}</div>
        <div style="color:#ffffff;font-size:20px;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">New story ready</div>
        <div style="color:#c8e6f5;font-size:13px;margin-top:4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Story #${storyCount} · ${passportCount} place${passportCount !== 1 ? 's' : ''} explored</div>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 40px;">
        <h2 style="margin:0 0 6px;font-size:22px;color:#1a2e3a;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${story.title}</h2>
        <p style="margin:0 0 20px;color:#38a2c2;font-size:14px;font-weight:600;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">📍 ${story.location}${story.area ? ` · ${story.area}` : ''}</p>
        <p style="margin:0 0 24px;color:#4a6070;font-size:15px;line-height:1.65;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          This week's adventure for <strong style="color:#306ca4;">${story.hero}</strong> is ready — a brand new story stamping <strong>${story.location}</strong> into their Australia Story Passport.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
          <tr>
            <td align="center">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#38a2c2" style="border-radius:50px;padding:16px 40px;">
                    <a href="${magicLink}" style="color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;display:block;white-space:nowrap;">🗺️ Read Story #${storyCount}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:0;font-size:12px;color:#4a6070;text-align:center;line-height:1.7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          A new story arrives every week. Save this email to always find your passport.<br>
          🌏 ${passportCount} Australian location${passportCount !== 1 ? 's' : ''} explored so far.
        </p>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:20px 40px 28px;border-top:1px solid #eef6fa;">
        <p style="margin:0;font-size:12px;color:#4a6070;line-height:1.8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          Sunny Stories · Australia ·
          <a href="https://sunnystories.co" style="color:#38a2c2;text-decoration:none;">sunnystories.co</a>
        </p>
      </td>
    </tr>
  </table>
</td></tr>
</table>
</body>
</html>`,
  });
}
