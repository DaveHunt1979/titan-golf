// Mints a real, short-lived Supabase session for a specific player — used
// ONLY by the tournament verification harness (src/lib/simulateVerification.ts)
// so each simulated group scores through its own real identity, exercising
// the exact same RLS a live scorer would hit (Dave, 2026-09-07: "the same
// permissions and authentication checks are applied").
//
// This is new territory for the app — every other simulate-mode write in
// this codebase deliberately avoids the service-role key (see
// src/lib/simulateTournament.ts's top comment). That principle still holds
// everywhere else; this function exists specifically because per-player RLS
// cannot be tested any other way, and its blast radius is hard-capped below.
//
// Hard safety rails, all server-side, none skippable by the caller:
//   1. Caller must be authenticated (their own JWT, verified against
//      Supabase Auth — not just trusted from the request body).
//   2. Caller must be an admin/owner of the target competition's society.
//   3. The target competition must have is_simulation = true — this
//      function can NEVER mint a session inside a real tournament, even
//      with a valid admin token.
//   4. The target player must belong to that same society.
//
// Secrets required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: CORS });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { competition_id, player_id } = await req.json();
    if (!competition_id || !player_id) return jsonError('competition_id and player_id are required');

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return jsonError('Missing Authorization header', 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1. Who is actually calling this, verified against Supabase Auth —
    // never trust a caller-supplied id.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return jsonError('Unauthorized', 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerPlayer } = await admin.from('players').select('id').eq('auth_uid', caller.id).maybeSingle();
    if (!callerPlayer) return jsonError('Caller has no player record', 403);

    // 2 & 3. Competition must exist, be a real simulation, and the caller
    // must be an admin/owner of its society.
    const { data: competition } = await admin
      .from('competitions').select('id, society_id, is_simulation').eq('id', competition_id).maybeSingle();
    if (!competition) return jsonError('Competition not found', 404);
    if (!competition.is_simulation) return jsonError('This function only operates on is_simulation competitions', 403);

    const { data: callerMembership } = await admin
      .from('society_members').select('role')
      .eq('society_id', competition.society_id).eq('player_id', callerPlayer.id).maybeSingle();
    if (!callerMembership || !['admin', 'owner'].includes(callerMembership.role)) {
      return jsonError('Caller is not an admin/owner of this society', 403);
    }

    // 4. Target player must belong to the same society.
    const { data: targetMembership } = await admin
      .from('society_members').select('player_id')
      .eq('society_id', competition.society_id).eq('player_id', player_id).maybeSingle();
    if (!targetMembership) return jsonError('Target player is not a member of this society', 403);

    const { data: targetPlayer } = await admin.from('players').select('email').eq('id', player_id).maybeSingle();
    if (!targetPlayer?.email) return jsonError('Target player has no email on file — cannot mint a real session for them', 422);

    // Mint a real session for the target player via the standard
    // generateLink + verifyOtp exchange (there is no direct "create session
    // for arbitrary user" admin API) — service-role only, never exposed to
    // the app beyond this function.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink', email: targetPlayer.email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
      return jsonError(`Could not generate a session for that player: ${linkErr?.message ?? 'no token returned'}`, 500);
    }

    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: verified, error: verifyErr } = await anonClient.auth.verifyOtp({
      type: 'magiclink', email: targetPlayer.email, token_hash: linkData.properties.hashed_token,
    });
    if (verifyErr || !verified?.session) {
      return jsonError(`Could not exchange session for that player: ${verifyErr?.message ?? 'no session returned'}`, 500);
    }

    return new Response(JSON.stringify({
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
  }
});
