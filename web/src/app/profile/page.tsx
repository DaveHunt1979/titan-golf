'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Edit2, Save, X, RefreshCw, Key, LogOut, Wifi, ChevronRight, ChevronDown, Briefcase, Newspaper, RotateCw, RotateCcw } from 'lucide-react';

// ── Club data (mirrors mobile bag.tsx) ───────────────────────────────────────

const CLUB_BRANDS = [
  'Benross','Callaway','Cleveland','Cobra','Honma','Lynx','Miura','Mizuno',
  'Ping','PXG','Srixon','TaylorMade','Titleist','Tour Edge','Wilson','Yonex','Other',
];

const BRAND_MODELS: Record<string, string[]> = {
  Benross: ['HTX Compressor','HTX Carbon','HTX Turbo','Power Play','Evolution','VX3 Forged','Tech 37'],
  Callaway: ['Paradym Ai Smoke','Paradym Ai Smoke Max','Paradym Ai Smoke Triple Diamond','Paradym','Paradym X','Paradym Triple Diamond','Rogue ST Max','Rogue ST Max D','Rogue ST Max LS','Rogue ST Max OS','Big Bertha','Big Bertha B21','Apex','Apex Pro','Apex CB','Apex MB','Apex DCB','Jaws Raw','Jaws MD5','Opus Wedge','Ai Smoke Wedge','Ai Smoke Putter'],
  Cleveland: ['Launcher XL2','Launcher HB Turbo 2','Launcher XL Halo','ZipCore XL','CBX4','CBX ZipCore','RTX 6 ZipCore','RTX ZipCore','Smart Sole Full Face 4','Frontline Cero','HB Soft Milled'],
  Cobra: ['Darkspeed','Darkspeed Max','Darkspeed LS','Darkspeed X','Darkspeed Max D','Aerojet','Aerojet Max','Aerojet LS','King Tour MIM','King Forged Tec','King Forged Tec X','King CB','King Oversized','Snakebite','King Cobra Vintage'],
  Honma: ['BERES BE-08','BERES 09','BERES S08','TR20 V','TR20 P','TR20 B','TR20 X','T//World GS','T//World XP-1','T//World B','T//World GS Utility'],
  Lynx: ['Predator Driver','Predator 3 Wood','Predator Irons','Black Cat','Ai Driver','Ai Irons','Tigress','Prowler'],
  Miura: ['CB-301 Irons','CB-302 Irons','TC-201 Irons','IC-601 Irons','Baby Blades','PP-9002 Putter','0-Grind Wedge','K-Grind Wedge','K-Grind 2.0'],
  Mizuno: ['ST-Max 230','ST-Z 230','ST-Max 235','ST-G 220','JPX923 Hot Metal','JPX923 Hot Metal Pro','JPX923 Forged','JPX923 Tour','JPX925 Hot Metal','JPX925 Forged','JPX925 Tour','MP-20 MB','MP-20 HMB','Pro 241','T24 Wedge','T22 Wedge','S23 Wedge','M-Craft OMOI','M-Craft II'],
  Ping: ['G430 Max','G430 LST','G430 SFT','G430 Max 10K','G425 Max','G425 LST','G425 SFT','Blueprint T','Blueprint S','i530','i525','i59','G430 HL','G430 Crossover','ChipR','Glide 4.0','Glide 4.0 SS','Glide 4.0 ES','Scottsdale TR','Anser','DS72','Kushin 4'],
  PXG: ['0811 XF Gen6','0811 X Gen6','0811+ Gen4','0811 XT Gen4','0311 XP Gen6','0311 P Gen6','0311 T Gen6','0311 ST Gen6','0317 X Gen4','0211 Irons','0702 Forged','0211 Crossover','0317 Hybrid','Darkness Wedge','0311 Sugar Daddy II','Battle Ready II Putter','0211 Putter'],
  Srixon: ['ZX5 Mk II','ZX7 Mk II','ZX5 LS Mk II','ZXi-5','ZXi-7','ZXi-LS','ZX4 Mk II Iron','ZX5 Mk II Iron','ZX7 Mk II Iron','ZXi-7 Iron','ZXi-5 Iron','U85 Utility Iron','U65 Utility Iron','W503 Wedge','Z785 Wedge','Tri-Hot 5K Putter'],
  TaylorMade: ['Qi10','Qi10 LS','Qi10 Max','Qi10 Tour','BRNR Mini','Stealth 2','Stealth 2 HD','Stealth 2 Plus','P790','P770','P7MC','P7MB','P7TW','Sim2 Max','Sim2 Max OS','Sim2','Sim2 Ti','P·DHY Driving Iron','GAPR MID','Milled Grind 4','MG4 TW','Hi-Toe Raw','Hi-Toe 3','Spider GT Max','Spider EX','Spider Tour','TP Hydro Blast','Truss TM1'],
  Titleist: ['GT2','GT3','GT4','GT2 Irons','TSR2','TSR3','TSR4','T100','T100·S','T150','T200','T350','DCI Black','690 MB','710 CB','Vokey SM10','Vokey SM9','Vokey SM8','Vokey WedgeWorks','Scotty Cameron Phantom','Scotty Cameron Special Select','Scotty Cameron Super Select','Scotty Cameron Newport','Scotty Cameron Futura'],
  'Tour Edge': ['Exotics C723','Exotics E723','Exotics 723 Forged','Hot Launch E523','Hot Launch C523','Hot Launch E521','Exotics EXS Pro','Exotics EXS 220','Exotics C722'],
  Wilson: ['Dynapower Carbon','Dynapower Titanium','Dynapower Forged','D9 Forged','D9','D9 HL','Staff Model Blade','Staff Model CB','Staff Model R','Staff Model Utility','Infinite Putter','Harmonized Wedge','Staff Wedge'],
  Yonex: ['Ezone GS Driver','Ezone GS Wood','Ezone GS Iron','Royal Ezone Driver','Royal Ezone Iron','Ezone Elite 4.0','Ezone LS'],
  Other: ['Custom / No Model'],
};

const DEFAULT_CLUBS = [
  { name: 'Driver',         short_name: 'D',   category: 'wood',   sort_order: 1  },
  { name: '3 Wood',         short_name: '3w',  category: 'wood',   sort_order: 2  },
  { name: '5 Wood',         short_name: '5w',  category: 'wood',   sort_order: 3  },
  { name: '3 Hybrid',       short_name: '3h',  category: 'hybrid', sort_order: 4  },
  { name: '4 Iron',         short_name: '4i',  category: 'iron',   sort_order: 5  },
  { name: '5 Iron',         short_name: '5i',  category: 'iron',   sort_order: 6  },
  { name: '6 Iron',         short_name: '6i',  category: 'iron',   sort_order: 7  },
  { name: '7 Iron',         short_name: '7i',  category: 'iron',   sort_order: 8  },
  { name: '8 Iron',         short_name: '8i',  category: 'iron',   sort_order: 9  },
  { name: '9 Iron',         short_name: '9i',  category: 'iron',   sort_order: 10 },
  { name: 'Pitching Wedge', short_name: 'PW',  category: 'wedge',  sort_order: 11 },
  { name: 'Gap Wedge',      short_name: 'GW',  category: 'wedge',  sort_order: 12 },
  { name: 'Sand Wedge',     short_name: 'SW',  category: 'wedge',  sort_order: 13 },
  { name: 'Lob Wedge',      short_name: 'LW',  category: 'wedge',  sort_order: 14 },
  { name: 'Putter',         short_name: 'P',   category: 'putter', sort_order: 15 },
];

const CATEGORY_ORDER = ['wood', 'hybrid', 'iron', 'wedge', 'putter'];
const CATEGORY_LABELS: Record<string, string> = {
  wood: 'Woods', hybrid: 'Hybrids', iron: 'Irons', wedge: 'Wedges', putter: 'Putter',
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Club = {
  id: string;
  name: string;
  short_name: string;
  category: string;
  sort_order: number;
  in_bag: boolean;
  brand: string | null;
  model: string | null;
  nfc_tag_id: string | null;
};

type CompetitionLite = { id: string; name: string; start_date: string | null; end_date: string | null };
type NewsReportRow = {
  id: string; story_type: string; headline: string | null; summary: string | null;
  created_at: string; dayNumber: number | null;
};
type ReportGroup = { competition: CompetitionLite; reports: NewsReportRow[] };

/** T-Card back face — mirrors mobile's RecentRound (src/lib/playerTiers.ts). */
type RecentRound = { matchId: string; courseName: string | null; points: number | null };

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function reportLabel(r: { story_type: string; dayNumber: number | null }) {
  if (r.story_type === 'final_report') return 'Final Report';
  if (r.story_type === 'round_report') return r.dayNumber != null ? `Day ${r.dayNumber}` : 'Round Report';
  if (r.story_type === 'preview') return 'Preview';
  return r.story_type;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router  = useRouter();
  const supabase = createClient();

  const [player,      setPlayer]      = useState<any>(null);
  const [clubs,       setClubs]       = useState<Club[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [editing,     setEditing]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [syncingHcp,  setSyncingHcp]  = useState(false);
  const [syncMsg,     setSyncMsg]     = useState('');
  const [societyName, setSocietyName] = useState<string | null>(null);
  const [joinedAt,    setJoinedAt]    = useState<string | null>(null);
  const [stats,       setStats]       = useState({ rounds: 0, best: null as number | null, avg: null as number | null, eagles: 0, birdies: 0, pars: 0 });
  /** Stableford total per round, oldest → newest, last 6 rounds. */
  const [trend,       setTrend]       = useState<number[]>([]);
  const [reportGroups, setReportGroups] = useState<ReportGroup[]>([]);
  /** Titan T-Card — live dot + back-face rounds. `null` = still loading. */
  const [online,      setOnline]      = useState(false);
  const [lastRounds,  setLastRounds]  = useState<RecentRound[] | null>(null);

  // Edit fields
  const [name,     setName]     = useState('');
  const [nickname, setNickname] = useState('');
  const [hcp,      setHcp]      = useState('');
  const [cdhNum,   setCdhNum]   = useState('');

  // Password change
  const [showPw,    setShowPw]    = useState(false);
  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving,  setPwSaving]  = useState(false);
  const [pwError,   setPwError]   = useState('');

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/auth/login'); return; }

    const { data: p } = await supabase.from('players').select('*').eq('auth_uid', user.id).maybeSingle();
    if (!p) { setLoading(false); return; }

    setPlayer(p);
    setName(p.display_name ?? '');
    setNickname(p.nickname ?? '');
    setHcp(p.handicap_index != null ? String(p.handicap_index) : '');
    setCdhNum(p.cdh_number ?? '');

    // Clubs — seed if none
    let { data: clubRows } = await supabase.from('clubs').select('*').eq('player_id', p.id).order('sort_order');
    if (!clubRows || clubRows.length === 0) {
      const rows = DEFAULT_CLUBS.map(c => ({ ...c, player_id: p.id, in_bag: true, nfc_tag_id: null }));
      const { data: seeded } = await supabase.from('clubs').insert(rows).select();
      clubRows = seeded;
    }
    setClubs((clubRows ?? []) as Club[]);

    // Society
    const { data: sm } = await supabase
      .from('society_members').select('societies(name), joined_at')
      .eq('player_id', p.id).maybeSingle();
    setSocietyName((sm as any)?.societies?.name ?? null);
    setJoinedAt((sm as any)?.joined_at ?? null);

    // Career stats + Stableford trend.
    // Same source as before (sum match_holes.stableford_pts per match_id), plus
    // updated_at so rounds can be ordered oldest → newest for the trend chart —
    // exactly how PlayerProfilePanel orders the same data. No new scoring maths.
    const { data: holes } = await supabase
      .from('match_holes').select('match_id, stableford_pts, updated_at').eq('player_id', p.id);
    if (holes) {
      const perMatch: Record<string, { pts: number; last: string }> = {};
      let eagles = 0, birdies = 0, pars = 0;
      (holes as { match_id: string; stableford_pts: number | null; updated_at: string | null }[])
        .forEach(h => {
          if (h.stableford_pts == null) return;
          const row = (perMatch[h.match_id] ??= { pts: 0, last: '' });
          row.pts += h.stableford_pts;
          if ((h.updated_at ?? '') > row.last) row.last = h.updated_at ?? '';
          if (h.stableford_pts >= 4) eagles++;
          if (h.stableford_pts === 3) birdies++;
          if (h.stableford_pts === 2) pars++;
        });
      const vals = Object.values(perMatch).sort((a, b) => a.last.localeCompare(b.last)).map(r => r.pts);
      setStats({
        rounds: vals.length,
        best: vals.length ? Math.max(...vals) : null,
        avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
        eagles, birdies, pars,
      });
      setTrend(vals.slice(-6));
    }

    // Titan T-Card — live status. Same RPC the mobile T-Card uses
    // (players.last_active_at > now() - 5 min). If the RPC is missing or
    // errors we simply never show the badge; the page must not break.
    try {
      const { data: isOnline, error: onlineErr } = await supabase.rpc('is_player_online', { p_player_id: p.id });
      if (!onlineErr) setOnline(!!isOnline);
    } catch { /* no online badge */ }

    // Titan T-Card back face — last 3 COMPLETED rounds, newest first.
    // Deliberately its own round-trip: the Career Stats query above pulls
    // every match_hole with no `status`/`completed_at` to order by, so it
    // cannot express "last 3 complete". Exact port of mobile's
    // fetchLastRounds() (src/lib/playerTiers.ts).
    const { data: recentMatches } = await supabase
      .from('matches')
      .select('id, completed_at, day:day_id(course_name)')
      .or(`home_player_ids.cs.{${p.id}},away_player_ids.cs.{${p.id}}`)
      .eq('status', 'complete')
      .order('completed_at', { ascending: false })
      .limit(3);

    // PostgREST types the `day:day_id(...)` embed as an array; a to-one
    // relation actually comes back as a single object, so accept both.
    type DayEmbed = { course_name: string | null } | { course_name: string | null }[] | null;
    const matchRows = (recentMatches ?? []) as unknown as { id: string; day: DayEmbed }[];
    if (matchRows.length) {
      const { data: roundHoles } = await supabase
        .from('match_holes').select('match_id, stableford_pts')
        .in('match_id', matchRows.map(m => m.id)).eq('player_id', p.id);
      const ptsByMatch: Record<string, number> = {};
      (roundHoles ?? []).forEach((h: { match_id: string; stableford_pts: number | null }) => {
        ptsByMatch[h.match_id] = (ptsByMatch[h.match_id] ?? 0) + (h.stableford_pts ?? 0);
      });
      setLastRounds(matchRows.map(m => {
        const day = Array.isArray(m.day) ? m.day[0] : m.day;
        return { matchId: m.id, courseName: day?.course_name ?? null, points: ptsByMatch[m.id] ?? null };
      }));
    } else {
      setLastRounds([]);
    }

    // My Reports — published Titan News stories from every tournament this player played in.
    // Scoped by "tournaments I played in" (competition_players), not "stories that mention me" —
    // titan_news.featured_players only stores names off the AI snapshot, no player_id link yet.
    const { data: cpRows } = await supabase.from('competition_players').select('competition_id').eq('player_id', p.id);
    const compIds = [...new Set((cpRows ?? []).map((c: { competition_id: string }) => c.competition_id))];
    if (compIds.length) {
      const [{ data: compsData }, { data: daysData }, { data: newsData }] = await Promise.all([
        supabase.from('competitions').select('id, name, start_date, end_date').in('id', compIds),
        supabase.from('competition_days').select('id, day_number, competition_id').in('competition_id', compIds),
        supabase.from('titan_news')
          .select('id, competition_id, day_id, story_type, headline, summary, created_at')
          .in('competition_id', compIds).eq('status', 'published').order('created_at', { ascending: false }),
      ]);
      const dayNumberById: Record<string, number> = {};
      (daysData ?? []).forEach((d: { id: string; day_number: number }) => { dayNumberById[d.id] = d.day_number; });
      const compsById: Record<string, CompetitionLite> = {};
      (compsData ?? []).forEach((c: CompetitionLite) => { compsById[c.id] = c; });
      const groups: Record<string, ReportGroup> = {};
      type NewsRawRow = {
        id: string; competition_id: string; day_id: string | null; story_type: string;
        headline: string | null; summary: string | null; created_at: string;
      };
      (newsData ?? []).forEach((n: NewsRawRow) => {
        const competition = compsById[n.competition_id];
        if (!competition) return;
        (groups[n.competition_id] ??= { competition, reports: [] }).reports.push({
          id: n.id, story_type: n.story_type, headline: n.headline, summary: n.summary,
          created_at: n.created_at, dayNumber: n.day_id ? dayNumberById[n.day_id] ?? null : null,
        });
      });
      setReportGroups(
        Object.values(groups).sort((a, b) => (b.competition.start_date ?? '').localeCompare(a.competition.start_date ?? ''))
      );
    }

    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveProfile() {
    if (!name.trim()) return;
    setSaving(true);
    const updates = {
      display_name:   name.trim(),
      nickname:       nickname.trim() || null,
      handicap_index: hcp ? parseFloat(hcp) : null,
      cdh_number:     cdhNum.trim() || null,
    };
    await supabase.from('players').update(updates).eq('id', player.id);
    setPlayer((p: any) => ({ ...p, ...updates }));
    setSaving(false);
    setEditing(false);
  }

  async function syncFromEnglandGolf() {
    const cdh = (cdhNum.trim() || player?.cdh_number || '').trim();
    if (!cdh) return;
    setSyncingHcp(true); setSyncMsg('');
    try {
      const res = await fetch(
        `https://api.golfgenius.com/api/v1.0/GolfEngland/HandicapIndex/${encodeURIComponent(cdh)}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!res.ok) throw new Error();
      const json = await res.json();
      const hi = json.handicapIndex ?? json.HandicapIndex ?? json.whs_handicap_index ?? json.data?.handicapIndex;
      if (hi == null) throw new Error();
      const rounded = Math.round(hi * 10) / 10;
      setHcp(String(rounded));
      await supabase.from('players').update({ handicap_index: rounded }).eq('id', player.id);
      setPlayer((p: any) => ({ ...p, handicap_index: rounded }));
      setSyncMsg(`Synced — ${rounded}`);
    } catch {
      setSyncMsg('Could not fetch. Check your CDH number.');
    }
    setSyncingHcp(false);
  }

  async function toggleBag(club: Club) {
    const next = !club.in_bag;
    setClubs(prev => prev.map(c => c.id === club.id ? { ...c, in_bag: next } : c));
    await supabase.from('clubs').update({ in_bag: next }).eq('id', club.id);
  }

  async function saveBrandModel(clubId: string, brand: string, model: string | null) {
    setClubs(prev => prev.map(c => c.id === clubId ? { ...c, brand, model } : c));
    await supabase.from('clubs').update({ brand, model }).eq('id', clubId);
  }

  async function changePassword() {
    if (newPw.length < 6) { setPwError('Minimum 6 characters'); return; }
    if (newPw !== confirmPw) { setPwError('Passwords do not match'); return; }
    setPwSaving(true); setPwError('');
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwSaving(false);
    if (error) { setPwError(error.message); return; }
    setShowPw(false); setNewPw(''); setConfirmPw('');
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/');
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
      </div>
    );
  }

  if (!player) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-neutral-400">
        No player profile found.
      </div>
    );
  }

  const initial     = (player.display_name ?? 'G')[0].toUpperCase();
  const inBagCount  = clubs.filter(c => c.in_bag).length;
  const byCategory  = clubs.reduce<Record<string, Club[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c); return acc;
  }, {});

  const hcpDisplay  = player.handicap_index != null ? Number(player.handicap_index).toFixed(1) : '—';

  // Stat tiles — handicap/rounds/in-bag from the old hero badges, plus every
  // Career Stats number the load() query computes (best/avg/eagles/birdies/pars).
  const statTiles: { label: string; value: string | number; gold?: boolean }[] = [
    { label: 'Handicap',   value: hcpDisplay, gold: true },
    { label: 'Rounds',     value: stats.rounds },
    { label: 'Best Round', value: stats.best != null ? stats.best : '—', gold: true },
    { label: 'Average',    value: stats.avg  != null ? stats.avg  : '—' },
    { label: 'Eagles+',    value: stats.eagles },
    { label: 'Birdies',    value: stats.birdies },
    { label: 'Pars',       value: stats.pars },
    { label: 'In Bag',     value: inBagCount },
  ];

  const metaChips = [
    societyName,
    joinedAt ? `Member since ${new Date(joinedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}` : null,
    player.cdh_number ? `CDH ${player.cdh_number}` : null,
  ].filter(Boolean) as string[];

  const trendDelta = trend.length > 1 ? trend[trend.length - 1] - trend[0] : null;

  return (
    <div className="relative">
      {/* Ambient gold wash behind the hero — same top-of-page treatment as the command deck. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />

      <div className="relative mx-auto max-w-screen-xl px-6 py-12">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">
            {societyName ?? 'Titan Golf'} · Player Card
          </div>
          <h1 className="mt-1 text-5xl font-black tracking-tight text-white">Locker Room</h1>
        </div>
        {editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-2 rounded-lg border border-[#1c1c1c] px-4 py-2 text-sm font-bold text-neutral-400 transition-colors hover:bg-white/5"
            >
              <X size={15} /> Cancel
            </button>
            <button
              onClick={saveProfile}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-bold text-[#000000] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Save size={15} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* ── Profile hero + buttons down the side ───────────── */}
      <div className="mb-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_248px]">

        <div className="space-y-4">

          {/* Hero — identity left, real Stableford trend right */}
          <div className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
            <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,368px)] lg:gap-8">

              {/* Identity */}
              <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
                <div className="relative shrink-0">
                  <div className="flex h-[112px] w-[112px] items-center justify-center rounded-full border-2 border-[#D4AF37] bg-[#1a1a1a] text-[38px] font-black leading-none text-[var(--gold-bright)] shadow-[0_0_0_5px_rgba(74,222,128,0.10),0_0_38px_-6px_rgba(212,175,55,0.55)]">
                    {initial}
                  </div>
                  <span
                    title="Handicap Index"
                    className="absolute -right-2.5 -top-1.5 rounded-full border-2 border-[#111111] bg-[#4ade80] px-2.5 py-0.5 font-mono text-[12px] font-bold tabular-nums text-[#052012]"
                  >
                    {hcpDisplay}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-600">
                    {stats.rounds > 0 ? `${stats.rounds} rounds logged` : 'No rounds logged yet'}
                  </div>
                  <h2 className="mt-1.5 text-[40px] font-black leading-[0.95] tracking-tight text-white">
                    {player.display_name}
                  </h2>
                  {player.nickname && (
                    <div className="mt-2 text-sm font-bold text-[#4ade80]">&ldquo;{player.nickname}&rdquo;</div>
                  )}
                  {metaChips.length > 0 && (
                    <div className="mt-3.5 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                      {metaChips.map(chip => (
                        <span
                          key={chip}
                          className="rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-semibold text-neutral-400"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => { setEditing(true); scrollToSection('profile-details'); }}
                    className="mt-5 inline-flex items-center gap-2 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] px-5 py-2.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110"
                  >
                    <Edit2 size={13} />
                    Edit Profile
                  </button>
                </div>
              </div>

              {/* Real trend chart — last 6 scored rounds */}
              <div className="rounded-xl border border-[#1c1c1c] bg-[#0a0a0a] p-4">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <span className="text-[11.5px] font-bold text-neutral-400">
                    Stableford — Last {trend.length || 6} Rounds
                  </span>
                  {trendDelta != null && (
                    <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--teal)' }}>
                      {trendDelta >= 0 ? '+' : ''}{trendDelta} pts
                    </span>
                  )}
                </div>
                {trend.length > 1 ? (
                  <TrendChart pts={trend} />
                ) : (
                  <div className="flex h-[132px] items-center justify-center rounded-lg border border-dashed border-[#1c1c1c] px-4 text-center text-xs text-neutral-600">
                    Not enough scored rounds yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stat tiles — hairline grid, same treatment as the tee-sheet player card */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-4">
            {statTiles.map(s => (
              <div key={s.label} className="bg-[#111111] px-4 py-3.5">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{s.label}</div>
                <div className={`mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums ${s.gold ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* T-Card + buttons down the side */}
        <div className="flex flex-col gap-1.5 lg:sticky lg:top-6 lg:self-start">

          {/* Titan T-Card — the mobile T-Card as a real flip card */}
          <TitanTCard
            initial={initial}
            avatarUrl={player.avatar_url ?? null}
            name={player.display_name}
            nickname={player.nickname ?? null}
            societyName={societyName}
            hcpDisplay={hcpDisplay}
            online={online}
            rounds={lastRounds}
          />

          <div className="mb-1 mt-4 flex items-center gap-2 px-1">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-neutral-600">Quick Actions</span>
            <span className="h-px flex-1 bg-[#1c1c1c]" />
          </div>
          <SideButton
            icon={<Edit2 size={15} />}
            label={editing ? 'Cancel Editing' : 'Edit Profile'}
            onClick={() => { setEditing(v => !v); scrollToSection('profile-details'); }}
          />
          <SideButton
            icon={<Briefcase size={15} />}
            label="My Bag"
            onClick={() => scrollToSection('my-bag')}
          />
          {reportGroups.length > 0 && (
            <SideButton
              icon={<Newspaper size={15} />}
              label="Tournament Reports"
              onClick={() => scrollToSection('my-reports')}
            />
          )}
          <SideButton
            icon={<Key size={15} />}
            label="Change Password"
            onClick={() => { setShowPw(true); setPwError(''); scrollToSection('account'); }}
          />
          <SideButton
            icon={<LogOut size={15} />}
            label="Sign Out"
            onClick={signOut}
            danger
          />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">

        {/* ── LEFT: Profile details + stats + account ──────── */}
        <div className="space-y-6">

          {/* Profile details */}
          <section id="profile-details" className="scroll-mt-6">
            <SectionHeading label="Profile Details" hint={editing ? 'Editing' : undefined} />
            <div className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111] divide-y divide-[#1c1c1c]">
              <ProfileField label="Display Name"   value={name}     onChange={setName}     editing={editing} placeholder="Your name" />
              <ProfileField label="Nickname"        value={nickname} onChange={setNickname} editing={editing} placeholder='"The Machine"' />
              <ProfileField label="Handicap Index"  value={hcp}      onChange={setHcp}      editing={editing} placeholder="e.g. 14.2" type="number" />
              <ProfileField label="CDH Number"      value={cdhNum}   onChange={setCdhNum}   editing={editing} placeholder="England Golf CDH" />
            </div>
            {editing && (
              <>
                <button
                  onClick={syncFromEnglandGolf}
                  disabled={!cdhNum.trim() || syncingHcp}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#22c55e]/30 bg-[#22c55e]/8 px-4 py-3 text-sm font-bold text-[#22c55e] transition-colors hover:bg-[#22c55e]/12 disabled:opacity-40"
                >
                  <RefreshCw size={15} className={syncingHcp ? 'animate-spin' : ''} />
                  {syncingHcp ? 'Syncing…' : 'Sync Handicap from England Golf'}
                </button>
                {syncMsg && (
                  <p className={`mt-2 text-center text-xs font-semibold ${syncMsg.startsWith('Could') ? 'text-[#f87171]' : 'text-[#22c55e]'}`}>
                    {syncMsg}
                  </p>
                )}
              </>
            )}
          </section>

          {/* Career stats live in the hero stat grid + trend chart above. */}

          {/* Account */}
          <section id="account" className="scroll-mt-6">
            <SectionHeading label="Account" />
            <div className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111] divide-y divide-[#1c1c1c]">

              {/* Change password */}
              <div>
                <button
                  onClick={() => { setShowPw(v => !v); setPwError(''); }}
                  className="flex w-full items-center justify-between px-5 py-4 transition-colors hover:bg-white/3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/8 text-[#D4AF37]">
                      <Key size={16} />
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-bold text-white">Change Password</div>
                      <div className="text-xs text-neutral-500">Update your login password</div>
                    </div>
                  </div>
                  {showPw ? <ChevronDown size={16} className="text-neutral-600" /> : <ChevronRight size={16} className="text-neutral-600" />}
                </button>
                {showPw && (
                  <div className="space-y-3 border-t border-[#1c1c1c] px-5 py-4">
                    <input
                      type="password"
                      placeholder="New password (min 6 chars)"
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      className="w-full rounded-lg border border-[#1c1c1c] bg-[#000000] px-4 py-3 text-sm text-white placeholder-neutral-600 focus:border-[#D4AF37]/40 focus:outline-none"
                    />
                    <input
                      type="password"
                      placeholder="Confirm new password"
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      className="w-full rounded-lg border border-[#1c1c1c] bg-[#000000] px-4 py-3 text-sm text-white placeholder-neutral-600 focus:border-[#D4AF37]/40 focus:outline-none"
                    />
                    {pwError && <p className="text-xs text-[#f87171]">{pwError}</p>}
                    <button
                      onClick={changePassword}
                      disabled={pwSaving}
                      className="w-full rounded-lg bg-[#D4AF37] py-2.5 text-sm font-bold text-[#000000] transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {pwSaving ? 'Updating…' : 'Update Password'}
                    </button>
                  </div>
                )}
              </div>

              {/* Sign out */}
              <button
                onClick={signOut}
                className="flex w-full items-center justify-between px-5 py-4 transition-colors hover:bg-white/3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/8 text-red-400">
                    <LogOut size={16} />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-bold text-red-400">Sign Out</div>
                    <div className="text-xs text-neutral-500">Sign out of Titan Golf web</div>
                  </div>
                </div>
                <ChevronRight size={16} className="text-neutral-600" />
              </button>
            </div>
          </section>
        </div>

        {/* ── RIGHT: My Bag ─────────────────────────────────── */}
        <div id="my-bag" className="scroll-mt-6">
          <SectionHeading label="My Bag" hint={`${inBagCount} in bag`} />
          <div className="space-y-4">
            {CATEGORY_ORDER.map(cat => {
              const group = byCategory[cat];
              if (!group?.length) return null;
              return (
                <div key={cat}>
                  <div className="mb-2 text-xs font-bold uppercase tracking-widest text-neutral-500">
                    {CATEGORY_LABELS[cat]}
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111] divide-y divide-[#1c1c1c]">
                    {group.map(club => (
                      <ClubRow
                        key={club.id}
                        club={club}
                        onToggleBag={() => toggleBag(club)}
                        onSaveBrandModel={(brand, model) => saveBrandModel(club.id, brand, model)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-center text-xs text-neutral-600">
            Tap the club code to toggle it in/out of your bag.
            Set brand &amp; model to enable distance tracking in the app.
            All changes sync instantly.
          </p>
        </div>
      </div>

      {/* ── My Tournament Reports ──────────────────────────── */}
      {reportGroups.length > 0 && (
        <section id="my-reports" className="mt-8 scroll-mt-6">
          <SectionHeading label="My Tournament Reports" hint={`${reportGroups.length} tournament${reportGroups.length === 1 ? '' : 's'}`} />
          <div className="space-y-4">
            {reportGroups.map(g => (
              <div key={g.competition.id} className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111] transition-colors hover:border-neutral-800">
                <div className="flex items-center justify-between gap-4 border-b border-[#1c1c1c] px-5 py-4">
                  <div>
                    <div className="text-sm font-black text-white">{g.competition.name}</div>
                    <div className="text-xs text-neutral-500">
                      {[fmtDate(g.competition.start_date), fmtDate(g.competition.end_date)].filter(Boolean).join(' – ')}
                    </div>
                  </div>
                  <a
                    href={`/newsreel/${g.competition.id}`}
                    target="_blank" rel="noopener noreferrer"
                    className="shrink-0 text-xs font-bold text-[#D4AF37] hover:underline"
                  >
                    View Newsreel →
                  </a>
                </div>
                <div className="divide-y divide-[#1c1c1c]">
                  {g.reports.map(r => (
                    <div key={r.id} className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/8 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#D4AF37]">
                          {reportLabel(r)}
                        </span>
                        <span className="text-[11px] text-neutral-600">{fmtDate(r.created_at)}</span>
                      </div>
                      {r.headline && <div className="mt-2 text-sm font-bold text-white">{r.headline}</div>}
                      {r.summary && <p className="mt-1 text-xs text-neutral-400">{r.summary}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      </div>
    </div>
  );
}

// ── TitanTCard ────────────────────────────────────────────────────────────────

/**
 * The mobile T-Card (src/components/TCardSheet.tsx) as a web trading card that
 * physically flips: a `perspective` wrapper holds a `preserve-3d` inner that
 * rotates 180° on Y, with both faces `backface-visibility: hidden`. Under
 * `prefers-reduced-motion` the transition is dropped so the faces swap
 * instantly instead of spinning.
 *
 * Front: avatar, name, live dot, handicap index. Back: last 3 completed rounds.
 */
function TitanTCard({ initial, avatarUrl, name, nickname, societyName, hcpDisplay, online, rounds }: {
  initial: string;
  avatarUrl: string | null;
  name: string;
  nickname: string | null;
  societyName: string | null;
  hcpDisplay: string;
  online: boolean;
  rounds: RecentRound[] | null;
}) {
  const [flipped, setFlipped] = useState(false);

  const face =
    'absolute inset-0 flex flex-col overflow-hidden rounded-[20px] border border-[var(--gold-border)] ' +
    'p-4 [backface-visibility:hidden] [-webkit-backface-visibility:hidden] ' +
    'shadow-[0_0_0_1px_rgba(212,175,55,0.10),0_26px_60px_-30px_rgba(212,175,55,0.7)]';

  const flipBtn =
    'flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--gold-border)] ' +
    'bg-[var(--gold-dim)] px-3 py-2 text-[10.5px] font-black uppercase tracking-[0.1em] ' +
    'text-[var(--gold-bright)] transition-colors hover:bg-[rgba(212,175,55,0.16)]';

  return (
    <div className="[perspective:1400px]">
      <div
        className={`relative aspect-[5/7] w-full transition-transform duration-700 [transform-style:preserve-3d] motion-reduce:transition-none ${
          flipped ? '[transform:rotateY(180deg)]' : ''
        }`}
      >

        {/* ── Front ─────────────────────────────────────── */}
        <div
          aria-hidden={flipped}
          className={`${face} bg-[linear-gradient(163deg,#181305_0%,#0c0c0c_46%,#111111_100%)] ${flipped ? 'pointer-events-none' : ''}`}
        >
          <TCardWatermark />

          <div className="relative flex items-center justify-between">
            <span className="text-[8.5px] font-black uppercase tracking-[0.2em] text-[var(--gold)]">Titan T-Card</span>
            {online && (
              <span className="flex items-center gap-1">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--green)] opacity-70 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
                </span>
                <span className="text-[8.5px] font-black uppercase tracking-[0.14em] text-[var(--green)]">Online</span>
              </span>
            )}
          </div>

          <div className="relative mt-4 flex flex-col items-center text-center">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={name}
                className="h-[74px] w-[74px] rounded-full border-2 border-[var(--gold)] object-cover shadow-[0_0_34px_-8px_rgba(212,175,55,0.75)]"
              />
            ) : (
              <div className="flex h-[74px] w-[74px] items-center justify-center rounded-full border-2 border-[var(--gold)] bg-[#1a1a1a] text-[27px] font-black leading-none text-[var(--gold-bright)] shadow-[0_0_34px_-8px_rgba(212,175,55,0.75)]">
                {initial}
              </div>
            )}
            <div className="mt-3 text-[16px] font-black leading-tight text-white">{name}</div>
            {nickname
              ? <div className="mt-1 text-[10.5px] font-bold text-[var(--green)]">&ldquo;{nickname}&rdquo;</div>
              : societyName && <div className="mt-1 text-[10px] font-semibold text-neutral-500">{societyName}</div>}
          </div>

          <div className="relative mt-auto mb-3 text-center">
            <div className="text-[8.5px] font-black uppercase tracking-[0.18em] text-neutral-600">Handicap Index</div>
            <div className="font-mono text-[40px] font-bold leading-none tabular-nums text-[var(--gold-bright)]">
              {hcpDisplay}
            </div>
          </div>

          <button onClick={() => setFlipped(true)} tabIndex={flipped ? -1 : 0} className={flipBtn}>
            <RotateCw size={12} /> Last 3 Rounds
            <ChevronRight size={12} />
          </button>
        </div>

        {/* ── Back ──────────────────────────────────────── */}
        <div
          aria-hidden={!flipped}
          className={`${face} bg-[linear-gradient(163deg,#111111_0%,#0c0c0c_54%,#181305_100%)] [transform:rotateY(180deg)] ${flipped ? '' : 'pointer-events-none'}`}
        >
          <TCardWatermark />

          <div className="relative flex items-center justify-between">
            <span className="text-[8.5px] font-black uppercase tracking-[0.2em] text-[var(--gold)]">Last 3 Rounds</span>
            <span className="text-[8.5px] font-black uppercase tracking-[0.14em] text-neutral-600">Stableford</span>
          </div>

          <div className="relative mt-3 flex-1 space-y-2 overflow-hidden">
            {rounds === null ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--gold)] border-t-transparent motion-reduce:animate-none" />
              </div>
            ) : rounds.length === 0 ? (
              <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-neutral-600">
                No completed rounds yet
              </div>
            ) : (
              rounds.map((r, i) => (
                <div
                  key={r.matchId}
                  className="flex items-center gap-2.5 rounded-lg border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-2"
                >
                  <span className="font-mono text-[9px] font-bold tabular-nums text-neutral-600">
                    {i === 0 ? 'LAST' : `-${i}`}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white">
                    {r.courseName ?? 'Round'}
                  </span>
                  <span className="font-mono text-[17px] font-bold leading-none tabular-nums text-[var(--gold-bright)]">
                    {r.points ?? '—'}
                  </span>
                </div>
              ))
            )}
          </div>

          <button onClick={() => setFlipped(false)} tabIndex={flipped ? 0 : -1} className={`${flipBtn} mt-3`}>
            <RotateCcw size={12} /> Back to Card
          </button>
        </div>
      </div>
    </div>
  );
}

/** Oversized brand wordmark bled across the card, same trick on both faces. */
function TCardWatermark() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -bottom-2 -left-1 select-none text-[62px] font-black leading-none tracking-tighter text-white/[0.035]"
    >
      TITAN
    </span>
  );
}

// ── SectionHeading ────────────────────────────────────────────────────────────

function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">{label}</h2>
      <span className="h-px flex-1 bg-[#1c1c1c]" />
      {hint && <span className="text-[11px] font-semibold text-neutral-600">{hint}</span>}
    </div>
  );
}

// ── TrendChart ────────────────────────────────────────────────────────────────

/**
 * Last-6-rounds Stableford trend. Same drawing recipe as the tee-sheet's
 * PlayerProfilePanel (grid lines, gradient fill, emphasised newest point),
 * sized for the wider full-page hero. The viewBox aspect matches the
 * container's aspect ratio so preserveAspectRatio="none" scales uniformly.
 */
function TrendChart({ pts }: { pts: number[] }) {
  const w = 336, h = 132, pad = 10;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const range = Math.max(1, max - min);
  const stepX = pts.length > 1 ? (w - pad * 2) / (pts.length - 1) : 0;

  const coords = pts.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / range);
    return [x, y] as const;
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const fillPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${h - pad} L${coords[0][0].toFixed(1)},${h - pad} Z`;

  return (
    <>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="aspect-[336/132] w-full overflow-visible"
      >
        <defs>
          <linearGradient id="profileTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--teal)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--teal)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(f => {
          const y = pad + (h - pad * 2) * f;
          return <line key={f} x1={pad} y1={y} x2={w - pad} y2={y} stroke="#1c1c1c" strokeWidth={1} />;
        })}
        <path d={fillPath} fill="url(#profileTrendGrad)" />
        <path d={linePath} fill="none" stroke="var(--teal)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c, i) => {
          const isLast = i === coords.length - 1;
          return (
            <circle
              key={i}
              cx={c[0]} cy={c[1]} r={isLast ? 4.5 : 2.8}
              fill={isLast ? 'var(--teal)' : '#050908'}
              stroke={isLast ? '#050908' : 'var(--teal)'}
              strokeWidth={2}
            />
          );
        })}
      </svg>
      <div className="mt-2 flex justify-between">
        {pts.map((v, i) => (
          <span key={i} className="font-mono text-[9.5px] tabular-nums text-neutral-600">
            {i === pts.length - 1 ? `${v} pts` : `R${i + 1}`}
          </span>
        ))}
      </div>
    </>
  );
}

// ── SideButton ────────────────────────────────────────────────────────────────

function SideButton({ icon, label, onClick, danger = false }: {
  icon: ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-xl border border-[#1c1c1c] bg-[#111111] px-3.5 py-3 text-left text-[12.5px] font-semibold text-neutral-400 transition-colors hover:border-neutral-700 hover:bg-[#1a1a1a] ${
        danger ? 'hover:text-[#f87171]' : 'hover:text-white'
      }`}
    >
      <span className={`shrink-0 text-neutral-600 transition-colors ${danger ? 'group-hover:text-[#f87171]' : 'group-hover:text-[var(--gold-bright)]'}`}>
        {icon}
      </span>
      {label}
    </button>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────

function ProfileField({ label, value, onChange, editing, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void;
  editing: boolean; placeholder?: string; type?: string;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="w-36 shrink-0 text-xs font-bold uppercase tracking-widest text-neutral-500">{label}</div>
      {editing ? (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          step={type === 'number' ? '0.1' : undefined}
          className="flex-1 bg-transparent text-right text-sm text-white placeholder-neutral-600 focus:outline-none"
        />
      ) : (
        <div className="flex-1 text-right text-sm font-semibold text-white">
          {value || <span className="text-neutral-600">—</span>}
        </div>
      )}
    </div>
  );
}

// ── ClubRow ───────────────────────────────────────────────────────────────────

function ClubRow({ club, onToggleBag, onSaveBrandModel }: {
  club: Club;
  onToggleBag: () => void;
  onSaveBrandModel: (brand: string, model: string | null) => void;
}) {
  const [brand, setBrand] = useState(club.brand ?? '');
  const [model, setModel] = useState(club.model ?? '');

  useEffect(() => {
    setBrand(club.brand ?? '');
    setModel(club.model ?? '');
  }, [club.brand, club.model]);

  function handleBrandChange(b: string) {
    setBrand(b);
    setModel('');
    onSaveBrandModel(b || '', null);
  }

  function handleModelChange(m: string) {
    setModel(m);
    onSaveBrandModel(brand, m || null);
  }

  const models = BRAND_MODELS[brand] ?? [];

  return (
    <div className={`flex items-center gap-3 px-4 py-3 transition-[opacity,background-color] hover:bg-white/[0.015] ${!club.in_bag ? 'opacity-40' : ''}`}>
      {/* In-bag toggle */}
      <button
        onClick={onToggleBag}
        title={club.in_bag ? 'Remove from bag' : 'Add to bag'}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-black transition-all ${
          club.in_bag
            ? 'border-[#D4AF37] bg-[#D4AF37] text-[#000000]'
            : 'border-[#D4AF37]/40 text-[#D4AF37] hover:border-[#D4AF37]'
        }`}
      >
        {club.short_name}
      </button>

      {/* Name + brand/model selectors */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-white leading-tight">{club.name}</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <select
            value={brand}
            onChange={e => handleBrandChange(e.target.value)}
            className="rounded border border-[#1c1c1c] bg-[#000000] px-2 py-1 text-xs text-neutral-300 focus:border-[#D4AF37]/40 focus:outline-none max-w-[110px]"
          >
            <option value="">Brand…</option>
            {CLUB_BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          {brand && models.length > 0 && (
            <select
              value={model}
              onChange={e => handleModelChange(e.target.value)}
              className="rounded border border-[#1c1c1c] bg-[#000000] px-2 py-1 text-xs text-neutral-300 focus:border-[#D4AF37]/40 focus:outline-none max-w-[140px]"
            >
              <option value="">Model…</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* NFC badge */}
      {club.nfc_tag_id && (
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/8 px-2 py-1">
          <Wifi size={10} className="text-[#D4AF37]" />
          <span className="text-[10px] font-bold text-[#D4AF37]">NFC</span>
        </div>
      )}
    </div>
  );
}
