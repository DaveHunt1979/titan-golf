// Golfbert API proxy — signs requests with AWS Signature V4
// Secrets required: GOLFBERT_ACCESS_KEY, GOLFBERT_SECRET_KEY, GOLFBERT_REGION

const ACCESS_KEY = Deno.env.get('GOLFBERT_ACCESS_KEY') ?? '';
const SECRET_KEY = Deno.env.get('GOLFBERT_SECRET_KEY') ?? '';
const API_TOKEN  = Deno.env.get('GOLFBERT_API_TOKEN') ?? '';
const REGION     = Deno.env.get('GOLFBERT_REGION') ?? 'us-east-1';
const HOST       = 'api.golfbert.com';
const SERVICE    = 'execute-api';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)));
}

async function hmac(key: ArrayBuffer, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
}

async function derivedKey(dateStamp: string): Promise<ArrayBuffer> {
  const kDate    = await hmac(new TextEncoder().encode('AWS4' + SECRET_KEY), dateStamp);
  const kRegion  = await hmac(kDate, REGION);
  const kService = await hmac(kRegion, SERVICE);
  return hmac(kService, 'aws4_request');
}

async function signedFetch(path: string, params: Record<string, string>): Promise<Response> {
  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);

  const qs = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    'GET',
    path,
    qs,
    `host:${HOST}\nx-amz-date:${amzDate}\n`,
    'host;x-amz-date',
    await sha256Hex(''),
  ].join('\n');

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign    = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const sig  = toHex(await hmac(await derivedKey(dateStamp), stringToSign));
  const auth = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=host;x-amz-date, Signature=${sig}`;
  const url  = qs ? `https://${HOST}${path}?${qs}` : `https://${HOST}${path}`;

  return fetch(url, {
    headers: { Authorization: auth, 'x-amz-date': amzDate, host: HOST, 'x-api-key': API_TOKEN },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { action, query, courseId } = await req.json();

    let res: Response;
    if (action === 'search') {
      if (!query) return new Response(JSON.stringify({ error: 'query required' }), { status: 400, headers: CORS });
      res = await signedFetch('/v1/courses', { name: query, per_page: '20' });
    } else if (action === 'holes') {
      if (!courseId) return new Response(JSON.stringify({ error: 'courseId required' }), { status: 400, headers: CORS });
      res = await signedFetch(`/v1/courses/${courseId}/holes`, {});
    } else {
      return new Response(JSON.stringify({ error: 'action must be search or holes' }), { status: 400, headers: CORS });
    }

    const text = await res.text();
    // Surface debug info if AWS rejects the request
    if (!res.ok) {
      return new Response(JSON.stringify({
        golfbert_status: res.status,
        golfbert_body: text,
        has_access_key: ACCESS_KEY.length > 0,
        has_secret_key: SECRET_KEY.length > 0,
        region: REGION,
      }), { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
    }
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
