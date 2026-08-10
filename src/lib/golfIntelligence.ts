const API_TOKEN = 'd6475ee0-94ff-40a6-aebf-3cadeb245f49';
const CLIENT_ID = '1041595';
const BASE = 'https://api.golfintelligence.com';

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const body = new URLSearchParams();
  body.append('grant_type', 'client_credentials');
  body.append('code', API_TOKEN);
  body.append('client_id', CLIENT_ID);
  const res = await fetch(`${BASE}/auth/authenticateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`GI auth failed: ${res.status}`);
  const data = await res.json();
  _token = data.access_token;
  _tokenExpiry = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
  return _token!;
}

export interface GICourseResult {
  publicId: string;
  name: string;
  location?: string;
}

// Local course names often carry a sub-course/scorecard suffix (e.g. "Wentworth
// Club - Front & Back", "Woburn Golf Club - The Duke") that GI's own directory
// doesn't use — strip it, plus the generic "Golf Club/Course/Links/Park" tail,
// so the search term matches GI's canonical club name.
export function cleanCourseNameForSearch(name: string): string {
  const beforeDash = name.split(/\s+-\s+/)[0];
  return beforeDash.replace(/\s*(golf\s*)?(club|course|links|park)?\s*$/i, '').trim();
}

export async function searchCourse(keywords: string, countryCode = 'GB'): Promise<GICourseResult[]> {
  const token = await getToken();
  const cleanedKeywords = cleanCourseNameForSearch(keywords);
  const res = await fetch(`${BASE}/courses/searchCourseGroups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ rows: 50, offset: 0, keywords: cleanedKeywords, countryCode, regionCode: null, gpsCoordinate: null }),
  });
  if (!res.ok) throw new Error(`GI search failed: ${res.status}`);
  const data = await res.json();
  const items: any[] = data.courses ?? data.data ?? (Array.isArray(data) ? data : []);
  return items
    .map((c: any) => ({
      publicId: c.publicId ?? c.PublicId,
      name: c.name ?? c.courseName ?? c.clubName ?? 'Unknown',
      location: c.address ?? c.location ?? c.town,
    }))
    .filter((c) => c.publicId);
}

export interface GIHoleData {
  holeNumber: number;
  par: number | null;
  strokeIndex: number | null;
  green_lat: number;
  green_lng: number;
  front_lat?: number | null;
  front_lng?: number | null;
  back_lat?: number | null;
  back_lng?: number | null;
  tee_lat?: number | null;
  tee_lng?: number | null;
  yellow_yards?: number | null;
  white_yards?: number | null;
  blue_yards?: number | null;
  red_yards?: number | null;
}

export async function getCourseHoles(publicId: string): Promise<GIHoleData[]> {
  const token = await getToken();
  const [gpsRes, scRes] = await Promise.all([
    fetch(`${BASE}/courses/getCourseGroupGPS?publicId=${publicId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetch(`${BASE}/courses/getCourseGroupScorecard?publicId=${publicId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  const gpsData = await gpsRes.json().catch(() => null);
  const scData = await scRes.json().catch(() => null);

  const layout = gpsData?.layouts?.[0];
  const gpsMap: Record<number, {
    lat: number; lng: number;
    front_lat?: number | null; front_lng?: number | null;
    back_lat?: number | null; back_lng?: number | null;
    tee_lat?: number | null; tee_lng?: number | null;
  }> = {};
  for (const h of layout?.holes ?? []) {
    const n = h.holeNumber ?? h.HoleNumber;
    const g = h.greenGPSCoordinate ?? h.GreenGPSCoordinate;
    if (n != null && g?.latitude != null && g?.longitude != null) {
      const front = h.frontGPSCoordinate ?? h.FrontGPSCoordinate;
      const back  = h.backGPSCoordinate  ?? h.BackGPSCoordinate;
      const tee   = h.teeGPSCoordinate   ?? h.TeeGPSCoordinate;
      gpsMap[n] = {
        lat: g.latitude,
        lng: g.longitude,
        front_lat: front?.latitude ?? null,
        front_lng: front?.longitude ?? null,
        back_lat:  back?.latitude ?? null,
        back_lng:  back?.longitude ?? null,
        tee_lat:   tee?.latitude ?? null,
        tee_lng:   tee?.longitude ?? null,
      };
    }
  }

  const scHoles: any[] = scData?.layouts?.[0]?.holes ?? scData?.holes ?? scData?.data?.holes ?? [];
  const parSiMap: Record<number, {
    par: number; si: number;
    yellow_yards?: number | null; white_yards?: number | null;
    blue_yards?: number | null; red_yards?: number | null;
  }> = {};
  for (const h of scHoles) {
    const n = h.holeNumber ?? h.HoleNumber ?? h.hole_number;
    if (n != null) {
      parSiMap[n] = {
        par: h.par ?? h.Par ?? 4,
        si: h.strokeIndex ?? h.StrokeIndex ?? h.handicap ?? h.Handicap ?? 1,
        yellow_yards: h.yellowYards ?? h.YellowYards ?? h.yellowDistance ?? null,
        white_yards:  h.whiteYards  ?? h.WhiteYards  ?? h.whiteDistance  ?? h.yards ?? h.distance ?? null,
        blue_yards:   h.blueYards   ?? h.BlueYards   ?? h.blueDistance   ?? null,
        red_yards:    h.redYards    ?? h.RedYards     ?? h.redDistance    ?? null,
      };
    }
  }

  return Object.entries(gpsMap)
    .map(([n, g]) => {
      const num = parseInt(n);
      const sc = parSiMap[num];
      return {
        holeNumber:   num,
        par:          sc?.par ?? null,
        strokeIndex:  sc?.si ?? null,
        green_lat:    g.lat,
        green_lng:    g.lng,
        front_lat:    g.front_lat ?? null,
        front_lng:    g.front_lng ?? null,
        back_lat:     g.back_lat ?? null,
        back_lng:     g.back_lng ?? null,
        tee_lat:      g.tee_lat ?? null,
        tee_lng:      g.tee_lng ?? null,
        yellow_yards: sc?.yellow_yards ?? null,
        white_yards:  sc?.white_yards ?? null,
        blue_yards:   sc?.blue_yards ?? null,
        red_yards:    sc?.red_yards ?? null,
      };
    })
    .sort((a, b) => a.holeNumber - b.holeNumber);
}
