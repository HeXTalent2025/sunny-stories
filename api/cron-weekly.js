// Vercel Cron Job — runs every Monday at 8am AEST (10pm Sunday UTC)
// Generates one new personalised story for every active subscriber
// and sends a notification email with their passport magic link.

import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export const config = { maxDuration: 300 };

// Curated Australian landmark discovery pool — used once family's chosen
// locations are exhausted, keeping the passport growing week after week.
// Ordered roughly by iconic status so the most famous locations come first.
const AUSTRALIAN_LANDMARKS = [
  { name:'Uluru', area:'Red Centre, NT', emoji:'🪨', desc:'Uluru rises 348 metres from the flat red desert, glowing brilliant orange at sunrise. Sacred to the Anangu people and more than 500 million years old.' },
  { name:'Great Barrier Reef', area:'Tropical QLD', emoji:'🐠', desc:'The world\'s largest coral reef system stretches 2,300km along Queensland\'s coast. Glass-bottomed boats reveal staghorn coral, sea turtles and thousands of tropical fish.' },
  { name:'Sydney Opera House', area:'Sydney, NSW', emoji:'🎭', desc:'The iconic sail-roofed building sits on Bennelong Point with more than one million ceramic tiles covering its shells. On the forecourt, buskers perform beside the sparkling harbour.' },
  { name:'Blue Mountains', area:'Katoomba, NSW', emoji:'🏔️', desc:'The Three Sisters rock formation rises from an ancient valley of eucalyptus forest that turns hazy blue from oil droplets in the air. The Scenic Railway plunges 545 metres into the rainforest below.' },
  { name:'Great Ocean Road', area:'Southwest VIC', emoji:'🌊', desc:'The Twelve Apostles limestone stacks rise from the Southern Ocean surf. Wild koalas cling to trees at Kennett River, and Gibson Steps puts visitors right at the base of the cliffs.' },
  { name:'Kakadu National Park', area:'Top End, NT', emoji:'🐊', desc:'Australia\'s largest national park has Aboriginal rock art sites up to 20,000 years old still painted vividly on sandstone cliffs. The Yellow Water Billabong glides past saltwater crocodiles.' },
  { name:'Phillip Island', area:'Phillip Island, VIC', emoji:'🐧', desc:'Every evening at dusk, hundreds of little penguins waddle ashore from Bass Strait to their burrows — the world\'s smallest penguins marching past in a ritual millions of years old.' },
  { name:'Bondi Beach', area:'Sydney, NSW', emoji:'🏄', desc:'A crescent of golden sand one kilometre long where surfers ride waves from New Zealand. The coastal walk to Coogee follows clifftops past blowholes and sea caves where spray shoots through the rock.' },
  { name:'Daintree Rainforest', area:'Far North QLD', emoji:'🌿', desc:'The oldest surviving tropical rainforest on Earth — over 180 million years old — meets the Great Barrier Reef at Cape Tribulation. Cassowaries stride through the undergrowth and Boyd\'s forest dragons cling to tree trunks.' },
  { name:'Kangaroo Island', area:'SA', emoji:'🦁', desc:'Australia\'s third-largest island has no foxes or rabbits — just a dense population of koalas, wallabies, echidnas and sea lions. Seal Bay allows visitors to walk among a wild Australian sea lion colony.' },
  { name:'Rottnest Island', area:'Perth, WA', emoji:'🐾', desc:'A car-free island 19km off Fremantle, home to the quokka — small wallabies so approachable they almost seem to smile. Snorkelling off The Basin reveals one of WA\'s best coral gardens.' },
  { name:'Cradle Mountain', area:'Central TAS', emoji:'🏔️', desc:'The jagged dolerite peak rises from ancient alpine moorland. Wombats graze on the lawns at Dove Lake at dusk, completely unafraid of people. The pencil pine forest is found nowhere else on Earth.' },
  { name:'Whitsunday Islands', area:'QLD', emoji:'⛵', desc:'74 tropical islands in the heart of the Great Barrier Reef Marine Park. Whitehaven Beach has swirling white silica sand so pure it stays cool even in summer heat.' },
  { name:'Katherine Gorge', area:'Nitmiluk, NT', emoji:'🌊', desc:'Thirteen sandstone gorges carved by the Katherine River glow deep ochre in afternoon light. Visitors canoe between towering walls and swim in jade-green pools where freshwater crocodiles bask nearby.' },
  { name:'Taronga Zoo', area:'Sydney, NSW', emoji:'🦒', desc:'Perched on Sydney Harbour\'s north shore, Taronga\'s animals look out over the Opera House and Harbour Bridge. Giraffes graze with the city skyline behind them.' },
  { name:'Healesville Sanctuary', area:'Yarra Valley, VIC', emoji:'🦘', desc:'The best platypus viewing in Australia — a purpose-built observation area lets you watch them dive and forage through glass. Echidnas, wombats, dingoes and Tasmanian devils also live here.' },
  { name:'Litchfield National Park', area:'Darwin surrounds, NT', emoji:'🌿', desc:'Crystal-clear swimming holes beneath cascading waterfalls including Florence Falls and Wangi Falls. Magnetic termite mounds stand like tombstones across the open plains — built to always face north-south.' },
  { name:'Bay of Fires', area:'Northeast TAS', emoji:'🔶', desc:'Some of the most extraordinary beaches in the world: white sand, brilliant turquoise water and giant granite boulders painted vivid orange by a lichen unique to this coastline.' },
  { name:'Jervis Bay', area:'NSW', emoji:'🐬', desc:'Home to some of the whitest sand in the world and water so clear it looks Caribbean. A pod of around 100 bottlenose dolphins lives permanently in the bay and swims alongside kayaks daily.' },
  { name:'The Pinnacles', area:'Cervantes, WA', emoji:'🗿', desc:'Thousands of ancient limestone pillars rise from yellow sand in Nambung National Park, some reaching four metres tall. The alien landscape glows amber at sunset as emus wander between the columns.' },
  { name:'Sovereign Hill', area:'Ballarat, VIC', emoji:'⛏️', desc:'A living museum recreating 1850s Ballarat at the height of the Gold Rush. Visitors pan for real gold in the creek and watch underground mine re-enactments in the tunnels below.' },
  { name:'Wineglass Bay', area:'Freycinet, TAS', emoji:'🌊', desc:'A perfect semicircle of pink granite sand cradled between forested peninsulas, accessible by a 45-minute walk over the Freycinet saddle. Fur seals and dolphins frequent the bay below.' },
  { name:'Kings Canyon', area:'Watarrka, NT', emoji:'🏜️', desc:'A 300-metre-deep canyon where the rim walk reveals the Lost City — hundreds of rounded sandstone domes sculpted over millions of years. A hidden gorge called the Garden of Eden holds a permanent waterhole.' },
  { name:'Monkey Mia', area:'Shark Bay, WA', emoji:'🐬', desc:'Wild bottlenose dolphins have voluntarily come to this beach to interact with people for over 60 years. Rangers allow visitors to wade in and offer fish each morning — one of Australia\'s most extraordinary encounters.' },
  { name:'Springbrook National Park', area:'Gold Coast Hinterland, QLD', emoji:'🦋', desc:'A glowworm tour takes families into a dark canyon where thousands of bioluminescent glowworms turn the rock walls into a constellation. Natural Arch is a spectacular cave carved by a waterfall.' },
  { name:'Cable Beach', area:'Broome, WA', emoji:'🌅', desc:'Twenty-two kilometres of white sand backed by dramatic red pindan cliffs in the Kimberley. Camel trains carry families along the waterline at sunset in one of Australia\'s most iconic experiences.' },
  { name:'Australian War Memorial', area:'Canberra, ACT', emoji:'🪖', desc:'The Last Post ceremony at 4:55pm daily, where a bugler plays and a family lays a wreath for a fallen serviceperson, is deeply moving even for young children. Free entry, extraordinary collections.' },
  { name:'Grampians National Park', area:'Southwest VIC', emoji:'🏔️', desc:'Ancient sandstone ranges rise dramatically from the flat farming plains. Aboriginal rock art sites are among the most significant in southeastern Australia, and eastern grey kangaroos graze in the valleys at dawn.' },
  { name:'Dandenong Ranges', area:'Melbourne, VIC', emoji:'🌿', desc:'Towering mountain ash trees and giant tree ferns fill cool gullies just 40km from Melbourne. Puffing Billy — a beloved century-old steam train — winds through the forests to Emerald Lake.' },
  { name:'Lone Pine Koala Sanctuary', area:'Brisbane, QLD', emoji:'🐨', desc:'The world\'s first and largest koala sanctuary is home to over 130 koalas. Families can hold a koala for a photo and hand-feed kangaroos in a free-range paddock.' },
  { name:'Carnarvon Gorge', area:'Central QLD', emoji:'🪨', desc:'A sandstone gorge in central Queensland contains one of Australia\'s finest collections of Aboriginal rock art — ochre stencils of hands and animals thousands of years old.' },
  { name:'Tidbinbilla Nature Reserve', area:'Canberra, ACT', emoji:'🦘', desc:'Forty-five minutes from Canberra, this fenced sanctuary lets visitors walk freely among emus, kangaroos and wallabies. The platypus viewing boardwalk is one of the most reliable spots in the country.' },
];

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

  // Pick location:
  // Phase 1 — work through the family's chosen favourites first
  // Phase 2 — once those are exhausted, auto-discover Australian landmarks
  //           from our curated database so the passport keeps growing
  const visitedNames = passport.map(p => p.name);
  const unvisitedSelected = selectedLocations.filter(l => !visitedNames.includes(l.name));

  let location;
  if (unvisitedSelected.length > 0) {
    // Still have family favourites to explore
    location = unvisitedSelected[storyCount % unvisitedSelected.length];
  } else {
    // All chosen spots visited — start discovering Australia from our landmark database
    const unvisitedLandmarks = AUSTRALIAN_LANDMARKS.filter(l => !visitedNames.includes(l.name));
    if (unvisitedLandmarks.length > 0) {
      location = unvisitedLandmarks[storyCount % unvisitedLandmarks.length];
    } else {
      // Visited everything — cycle back to family favourites with fresh arcs
      location = selectedLocations[storyCount % selectedLocations.length];
    }
  }

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
