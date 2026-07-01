import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { competitionId, title, body, data, playerIds: directPlayerIds } = await req.json();
    if (!title || !body) {
      return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers: CORS });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Get player IDs: from competition_players, falling back to directly-supplied IDs
    let playerIds: string[] = directPlayerIds ?? [];
    if (competitionId) {
      const { data: cpRows } = await supabase
        .from('competition_players')
        .select('player_id')
        .eq('competition_id', competitionId);
      if (cpRows?.length) playerIds = cpRows.map((r: any) => r.player_id);
    }

    if (!playerIds.length) return new Response(JSON.stringify({ ok: true }), { headers: CORS });

    // Get push tokens for those players
    const { data: players } = await supabase
      .from('players')
      .select('push_token')
      .in('id', playerIds)
      .not('push_token', 'is', null);

    const tokens = (players ?? []).map((p: any) => p.push_token).filter(Boolean);
    if (!tokens.length) return new Response(JSON.stringify({ ok: true }), { headers: CORS });

    // Send via Expo Push API
    const messages = tokens.map((token: string) => ({
      to: token,
      sound: 'default',
      title,
      body,
      data: data ?? {},
    }));

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    });

    const result = await res.json();
    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
  }
});
