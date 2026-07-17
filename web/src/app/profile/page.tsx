'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Edit2, Save, X, RefreshCw, Key, LogOut, Wifi, ChevronRight, ChevronDown } from 'lucide-react';

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

    // Career stats
    const { data: holes } = await supabase
      .from('match_holes').select('match_id, stableford_pts').eq('player_id', p.id);
    if (holes) {
      const matchPts: Record<string, number> = {};
      let eagles = 0, birdies = 0, pars = 0;
      holes.forEach((h: any) => {
        if (h.stableford_pts != null) {
          matchPts[h.match_id] = (matchPts[h.match_id] ?? 0) + h.stableford_pts;
          if (h.stableford_pts >= 4) eagles++;
          if (h.stableford_pts === 3) birdies++;
          if (h.stableford_pts === 2) pars++;
        }
      });
      const vals = Object.values(matchPts);
      setStats({
        rounds: vals.length,
        best: vals.length ? Math.max(...vals) : null,
        avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
        eagles, birdies, pars,
      });
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
      <div className="flex min-h-[60vh] items-center justify-center text-slate-400">
        No player profile found.
      </div>
    );
  }

  const initial     = (player.display_name ?? 'G')[0].toUpperCase();
  const inBagCount  = clubs.filter(c => c.in_bag).length;
  const byCategory  = clubs.reduce<Record<string, Club[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c); return acc;
  }, {});

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-12">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">
            {societyName ?? 'Titan Golf'}
          </div>
          <h1 className="mt-1 text-5xl font-black text-white">Locker Room</h1>
        </div>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-2 rounded-lg border border-[#D4AF37]/40 px-4 py-2 text-sm font-bold text-[#D4AF37] transition-colors hover:bg-[#D4AF37]/10"
          >
            <Edit2 size={15} /> Edit Profile
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-2 rounded-lg border border-[#1e2d3d] px-4 py-2 text-sm font-bold text-slate-400 transition-colors hover:bg-white/5"
            >
              <X size={15} /> Cancel
            </button>
            <button
              onClick={saveProfile}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-bold text-[#070b10] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Save size={15} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* ── Profile hero ───────────────────────────────────── */}
      <div className="mb-8 flex flex-col items-start gap-5 rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-6 sm:flex-row sm:items-center">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-[#D4AF37]/40 bg-[#D4AF37]/10 text-3xl font-black text-[#D4AF37]">
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-2xl font-black text-white">{player.display_name}</div>
          {player.nickname && (
            <div className="mt-1 text-sm font-bold text-[#22c55e]">"{player.nickname}"</div>
          )}
          {joinedAt && (
            <div className="mt-1 text-xs text-slate-500">
              Member since {new Date(joinedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </div>
          )}
          {player.cdh_number && (
            <div className="mt-1 text-xs text-slate-500">CDH: {player.cdh_number}</div>
          )}
        </div>
        <div className="flex gap-3">
          <div className="rounded-xl border border-[#D4AF37]/30 bg-[#D4AF37]/8 px-6 py-4 text-center">
            <div className="text-3xl font-black text-[#D4AF37]">
              {player.handicap_index != null ? Number(player.handicap_index).toFixed(1) : '—'}
            </div>
            <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">Handicap</div>
          </div>
          <div className="rounded-xl border border-[#1e2d3d] bg-[#070b10] px-6 py-4 text-center">
            <div className="text-3xl font-black text-white">{inBagCount}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">In Bag</div>
          </div>
          {stats.rounds > 0 && (
            <div className="rounded-xl border border-[#1e2d3d] bg-[#070b10] px-6 py-4 text-center">
              <div className="text-3xl font-black text-white">{stats.rounds}</div>
              <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">Rounds</div>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">

        {/* ── LEFT: Profile details + stats + account ──────── */}
        <div className="space-y-6">

          {/* Profile details */}
          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Profile Details</h2>
            <div className="overflow-hidden rounded-2xl border border-[#1e2d3d] bg-[#0f1923] divide-y divide-[#1e2d3d]">
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

          {/* Career stats */}
          {stats.rounds > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Career Stats</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Best Round', value: stats.best != null ? `${stats.best} pts` : '—' },
                  { label: 'Average',    value: stats.avg  != null ? `${stats.avg} pts`  : '—' },
                  { label: 'Birdies',    value: stats.birdies },
                ].map(s => (
                  <div key={s.label} className="rounded-xl border border-[#1e2d3d] bg-[#0f1923] p-4 text-center">
                    <div className="text-2xl font-black text-white">{s.value}</div>
                    <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">{s.label}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Account */}
          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Account</h2>
            <div className="overflow-hidden rounded-2xl border border-[#1e2d3d] bg-[#0f1923] divide-y divide-[#1e2d3d]">

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
                      <div className="text-xs text-slate-500">Update your login password</div>
                    </div>
                  </div>
                  {showPw ? <ChevronDown size={16} className="text-slate-600" /> : <ChevronRight size={16} className="text-slate-600" />}
                </button>
                {showPw && (
                  <div className="space-y-3 border-t border-[#1e2d3d] px-5 py-4">
                    <input
                      type="password"
                      placeholder="New password (min 6 chars)"
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      className="w-full rounded-lg border border-[#1e2d3d] bg-[#070b10] px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-[#D4AF37]/40 focus:outline-none"
                    />
                    <input
                      type="password"
                      placeholder="Confirm new password"
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      className="w-full rounded-lg border border-[#1e2d3d] bg-[#070b10] px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-[#D4AF37]/40 focus:outline-none"
                    />
                    {pwError && <p className="text-xs text-[#f87171]">{pwError}</p>}
                    <button
                      onClick={changePassword}
                      disabled={pwSaving}
                      className="w-full rounded-lg bg-[#D4AF37] py-2.5 text-sm font-bold text-[#070b10] transition-opacity hover:opacity-90 disabled:opacity-50"
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
                    <div className="text-xs text-slate-500">Sign out of Titan Golf web</div>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-600" />
              </button>
            </div>
          </section>
        </div>

        {/* ── RIGHT: My Bag ─────────────────────────────────── */}
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">My Bag</h2>
          <div className="space-y-4">
            {CATEGORY_ORDER.map(cat => {
              const group = byCategory[cat];
              if (!group?.length) return null;
              return (
                <div key={cat}>
                  <div className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                    {CATEGORY_LABELS[cat]}
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-[#1e2d3d] bg-[#0f1923] divide-y divide-[#1e2d3d]">
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
          <p className="mt-4 text-center text-xs text-slate-600">
            Tap the club code to toggle it in/out of your bag.
            Set brand &amp; model to enable distance tracking in the app.
            All changes sync instantly.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────

function ProfileField({ label, value, onChange, editing, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void;
  editing: boolean; placeholder?: string; type?: string;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="w-36 shrink-0 text-xs font-bold uppercase tracking-widest text-slate-500">{label}</div>
      {editing ? (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          step={type === 'number' ? '0.1' : undefined}
          className="flex-1 bg-transparent text-right text-sm text-white placeholder-slate-600 focus:outline-none"
        />
      ) : (
        <div className="flex-1 text-right text-sm font-semibold text-white">
          {value || <span className="text-slate-600">—</span>}
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
    <div className={`flex items-center gap-3 px-4 py-3 transition-opacity ${!club.in_bag ? 'opacity-40' : ''}`}>
      {/* In-bag toggle */}
      <button
        onClick={onToggleBag}
        title={club.in_bag ? 'Remove from bag' : 'Add to bag'}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-black transition-all ${
          club.in_bag
            ? 'border-[#D4AF37] bg-[#D4AF37] text-[#070b10]'
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
            className="rounded border border-[#1e2d3d] bg-[#070b10] px-2 py-1 text-xs text-slate-300 focus:border-[#D4AF37]/40 focus:outline-none max-w-[110px]"
          >
            <option value="">Brand…</option>
            {CLUB_BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          {brand && models.length > 0 && (
            <select
              value={model}
              onChange={e => handleModelChange(e.target.value)}
              className="rounded border border-[#1e2d3d] bg-[#070b10] px-2 py-1 text-xs text-slate-300 focus:border-[#D4AF37]/40 focus:outline-none max-w-[140px]"
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
