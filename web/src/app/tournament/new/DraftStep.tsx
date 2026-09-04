'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ChevronDown, Star, X } from 'lucide-react';
import { Label, SectionHeading, StatusPill, Stepper } from './ui';

export interface DraftPlayer {
  id: string;
  player_id: string;
  team_id: string | null;
  handicap_index: number | null;
  display_name: string;
  is_captain: boolean;
  status: 'enrolled' | 'invited' | 'declined';
}

export interface SquadTeam { id: string; name: string; accent_color: string | null; }

interface SocietyMember {
  player_id: string;
  display_name: string;
  handicap_index: number | null;
  team_id: string | null;
}

/**
 * Player enrollment, sourced entirely from the society's REAL roster
 * (society_members → players) and its REAL teams table. Nothing here
 * fabricates a player, a team, or a handicap: an empty society shows an empty
 * draft, and the fix is to add members in the admin panel, not to invent them.
 */
export default function DraftStep({
  compId, societyId, isTeamFormat, exactPlayersPerTeam, maxHandicap, players, onReload,
}: {
  compId: string;
  societyId: string;
  isTeamFormat: boolean;
  exactPlayersPerTeam: number | null;
  maxHandicap: number | null;
  players: DraftPlayer[];
  onReload: () => Promise<void>;
}) {
  const supabase = createClient();

  const [teams,    setTeams]    = useState<SquadTeam[]>([]);
  const [members,  setMembers]  = useState<SocietyMember[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [busyId,   setBusyId]   = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Titan Way / Odd Titan hard-require exactly four players per team, so the
  // stepper is locked rather than merely defaulted for those formats.
  const [perTeam,  setPerTeam]  = useState(exactPlayersPerTeam ?? 4);

  useEffect(() => { if (exactPlayersPerTeam != null) setPerTeam(exactPlayersPerTeam); }, [exactPlayersPerTeam]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: teamRows }, { data: memberRows }] = await Promise.all([
      supabase.from('teams').select('id, name, accent_color').eq('society_id', societyId).order('sort_order'),
      supabase.from('society_members').select('player_id, team_id, players(display_name, handicap_index)').eq('society_id', societyId),
    ]);
    setTeams((teamRows as SquadTeam[] | null) ?? []);
    setMembers(((memberRows ?? []) as unknown as Array<{
      player_id: string; team_id: string | null;
      players: { display_name: string | null; handicap_index: number | null } | null;
    }>).map(m => ({
      player_id: m.player_id,
      display_name: m.players?.display_name ?? '—',
      handicap_index: m.players?.handicap_index ?? null,
      team_id: m.team_id ?? null,
    })).sort((a, b) => a.display_name.localeCompare(b.display_name)));
    setLoading(false);
  }, [supabase, societyId]);

  useEffect(() => { load(); }, [load]);

  const enrolledIds = new Set(players.filter(p => p.status !== 'declined').map(p => p.player_id));

  // The enrollment handicap is clamped to the tournament's max_handicap the
  // same way the mobile builder clamps it, so both paths snapshot the same
  // number into competition_players.
  function clamp(h: number | null): number | null {
    return maxHandicap != null && h != null ? Math.min(h, maxHandicap) : h;
  }

  async function addPlayer(m: SocietyMember, teamId: string | null) {
    setBusyId(m.player_id);
    await supabase.from('competition_players').insert({
      competition_id: compId,
      player_id: m.player_id,
      team_id: teamId,
      handicap_index: clamp(m.handicap_index),
      status: 'enrolled',
    });
    await onReload();
    setBusyId(null);
  }

  async function removePlayer(cp: DraftPlayer) {
    setBusyId(cp.player_id);
    await supabase.from('competition_players').delete().eq('id', cp.id);
    await onReload();
    setBusyId(null);
  }

  async function toggleCaptain(cp: DraftPlayer) {
    if (!cp.team_id) return;
    setBusyId(cp.player_id);
    if (cp.is_captain) {
      await supabase.from('competition_players').update({ is_captain: false }).eq('id', cp.id);
    } else {
      // One captain per team — clear the team first so two taps can't leave
      // two captains standing.
      await supabase.from('competition_players').update({ is_captain: false })
        .eq('competition_id', compId).eq('team_id', cp.team_id);
      await supabase.from('competition_players').update({ is_captain: true }).eq('id', cp.id);
    }
    await onReload();
    setBusyId(null);
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading the society roster…</p>;
  }

  // ── Team formats ──────────────────────────────────────────────────────────
  if (isTeamFormat) {
    if (teams.length === 0) {
      return (
        <div className="rounded-2xl border border-[#f87171]/30 bg-[#f87171]/8 p-6 text-sm text-[#f87171]">
          This society has no teams yet. Create them in the admin panel first — a team format can&apos;t draft players
          into teams that don&apos;t exist.
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <p className="text-sm text-neutral-400">
          Draft real society members into their teams. Tap a team to open its roster, tap a player to add or remove them,
          and use the star to set that team&apos;s captain.
        </p>

        <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6">
          <Stepper
            label="Players Per Team"
            value={perTeam}
            unit={perTeam === 1 ? 'player' : 'players'}
            onDec={() => setPerTeam(v => Math.max(1, v - 1))}
            onInc={() => setPerTeam(v => Math.min(8, v + 1))}
            locked={exactPlayersPerTeam != null}
            lockedHint={exactPlayersPerTeam != null ? `Locked at ${exactPlayersPerTeam}` : undefined}
          />
        </div>

        <SectionHeading label="Teams" hint={`${players.filter(p => p.status !== 'declined').length} players drafted`} />

        <div className="space-y-3">
          {teams.map(team => {
            const roster = players.filter(p => p.team_id === team.id && p.status !== 'declined');
            const full   = roster.length >= perTeam;
            const tone   = roster.length === 0 ? 'red' : full ? 'green' : 'gold';
            const pool   = members.filter(m => m.team_id === team.id || !enrolledIds.has(m.player_id));
            const open   = expanded === team.id;

            return (
              <div key={team.id} className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : team.id)}
                  className="flex w-full items-center gap-3 px-6 py-4 text-left transition-colors hover:bg-[#161616]"
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: team.accent_color ?? '#D4AF37' }} />
                  <span className="min-w-0 flex-1 truncate font-black text-white">{team.name}</span>
                  <StatusPill tone={tone}>{roster.length} / {perTeam}</StatusPill>
                  <ChevronDown size={16} className={`shrink-0 text-neutral-600 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {roster.length > 0 && (
                  <div className="border-t border-[#1c1c1c]">
                    {roster.map(cp => (
                      <div key={cp.id} className="flex items-center gap-3 border-b border-[#1c1c1c] px-6 py-3 last:border-0">
                        <button
                          type="button"
                          onClick={() => toggleCaptain(cp)}
                          disabled={busyId === cp.player_id}
                          aria-label={`Captain ${cp.display_name}`}
                          className={`shrink-0 transition-colors ${cp.is_captain ? 'text-[var(--gold-bright)]' : 'text-neutral-700 hover:text-neutral-500'}`}
                        >
                          <Star size={15} fill={cp.is_captain ? 'currentColor' : 'none'} />
                        </button>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{cp.display_name}</span>
                        <span className="font-mono text-[12px] font-bold tabular-nums text-neutral-500">
                          {cp.handicap_index != null ? cp.handicap_index.toFixed(1) : '—'}
                        </span>
                        <button
                          type="button"
                          onClick={() => removePlayer(cp)}
                          disabled={busyId === cp.player_id}
                          aria-label={`Remove ${cp.display_name}`}
                          className="shrink-0 text-neutral-700 transition-colors hover:text-[#f87171]"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {open && (
                  <div className="border-t border-[#1c1c1c] bg-[#0a0a0a] p-5">
                    <Label>Society Roster</Label>
                    {pool.length === 0 ? (
                      <p className="text-[12px] text-neutral-600">Every available member is already drafted.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {pool.map(m => {
                          const inThis = players.some(p => p.player_id === m.player_id && p.team_id === team.id && p.status !== 'declined');
                          const taken  = enrolledIds.has(m.player_id) && !inThis;
                          return (
                            <button
                              key={m.player_id}
                              type="button"
                              disabled={busyId === m.player_id || taken || (!inThis && full)}
                              onClick={() => {
                                const existing = players.find(p => p.player_id === m.player_id && p.team_id === team.id);
                                if (existing) removePlayer(existing); else addPlayer(m, team.id);
                              }}
                              className={`rounded-xl border px-3.5 py-2 text-left text-[12.5px] transition-colors disabled:opacity-30 ${
                                inThis
                                  ? 'border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[var(--gold-bright)]'
                                  : 'border-[#1c1c1c] bg-[#000000] text-neutral-400 hover:border-neutral-700 hover:text-white'
                              }`}
                            >
                              <span className="font-semibold">{m.display_name}</span>
                              <span className="ml-2 font-mono text-[11px] tabular-nums text-neutral-600">
                                {m.handicap_index != null ? m.handicap_index.toFixed(1) : '—'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Individual formats ────────────────────────────────────────────────────
  const available = members.filter(m => !enrolledIds.has(m.player_id));
  const enrolled  = players.filter(p => p.status !== 'declined');

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-400">Enrol real society members into the field. There are no teams in this format.</p>

      <SectionHeading label="Enrolled" hint={`${enrolled.length} player${enrolled.length === 1 ? '' : 's'}`} />
      {enrolled.length === 0 ? (
        <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] px-6 py-5 text-sm text-neutral-500">
          No players enrolled yet — pick them from the roster below.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
          {enrolled.map((cp, i) => (
            <div
              key={cp.id}
              className={`flex items-center gap-3 border-b border-[#1c1c1c] px-5 py-3.5 last:border-0 ${i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'}`}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{cp.display_name}</span>
              <span className="font-mono text-[12px] font-bold tabular-nums text-neutral-500">
                {cp.handicap_index != null ? cp.handicap_index.toFixed(1) : '—'}
              </span>
              <button
                type="button"
                onClick={() => removePlayer(cp)}
                disabled={busyId === cp.player_id}
                aria-label={`Remove ${cp.display_name}`}
                className="shrink-0 text-neutral-700 transition-colors hover:text-[#f87171]"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <SectionHeading label="Society Roster" hint={`${available.length} available`} />
      {available.length === 0 ? (
        <p className="text-[12px] text-neutral-600">Every society member is already enrolled.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {available.map(m => (
            <button
              key={m.player_id}
              type="button"
              disabled={busyId === m.player_id}
              onClick={() => addPlayer(m, null)}
              className="rounded-xl border border-[#1c1c1c] bg-[#000000] px-3.5 py-2 text-left text-[12.5px] text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white disabled:opacity-30"
            >
              <span className="font-semibold">{m.display_name}</span>
              <span className="ml-2 font-mono text-[11px] tabular-nums text-neutral-600">
                {m.handicap_index != null ? m.handicap_index.toFixed(1) : '—'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
