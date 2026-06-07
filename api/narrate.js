import { Redis } from '@upstash/redis';

export const config = { maxDuration: 120 };

const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

// ── Text chunking ────────────────────────────────────────────────────────────
// ElevenLabs degrades in volume on very long inputs (1000+ words). We chunk
// at 500 words — large enough that most stories (300-400 words) are a single
// chunk, avoiding MP3 concatenation issues where browsers misread duration from
// only the first chunk's header (causes premature ended events + scrubber drift).
function splitIntoChunks(text, maxWords = 500) {
  const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = [];
  let wordCount = 0;

  for (const para of paragraphs) {
    const words = para.split(/\s+/).length;
    if (wordCount + words > maxWords && current.length > 0) {
      chunks.push(current.join('\n\n'));
      current = [para];
      wordCount = words;
    } else {
      current.push(para);
      wordCount += words;
    }
  }
  if (current.length) chunks.push(current.join('\n\n'));
  return chunks.length ? chunks : [text];
}

// ── Character-level alignment → word-level ───────────────────────────────────
function charsToWordAlignment(alignment) {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words = [];
  let wordChars = '', wordStart = null, wordEnd = null;
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (/\s/.test(ch)) {
      if (wordChars) {
        words.push({ word: wordChars, start: wordStart, end: wordEnd });
        wordChars = ''; wordStart = null;
      }
    } else {
      if (!wordChars) wordStart = starts[i];
      wordChars += ch;
      wordEnd = ends[i];
    }
  }
  if (wordChars) words.push({ word: wordChars, start: wordStart, end: wordEnd });
  return words;
}

// ── Single-chunk TTS call (with timestamps) ──────────────────────────────────
async function generateChunk(text, voiceId, apiKey) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.70,
          similarity_boost: 0.82,
          style: 0.18,
          use_speaker_boost: true,
        },
      }),
    }
  );
  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`ElevenLabs ${response.status}: ${err}`);
  }
  const data = await response.json();
  const audioBuffer = Buffer.from(data.audio_base64, 'base64');
  return { audioBuffer, alignment: data.alignment };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, storyLength, token, storyIdx } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  // v2 cache key — busts old concatenated-chunk cache entries that had duration issues
  const cacheKey = (token && storyIdx !== undefined) ? `narration_v2_${token}_${storyIdx}` : null;

  // Check Redis cache first — fail silently so ElevenLabs is always the fallback
  if (cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        if (typeof cached === 'string') {
          // Old cache format — audio only, no alignment
          const durationSeconds = Math.round((cached.length * 3 / 4) / 16000);
          return res.status(200).json({ audioBase64: cached, mimeType: 'audio/mpeg', cached: true, durationSeconds });
        } else {
          // New cache format — audio + word alignment
          return res.status(200).json({
            audioBase64: cached.audio, mimeType: 'audio/mpeg', cached: true,
            durationSeconds: cached.durationSeconds, wordAlignment: cached.wordAlignment,
          });
        }
      }
    } catch (e) {
      console.error('Redis cache read error (non-fatal):', e);
    }
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const apiKey  = process.env.ELEVENLABS_API_KEY;

  if (!voiceId || !apiKey) {
    return res.status(500).json({ error: 'Narration service not configured' });
  }

  try {
    // Split into chunks and generate sequentially — fixes volume fade on long texts
    // without hitting ElevenLabs' concurrent-request limit (max 3).
    const chunks = splitIntoChunks(text);
    const results = [];
    let timeOffset = 0;

    for (const chunk of chunks) {
      const { audioBuffer, alignment } = await generateChunk(chunk, voiceId, apiKey);
      // Offset this chunk's timestamps by the accumulated duration so far
      const offsetAlignment = {
        characters: alignment.characters,
        character_start_times_seconds: alignment.character_start_times_seconds.map(t => t + timeOffset),
        character_end_times_seconds: alignment.character_end_times_seconds.map(t => t + timeOffset),
      };
      results.push({ audioBuffer, alignment: offsetAlignment });
      // Advance offset by end time of last character in this chunk
      const chunkEnds = alignment.character_end_times_seconds;
      timeOffset += chunkEnds[chunkEnds.length - 1] || 0;
    }

    const audioBuffer = Buffer.concat(results.map(r => r.audioBuffer));
    const audioBase64 = audioBuffer.toString('base64');
    const durationSeconds = Math.round(timeOffset) || Math.round(audioBuffer.length / 16000);

    // Merge character alignments and convert to word-level
    const mergedAlignment = {
      characters: results.flatMap(r => r.alignment.characters),
      character_start_times_seconds: results.flatMap(r => r.alignment.character_start_times_seconds),
      character_end_times_seconds: results.flatMap(r => r.alignment.character_end_times_seconds),
    };
    const wordAlignment = charsToWordAlignment(mergedAlignment);

    // Persist to Redis — fail silently so audio is always returned even if caching fails
    if (cacheKey) {
      redis.set(cacheKey, { audio: audioBase64, wordAlignment, durationSeconds }, { ex: 31536000 }).catch(e =>
        console.error('Redis cache write error (non-fatal):', e)
      );
    }

    return res.status(200).json({ audioBase64, mimeType: 'audio/mpeg', durationSeconds, wordAlignment });
  } catch (e) {
    console.error('Narration error:', e);
    return res.status(500).json({ error: 'Could not generate narration — please try again' });
  }
}
