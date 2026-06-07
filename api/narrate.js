// Narration via ElevenLabs — single call, no chunking.
//
// Previous approach chunked at 200→500 words and concatenated MP3 buffers.
// This caused browsers to read duration only from the first chunk's header,
// breaking: scrubber accuracy, word highlighting sync, and premature ended events.
//
// Single-call approach: ElevenLabs with-timestamps handles full story text
// (300–700 words) without quality issues. Correct MP3 header = correct
// duration = correct scrubber + highlighting throughout the full story.

import { Redis } from '@upstash/redis';
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export const config = { maxDuration: 120 };

// Convert character-level alignment → word-level timing array
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, token, storyIdx } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  // v3 cache key — single-chunk, correct duration metadata
  const cacheKey = (token && storyIdx !== undefined) ? `narration_v3_${token}_${storyIdx}` : null;

  // Check Redis cache first
  if (cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        if (typeof cached === 'string') {
          // Legacy format — audio only, no alignment
          return res.status(200).json({ audioBase64: cached, mimeType: 'audio/mpeg', cached: true });
        }
        return res.status(200).json({
          audioBase64: cached.audio, mimeType: 'audio/mpeg', cached: true,
          durationSeconds: cached.durationSeconds, wordAlignment: cached.wordAlignment,
        });
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
            stability: 0.80,          // Higher = more consistent volume throughout
            similarity_boost: 0.82,
            style: 0.12,              // Lower style = steadier energy, less drift
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
    const audioBase64 = data.audio_base64;

    // Word-level alignment for highlighting
    const wordAlignment = data.alignment ? charsToWordAlignment(data.alignment) : [];

    // Duration from last word's end time (more accurate than file-size estimate)
    const lastWord = wordAlignment[wordAlignment.length - 1];
    const durationSeconds = lastWord
      ? Math.ceil(lastWord.end) + 0.3
      : Math.round(Buffer.from(audioBase64, 'base64').length / 16000);

    // Persist to Redis — 1 year TTL
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
