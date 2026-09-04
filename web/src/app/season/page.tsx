'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useSeasonAdmin } from '@/lib/season/useSeasonAdmin';
import { publishDivisions, closeSeason } from '@/lib/season/admin';
import { Copy, Check, Lock, Plus, ArrowUpRight } from 'lucide-react';

// The full lifecycle vocabulary from the seasons.status CHECK constraint —
// in practice only draft → active → locked is reachable today, but a season
// row written by anything else should still read as a word, not a slug.
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', registration_open: 'Registration Open', registration_closed: 'Registration Closed',
  divisions_preview: 'Divisions Preview', published: 'Published', active: 'Active',
  verification_grace: 'Verification Grace', finalising: 'Finalising', locked: 'Locked', archived: 'Archived',
};

type SeasonRow = {
  id: string;
  name: string;
  season_year: number;
  status: string;
  join_pin: string | null;
  start_at: string | null;
  end_at: string | null;
  division_count: number;
};

type Banner = { tone: 'ok' | 'error'; text: string };

function formatDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SeasonPage() {
  const supabase = createClient();
  const { loading: gateLoading, societyId, societyName } = useSeasonAdmin();

  const [seasons, setSeasons]   = useState<SeasonRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busyId, setBusyId]     = useState<string | null>(null);
  const [banner, setBanner]     = useState<Banner | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SeasonRow | null>(null);

  const load = useCallback(async (id: string) => {
    const { data } = await supabase
      .from('seasons')
      .select('id, name, season_year, status, join_pin, start_at, end_at, season_divisions(count)')
      .eq('society_id', id)
      .order('created_at', { ascending: false });

    setSeasons(((data ?? []) as Record<string, unknown>[]).map(r => ({
      id: r.id as string,
      name: r.name as string,
      season_year: r.season_year as number,
      status: r.status as string,
      join_pin: (r.join_pin as string | null) ?? null,
      start_at: (r.start_at as string | null) ?? null,
      end_at: (r.end_at as string | null) ?? null,
      division_count: (r.season_divisions as { count: number }[] | null)?.[0]?.count ?? 0,
    })));
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (societyId) load(societyId);
  }, [societyId, load]);

  async function copyPin(season: SeasonRow) {
    if (!season.join_pin) return;
    try {
      await navigator.clipboard.writeText(season.join_pin);
      setCopiedId(season.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setBanner({ tone: 'error', text: 'Could not copy the PIN — select it manually instead.' });
    }
  }

  async function handlePublish(season: SeasonRow) {
    setBusyId(season.id);
    setBanner(null);
    try {
      const result = await publishDivisions(supabase, season.id);
      setBanner(result.assignedCount === 0
        ? { tone: 'error', text: 'Nothing to publish — no approved players are waiting to be placed into divisions yet.' }
        : { tone: 'ok', text: `${result.assignedCount} player${result.assignedCount === 1 ? '' : 's'} placed into divisions by handicap.` });
      if (societyId) await load(societyId);
    } catch (e) {
      setBanner({ tone: 'error', text: (e as Error)?.message ?? 'Could not publish divisions' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleClose(season: SeasonRow) {
    setConfirming(null);
    setBusyId(season.id);
    setBanner(null);
    try {
      const result = await closeSeason(supabase, season.id);
      const champs = result.champions.map(c => `${c.divisionName}: ${c.playerName}`).join(' · ');
      setBanner({
        tone: 'ok',
        text: `${result.divisionsClosed} division${result.divisionsClosed === 1 ? '' : 's'} finalized.${champs ? ` Champions — ${champs}` : ''}`,
      });
      if (societyId) await load(societyId);
    } catch (e) {
      setBanner({ tone: 'error', text: (e as Error)?.message ?? 'Could not close Season' });
    } finally {
      setBusyId(null);
    }
  }

  if (gateLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--green)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative mx-auto max-w-screen-xl px-6 py-12">

        {/* ── Header ─────────────────────────────────────────── */}
        <Link href="/admin" className="text-sm text-[var(--gold)] hover:underline">← Back to Admin</Link>
        <div className="mb-8 mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-[var(--green)]">
              {societyName ?? 'Society'} · Season Mode
            </div>
            <h1 className="mt-1 text-5xl font-black text-white">Seasons</h1>
            <p className="mt-2 text-neutral-400">
              Create a Season, publish divisions by handicap, and close it out at year end.
            </p>
          </div>
          <Link
            href="/season/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--green)] px-5 py-3 text-sm font-black text-[#00140a] transition-[filter] hover:brightness-110"
          >
            <Plus size={15} />
            New Season
          </Link>
        </div>

        {banner && (
          <div
            className={`mb-6 rounded-xl border bg-[#111111] px-5 py-3 text-sm ${
              banner.tone === 'ok'
                ? 'border-[var(--green)]/30 text-[var(--green)]'
                : 'border-[var(--red)]/30 text-[var(--red)]'
            }`}
          >
            {banner.text}
          </div>
        )}

        {/* ── Season list ────────────────────────────────────── */}
        {seasons.length === 0 ? (
          <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--green)]/25 bg-[var(--green)]/8 text-3xl">
              🏆
            </div>
            <h3 className="text-xl font-black text-white">No Seasons yet</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">
              Create one to start building your league — divisions, majors and the join PIN come with it.
            </p>
            <Link
              href="/season/new"
              className="mt-6 inline-block rounded-xl bg-[var(--green)] px-6 py-3 text-sm font-black text-[#00140a]"
            >
              Create Season
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {seasons.map(season => {
              const busy = busyId === season.id;
              const dateWindow = [formatDate(season.start_at), formatDate(season.end_at)].filter(Boolean).join(' → ');
              return (
                <section key={season.id} className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <Link
                        href={`/season/${season.id}`}
                        className="group inline-flex items-center gap-1.5 text-lg font-black text-white transition-colors hover:text-[var(--green)]"
                      >
                        <span className="truncate">{season.name}</span>
                        <ArrowUpRight size={15} className="shrink-0 text-neutral-700 transition-colors group-hover:text-[var(--green)]" />
                      </Link>
                      <div className="mt-1 text-xs font-semibold text-neutral-500">
                        {season.season_year} · {season.division_count} division{season.division_count === 1 ? '' : 's'}
                        {dateWindow ? ` · ${dateWindow}` : ''}
                      </div>
                    </div>
                    {/* Season Mode's own pill is always green-tinted, matching the app. */}
                    <span className="shrink-0 rounded-full border border-[var(--green)]/25 bg-[var(--green)]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-[var(--green)]">
                      {STATUS_LABEL[season.status] ?? season.status}
                    </span>
                  </div>

                  {season.join_pin && (
                    <div className="mt-4 flex items-center justify-between gap-4 border-t border-[#1c1c1c] pt-4">
                      <span className="font-mono text-[22px] font-black leading-none tracking-[4px] tabular-nums text-white">
                        {season.join_pin.slice(0, 3)} {season.join_pin.slice(3)}
                      </span>
                      <button
                        onClick={() => copyPin(season)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--green)]/25 bg-[var(--green)]/10 px-3 py-1.5 text-[11px] font-bold text-[var(--green)] transition-colors hover:bg-[var(--green)]/20"
                      >
                        {copiedId === season.id ? <Check size={13} /> : <Copy size={13} />}
                        {copiedId === season.id ? 'Copied' : 'Copy PIN'}
                      </button>
                    </div>
                  )}

                  {season.status === 'locked' ? (
                    <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-neutral-500">
                      <Lock size={13} />
                      Final — Season Closed
                    </div>
                  ) : (
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => handlePublish(season)}
                        disabled={busy}
                        className="flex-1 rounded-xl border border-[var(--green)]/25 bg-[var(--green)]/10 py-2.5 text-xs font-bold text-[var(--green)] transition-colors hover:bg-[var(--green)]/20 disabled:opacity-40"
                      >
                        {busy ? 'Working…' : season.status === 'draft' ? 'Publish Divisions' : 'Re-Publish'}
                      </button>
                      <button
                        onClick={() => setConfirming(season)}
                        disabled={busy}
                        className="flex-1 rounded-xl border border-[var(--red)]/25 bg-[var(--red)]/10 py-2.5 text-xs font-bold text-[var(--red)] transition-colors hover:bg-[var(--red)]/20 disabled:opacity-40"
                      >
                        Close Season
                      </button>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {confirming && (
        <ConfirmClose
          season={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => handleClose(confirming)}
        />
      )}
    </div>
  );
}

// ── Close Season confirm ────────────────────────────────────────────────────
// Dave dislikes native popups, and the web app had no confirm pattern yet —
// this is a plain modal built from the same card/button tokens as the page.

function ConfirmClose({
  season, onCancel, onConfirm,
}: {
  season: SeasonRow;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const notEndedYet = season.end_at ? new Date(season.end_at) > new Date() : false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Close Season"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6"
      >
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--red)]">Close Season</div>
        <h2 className="mt-1.5 text-2xl font-black text-white">{season.name}</h2>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          {notEndedYet && (
            <span className="text-[var(--red)]">
              This Season&apos;s end date hasn&apos;t passed yet ({formatDate(season.end_at)}).{' '}
            </span>
          )}
          This finalizes final standings, confirms champions, and applies promotion/relegation.
          It cannot be undone from the app.
        </p>
        <div className="mt-6 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-[#1c1c1c] bg-[#000000] py-2.5 text-xs font-bold text-neutral-300 transition-colors hover:border-neutral-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-[var(--red)] py-2.5 text-xs font-black text-[#1a0505] transition-[filter] hover:brightness-110"
          >
            Close Season
          </button>
        </div>
      </div>
    </div>
  );
}
