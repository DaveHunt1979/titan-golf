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

    // Bumps each recipient's badge_count and hands back their new total in
    // the same round trip — APNs sets the icon badge from this payload
    // value directly, so a killed/backgrounded app still shows the right
    // number (the client's own notification handler only affects what
    // happens while the app is actually open, not this).
    const { data: recipients } = await supabase.rpc('increment_badge_counts', { p_player_ids: playerIds });
    if (!recipients?.length) return new Response(JSON.stringify({ ok: true }), { headers: CORS });

    // Send via Expo Push API
    const messages = (recipients as { push_token: string; badge_count: number }[]).map(r => ({
      to: r.push_token,
      sound: 'default',
      title,
      body,
      data: data ?? {},
      badge: r.badge_count,
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
