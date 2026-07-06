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
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            {
              type:   'image',
              source: { type: 'base64', media_type: mediaType ?? 'image/jpeg', data: imageBase64 },
            },
            {
              type: 'text',
              text: `This is a golf scorecard. Extract the hole data and return ONLY valid JSON with no other text.

IMPORTANT: Some courses have multiple named 9-hole loops on one scorecard (e.g. "Shore", "Himalaya", "Dunes" at The Princes, or "Lakeside", "Heathland" etc). If you can see distinct named sections, return each as a separate course. Otherwise return a single course with name null.

Return this exact format:
{"courses":[{"name":"Shore","holes":[{"hole":1,"par":4,"si":7,"tees":{"black":425,"white":390,"yellow":365}},...]},{"name":"Himalaya","holes":[{"hole":1,"par":3,"si":5,"tees":{"black":180,"white":162,"yellow":145}},...]}]}

For a normal single course:
{"courses":[{"name":null,"holes":[{"hole":1,"par":4,"si":7,"tees":{"black":425,"white":390,"yellow":365}},{"hole":2,"par":3,"si":15,"tees":{"white":162,"yellow":145}},...]}]}

Rules:
- Each named section gets its own entry in the courses array
- Hole numbers within each course/section start from 1
- "par" must be 3, 4, or 5
- "si" is stroke index, use null if not shown
- "tees" is an object mapping tee colour name to yardage. Common colours: black, white, yellow, blue, red, gold, silver. Use the colour names printed or shown on the card (often colour-coded rows). If only one yardage row exists and no colour is labelled, use "white" as the key.
- Use lowercase colour names as keys
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
    const text = (anthropicData.content?.[0]?.text ?? '').trim();

    // Strip markdown code fences if present
    const stripped = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: `Could not parse scorecard — raw: ${text.slice(0, 200)}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr: any) {
      return new Response(JSON.stringify({ error: `JSON parse failed: ${parseErr.message} — raw: ${text.slice(0, 200)}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
