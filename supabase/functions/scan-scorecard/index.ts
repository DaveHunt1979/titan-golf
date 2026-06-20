// Scorecard scanner — sends image to Claude vision, returns structured hole data
// Secret required: ANTHROPIC_API_KEY

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { imageBase64, mediaType } = await req.json();

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'imageBase64 required' }), { status: 400, headers: CORS });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type:   'image',
              source: { type: 'base64', media_type: mediaType ?? 'image/jpeg', data: imageBase64 },
            },
            {
              type: 'text',
              text: `This is a golf scorecard. Extract the hole data and return ONLY valid JSON with no other text, in this exact format:
{"holes":[{"hole":1,"par":4,"yardage":385,"si":7},{"hole":2,"par":3,"yardage":162,"si":15},...]}

Rules:
- Include every hole shown (9 or 18)
- "par" must be 3, 4, or 5
- "si" is stroke index (1–18), use null if not shown
- "yardage" is the main tee yardage shown, use null if not shown
- Return null for any field you cannot read clearly
- Return ONLY the JSON, nothing else`,
            },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ error: `Anthropic error: ${errText}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const anthropicData = await res.json();
    const text = anthropicData.content?.[0]?.text ?? '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: 'Could not parse scorecard — try a clearer photo' }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
