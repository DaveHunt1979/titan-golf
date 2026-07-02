// voice-command — STT (Whisper) → intent (Claude) → TTS (ElevenLabs)
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const EL_KEY        = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
const OPENAI_KEY    = Deno.env.get('OPENAI_API_KEY') ?? '';
const VOICE_CHIP    = Deno.env.get('EL_VOICE_CHIP')   ?? 'x1fhuXF6G79K5aYpNhjy';
const VOICE_BIRDIE  = Deno.env.get('EL_VOICE_BIRDIE') ?? 'ZzEULG032UlK7V80OKE5';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function transcribe(audioBase64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
  const form  = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/m4a' }), 'command.m4a');
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  const res  = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: form,
  });
  const data = await res.json();
  return (data.text ?? '').trim();
}

async function interpret(transcript: string, ctx: Record<string, unknown>): Promise<{
  voice: 'chip' | 'birdie';
  response: string;
  action?: { type: string; club?: string; distance?: number } | null;
}> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are the AI caddie for a golf scoring app. Two voices: Chip (analytical, stats-focused) and Birdie (warm, motivational, cheeky).

Current game context:
${JSON.stringify(ctx, null, 2)}

The player just said: "${transcript}"

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "voice": "chip" or "birdie",
  "response": "spoken reply under 35 words, conversational, no stage directions",
  "action": null or { "type": "log_shot", "club": "club name", "distance": 150 }
}

Rules:
- Stats / score / yardage questions → Chip
- Encouragement / banter / celebration → Birdie
- Shot logging ("7 iron, 150 yards" / "log driver 280") → extract club + distance, set action
- Club advice ("what club?") → Chip recommends based on yardage in context
- If unclear, Birdie says something warm and asks them to repeat`,
      }],
    }),
  });
  const data = await res.json();
  const raw  = (data.content?.[0]?.text ?? '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { voice: 'birdie', response: "Sorry, didn't quite catch that — give it another go!", action: null };
  }
}

async function tts(text: string, voiceId: string): Promise<string> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': EL_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body: JSON.stringify({
      text, model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs: ${await res.text()}`);
  const buf   = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { audio, context } = await req.json();
    if (!audio) return new Response(JSON.stringify({ error: 'audio required' }), { status: 400, headers: CORS });

    const transcript = await transcribe(audio);
    if (!transcript) {
      const fallbackAudio = await tts("I didn't hear anything — try again!", VOICE_BIRDIE);
      return new Response(JSON.stringify({ audio: fallbackAudio, transcript: '', voice: 'birdie', action: null }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const { voice, response, action } = await interpret(transcript, context ?? {});
    const voiceId     = voice === 'birdie' ? VOICE_BIRDIE : VOICE_CHIP;
    const responseAudio = await tts(response, voiceId);

    return new Response(JSON.stringify({ audio: responseAudio, transcript, voice, response, action }), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
