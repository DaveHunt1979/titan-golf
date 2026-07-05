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

    // ── Intro mode: BIG laughs — Chip opens, Birdie piles on ────────
    if (mode === 'intro') {
      const names = (players ?? []).join(', ') || 'lads';

      const [chipScript, birdieScript] = await Promise.all([
        claudeText(`You are Chip, a savagely funny British golf commentator. Your job is to roast the players (${names}) as they're about to tee off. Be absolutely brutal — mock their handicaps, their fashion sense, their life choices, their swing. Like a best man speech meets golf commentary. Reference Birdie as your partner in crime. Under 35 words. No quotes, no stage directions. Pure gold banter.`),
        claudeText(`You are Birdie, Chip's comedy co-host. Chip just roasted ${names}. Pile on with an even worse dig — something that sounds warm but absolutely destroys them. Could reference the weather, the course, or their total lack of ability. Under 25 words. No quotes, no stage directions.`),
      ]);

      const [chipAudio, birdieAudio] = await Promise.all([
        tts(chipScript || `Right then ${names}, Chip and Birdie here — and frankly, I've seen better swings on a playground. Let's see if we can get round without embarrassing yourselves. No promises.`, VOICE_CHIP),
        tts(birdieScript || `Don't worry lads, the bar is on the floor. You can only go up. Well. Statistically. Anyway, good luck!`, VOICE_BIRDIE),
      ]);

      return new Response(JSON.stringify({ chipAudio, birdieAudio, chipScript, birdieScript }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // ── Outro mode: funny witty banter to close ──────────────────────
    if (mode === 'outro') {
      const names = (players ?? []).join(', ') || 'lads';
      const score = body.score ?? '';

      const [chipScript, birdieScript] = await Promise.all([
        claudeText(`You are Chip, a savagely funny British golf commentator. The round is over for ${names} — final score: ${score}. Give them absolute grief about it. Too low? Mock them. Too high? Mock them harder. One sentence, brutal but affectionate. Under 30 words. No quotes, no stage directions.`),
        claudeText(`You are Birdie, comedy golf co-host. Add a final devastating one-liner about ${names}'s round (${score}). Something that sounds almost like a compliment but really isn't. Under 20 words. No quotes, no stage directions.`),
      ]);

      const [chipAudio, birdieAudio] = await Promise.all([
        tts(chipScript || `Well ${names}, ${score} — I've seen better scores on a whist drive. Same time next week so we can all do this again to ourselves?`, VOICE_CHIP),
        tts(birdieScript || `Genuinely inspiring. Not the golf, but the sheer commitment to turning up. See you next time!`, VOICE_BIRDIE),
      ]);

      return new Response(JSON.stringify({ chipAudio, birdieAudio, chipScript, birdieScript }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // ── Back 9 mode: Chip summarises front 9, Birdie adds commentary ─
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

    // ── Pressure mode: live commentary on current standings ──────────
    if (mode === 'pressure') {
      const { standings, holeNumber, holesLeft, format, matchplay } = body;
      const pressureVoice = voice === 'birdie' ? 'birdie' : 'chip';
      const voiceName     = pressureVoice === 'birdie' ? 'Birdie' : 'Chip';

      let context = '';
      if (format === 'matchplay' && matchplay) {
        const { homeTeam, awayTeam, homeUp, remaining } = matchplay;
        if (homeUp === 0)
          context = `All square with ${remaining} to play between ${homeTeam} and ${awayTeam}.`;
        else if (homeUp > 0)
          context = `${homeTeam} are ${homeUp} UP with ${remaining} holes left against ${awayTeam}.`;
        else
          context = `${awayTeam} are ${Math.abs(homeUp)} UP with ${remaining} holes left against ${homeTeam}.`;
      } else if (standings?.length) {
        const sorted = [...standings].sort((a: any, b: any) => b.pts - a.pts);
        const leader = sorted[0];
        const second = sorted[1];
        const gap    = second ? leader.pts - second.pts : null;
        const left   = holesLeft > 0 ? `${holesLeft} hole${holesLeft === 1 ? '' : 's'} to play` : 'final hole done';
        if (gap === null)
          context = `${leader.name} is leading with ${leader.pts} points after hole ${holeNumber}.`;
        else if (gap === 0)
          context = `${leader.name} and ${second.name} are dead level on ${leader.pts} points with ${left} — it's anyone's game.`;
        else if (gap <= 2)
          context = `${leader.name} leads on ${leader.pts} points, just ${gap} ahead of ${second.name} with ${left}. Very tight.`;
        else
          context = `${leader.name} out in front on ${leader.pts} points, ${gap} clear of ${second.name} with ${left}.`;
        if (sorted.length > 2) {
          const third = sorted[2];
          if (leader.pts - third.pts <= 4)
            context += ` ${third.name} still in touch on ${third.pts}.`;
        }
      }

      const script = await claudeText(
        `You are ${voiceName}, a quick-witted British golf caddie commentator.\n\nSituation after hole ${holeNumber}: ${context}\n\nGive one punchy live commentary line — like a great Sky Sports moment. Make players feel the pressure or excitement. Use first names. Under 35 words. No hashtags, no stage directions, no quotes — just spoken words.`
      );

      const voiceId = pressureVoice === 'birdie' ? VOICE_BIRDIE : VOICE_CHIP;
      const audio   = await tts(script || context, voiceId);

      return new Response(JSON.stringify({ audio, script }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // ── Hole mode ────────────────────────────────────────────────────
    if (hole && par && players?.length) {
      const yardsStr = yardage ? `, ${yardage} yards` : '';
      const siStr    = si     ? `, stroke index ${si}` : '';
      const voiceName = voice === 'birdie' ? 'Birdie' : 'Chip';
      const otherName = voice === 'birdie' ? 'Chip'   : 'Birdie';
      const playerList = players.join(', ');

      let prompt: string;

      if (hole === 9) {
        // The turn — serious, reflective commentary
        prompt = `You are ${voiceName}, a seasoned golf commentator. This is the 9th hole — the turn. Par ${par}${yardsStr}. Players: ${playerList}. This is a serious moment in any round. Give a proper, focused commentary about what the 9th means — where rounds are made or broken. Mention the players. Measured and real, like proper TV golf. Under 40 words. No quotes, no stage directions.`;
      } else if (hole === 18) {
        // The final hole — drama, gravitas
        prompt = `You are ${voiceName}, a serious golf commentator. Hole 18 — the final hole. Par ${par}${yardsStr}. Players: ${playerList}. Build the drama of the last hole. Speak with weight and gravitas — this is it. Every shot counts now. Proper Sky Sports final-hole commentary. Under 40 words. No quotes, no stage directions.`;
      } else {
        // All other holes — fun, banter, piss-taking
        prompt = `You are ${voiceName}, a savagely funny British golf caddie commentator (your partner is ${otherName}).\n\nHole ${hole}, par ${par}${yardsStr}${siStr}. Players: ${playerList}.\n\nAnnounce the hole stats then add a cheeky, affectionate dig — mock the par, the distance, or single out a player by first name. Sound like the funniest caddie at the club who knows exactly how to wind them up. Warm and properly funny. Under 45 words. No hashtags, no stage directions, no quotes.`;
      }

      const script = await claudeText(prompt);
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
