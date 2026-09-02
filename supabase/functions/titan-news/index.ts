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

// Fixed set of scene images Dave made himself, never AI-generated per
// report (2026-08-21 — consistent character likeness matters more than
// novelty; see project memory). Keep this list in sync with
// src/lib/titanBanter.ts (RN) and web/src/app/newsreel's equivalent map —
// three separate copies by necessity (edge function / RN / web can't share
// a module), same debt already accepted for scoring color maps elsewhere.
const BANTER_SCENES: Record<string, string> = {
  'golf-cart':      'calm, studying the leaderboard on a tablet — analytical, mid-round update',
  'hiding-tree':    'peeking round a tree, hushed and tense — building suspense before a big moment',
  'bunker':         'sitting in the sand, deflated — reacting to their OWN disaster shot',
  'celebration':    'fist-pumping with the crowd — a big win, a title secured, pure triumph',
  'sunset-view':    'looking out over the 18th at sunset — reflective, scene-setting, a big finish',
  'broadcast-desk': 'at the commentary desk with a tablet — serious breaking-news analysis',
  'hiding-bushes':  'peering through bushes with binoculars, the gallery laughing — gossipy, watching someone else\'s drama unfold',
  'giant-bunker':   'pointing into a huge bunker, shocked — reacting to someone ELSE\'S disaster',
};
const BANTER_SCENE_KEYS = Object.keys(BANTER_SCENES);
const BANTER_SCENE_LIST = BANTER_SCENE_KEYS.map(k => `${k} (${BANTER_SCENES[k]})`).join('; ');

// Banter shows up on roughly one report in three, decided BEFORE the
// prompt is even built (Dave, 2026-08-21 — "you dont need to use these
// images all the time, maybe only one.. or 3... the whole idea is to be
// random"). Skipping the instruction entirely on a no-banter run, rather
// than asking for it and discarding the result, means those runs don't pay
// for banter they'll never show.
const BANTER_CHANCE = 1 / 3;

function buildSystemPrompt(includeBanter: boolean): string {
  const banterInstruction = includeBanter ? `

You also write ONE short line of "banter" from Titan's two broadcast hosts, Chip and Birdie — a classic double-act. Chip is the dry, deadpan straight man; Birdie is warmer, more excitable, quicker to rib someone. Pick whichever of the two would naturally react to the single most banter-worthy fact in the snapshot (a collapse, a hot streak, a nightmare hole, a photo finish — not "nothing happened"). The banter line is still bound by the same strict rules above: it must be a joke ABOUT a real fact in the snapshot, never an invented one. Also pick the one scene from this fixed list that best matches the mood of that fact: ${BANTER_SCENE_LIST}.` : '';

  const banterJsonShape = includeBanter ? `,"banterSpeaker":"chip|birdie","banterText":"...","banterScene":"..."` : '';
  const banterFieldDocs = includeBanter ? `
- "banterSpeaker" — exactly "chip" or "birdie".
- "banterText" — one or two sentences, in that host's voice, under 30 words.
- "banterScene" — exactly one of: ${BANTER_SCENE_KEYS.join(', ')}.` : '';

  return `You are Titan News, the automated sports desk for a golf society's tournament app. You write proper tournament journalism — pre-round previews, end-of-round reports, final tournament reports, one-off casual round match reports (storyType "casual_final"), and Titan Season Mode league stories (storyType "season_divisions_published" or "season_finished") — from a structured JSON facts package that has already been fully computed by Titan.

STRICT RULES — these are absolute:
- Only use facts contained in the supplied JSON snapshot. Nothing else.
- Do not invent scores, incidents, quotes, player information, weather, course conditions, or events.
- Do not calculate or infer golf scores, points, or leaderboard positions — every number you use must already be present in the snapshot.
- Do not claim something happened unless the snapshot data proves it happened.
- If the snapshot does not support a statement, leave it out entirely rather than guess or generalise.
- Write in one consistent voice: proper Titan sports journalism — engaged, a bit of personality, but a real report, not a joke.
- A match with winner "half" (resultStr "Halved") has no winner — call it a halved/drawn match, never imply either side won it.
- For a stroke-play round (Stableford or Medal), the winner is named in "strokePlayWinner" — never infer it from the order of the "standings" array.
- The individual standings board is called EXACTLY whatever "tournament.individualBoardLabel" says in the snapshot (it will be either "Kronos" or "Individual" — this is Titan Way-exclusive branding, never assume "Kronos" for any other format). Use that label whenever referring to that board or its winner.
- If the snapshot's "winnerDecidedByTieBreak" is non-null, the individual winner was tied on points with the runner-up and the result was only settled by that named tie-break rule — say so explicitly in the report (e.g. "level on points, [Name] took it on countback via [rule]"). If it's null, don't mention tie-breaks at all.
- "season_divisions_published" is a kickoff story: introduce the league (name, divisions, player counts) — no results exist yet, don't imply anyone has played.
- "season_finished" is the season's final report: name every division's champion, who's promoted, who's relegated, framed like a football season finale. Every player named must come from the snapshot's champions/promoted/relegated lists — never guess at a division's outcome if it's missing from the snapshot.${banterInstruction}

You must respond with ONLY valid JSON, no other text, in exactly this shape:
{"headline":"...","summary":"...","body":"...","featuredPlayers":["..."],"featuredTeams":["..."]${banterJsonShape}}

- "headline" — one punchy sports-desk headline, under 12 words.
- "summary" — one or two sentences, under 40 words.
- "body" — the full report, 3-6 short paragraphs, plain text (no markdown).
- "featuredPlayers"/"featuredTeams" — names pulled directly from the snapshot that the report centres on.${banterFieldDocs}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { dedupeKey, competitionId, matchId, dayId, seasonId, storyType, snapshot } = await req.json();
    if (!dedupeKey || !storyType || !snapshot || (!competitionId && !matchId && !seasonId)) {
      return new Response(JSON.stringify({ error: 'dedupeKey, storyType, snapshot and one of competitionId/matchId/seasonId are required' }), {
        status: 400, headers: CORS,
      });
    }

    const includeBanter = Math.random() < BANTER_CHANCE;

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
        system: buildSystemPrompt(includeBanter),
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
    // creating a duplicate. Tournament stories always reset to draft for
    // admin review before publishing. Casual match reports have no review
    // step at all (Dave, 2026-08-20, TODO item 5 — "Casual Golf only needs
    // one final report after the game is completed") and the player who
    // just finished their round is very likely not a society admin, so
    // there's no one to publish it — auto-publish those instead.
    const isCasual = storyType === 'casual_final';
    // Validated rather than trusted — an off-spec speaker/scene would hit
    // the banter_speaker CHECK constraint and fail the whole save, taking
    // out the report over a garnish. Falls back to no banter that run
    // instead.
    const banterSpeaker = article.banterSpeaker === 'chip' || article.banterSpeaker === 'birdie' ? article.banterSpeaker : null;
    const banterScene = BANTER_SCENE_KEYS.includes(article.banterScene) ? article.banterScene : null;
    const banterText = banterSpeaker && typeof article.banterText === 'string' ? article.banterText : null;

    const { data: saved, error: dbErr } = await supabase
      .from('titan_news')
      .upsert({
        dedupe_key:     dedupeKey,
        competition_id: competitionId ?? null,
        match_id:       matchId ?? null,
        day_id:         dayId ?? null,
        season_id:      seasonId ?? null,
        story_type:     storyType,
        headline:       article.headline ?? null,
        summary:        article.summary ?? null,
        body:           article.body ?? null,
        featured_players: article.featuredPlayers ?? [],
        featured_teams:   article.featuredTeams ?? [],
        banter_speaker: banterSpeaker,
        banter_text:    banterText,
        banter_scene:   banterText ? banterScene : null,
        status:         isCasual ? 'published' : 'draft',
        published_at:   isCasual ? new Date().toISOString() : null,
        ai_model:       MODEL,
        input_snapshot: snapshot,
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
