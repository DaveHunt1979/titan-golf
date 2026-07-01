// Caddie speak — Claude generates Chip/Birdie banter, ElevenLabs voices it
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const EL_KEY        = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
const VOICE_CHIP    = Deno.env.get('EL_VOICE_CHIP')    ?? 'x1fhuXF6G79K5aYpNhjy';
const VOICE_BIRDIE  = Deno.env.get('EL_VOICE_BIRDIE')  ?? 'ZzEULG032UlK7V80OKE5';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function claudeText(prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) return '';
  const data = await res.json();
  return (data.content?.[0]?.text ?? '').trim();
}

async function tts(text: string, voiceId: string): Promise<string> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': EL_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body: JSON.stringify({
      text, model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      speed: 1.0,
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs: ${await res.text()}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const { mode, voice = 'chip', hole, par, yardage, si, players, text } = body;

    // ── Intro mode: Chip speaks first, Birdie responds ──────────────
    if (mode === 'intro') {
      const names = (players ?? []).join(', ') || 'lads';

      const [chipScript, birdieScript] = await Promise.all([
        claudeText(`You are Chip, a cheeky golf commentator. Welcome the players (${names}) to their round in one punchy sentence. Reference that you and Birdie are hosting. Be funny and slightly self-deprecating — something like "here to ruin... I mean coach you round." Under 25 words. No quotes or stage directions.`),
        claudeText(`You are Birdie, the enthusiastic co-host to Chip. Respond to Chip's welcome with one short line — hype up the players (${names}) with genuine warmth and a cheeky twist. Under 20 words. No quotes or stage directions.`),
      ]);

      const [chipAudio, birdieAudio] = await Promise.all([
        tts(chipScript || `Chip here, and Birdie too — ready to coach you round ${names}. Let's have it!`, VOICE_CHIP),
        tts(birdieScript || `You're all going to be brilliant today. Probably. Good luck lads!`, VOICE_BIRDIE),
      ]);

      return new Response(JSON.stringify({ chipAudio, birdieAudio, chipScript, birdieScript }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // ── Outro mode: Chip & Birdie sign off with final score ──────────────
    if (mode === 'outro') {
      const names = (players ?? []).join(', ') || 'lads';
      const score = body.score ?? '';

      const [chipScript, birdieScript] = await Promise.all([
        claudeText(`You are Chip, quick-witted golf caddie. The round is done for ${names} — final score: ${score}. Give a punchy send-off in one sentence, hand to Birdie for the last word. Under 25 words. No quotes, no stage directions.`),
        claudeText(`You are Birdie, enthusiastic golf co-host. Say a warm, slightly cheeky goodbye to ${names} after their round (${score}). One sentence, under 20 words. No quotes, no stage directions.`),
      ]);

      const [chipAudio, birdieAudio] = await Promise.all([
        tts(chipScript || `Well played ${names}! ${score} — not bad at all. Over to Birdie for the final word.`, VOICE_CHIP),
        tts(birdieScript || `Brilliant effort! We'll see you back on the course very soon. Take care!`, VOICE_BIRDIE),
      ]);

      return new Response(JSON.stringify({ chipAudio, birdieAudio, chipScript, birdieScript }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // ── Back 9 mode: Chip summarises front 9, Birdie adds abuse ────────
    if (mode === 'back9') {
      const names    = (players ?? []).join(', ') || 'lads';
      const format   = body.format ?? 'stableford';
      const frontPts = body.frontPts ?? 0;
      const frontVsPar: number = body.frontVsPar ?? 0;
      const statsStr = format === 'stableford'
        ? `${frontPts} point${frontPts === 1 ? '' : 's'} on the front 9`
        : `${frontVsPar >= 0 ? '+' : ''}${frontVsPar} after the front 9`;

      const [chipScript, birdieScript] = await Promise.all([
        claudeText(`You are Chip, quick-witted golf caddie. Summarise the front 9 for ${names}: ${statsStr}. One punchy sentence then hand over to Birdie. Under 30 words. No quotes, no stage directions.`),
        claudeText(`You are Birdie, enthusiastic golf co-host. React to ${names}'s front 9 (${statsStr}) with a warm but cheeky dig. One sentence, under 20 words. No quotes, no stage directions.`),
      ]);

      const [chipAudio, birdieAudio] = await Promise.all([
        tts(chipScript || `Front nine done ${names} — ${statsStr}. Over to Birdie for some back nine wisdom.`, VOICE_CHIP),
        tts(birdieScript || `Not bad! Can you hold it together for the back nine? Statistically unlikely, but here we go!`, VOICE_BIRDIE),
      ]);

      return new Response(JSON.stringify({ chipAudio, birdieAudio, chipScript, birdieScript }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // ── Hole mode: generate banter then voice it ─────────────────────
    if (hole && par && players?.length) {
      const yardsStr = yardage ? `, ${yardage} yards` : '';
      const siStr    = si     ? `, stroke index ${si}` : '';
      const voiceName = voice === 'birdie' ? 'Birdie' : 'Chip';
      const otherName = voice === 'birdie' ? 'Chip'   : 'Birdie';
      const playerList = players.join(', ');

      const script = await claudeText(
        `You are ${voiceName}, a quick-witted golf caddie and commentator (your co-host is ${otherName}).\n\nHole ${hole}, par ${par}${yardsStr}${siStr}. Players: ${playerList}.\n\nAnnounce the hole stats then add a cheeky, affectionate dig at one player by first name. Sound like a local caddie who knows these lads well. Warm and funny. Under 45 words. No hashtags, no stage directions, no quotes — just spoken words.`,
      );

      const voiceId = voice === 'birdie' ? VOICE_BIRDIE : VOICE_CHIP;
      const audio   = await tts(
        script || `Hole ${hole}. Par ${par}${yardsStr}. Good luck ${playerList}.`,
        voiceId,
      );

      return new Response(JSON.stringify({ audio, script }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // ── Direct TTS: just voice the provided text ──────────────────────
    if (text) {
      const voiceId = voice === 'birdie' ? VOICE_BIRDIE : VOICE_CHIP;
      const audio   = await tts(text, voiceId);
      return new Response(JSON.stringify({ audio }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    return new Response(JSON.stringify({ error: 'Provide mode:intro, hole+par+players, or text' }), {
      status: 400, headers: CORS,
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
