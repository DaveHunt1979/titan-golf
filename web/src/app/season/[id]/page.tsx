'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useSeasonAdmin } from '@/lib/season/useSeasonAdmin';
import { rankDivisionEntries, type MovementStatus, type RankedSeasonEntry } from '@/lib/season/ranking';

// Standings colours are Season Mode's own, matching app/(app)/season/table.tsx.
const MOVEMENT: Record<MovementStatus, { label: string; cls: string }> = {
  champion:   { label: 'Champion',   cls: 'bg-[var(--gold)]/10 text-[var(--gold)]'   },
  promotion:  { label: 'Promotion',  cls: 'bg-[var(--green)]/10 text-[var(--green)]' },
  safe:       { label: 'Safe',       cls: 'bg-[#000000] text-neutral-500 border border-[#1c1c1c]' },
  relegation: { label: 'Relegation', cls: 'bg-[var(--red)]/10 text-[var(--red)]'     },
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', registration_open: 'Registration Open', registration_closed: 'Registration Closed',
  divisions_preview: 'Divisions Preview', published: 'Published', active: 'Active',
  verification_grace: 'Verification Grace', finalising: 'Finalising', locked: 'Locked', archived: 'Archived',
};

type Season = {
  id: string; society_id: string; name: string; season_year: number; status: string;
  join_pin: string | null; start_at: string | null; end_at: string | null;
  registration_close_at: string | null;
  minimum_qualifying_rounds: number; counting_round_limit: number; handicap_allowance_percent: number;
};

type Division = { id: string; name: string; display_order: number; target_player_count: number; promotion_places: number; relegation_places: number };
type Major = { id: string; sequence: number; name: string; start_at: string; end_at: string; multiplier: number };

type Entry = {
  id: string; player_id: string; division_id: string | null; join_status: string;
  entry_handicap_index: number | null; qualification_status: 'provisional' | 'qualified' | 'dnq';
  qualifying_rounds_count: number; season_points: number;
  players: { display_name: string | null } | null;
};

type Row = RankedSeasonEntry & { name: string; handicap: number | null; rounds: number };

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SeasonDetailPage() {
  const params = useParams<{ id: string }>();
  const seasonId = params?.id;
  const supabase = createClient();
  const { loading: gateLoading, societyId, societyName } = useSeasonAdmin();

  const [loading, setLoading]     = useState(true);
  const [season, setSeason]       = useState<Season | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [majors, setMajors]       = useState<Major[]>([]);
  const [entries, setEntries]     = useState<Entry[]>([]);
  const [countingPoints, setCountingPoints] = useState<Record<string, number[]>>({});

  const load = useCallback(async (id: string, society: string) => {
    const { data: seasonRow } = await supabase
      .from('seasons')
      .select('id, society_id, name, season_year, status, join_pin, start_at, end_at, registration_close_at, minimum_qualifying_rounds, counting_round_limit, handicap_allowance_percent')
      .eq('id', id)
      .maybeSingle();

    // Never render a Season belonging to another society, even if the blanket
    // RLS policy would hand the row over.
    const s = seasonRow as Season | null;
    if (!s || s.society_id !== society) { setSeason(null); setLoading(false); return; }
    setSeason(s);

    const [{ data: divisionRows }, { data: majorRows }, { data: entryRows }] = await Promise.all([
      supabase.from('season_divisions')
        .select('id, name, display_order, target_player_count, promotion_places, relegation_places')
        .eq('season_id', id).order('display_order', { ascending: true }),
      supabase.from('season_majors')
        .select('id, sequence, name, start_at, end_at, multiplier')
        .eq('season_id', id).order('sequence', { ascending: true }),
      supabase.from('season_entries')
        .select('id, player_id, division_id, join_status, entry_handicap_index, qualification_status, qualifying_rounds_count, season_points, players(display_name)')
        .eq('season_id', id),
    ]);

    const es = (entryRows ?? []) as unknown as Entry[];
    setDivisions((divisionRows ?? []) as Division[]);
    setMajors((majorRows ?? []) as Major[]);
    setEntries(es);

    const ids = es.map(e => e.id);
    const { data: roundRows } = ids.length
      ? await supabase.from('season_rounds').select('season_entry_id, final_round_points').in('season_entry_id', ids).eq('is_counting', true)
      : { data: [] };
    const byEntry: Record<string, number[]> = {};
    for (const r of (roundRows ?? []) as { season_entry_id: string; final_round_points: number }[]) {
      (byEntry[r.season_entry_id] ??= []).push(r.final_round_points);
    }
    setCountingPoints(byEntry);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (seasonId && societyId) load(seasonId, societyId);
  }, [seasonId, societyId, load]);

  if (gateLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--green)] border-t-transparent" />
      </div>
    );
  }

  if (!season) {
    return (
      <div className="mx-auto max-w-screen-xl px-6 py-12">
        <Link href="/season" className="text-sm text-[var(--gold)] hover:underline">← Back to Seasons</Link>
        <div className="mt-6 rounded-2xl border border-[#1c1c1c] bg-[#111111] p-16 text-center">
          <h3 className="text-xl font-black text-white">Season not found</h3>
          <p className="mt-2 text-neutral-400">It may belong to another society, or it has been deleted.</p>
        </div>
      </div>
    );
  }

  function standingsFor(division: Division): Row[] {
    const inDivision = entries.filter(e => e.division_id === division.id);
    const ranked = rankDivisionEntries(
      inDivision.map(e => ({
        entryId: e.id,
        seasonPoints: Number(e.season_points ?? 0),
        qualificationStatus: e.qualification_status,
        countingRoundPoints: countingPoints[e.id] ?? [],
      })),
      division.promotion_places,
      division.relegation_places,
    );
    return ranked.map(r => {
      const entry = inDivision.find(e => e.id === r.entryId);
      return {
        ...r,
        name: entry?.players?.display_name ?? 'Unknown player',
        handicap: entry?.entry_handicap_index ?? null,
        rounds: entry?.qualifying_rounds_count ?? 0,
      };
    });
  }

  const unplaced = entries.filter(e => !e.division_id && e.join_status === 'approved');
  const pending  = entries.filter(e => e.join_status === 'pending_approval');

  const configTiles = [
    { label: 'Divisions',        value: divisions.length },
    { label: 'Entries',          value: entries.length },
    { label: 'Qualifying Rds',   value: season.minimum_qualifying_rounds },
    { label: 'Counting Rds',     value: season.counting_round_limit },
    { label: 'Hcp Allowance',    value: `${season.handicap_allowance_percent}%` },
  ];

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-12">
      <Link href="/season" className="text-sm text-[var(--gold)] hover:underline">← Back to Seasons</Link>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="mb-4 mt-6 overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--green)]">
              {societyName ?? 'Society'} · Season Mode
            </div>
            <h1 className="mt-1.5 text-[44px] font-black leading-[0.95] tracking-tight text-white">{season.name}</h1>
            <div className="mt-3.5 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-[var(--green)]/25 bg-[var(--green)]/10 px-2.5 py-1 text-[11px] font-bold text-[var(--green)]">
                {STATUS_LABEL[season.status] ?? season.status}
              </span>
              {[
                `${season.season_year}`,
                `Registration closes ${formatDate(season.registration_close_at)}`,
                `${formatDate(season.start_at)} → ${formatDate(season.end_at)}`,
              ].map(chip => (
                <span key={chip} className="rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-semibold text-neutral-400">
                  {chip}
                </span>
              ))}
            </div>
          </div>

          {season.join_pin && (
            <div className="shrink-0 rounded-xl border border-[var(--green)]/25 bg-[var(--green)]/5 px-5 py-4 sm:self-start">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Season Join PIN</div>
              <div className="mt-1.5 font-mono text-[30px] font-black leading-none tracking-[5px] tabular-nums text-[var(--green)]">
                {season.join_pin.slice(0, 3)} {season.join_pin.slice(3)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Config strip ─────────────────────────────────────── */}
      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-5">
        {configTiles.map(t => (
          <div key={t.label} className="bg-[#111111] px-4 py-3.5">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{t.label}</div>
            <div className="mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums text-white">{t.value}</div>
          </div>
        ))}
      </div>

      {/* ── Standings ────────────────────────────────────────── */}
      <SectionHeading label="Standings" hint={season.status === 'draft' ? 'Divisions not published yet' : undefined} />
      {divisions.length === 0 ? (
        <EmptyCard title="No divisions on this Season" body="Divisions are set when the Season is created." />
      ) : (
        <div className="mb-8 space-y-4">
          {divisions.map(division => {
            const rows = standingsFor(division);
            return (
              <section key={division.id} className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3.5">
                  <h3 className="text-[15px] font-black text-white">{division.name}</h3>
                  <div className="flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-600">
                    <span>{rows.length} / {division.target_player_count} players</span>
                    {division.promotion_places > 0 && <span className="text-[var(--green)]">↑ {division.promotion_places} up</span>}
                    {division.relegation_places > 0 && <span className="text-[var(--red)]">↓ {division.relegation_places} down</span>}
                  </div>
                </div>

                {rows.length === 0 ? (
                  <div className="bg-[#000000] px-5 py-8 text-center text-sm text-neutral-500">
                    No players placed in this division yet — use Publish Divisions on the Seasons list.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-[3rem_1fr_5rem_5rem_6rem_7rem] gap-3 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
                      {['Pos', 'Player', 'Hcp', 'Rds', 'Points', 'Status'].map(h => (
                        <div key={h} className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h !== 'Player' ? 'text-center' : ''}`}>
                          {h}
                        </div>
                      ))}
                    </div>
                    {rows.map((r, i) => {
                      const m = MOVEMENT[r.movementStatus];
                      return (
                        <div
                          key={r.entryId}
                          className={`grid grid-cols-[3rem_1fr_5rem_5rem_6rem_7rem] items-center gap-3 border-b border-[#1c1c1c] px-5 py-3 last:border-0 ${i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'}`}
                        >
                          <div className={`text-center font-mono text-sm font-bold tabular-nums ${r.movementStatus === 'champion' ? 'text-[var(--gold)]' : 'text-neutral-500'}`}>
                            {r.position}
                          </div>
                          <div className="truncate text-sm font-semibold text-white">{r.name}</div>
                          <div className="text-center font-mono text-xs tabular-nums text-neutral-400">
                            {r.handicap != null ? Number(r.handicap).toFixed(1) : '—'}
                          </div>
                          <div className="text-center font-mono text-xs tabular-nums text-neutral-400">{r.rounds}</div>
                          <div className="text-center font-mono text-sm font-bold tabular-nums text-white">{r.seasonPoints}</div>
                          <div className="text-center">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[9.5px] font-black uppercase tracking-widest ${m.cls}`}>
                              {r.qualificationStatus === 'dnq' ? 'DNQ' : m.label}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* ── Entries not yet in a division ────────────────────── */}
      {(unplaced.length > 0 || pending.length > 0) && (
        <>
          <SectionHeading
            label="Awaiting Divisions"
            hint={`${unplaced.length} approved${pending.length ? ` · ${pending.length} pending` : ''}`}
          />
          <div className="mb-8 overflow-hidden rounded-2xl border border-[#1c1c1c]">
            <div className="grid grid-cols-[1fr_6rem_7rem] gap-3 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
              {['Player', 'Hcp', 'Join Status'].map(h => (
                <div key={h} className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h !== 'Player' ? 'text-center' : ''}`}>
                  {h}
                </div>
              ))}
            </div>
            {[...unplaced, ...pending].map((e, i) => (
              <div
                key={e.id}
                className={`grid grid-cols-[1fr_6rem_7rem] items-center gap-3 border-b border-[#1c1c1c] px-5 py-3 last:border-0 ${i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'}`}
              >
                <div className="truncate text-sm font-semibold text-white">{e.players?.display_name ?? 'Unknown player'}</div>
                <div className="text-center font-mono text-xs tabular-nums text-neutral-400">
                  {e.entry_handicap_index != null ? Number(e.entry_handicap_index).toFixed(1) : '—'}
                </div>
                <div className="text-center">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[9.5px] font-black uppercase tracking-widest ${
                    e.join_status === 'approved'
                      ? 'bg-[var(--green)]/10 text-[var(--green)]'
                      : 'bg-[#000000] text-neutral-500 border border-[#1c1c1c]'
                  }`}>
                    {e.join_status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Majors ───────────────────────────────────────────── */}
      <SectionHeading label="The 4 Majors" />
      {majors.length === 0 ? (
        <EmptyCard title="No Majors configured" body="Majors are set when the Season is created." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {majors.map(m => (
            <div key={m.id} className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-5">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-[var(--green)]">Major {m.sequence}</div>
              <div className="mt-1.5 font-black text-white">{m.name}</div>
              <div className="mt-2 text-xs text-neutral-500">{formatDate(m.start_at)} → {formatDate(m.end_at)}</div>
              <div className="mt-3 inline-flex rounded-full border border-[var(--gold)]/25 bg-[var(--gold)]/8 px-2.5 py-1 font-mono text-[10px] font-black tabular-nums text-[var(--gold)]">
                ×{Number(m.multiplier).toFixed(1)} points
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--green)]">{label}</h2>
      <span className="h-px flex-1 bg-[#1c1c1c]" />
      {hint && <span className="text-[11px] font-semibold text-neutral-600">{hint}</span>}
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-8 rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
      <h3 className="text-lg font-black text-white">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">{body}</p>
    </div>
  );
}
