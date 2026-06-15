#!/usr/bin/env node
// Generates narrated MP3 audio clips for all 10 Instagram posts.
// Calls the live ElevenLabs narrate endpoint already deployed on sunnystories.co.
//
// Usage:
//   node generate-audio.js
//
// Output: audio/post-01-uluru.mp3 through audio/post-10-kakadu.mp3
//
// Requires Node 18+ (built-in fetch). Run from this folder:
//   cd marketing/instagram && node generate-audio.js

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'audio');
mkdirSync(OUT_DIR, { recursive: true });

const API_URL = 'https://sunnystories.co/api/narrate';

// ── Story excerpts for each Instagram post ────────────────────────────────────
// Each ~75–90 words — approximately 30 seconds of narration at Hannah's pace.
// Written in Sunny Stories style: warm, lyrical, child as hero, specific place.

const EXCERPTS = [
  {
    file: 'post-01-uluru.mp3',
    location: 'Uluru',
    text: `Maya had been standing at the base of Uluru for three whole minutes, and she still couldn't quite believe it was real.

The rock rose above her — 348 metres of ancient sandstone, glowing a deep, impossible red in the afternoon light. She had read that it was 550 million years old. Older than most life on Earth. Older than fish. Older than trees.

She pressed her palm flat against the warm surface, and tried to feel all those years moving through the stone.

She couldn't. But she tried.`,
  },
  {
    file: 'post-02-great-barrier-reef.mp3',
    location: 'Great Barrier Reef',
    text: `Oscar had never put his face in the ocean before.

He had paddled, and jumped waves, and been very brave about the cold. But his face had always stayed dry.

He went under.

The whole world changed.

A fish the colour of a sunset drifted past his nose. Then another, striped black and white. Then a parrotfish — electric blue — that turned and vanished into a curtain of coral so orange it looked like it was on fire.

Oscar came up laughing, his mouth full of salt water, already pulling his mask back down.`,
  },
  {
    file: 'post-03-cradle-mountain.mp3',
    location: 'Cradle Mountain',
    text: `At the edge of the tarn, something moved.

Maya went very still.

A wombat. Enormous and round and completely unbothered, grazing on the alpine grass with the focused dedication of an animal that had much better things to do than notice people.

It lifted its heavy head. Looked at Maya with small, dark eyes. Decided she was not interesting. Went back to eating.

Maya stood there for a very long time after, in the thin cold air, not wanting to move. Not wanting to break whatever this was.

Some moments are too good to hurry.`,
  },
  {
    file: 'post-04-rottnest-island.mp3',
    location: 'Rottnest Island',
    text: `A small round face looked back at Lily from behind the bush.

It had big dark eyes, a little black nose, and — she was absolutely certain — a smile.

"Hello," said Lily.

The animal blinked.

"It's a quokka," said Mum, crouching beside her. "They only live here, on Rottnest Island. Nowhere else in the whole world."

Lily looked at the quokka. The quokka looked at Lily. Neither of them moved.

Another quokka appeared. Then another. Three quokkas now, all of them smiling.

Lily looked at Mum. Mum was smiling too. So was Lily.`,
  },
  {
    file: 'post-05-blue-mountains.mp3',
    location: 'Blue Mountains',
    text: `Oscar stopped at the lookout and turned around.

He could see everything.

The valley dropped away below — enormous and green and stretching to the horizon, filled with a haze that was genuinely, actually blue. He had thought that was just a name. But Mum had explained: eucalyptus trees release tiny oil droplets into the air, and the droplets scatter the light, and the light turns blue.

Three million years of gum trees, turning the whole mountain air into something you could see.

"Whoa," said Oscar. It was all he had.`,
  },
  {
    file: 'post-06-phillip-island.mp3',
    location: 'Phillip Island',
    text: `They came in at dusk, and they were so small.

Lily had expected penguins to be tall and serious, like the ones in books. But these ones barely reached her knee. They waddled, and bumped into each other, and made small determined sounds.

And then one of them stopped.

It tilted its head, and looked right at Lily, with bright eyes that seemed to know something.

Lily felt her heart do something it had never done before.

It wasn't quite love. It wasn't quite awe. It was something in between, with wonder folded into it.`,
  },
  {
    file: 'post-07-daintree-rainforest.mp3',
    location: 'Daintree Rainforest',
    text: `They heard it before they saw it.

A sound like a very large something, moving through very old trees, taking its time.

Maya went completely still.

And then it stepped out of the undergrowth.

A cassowary. Taller than Dad. Bright blue neck, red wattle, ancient yellow eyes, and a helmet of bone on top of its head that had been there, in some form, for eighty million years.

It looked at Maya. Maya looked at it.

The Daintree Rainforest is 180 million years old. And every living thing in it knows exactly who it is.`,
  },
  {
    file: 'post-08-bondi-beach.mp3',
    location: 'Bondi Beach',
    text: `The wave picked Oscar up like he weighed nothing at all.

One moment he was standing in the white water with his board, slightly nervous, watching the horizon. Then the instructor shouted now, and he pushed up, and his feet found the board, and the wave found him —

And he was standing.

Arms out. Grinning so hard his face hurt. Salt water everywhere.

The wave carried him all the way to the sand, and when it set him down, he turned around immediately to find the next one.

This was Bondi Beach. And Oscar was a surfer.`,
  },
  {
    file: 'post-09-kangaroo-island.mp3',
    location: 'Kangaroo Island',
    text: `The sea lion pup looked up at Lily from the sand.

It was perhaps three weeks old. Its eyes were enormous and dark and completely unafraid. It had never learned to be afraid of people, because no one had ever given it a reason.

Kangaroo Island has no foxes. No rabbits. No animals that came from somewhere else to cause trouble.

Just this: a beach full of sea lions living as they always had, and a small girl standing at a respectful distance, very quietly crying, because she hadn't expected it to feel like this.`,
  },
  {
    file: 'post-10-kakadu.mp3',
    location: 'Kakadu National Park',
    text: `Maya stood in front of the rock and didn't speak for a very long time.

The paintings had been here for twenty thousand years. Hands pressed flat against the stone, outlined in ochre, still clear.

Twenty thousand years ago, a person stood in this exact spot. Pressed their palm against the rock. Left something of themselves behind.

And here was Maya, pressing her palm against the same stone, in the same spot, on the other side of all that time.

"Do you feel it?" Dad asked quietly.

Maya nodded. She couldn't explain it. But she felt it.`,
  },
];

// ── Generate each MP3 ─────────────────────────────────────────────────────────

async function generateAudio(excerpt) {
  console.log(`⏳ Generating: ${excerpt.location}...`);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: excerpt.text }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  if (!data.audioBase64) throw new Error('No audio returned');

  const bytes = Buffer.from(data.audioBase64, 'base64');
  const outPath = join(OUT_DIR, excerpt.file);
  writeFileSync(outPath, bytes);

  const duration = data.durationSeconds ? `${Math.round(data.durationSeconds)}s` : 'unknown duration';
  console.log(`✅ Saved: ${excerpt.file} (${duration})`);
  return outPath;
}

async function main() {
  console.log(`\n🎙️  Sunny Stories — Instagram Audio Generator`);
  console.log(`📁 Output: ${OUT_DIR}\n`);

  let success = 0;
  for (const excerpt of EXCERPTS) {
    try {
      await generateAudio(excerpt);
      success++;
      // Small delay between calls to be kind to the API
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error(`❌ Failed: ${excerpt.location} — ${e.message}`);
    }
  }

  console.log(`\n🎉 Done! ${success}/${EXCERPTS.length} audio files generated.`);
  console.log(`📂 Find your MP3s in: marketing/instagram/audio/\n`);
}

main();
