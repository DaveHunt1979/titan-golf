// Titan News AI — turns a Titan-computed facts snapshot into a news article.
// Secrets required: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// This function calculates nothing. Every fact (positions, points, margins)
// arrives already computed in `snapshot` (see src/lib/titanNews.ts). Claude's
// only job is to turn those facts into readable prose, under a strict prompt
// that forbids inventing or calculating anything.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are Titan News, the automated sports desk for a golf society's tournament app. You write proper tournament journalism — pre-round previews, end-of-round reports, final tournament reports — from a structured JSON facts package that has already been fully computed by Titan.

STRICT RULES — these are absolute:
- Only use facts contained in the supplied JSON snapshot. Nothing else.
- Do not invent scores, incidents, quotes, player information, weather, course conditions, or events.
- Do not calculate or infer golf scores, points, or leaderboard positions — every number you use must already be present in the snapshot.
- Do not claim something happened unless the snapshot data proves it happened.
- If the snapshot does not support a statement, leave it out entirely rather than guess or generalise.
- Write in one consistent voice: proper Titan sports journalism — engaged, a bit of personality, but a real report, not a joke.

You must respond with ONLY valid JSON, no other text, in exactly this shape:
{"headline":"...","summary":"...","body":"...","featuredPlayers":["..."],"featuredTeams":["..."]}

- "headline" — one punchy sports-desk headline, under 12 words.
- "summary" — one or two sentences, under 40 words.
- "body" — the full report, 3-6 short paragraphs, plain text (no markdown).
- "featuredPlayers"/"featuredTeams" — names pulled directly from the snapshot that the report centres on.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { dedupeKey, competitionId, dayId, storyType, snapshot } = await req.json();
    if (!dedupeKey || !competitionId || !storyType || !snapshot) {
      return new Response(JSON.stringify({ error: 'dedupeKey, competitionId, storyType and snapshot are required' }), {
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
        messages: [{ role: 'user', content: `Story type: ${storyType}\n\nSnapshot:\n${JSON.stringify(snapshot)}` }],
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

    // Same fence-strip/regex/parse convention as scan-scorecard — no forced
    // tool-use schema, just a strict "JSON only" prompt.
    const stripped = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: `Could not parse article — raw: ${text.slice(0, 200)}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    let article: any;
    try {
      article = JSON.parse(jsonMatch[0]);
    } catch (parseErr: any) {
      return new Response(JSON.stringify({ error: `JSON parse failed: ${parseErr.message} — raw: ${text.slice(0, 200)}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Regeneration overwrites the same row (same dedupe_key) rather than
    // creating a duplicate — status always resets to draft, never auto-published.
    const { data: saved, error: dbErr } = await supabase
      .from('titan_news')
      .upsert({
        dedupe_key:     dedupeKey,
        competition_id: competitionId,
        day_id:         dayId ?? null,
        story_type:     storyType,
        headline:       article.headline ?? null,
        summary:        article.summary ?? null,
        body:           article.body ?? null,
        featured_players: article.featuredPlayers ?? [],
        featured_teams:   article.featuredTeams ?? [],
        status:         'draft',
        ai_model:       MODEL,
        input_snapshot: snapshot,
        published_at:   null,
      }, { onConflict: 'dedupe_key' })
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
