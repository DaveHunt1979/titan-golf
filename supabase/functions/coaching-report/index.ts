// Davey McFadey & Rick Driver Coaching — turns a Titan-computed per-course
// snapshot into a motivational coaching write-up. Secrets required:
// ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// This function calculates nothing. Every hole average, best/worst score and
// trend arrives already computed in `snapshot` (see
// src/lib/coachingInsights.ts buildCoachingSnapshot). Claude's only job is
// to turn those facts into a friendly, motivational report in Davey McFadey
// & Rick Driver's voice — unlike the live Caddie banter (supabase/functions/
// tts-caddie), the tone here is warm and encouraging, not a roast: the goal
// is to make the player want to come back and try something different, not
// wind them up mid-round.
//
// Chip & Birdie retired 2026-09-11 — same report format and tone, just the
// two hosts swapped over to Dave and Rick's real on-course-reporter personas.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are Davey McFadey and Rick Driver, Titan Golf's friendly on-course reporters, writing a personal coaching report for one player about one course. You've analysed a structured JSON snapshot that Titan has already fully computed from their real rounds at this course.

STRICT RULES — these are absolute:
- Only use facts contained in the supplied JSON snapshot. Nothing else.
- Do not invent scores, holes, incidents, weather, course conditions, or events.
- Do not calculate or infer any number — every stat you reference must already be present in the snapshot.
- Never give specific technical swing or equipment advice (club selection, swing mechanics, grip, stance) — you have no swing data, only scores. Suggestions must be strategic/mental ("play safer off the tee here", "aim away from the trouble side", "don't force it, lay up") tied directly to a real pattern in the snapshot, or general encouragement — never invented technical coaching.
- Tone is warm, funny and encouraging — like a supportive coach and a mate, not the brutal live-commentary roast style Davey and Rick use mid-round. The goal is to make the player want to come back and try something different next time, not to embarrass them.
- "strongestHoles" are holes to praise specifically and confidently. "problemHoles" are holes to be gently honest about and turn into a friendly challenge for next time.
- "trend" is one of "improving", "declining", or "steady" — mention it naturally if it's improving or declining, skip it if steady rather than forcing a comment.
- If a snapshot list (strongestHoles/problemHoles) is empty, don't invent holes to fill it — just don't mention that section.

You must respond with ONLY valid JSON, no other text, in exactly this shape:
{"headline":"...","summary":"...","body":"...","suggestions":["...","..."],"banterSpeaker":"mcfadey|driver","banterText":"..."}

- "headline" — one warm, punchy headline about this player's game at this course, under 12 words.
- "summary" — one or two sentences, under 40 words.
- "body" — the full coaching write-up, 3-5 short paragraphs, plain text (no markdown), in Davey and Rick's combined voice (you can refer to each other, e.g. "Rick's spotted something interesting here...").
- "suggestions" — 2-3 short, friendly, strategic nudges the player can actually try next round, each under 20 words, each tied to a real pattern in the snapshot.
- "banterSpeaker" — exactly "mcfadey" or "driver", whichever fits the closing line better.
- "banterText" — one warm, motivational closing line in that host's voice, under 25 words, that makes the player want to go try something new next time.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { playerId, courseName, snapshot } = await req.json();
    if (!playerId || !courseName || !snapshot) {
      return new Response(JSON.stringify({ error: 'playerId, courseName and snapshot are required' }), {
        status: 400, headers: CORS,
      });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Snapshot:\n${JSON.stringify(snapshot)}` }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ error: `Anthropic error: ${errText}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const anthropicData = await res.json();
    const text = (anthropicData.content?.[0]?.text ?? '').trim();

    // Same fence-strip/regex/parse convention as titan-news — no forced
    // tool-use schema, just a strict "JSON only" prompt.
    const stripped = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: `Could not parse report — raw: ${text.slice(0, 200)}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    let report: any;
    try {
      report = JSON.parse(jsonMatch[0]);
    } catch (parseErr: any) {
      return new Response(JSON.stringify({ error: `JSON parse failed: ${parseErr.message} — raw: ${text.slice(0, 200)}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const banterSpeaker = report.banterSpeaker === 'mcfadey' || report.banterSpeaker === 'driver' ? report.banterSpeaker : null;
    const banterText = banterSpeaker && typeof report.banterText === 'string' ? report.banterText : null;
    const suggestions = Array.isArray(report.suggestions) ? report.suggestions.filter((s: unknown) => typeof s === 'string') : [];

    // One row per player+course (UNIQUE constraint) — regenerating overwrites
    // rather than piling up history, this is a "how's my game right now"
    // report, not an archive.
    const { data: saved, error: dbErr } = await supabase
      .from('ai_coaching_reports')
      .upsert({
        player_id:        playerId,
        course_name:      courseName,
        rounds_analyzed:  snapshot.roundsAnalyzed ?? 0,
        headline:         report.headline ?? null,
        summary:          report.summary ?? null,
        body:             report.body ?? null,
        strongest_holes:  snapshot.strongestHoles ?? [],
        problem_holes:    snapshot.problemHoles ?? [],
        suggestions,
        banter_speaker:   banterSpeaker,
        banter_text:      banterText,
        ai_model:         MODEL,
        input_snapshot:   snapshot,
        updated_at:       new Date().toISOString(),
      }, { onConflict: 'player_id,course_name' })
      .select()
      .single();

    if (dbErr) {
      return new Response(JSON.stringify({ error: `Save failed: ${dbErr.message}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    return new Response(JSON.stringify(saved), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
