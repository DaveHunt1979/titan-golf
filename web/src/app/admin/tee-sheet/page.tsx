'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { GripVertical, Plus } from 'lucide-react';
import PlayerProfilePanel from '@/components/PlayerProfilePanel';

type CompetitionLite = { id: string; name: string; year: number | null; status: string | null };

type DayRow = {
  id: string;
  day_number: number;
  course_name: string | null;
  play_date: string | null;
  tee_name: string | null;
  tee_time: string | null;
  day_format: string | null;
};

type MatchRow = {
  id: string;
  day_id: string;
  match_number: number | null;
  tee_time: string | null;
  home_player_ids: string[] | null;
  away_player_ids: string[] | null;
  status: string | null;
  is_singles: boolean | null;
  round_format: string | null;
  hcp_allowance: number | null;
  handicap_method: string | null;
};

type PlayerLite = { id: string; display_name: string | null; handicap_index: number | null };

type Progress = { holes: number; pts: number };

type DayStatus = 'live' | 'complete' | 'upcoming';

const DEFAULT_ANCHOR_MINUTES = 8 * 60; // 08:00 when the day has no tee time set
const DEFAULT_INTERVAL = 10;

/** competition_days.day_format → matches.round_format, mirroring app/(app)/admin/draw.tsx. */
function dayFormatToRoundFormat(df: string | null) {
  if (df === 'stableford') return 'stableford';
  if (df === 'medal')      return 'medal';
  if (df === 'scramble')   return 'scramble';
  return 'matchplay';
}

function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToTime(mins: number): string {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

function formatTime(t: string | null | undefined) {
  const mins = timeToMinutes(t);
  return mins == null ? null : minutesToTime(mins);
}

function formatDayDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function TeeSheetPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading,     setLoading]     = useState(true);
  const [societyName, setSocietyName] = useState<string | null>(null);
  const [comps,       setComps]       = useState<CompetitionLite[]>([]);
  const [compId,      setCompId]      = useState<string>('');
  const [loadedComp,  setLoadedComp]  = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  const [days,      setDays]      = useState<DayRow[]>([]);
  const [matches,   setMatches]   = useState<MatchRow[]>([]);
  const [players,   setPlayers]   = useState<Record<string, PlayerLite>>({});
  const [snapHcp,   setSnapHcp]   = useState<Record<string, number | null>>({});
  const [progress,  setProgress]  = useState<Record<string, Progress>>({});

  const [intervals,  setIntervals]  = useState<Record<string, number>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [flashIds,   setFlashIds]   = useState<string[]>([]);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);

  // ── Gate: society admin/owner only, same check as /admin and /admin/codes ──
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/auth/login'); return; }

      const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!player) { router.push('/dashboard'); return; }

      const { data: member } = await supabase
        .from('society_members').select('role, society_id')
        .eq('player_id', player.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!member || !['admin', 'owner'].includes(member.role ?? '')) { router.push('/dashboard'); return; }

      const [{ data: society }, { data: compRows }] = await Promise.all([
        supabase.from('societies').select('name').eq('id', member.society_id).single(),
        supabase.from('competitions').select('id, name, year, status')
          .eq('society_id', member.society_id).order('created_at', { ascending: false }),
      ]);

      setSocietyName((society as { name: string } | null)?.name ?? null);
      const list = (compRows ?? []) as CompetitionLite[];
      setComps(list);
      // Default to whatever is live, else the newest competition.
      setCompId(list.find(c => c.status === 'active')?.id ?? list[0]?.id ?? '');
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Board data for the selected competition ───────────────────────────────
  const loadBoard = useCallback(async (id: string) => {
    const [{ data: dayRows }, { data: matchRows }, { data: cpRows }] = await Promise.all([
      supabase.from('competition_days')
        .select('id, day_number, course_name, play_date, tee_name, tee_time, day_format')
        .eq('competition_id', id).order('day_number'),
      supabase.from('matches')
        .select('id, day_id, match_number, tee_time, home_player_ids, away_player_ids, status, is_singles, round_format, hcp_allowance, handicap_method')
        .eq('competition_id', id).order('match_number'),
      supabase.from('competition_players').select('player_id, handicap_index').eq('competition_id', id),
    ]);

    const ms = (matchRows ?? []) as MatchRow[];
    setDays((dayRows ?? []) as DayRow[]);
    setMatches(ms);

    const snapshot: Record<string, number | null> = {};
    ((cpRows ?? []) as { player_id: string; handicap_index: number | null }[])
      .forEach(cp => { snapshot[cp.player_id] = cp.handicap_index; });
    setSnapHcp(snapshot);

    const playerIds = [...new Set(ms.flatMap(m => [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]))];
    const matchIds  = ms.map(m => m.id);

    const [{ data: playerRows }, { data: holeRows }] = await Promise.all([
      playerIds.length
        ? supabase.from('players').select('id, display_name, handicap_index').in('id', playerIds)
        : Promise.resolve({ data: [] as PlayerLite[] }),
      matchIds.length
        ? supabase.from('match_holes').select('match_id, hole_number, stableford_pts').in('match_id', matchIds)
        : Promise.resolve({ data: [] as { match_id: string; hole_number: number; stableford_pts: number | null }[] }),
    ]);

    const byId: Record<string, PlayerLite> = {};
    ((playerRows ?? []) as PlayerLite[]).forEach(p => { byId[p.id] = p; });
    setPlayers(byId);

    // Group progress straight off match_holes: furthest hole reached by anyone
    // in the group, and the group's combined Stableford so far.
    const prog: Record<string, Progress> = {};
    ((holeRows ?? []) as { match_id: string; hole_number: number; stableford_pts: number | null }[])
      .forEach(h => {
        const row = (prog[h.match_id] ??= { holes: 0, pts: 0 });
        if (h.hole_number > row.holes) row.holes = h.hole_number;
        row.pts += h.stableford_pts ?? 0;
      });
    setProgress(prog);
    setError(null);
    setLoadedComp(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!compId) return;
    let cancelled = false;
    (async () => {
      const id = compId;
      if (!cancelled) await loadBoard(id);
    })();
    return () => { cancelled = true; };
  }, [compId, loadBoard]);

  const boardBusy = loadedComp !== compId;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function matchesForDay(dayId: string) {
    return matches
      .filter(m => m.day_id === dayId)
      .sort((a, b) => (a.match_number ?? 0) - (b.match_number ?? 0));
  }

  function dayStatus(dayId: string): DayStatus {
    const list = matchesForDay(dayId);
    if (list.length === 0) return 'upcoming';
    if (list.some(m => m.status === 'in_progress')) return 'live';
    if (list.every(m => m.status === 'complete')) return 'complete';
    return 'upcoming';
  }

  function anchorFor(day: DayRow) {
    return timeToMinutes(day.tee_time) ?? DEFAULT_ANCHOR_MINUTES;
  }

  function intervalFor(dayId: string) {
    return intervals[dayId] ?? DEFAULT_INTERVAL;
  }

  /**
   * Writes match_number (the ordering key the mobile app already reads) and
   * the recomputed tee_time for every group in the day, in the given order.
   */
  async function persistOrder(day: DayRow, orderedIds: string[]) {
    const anchor   = anchorFor(day);
    const interval = intervalFor(day.id);

    const updates = orderedIds.map((id, idx) => ({
      id,
      match_number: idx + 1,
      tee_time: `${minutesToTime(anchor + idx * interval)}:00`,
    }));

    const changed = updates
      .filter(u => formatTime(matches.find(m => m.id === u.id)?.tee_time) !== formatTime(u.tee_time))
      .map(u => u.id);

    setMatches(prev => prev.map(m => {
      const u = updates.find(x => x.id === m.id);
      return u ? { ...m, match_number: u.match_number, tee_time: u.tee_time } : m;
    }));

    if (changed.length) {
      setFlashIds(changed);
      setTimeout(() => setFlashIds([]), 900);
    }

    const results = await Promise.all(updates.map(u =>
      supabase.from('matches').update({ match_number: u.match_number, tee_time: u.tee_time }).eq('id', u.id)
    ));
    const failed = results.find(r => r.error);
    if (failed?.error) {
      setError(failed.error.message);
      await loadBoard(compId);
    } else {
      setError(null);
    }
  }

  function onDrop(day: DayRow, targetId: string) {
    setDragOverId(null);
    const sourceId = draggingId;
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;

    const list = matchesForDay(day.id);
    if (!list.some(m => m.id === sourceId)) return; // keep it to reorder within a day

    const ids = list.map(m => m.id).filter(id => id !== sourceId);
    const at  = ids.indexOf(targetId);
    ids.splice(at < 0 ? ids.length : at, 0, sourceId);
    persistOrder(day, ids);
  }

  /** Inserts an empty group at the end of the day, cloning the day's format columns. */
  async function addGroup(day: DayRow) {
    const list     = matchesForDay(day.id);
    const template = list[list.length - 1];
    const index    = list.length;

    const { error: insertError } = await supabase.from('matches').insert({
      competition_id:  compId,
      day_id:          day.id,
      match_number:    index + 1,
      home_player_ids: [],
      away_player_ids: [],
      status:          'upcoming',
      tee_time:        `${minutesToTime(anchorFor(day) + index * intervalFor(day.id))}:00`,
      // Format columns come from a group already on this day so the new one
      // scores identically; the day_format mapping is only the empty-day case.
      round_format:    template?.round_format    ?? dayFormatToRoundFormat(day.day_format),
      handicap_method: template?.handicap_method ?? 'individual',
      hcp_allowance:   template?.hcp_allowance   ?? 100,
      is_singles:      template?.is_singles      ?? false,
    });

    if (insertError) { setError(insertError.message); return; }
    setError(null);
    await loadBoard(compId);
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
      </div>
    );
  }

  const comp = comps.find(c => c.id === compId);

  return (
    <div className={`transition-[margin] duration-300 ease-out ${openPlayer ? 'lg:mr-[352px]' : ''}`}>
      <div className="mx-auto max-w-screen-2xl px-6 py-12">

        {/* Header */}
        <div className="mb-8">
          <Link href="/admin" className="text-sm text-[#D4AF37] hover:underline">← Back to Admin</Link>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">
                {societyName ?? 'Society'} · Command Deck
              </div>
              <h1 className="mt-1 text-5xl font-black text-white">Tee Sheet</h1>
              <p className="mt-2 text-neutral-400">
                Drag a group to move it — tee times recalculate and save automatically.
              </p>
            </div>

            {comps.length > 0 && (
              <select
                value={compId}
                onChange={e => setCompId(e.target.value)}
                className="rounded-xl border border-[#1c1c1c] bg-[#111111] px-4 py-3 text-sm font-semibold text-neutral-300 outline-none transition-colors hover:border-neutral-700 focus:border-[#D4AF37]/40"
              >
                {comps.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.year ? ` ${c.year}` : ''}{c.status === 'active' ? ' — LIVE' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-[#f87171]/30 bg-[#111111] px-5 py-3 text-sm text-[#f87171]">
            {error}
          </div>
        )}

        {comps.length === 0 ? (
          <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-16 text-center">
            <div className="mb-3 text-5xl">🏆</div>
            <h3 className="text-xl font-bold text-white">No competitions yet</h3>
            <p className="mt-2 text-neutral-400">Create one before building a tee sheet.</p>
            <a href="/tournament/new" className="mt-6 inline-block rounded-xl bg-[#D4AF37] px-6 py-3 text-sm font-black text-[#000000]">
              Create Competition
            </a>
          </div>
        ) : boardBusy && days.length === 0 ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
          </div>
        ) : days.length === 0 ? (
          <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-16 text-center">
            <div className="mb-3 text-5xl">📋</div>
            <h3 className="text-xl font-bold text-white">No rounds on {comp?.name ?? 'this competition'}</h3>
            <p className="mt-2 text-neutral-400">Add rounds in the app’s tournament builder, then come back here.</p>
          </div>
        ) : (
          <div className="flex items-start gap-4 overflow-x-auto pb-6">
            {days.map(day => (
              <TeeSheetColumn
                key={day.id}
                day={day}
                status={dayStatus(day.id)}
                groups={matchesForDay(day.id)}
                players={players}
                snapHcp={snapHcp}
                progress={progress}
                anchor={anchorFor(day)}
                interval={intervalFor(day.id)}
                flashIds={flashIds}
                draggingId={draggingId}
                dragOverId={dragOverId}
                onIntervalChange={v => setIntervals(prev => ({ ...prev, [day.id]: v }))}
                onApplyTimes={() => persistOrder(day, matchesForDay(day.id).map(m => m.id))}
                onDragStart={setDraggingId}
                onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                onDragOverCard={setDragOverId}
                onDropCard={targetId => onDrop(day, targetId)}
                onAddGroup={() => addGroup(day)}
                onPlayerClick={setOpenPlayer}
              />
            ))}
          </div>
        )}
      </div>

      <PlayerProfilePanel
        playerId={openPlayer}
        societyName={societyName}
        onClose={() => setOpenPlayer(null)}
      />
    </div>
  );
}

// ── Column ──────────────────────────────────────────────────────────────────

const COLUMN_STATUS: Record<DayStatus, { label: string; chip: string; border: string }> = {
  live:     { label: 'Live',     chip: 'bg-[#4ade80]/10 text-[#4ade80]',  border: 'border-[#4ade80]/30' },
  complete: { label: 'Complete', chip: 'bg-[#1a1a1a] text-neutral-500',   border: 'border-[#1c1c1c]'    },
  upcoming: { label: 'Upcoming', chip: 'bg-[#D4AF37]/10 text-[#D4AF37]',  border: 'border-[#1c1c1c]'    },
};

function TeeSheetColumn({
  day, status, groups, players, snapHcp, progress, anchor, interval, flashIds,
  draggingId, dragOverId, onIntervalChange, onApplyTimes, onDragStart, onDragEnd,
  onDragOverCard, onDropCard, onAddGroup, onPlayerClick,
}: {
  day: DayRow;
  status: DayStatus;
  groups: MatchRow[];
  players: Record<string, PlayerLite>;
  snapHcp: Record<string, number | null>;
  progress: Record<string, Progress>;
  anchor: number;
  interval: number;
  flashIds: string[];
  draggingId: string | null;
  dragOverId: string | null;
  onIntervalChange: (v: number) => void;
  onApplyTimes: () => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverCard: (id: string) => void;
  onDropCard: (id: string) => void;
  onAddGroup: () => void;
  onPlayerClick: (id: string) => void;
}) {
  const s = COLUMN_STATUS[status];
  const subtitle = [formatDayDate(day.play_date), day.course_name, day.tee_name].filter(Boolean).join(' · ');

  return (
    <section className={`flex w-[300px] shrink-0 flex-col rounded-2xl border bg-[#111111] ${s.border}`}>
      <div className="border-b border-[#1c1c1c] p-4">
        <span className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${s.chip}`}>
          {status === 'live' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4ade80]" />}
          {s.label}
        </span>
        <h3 className="text-[15px] font-black text-white">Round {day.day_number}</h3>
        <p className="mt-0.5 text-xs text-neutral-400">{subtitle || 'No course set'}</p>

        <div className="mt-3 flex items-center gap-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-600" htmlFor={`interval-${day.id}`}>
            Gap
          </label>
          <input
            id={`interval-${day.id}`}
            type="number"
            min={1}
            max={60}
            value={interval}
            onChange={e => onIntervalChange(Math.max(1, Math.min(60, Number(e.target.value) || DEFAULT_INTERVAL)))}
            className="w-14 rounded-lg border border-[#1c1c1c] bg-[#000000] px-2 py-1 text-center font-mono text-xs text-white outline-none focus:border-[#D4AF37]/40"
          />
          <span className="text-[10px] text-neutral-600">min from {minutesToTime(anchor)}</span>
          {groups.length > 0 && (
            <button
              onClick={onApplyTimes}
              className="ml-auto rounded-lg border border-[#D4AF37]/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[#D4AF37] transition-colors hover:bg-[#D4AF37]/10"
            >
              Apply
            </button>
          )}
        </div>
      </div>

      <div className="flex max-h-[640px] flex-col gap-2.5 overflow-y-auto p-3">
        {groups.map((m, idx) => (
          <GroupCard
            key={m.id}
            match={m}
            players={players}
            snapHcp={snapHcp}
            progress={progress[m.id]}
            previewTime={minutesToTime(anchor + idx * interval)}
            flashing={flashIds.includes(m.id)}
            dragging={draggingId === m.id}
            dragOver={dragOverId === m.id && draggingId !== m.id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOverCard={onDragOverCard}
            onDropCard={onDropCard}
            onPlayerClick={onPlayerClick}
          />
        ))}

        <button
          onClick={onAddGroup}
          className="rounded-xl border-[1.5px] border-dashed border-[#2c2820] p-3 text-xs font-bold tracking-wide text-neutral-600 transition-colors hover:border-[#D4AF37]/50 hover:text-[#D4AF37]"
        >
          <Plus size={13} className="mr-1 inline" />
          Add Group
        </button>
      </div>
    </section>
  );
}

// ── Group card ──────────────────────────────────────────────────────────────

function GroupCard({
  match, players, snapHcp, progress, previewTime, flashing, dragging, dragOver,
  onDragStart, onDragEnd, onDragOverCard, onDropCard, onPlayerClick,
}: {
  match: MatchRow;
  players: Record<string, PlayerLite>;
  snapHcp: Record<string, number | null>;
  progress: Progress | undefined;
  previewTime: string;
  flashing: boolean;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverCard: (id: string) => void;
  onDropCard: (id: string) => void;
  onPlayerClick: (id: string) => void;
}) {
  const ids   = [...(match.home_player_ids ?? []), ...(match.away_player_ids ?? [])];
  const saved = formatTime(match.tee_time);

  const chip =
    match.status === 'in_progress' ? { label: 'Live',     cls: 'bg-[#4ade80]/10 text-[#4ade80]' } :
    match.status === 'complete'    ? { label: 'Complete', cls: 'bg-[#000000] text-neutral-500 border border-[#1c1c1c]' } :
                                     { label: 'Not Out',  cls: 'bg-[#000000] text-neutral-500 border border-[#1c1c1c]' };

  return (
    <article
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(match.id); }}
      onDragEnd={onDragEnd}
      onDragOver={e => { e.preventDefault(); onDragOverCard(match.id); }}
      onDrop={e => { e.preventDefault(); onDropCard(match.id); }}
      className={`cursor-grab rounded-xl border bg-[#1a1a1a] px-3 pb-2.5 pt-3 transition-colors active:cursor-grabbing ${
        dragOver ? 'border-[#D4AF37]' : 'border-[#1c1c1c] hover:border-neutral-700'
      } ${dragging ? 'opacity-35' : ''} ${flashing ? 'tee-flash' : ''}`}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <GripVertical size={14} className="text-neutral-600" />
          {saved ? (
            <span className="font-mono text-[17px] font-bold tabular-nums text-[#D4AF37]">{saved}</span>
          ) : (
            <span className="font-mono text-[17px] font-bold tabular-nums text-neutral-600" title="No tee time saved yet — this is the time Apply would set">
              {previewTime}
            </span>
          )}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-black uppercase tracking-widest ${chip.cls}`}>
          {chip.label}
        </span>
      </div>

      {ids.length === 0 ? (
        <div className="py-3 text-center text-[11.5px] text-neutral-600">
          Empty group — add players in the app
        </div>
      ) : (
        ids.map(pid => {
          const p   = players[pid];
          const hcp = snapHcp[pid] ?? p?.handicap_index ?? null;
          return (
            <div key={pid} className="flex items-center justify-between border-b border-dashed border-[#1c1c1c] py-1.5 last:border-b-0">
              <button
                onClick={() => onPlayerClick(pid)}
                className="text-left text-[12.5px] font-semibold text-white transition-colors hover:text-[#D4AF37]"
              >
                {p?.display_name ?? 'Unknown player'}
              </button>
              <span className="font-mono text-[11.5px] text-neutral-600">{hcp != null ? hcp.toFixed(1) : '—'}</span>
            </div>
          );
        })
      )}

      {progress && progress.holes > 0 && (
        <div className="mt-2.5 flex items-center justify-between border-t border-[#1c1c1c] pt-2.5 text-[11px] text-neutral-400">
          <span className="flex items-center gap-1.5">
            Hole {progress.holes}
            <span className="block h-1 w-14 overflow-hidden rounded-full bg-[#111111]">
              <span className="block h-full bg-[#4ade80]" style={{ width: `${Math.round((progress.holes / 18) * 100)}%` }} />
            </span>
          </span>
          <span>{progress.pts} pts</span>
        </div>
      )}
    </article>
  );
}
