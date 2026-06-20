// UK Golf Course Data API proxy (RapidAPI)
// Secret required: RAPIDAPI_KEY

const RAPIDAPI_KEY  = Deno.env.get('RAPIDAPI_KEY') ?? '';
const HOST          = 'uk-golf-course-data-api.p.rapidapi.com';
const BASE_URL      = `https://${HOST}`;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function apiFetch(path: string, params: Record<string, string> = {}): Promise<Response> {
  const qs  = new URLSearchParams(params).toString();
  const url = qs ? `${BASE_URL}${path}?${qs}` : `${BASE_URL}${path}`;
  return fetch(url, {
    headers: {
      'x-rapidapi-key':  RAPIDAPI_KEY,
      'x-rapidapi-host': HOST,
      'Content-Type':    'application/json',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { action, query, clubId } = await req.json();

    let res: Response;

    if (action === 'search') {
      if (!query) {
        return new Response(JSON.stringify({ error: 'query required' }), { status: 400, headers: CORS });
      }
      res = await apiFetch('/clubs', { search: query, per_page: '20' });

    } else if (action === 'club') {
      if (!clubId) {
        return new Response(JSON.stringify({ error: 'clubId required' }), { status: 400, headers: CORS });
      }
      res = await apiFetch(`/clubs/${clubId}`);

    } else if (action === 'regions') {
      res = await apiFetch('/regions');

    } else {
      return new Response(
        JSON.stringify({ error: 'action must be search, club, or regions' }),
        { status: 400, headers: CORS },
      );
    }

    const text = await res.text();
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `RapidAPI ${res.status}: ${text}` }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } },
      );
    }
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
