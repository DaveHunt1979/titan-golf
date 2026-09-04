'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Check, ChevronDown, Copy, Minus, Plus, Trophy } from 'lucide-react';

import {
  FORMAT_IDS, FORMAT_RULES, checkTitanWayStructure, getFormatRules, tournamentTypeFor,
  type FormatId,
} from '@/lib/tournamentFormat';
import {
  DAY_FORMATS, DEFAULT_HANDICAP_CUT_BANDS, applyLastDayOverride, blankDay,
  calculateWHSPlayingHandicap, emptyWebInfoPack, fetchAllRows, fetchCourseTees,
  fetchTeesForRounds, genPin, resolveTeeForRound,
  type DayConfig, type DayFormatId, type HandicapCutBand, type SelectableTee, type WebInfoPack,
} from '@/lib/tournamentBuilder';

import DaysStep, { type CourseHole } from './DaysStep';
import DraftStep, { type DraftPlayer } from './DraftStep';
import PrizesStep from './PrizesStep';
import {
  Card, CheckDot, ErrorBanner, Label, SectionHeading, StatusPill,
  Stepper, TextArea, TextField, Toggle,
} from './ui';

const STEPS = ['Format', 'Details', 'Days', 'Draft', 'Prizes', 'Info Pack', 'Review'];

export default function NewTournamentPage() {
  return (
    <Suspense fallback={<div className="px-6 py-12 text-sm text-neutral-500">Loading builder…</div>}>
      <Wizard />
    </Suspense>
  );
}

function Wizard() {
  const supabase = createClient();
  // ?id= turns the whole wizard into an editor for that draft, the same way
  // the mobile builder's Make Amendments flow works.
  const editCompId = useSearchParams().get('id');

  const [step,  setStep]  = useState(0);
  const [error, setError] = useState('');

  // Identity
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [playerId,  setPlayerId]  = useState<string | null>(null);
  const [gateMsg,   setGateMsg]   = useState<string | null>(null);

  // Step 0 — Format
  const [selectedFormat, setSelectedFormat] = useState<FormatId | null>(null);
  const [howItWorksFor,  setHowItWorksFor]  = useState<FormatId | null>(null);

  // Step 1 — Details
  const [name,        setName]        = useState('');
  const [year,        setYear]        = useState(String(new Date().getFullYear() + 1));
  const [logoUrl,     setLogoUrl]     = useState('');
  const [description, setDescription] = useState('');
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');
  const [numTeams,    setNumTeams]    = useState('2');
  const [maxHandicap, setMaxHandicap] = useState('');
  const [ptsWin,      setPtsWin]      = useState('1');
  const [ptsHalf,     setPtsHalf]     = useState('0.5');
  const [openingRounds,     setOpeningRounds]     = useState('3');
  const [sweepBonusEnabled, setSweepBonusEnabled] = useState(true);
  const [bonusPoints,       setBonusPoints]       = useState('2');
  const [includeInKronos,   setIncludeInKronos]   = useState(false);
  const [handicapCutsEnabled, setHandicapCutsEnabled] = useState(false);
  const [handicapCutTrigger,  setHandicapCutTrigger]  = useState('36');
  const [handicapCutMinimum,  setHandicapCutMinimum]  = useState('0');
  const [handicapCutBands,    setHandicapCutBands]    = useState<HandicapCutBand[]>(DEFAULT_HANDICAP_CUT_BANDS);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [statsEnabled, setStatsEnabled] = useState(false);

  // Step 2 — Days
  const [days,        setDays]        = useState<DayConfig[]>([]);
  const [courses,     setCourses]     = useState<string[]>([]);
  const [courseTees,  setCourseTees]  = useState<Record<string, SelectableTee[]>>({});
  const [courseHoles, setCourseHoles] = useState<Record<string, CourseHole[]>>({});

  // Step 3+ — the persisted competition
  const [compId,      setCompId]      = useState<string | null>(null);
  const [compPin,     setCompPin]     = useState<string | null>(null);
  const [compPlayers, setCompPlayers] = useState<DraftPlayer[]>([]);

  // Step 5 — Info Pack
  const [infoPack,    setInfoPack]    = useState<WebInfoPack>(emptyWebInfoPack());
  const [rawInfoPack, setRawInfoPack] = useState<Record<string, unknown>>({});

  const [saving,      setSaving]      = useState(false);
  const [goLiveIssues, setGoLiveIssues] = useState<string[] | null>(null);
  const [wentLive,    setWentLive]    = useState<{ name: string; pin: string } | null>(null);
  const [copied,      setCopied]      = useState(false);

  const rules       = getFormatRules(selectedFormat);
  const isTeamFmt   = selectedFormat != null && rules.isTeamFormat;
  const numTeamsN   = parseInt(numTeams, 10) || 0;
  const maxHcpN     = maxHandicap.trim() ? parseFloat(maxHandicap) : null;
  const enrolled    = compPlayers.filter(p => p.status !== 'declined');

  // ── Gate: society admin/owner only, same check as /admin and /admin/tee-sheet ──
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setGateMsg('You must be logged in to build a tournament.'); return; }
      const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!player) { setGateMsg('Player profile not found.'); return; }
      setPlayerId((player as { id: string }).id);
      const { data: member } = await supabase
        .from('society_members').select('role, society_id')
        .eq('player_id', (player as { id: string }).id)
        .in('role', ['admin', 'owner'])
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!member) { setGateMsg('Admin access required.'); return; }
      setSocietyId((member as { society_id: string }).society_id);
    })();
  }, [supabase]);

  // ── Course master (paginated — the course list is well past PostgREST's 1000-row cap) ──
  useEffect(() => {
    (async () => {
      const rows = await fetchAllRows<{ name: string }>(
        (from, to) => supabase.from('courses').select('name').range(from, to),
      );
      setCourses(rows.map(r => r.name).sort((a, b) => a.localeCompare(b)));
    })();
  }, [supabase]);

  // Tees and holes are fetched per selected course rather than up front —
  // course_holes is ~22,000 rows across the whole master list.
  const ensureCourseData = useCallback(async (courseName: string) => {
    if (!courseName) return;
    if (!courseTees[courseName]) {
      const tees = await fetchCourseTees(courseName);
      setCourseTees(prev => ({ ...prev, [courseName]: tees }));
    }
    if (!courseHoles[courseName]) {
      const { data } = await supabase
        .from('course_holes').select('hole_number, par').eq('course_name', courseName).order('hole_number');
      setCourseHoles(prev => ({ ...prev, [courseName]: (data as CourseHole[] | null) ?? [] }));
    }
  }, [supabase, courseTees, courseHoles]);

  // ── Edit an existing draft ────────────────────────────────────────────────
  const hydrate = useCallback(async (id: string) => {
    const { data: comp } = await supabase.from('competitions').select('*').eq('id', id).single();
    if (!comp) { setError('That tournament could not be loaded.'); return; }
    const c = comp as Record<string, unknown>;

    setCompId(id);
    setCompPin((c.pin as string | null) ?? null);
    setSelectedFormat(((c.format as string) in FORMAT_RULES ? c.format : null) as FormatId | null);
    setName((c.name as string) ?? '');
    setYear(String((c.year as number | null) ?? new Date().getFullYear() + 1));
    setLogoUrl((c.logo_url as string | null) ?? '');
    setDescription((c.description as string | null) ?? '');
    setStartDate((c.start_date as string | null) ?? '');
    setEndDate((c.end_date as string | null) ?? '');
    setPtsWin(String((c.pts_win as number | null) ?? 1));
    setPtsHalf(String((c.pts_half as number | null) ?? 0.5));
    setOpeningRounds(String((c.opening_rounds as number | null) ?? 3));
    const bonus = Number((c.bonus_points as number | null) ?? 0);
    setSweepBonusEnabled(bonus > 0);
    setBonusPoints(String(bonus || 2));
    setMaxHandicap(c.max_handicap != null ? String(c.max_handicap) : '');
    setIncludeInKronos(Boolean(c.include_in_kronos));
    setHandicapCutsEnabled(Boolean(c.handicap_cuts_enabled));
    setHandicapCutTrigger(String((c.handicap_cut_trigger_score as number | null) ?? 36));
    setHandicapCutMinimum(String((c.handicap_cut_minimum as number | null) ?? 0));
    setHandicapCutBands((c.handicap_cut_bands as HandicapCutBand[] | null) ?? DEFAULT_HANDICAP_CUT_BANDS);

    const settings = (c.settings as Record<string, unknown> | null) ?? {};
    setNumTeams(String((settings.num_teams as number | null) ?? 2));
    setVoiceEnabled(Boolean(settings.voice_enabled));
    setStatsEnabled(Boolean(settings.track_stats_enabled));

    const pack = (c.info_pack as Record<string, unknown> | null) ?? {};
    setRawInfoPack(pack);
    setInfoPack({
      schedule: (pack.schedule as string) ?? '',
      travel:   (pack.travel   as string) ?? '',
      rules:    (pack.rules    as string) ?? '',
      contacts: (pack.contacts as string) ?? '',
    });

    const { data: dayRows } = await supabase
      .from('competition_days').select('*').eq('competition_id', id).order('day_number');
    setDays(((dayRows ?? []) as Record<string, unknown>[]).map(d => ({
      courseName:   (d.course_name as string | null) ?? '',
      slopeRating:  d.slope_rating  != null ? String(d.slope_rating)  : '',
      courseRating: d.course_rating != null ? String(d.course_rating) : '',
      teeName:      (d.tee_name   as string | null) ?? '',
      teeGender:    (d.tee_gender as string | null) ?? '',
      whsEnabled:   Boolean(d.whs_enabled),
      teeTime:      ((d.tee_time as string | null) ?? '').slice(0, 5),
      playDate:     (d.play_date as string | null) ?? '',
      format:       ((d.day_format as string | null) ?? 'four_bbb') as DayFormatId,
      hcpPct:       (d.hcp_pct as number | null) ?? 100,
      ldEnabled:    d.ld_hole  != null, ldHole:  (d.ld_hole  as number | null) ?? null,
      ntpEnabled:   d.ntp_hole != null, ntpHole: (d.ntp_hole as number | null) ?? null,
    })));
  }, [supabase]);

  useEffect(() => { if (editCompId) hydrate(editCompId); }, [editCompId, hydrate]);

  // Any course already referenced by a hydrated round needs its tees/holes
  // loaded before the Days step can show what was picked.
  useEffect(() => {
    days.forEach(d => { if (d.courseName) ensureCourseData(d.courseName); });
  }, [days, ensureCourseData]);

  const loadDraft = useCallback(async () => {
    if (!compId) return;
    const { data } = await supabase
      .from('competition_players')
      .select('id, player_id, team_id, handicap_index, is_captain, status, players(display_name)')
      .eq('competition_id', compId);
    setCompPlayers(((data ?? []) as unknown as Array<{
      id: string; player_id: string; team_id: string | null; handicap_index: number | null;
      is_captain: boolean | null; status: string | null; players: { display_name: string | null } | null;
    }>).map(cp => ({
      id: cp.id,
      player_id: cp.player_id,
      team_id: cp.team_id,
      handicap_index: cp.handicap_index,
      display_name: cp.players?.display_name ?? '—',
      is_captain: cp.is_captain ?? false,
      status: (cp.status ?? 'enrolled') as DraftPlayer['status'],
    })));
  }, [supabase, compId]);

  useEffect(() => { if (compId) loadDraft(); }, [compId, loadDraft]);

  // ── Step 0 ────────────────────────────────────────────────────────────────
  function pickFormat(id: FormatId) {
    const r = FORMAT_RULES[id];
    if (!r.available) return;
    setSelectedFormat(id);
    setIncludeInKronos(r.individualBoardDefaultOn);
    setPtsWin(String(r.defaultPtsWin));
    setPtsHalf(String(r.defaultPtsHalf));
    setMaxHandicap(r.defaultMaxHandicap != null ? String(r.defaultMaxHandicap) : '');
    setNumTeams(String(r.minTeams ?? 2));
    setDays(applyLastDayOverride(
      Array.from({ length: r.defaultDays }, () => blankDay(r.defaultDayFormat as DayFormatId, r.defaultHcpPct)),
      r,
    ));
    if (!name) setName(`${r.label} ${new Date().getFullYear() + 1}`);
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  function updateDay(i: number, patch: Partial<DayConfig>) {
    setDays(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d));
  }

  function pickCourse(i: number, courseName: string) {
    // Changing the course invalidates the round's tee — a tee name from the
    // previous course would silently fail to resolve against the new
    // course_tees and quietly break that round's WHS numbers.
    updateDay(i, { courseName, teeName: '', teeGender: '', courseRating: '', slopeRating: '' });
    ensureCourseData(courseName);
  }

  function addDay() {
    if (days.length >= 10) return;
    setDays(prev => applyLastDayOverride(
      [...prev, blankDay(rules.defaultDayFormat as DayFormatId, rules.defaultHcpPct)],
      rules,
    ));
  }

  function removeDay() {
    if (days.length <= 1) return;
    setDays(prev => applyLastDayOverride(prev.slice(0, -1), rules));
  }

  // ── Save the competition shell (Days → Draft) ─────────────────────────────
  async function saveShell(): Promise<boolean> {
    if (!selectedFormat || !societyId) return false;
    if (name.trim().length < 2) { setError('Give the tournament a name first.'); return false; }
    if (isTeamFmt && numTeamsN % 2 !== 0 && !rules.requiresOddTeams) {
      setError('This format needs an even number of teams to pair up.');
      return false;
    }
    setSaving(true); setError('');

    const settings = {
      format_type: selectedFormat,
      num_days: days.length,
      num_teams: isTeamFmt ? numTeamsN : null,
      day_configs: days.map(d => ({ format: d.format, hcp_pct: d.hcpPct })),
      voice_enabled: voiceEnabled,
      track_stats_enabled: statsEnabled,
    };

    const sharedFields = {
      name:            name.trim(),
      year:            parseInt(year, 10) || new Date().getFullYear() + 1,
      format:          selectedFormat,
      tournament_type: tournamentTypeFor(selectedFormat),
      pts_win:         isTeamFmt ? (parseFloat(ptsWin)  || 1)   : 1,
      pts_half:        isTeamFmt ? (parseFloat(ptsHalf) || 0.5) : 0.5,
      // Captain Rotation is Titan Way / Odd Titan-exclusive — every other
      // format stores 0 so the row itself carries no rotation to apply.
      opening_rounds:  rules.captainRotation ? (parseInt(openingRounds, 10) || 0) : 0,
      // bonus_points = 0 already functions as a full "off" switch at every
      // sweep-bonus call site, so there is no separate enabled column.
      bonus_points:    isTeamFmt && sweepBonusEnabled ? (parseFloat(bonusPoints) || 0) : 0,
      description:     description.trim() || null,
      start_date:      startDate || null,
      end_date:        endDate   || null,
      max_handicap:    maxHcpN,
      logo_url:        logoUrl.trim() || null,
      settings,
      include_in_kronos:          includeInKronos,
      handicap_cuts_enabled:      handicapCutsEnabled,
      handicap_cut_trigger_score: parseInt(handicapCutTrigger, 10) || 36,
      handicap_cut_minimum:       parseFloat(handicapCutMinimum) || 0,
      handicap_cut_bands:         handicapCutBands,
    };

    let id = compId;
    let pin = compPin;

    if (id) {
      const { error: updErr } = await supabase.from('competitions').update(sharedFields).eq('id', id);
      if (updErr) { setError(updErr.message); setSaving(false); return false; }
    } else {
      // A PIN collision makes the app's verifyPin lookup fail as "Wrong PIN"
      // for whichever tournament loses the race — retry rather than trusting
      // a single random draw.
      pin = genPin();
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: clash } = await supabase.from('competitions').select('id').eq('pin', pin).limit(1).maybeSingle();
        if (!clash) break;
        pin = genPin();
      }
      const { data, error: insErr } = await supabase
        .from('competitions')
        .insert({ ...sharedFields, society_id: societyId, status: 'draft', pin })
        .select('id').single();
      if (insErr || !data) { setError(insErr?.message ?? 'Could not create the competition.'); setSaving(false); return false; }
      id = (data as { id: string }).id;
    }

    // Day rows are replaced wholesale rather than diffed. That is safe
    // pre-Go-Live: a draft competition has no matches or scores yet, so
    // nothing downstream can be corrupted by a day-row swap.
    const { error: delErr } = await supabase.from('competition_days').delete().eq('competition_id', id);
    if (delErr) { setError(delErr.message); setSaving(false); return false; }

    const dayRows = days.map((d, i) => ({
      competition_id: id,
      day_number:     i + 1,
      course_name:    d.courseName.trim() || null,
      course_par:     (courseHoles[d.courseName] ?? []).reduce((s, h) => s + h.par, 0) || null,
      course_rating:  d.courseRating.trim() ? (parseFloat(d.courseRating) || null) : null,
      slope_rating:   parseInt(d.slopeRating, 10) || 113,
      tee_name:       d.teeName.trim()   || null,
      tee_gender:     d.teeGender.trim() || null,
      whs_enabled:    d.whsEnabled,
      tee_time:       d.teeTime  || null,
      play_date:      d.playDate || null,
      day_format:     d.format,
      hcp_pct:        d.hcpPct,
      ld_hole:        d.ldEnabled  ? d.ldHole  : null,
      ntp_hole:       d.ntpEnabled ? d.ntpHole : null,
    }));
    const { error: daysErr } = await supabase.from('competition_days').insert(dayRows);
    setSaving(false);
    if (daysErr) { setError(daysErr.message); return false; }

    setCompId(id);
    setCompPin(pin);
    return true;
  }

  async function saveInfoPack(id: string) {
    // Merge, never replace — the mobile Info Pack editor owns several richer
    // keys in this same jsonb column and must not lose them to a web save.
    await supabase.from('competitions')
      .update({ info_pack: { ...rawInfoPack, ...infoPack } })
      .eq('id', id);
  }

  // ── Go Live validation ────────────────────────────────────────────────────
  /**
   * A subset of the mobile builder's computeGoLiveIssues: identity and dates,
   * every round's course/tee/rating, a resolvable fully-rated tee for every
   * WHS round, at least one enrolled player, the format's own team/player
   * minimums and structural rules, and prize configuration.
   */
  async function computeGoLiveIssues(id: string): Promise<string[]> {
    const issues: string[] = [];

    if (name.trim().length < 2) issues.push('Tournament Name — not set');
    if (!selectedFormat)        issues.push('Tournament Format — not selected');
    if (!startDate)             issues.push('Start Date — not set');
    if (!endDate)               issues.push('End Date — not set');
    if (startDate && endDate && endDate < startDate) issues.push('End Date — falls before Start Date');
    if (days.length === 0)      issues.push('Rounds — none configured');

    const teesByCourse = await fetchTeesForRounds(days.filter(d => d.whsEnabled));
    days.forEach((d, i) => {
      if (!d.courseName.trim()) issues.push(`Round ${i + 1} — Course not selected`);
      if (!d.teeName.trim())    issues.push(`Round ${i + 1} — Tee not selected`);
      // A blank rating writes course_rating: null, which silently drops every
      // handicap on that round back to the bare rounded handicap index.
      if (d.courseName.trim() && !d.courseRating.trim()) issues.push(`Round ${i + 1} — Course Rating not set`);
      if (d.whsEnabled) {
        const tee = resolveTeeForRound(teesByCourse[d.courseName] ?? [], d);
        if (!tee || tee.par == null || tee.course_rating == null || tee.slope_rating == null) {
          issues.push(`Round ${i + 1} — WHS needs a rated tee box for this round's course`);
        }
      }
    });

    if (enrolled.length === 0) issues.push('Players — none enrolled');

    const pickedTeamIds = new Set(enrolled.map(p => p.team_id).filter(Boolean) as string[]);
    if (isTeamFmt && pickedTeamIds.size < numTeamsN) {
      issues.push(`Teams — only ${pickedTeamIds.size} of ${numTeamsN} teams have players`);
    }
    if (rules.minTeams != null && numTeamsN < rules.minTeams) {
      issues.push(`${rules.label} needs at least ${rules.minTeams} teams`);
    }
    if (rules.minPlayers != null && enrolled.length < rules.minPlayers) {
      issues.push(`${rules.label} needs at least ${rules.minPlayers} players — currently ${enrolled.length}`);
    }
    if (rules.maxTeams != null || rules.exactPlayersPerTeam != null || rules.requiresEvenTeams || rules.requiresOddTeams) {
      const counts = new Map<string, number>();
      enrolled.forEach(p => { if (p.team_id) counts.set(p.team_id, (counts.get(p.team_id) ?? 0) + 1); });
      const teamsForCheck = Array.from(pickedTeamIds).map(tid => ({ id: tid, playerCount: counts.get(tid) ?? 0 }));
      checkTitanWayStructure(rules, teamsForCheck).forEach(iss => issues.push(iss.label));
    }

    const { data: cats } = await supabase
      .from('prize_categories').select('id, prize_payouts(id)').eq('competition_id', id);
    const catRows = (cats ?? []) as unknown as Array<{ id: string; prize_payouts: { id: string }[] | null }>;
    if (catRows.length === 0) {
      issues.push('Prize Categories — not configured');
    } else {
      const empty = catRows.filter(c => !c.prize_payouts || c.prize_payouts.length === 0).length;
      if (empty > 0) issues.push(`${empty} Prize Categor${empty === 1 ? 'y' : 'ies'} — no prize amounts set`);
    }
    if (includeInKronos) {
      const { data: comp } = await supabase.from('competitions').select('kronos_overall_prize').eq('id', id).single();
      const prize = (comp as { kronos_overall_prize: number | null } | null)?.kronos_overall_prize;
      if (prize == null || Number(prize) <= 0) {
        issues.push(`${rules.individualBoardLabel} Trophy — no prize amount set`);
      }
    }

    return issues;
  }

  async function goLive() {
    if (!compId || !compPin) return;
    setSaving(true); setError(''); setGoLiveIssues(null);

    await saveInfoPack(compId);
    const issues = await computeGoLiveIssues(compId);
    if (issues.length > 0) { setGoLiveIssues(issues); setSaving(false); return; }

    const { error: statusErr } = await supabase.from('competitions').update({ status: 'active' }).eq('id', compId);
    if (statusErr) { setError(statusErr.message); setSaving(false); return; }

    // Automatic Handicap Cuts — the starting handicap is captured the instant
    // the tournament goes live and then permanently locked; only Titan's own
    // engine may reduce current_tournament_handicap from here on.
    if (handicapCutsEnabled) {
      await Promise.all(compPlayers.map(cp =>
        supabase.from('competition_players').update({
          starting_tournament_handicap: cp.handicap_index,
          current_tournament_handicap:  cp.handicap_index,
        }).eq('id', cp.id)
      ));
      await supabase.from('competitions')
        .update({ handicap_cuts_config_locked_at: new Date().toISOString() }).eq('id', compId);
    }

    // WHS round snapshot — frozen at go-live, per player per WHS round,
    // against that round's single organiser-set tee. Byte-identical to what
    // the mobile builder writes, so a web-created tournament scores the same.
    if (days.some(d => d.whsEnabled)) {
      const { data: savedDays } = await supabase
        .from('competition_days').select('id, day_number').eq('competition_id', compId).order('day_number');
      const dayIds = ((savedDays ?? []) as Array<{ id: string }>).map(d => d.id);
      const teesByCourse = await fetchTeesForRounds(days.filter(d => d.whsEnabled));
      const snapshotRows: Record<string, unknown>[] = [];
      days.forEach((d, i) => {
        if (!d.whsEnabled) return;
        const dayId = dayIds[i];
        if (!dayId) return;
        const tee = resolveTeeForRound(teesByCourse[d.courseName] ?? [], d);
        if (!tee || tee.par == null || tee.course_rating == null || tee.slope_rating == null) return;
        enrolled.forEach(cp => {
          if (cp.handicap_index == null) return;
          const whs = calculateWHSPlayingHandicap(cp.handicap_index, tee.slope_rating!, tee.course_rating!, tee.par!, d.hcpPct);
          snapshotRows.push({
            day_id: dayId,
            player_id: cp.player_id,
            tee_name: tee.tee_name,
            gender: tee.gender,
            handicap_index_at_start: cp.handicap_index,
            slope_at_start: tee.slope_rating,
            course_rating_at_start: tee.course_rating,
            par_at_start: tee.par,
            course_handicap_at_start: whs.courseHandicapUnrounded,
            allowance_at_start: d.hcpPct,
            playing_handicap_at_start: whs.playingHandicap,
            whs_enabled_at_start: true,
          });
        });
      });
      if (snapshotRows.length > 0) {
        await supabase.from('round_player_tees').upsert(snapshotRows, { onConflict: 'day_id,player_id' });
      }
    }

    // Enrolment DMs, same as the mobile builder. The admin's own row is
    // skipped because direct_messages rejects sender == recipient and would
    // abort the whole batch.
    if (playerId) {
      const pinFormatted = `${compPin.slice(0, 3)} ${compPin.slice(3)}`;
      const rows = enrolled
        .filter(cp => cp.player_id !== playerId)
        .map(cp => cp.status === 'invited'
          ? {
              sender_id: playerId, recipient_id: cp.player_id,
              content: `You've been invited to join ${name.trim()}. Code: ${pinFormatted}`,
              message_type: 'tournament_invite', competition_id: compId,
            }
          : {
              sender_id: playerId, recipient_id: cp.player_id,
              content: `You've been enrolled in ${name.trim()}! Join with code ${pinFormatted} in the Tour tab.`,
            });
      if (rows.length) await supabase.from('direct_messages').insert(rows);
    }

    setSaving(false);
    setWentLive({ name: name.trim(), pin: compPin });
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  const canNext = [
    selectedFormat !== null,
    name.trim().length >= 2,
    true, true, true, true,
  ][step] ?? true;

  async function next() {
    setError('');
    if (step === 2) {
      const ok = await saveShell();
      if (!ok) return;
      setStep(3);
      return;
    }
    if (step === 5 && compId) await saveInfoPack(compId);
    setStep(s => Math.min(STEPS.length - 1, s + 1));
  }

  // ── Gate / success screens ────────────────────────────────────────────────
  if (gateMsg) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg py-16 text-center">
          <h1 className="text-[28px] font-black text-white">{gateMsg}</h1>
          <Link href="/dashboard" className="mt-6 inline-block text-[12px] font-black uppercase tracking-widest text-[#D4AF37]">
            ← Back to Dashboard
          </Link>
        </div>
      </Shell>
    );
  }

  if (wentLive) {
    return (
      <Shell>
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="w-full max-w-lg text-center">
            <div className="mb-6 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#4ade80] bg-[#1a1a1a] text-[#4ade80] shadow-[0_0_0_5px_rgba(74,222,128,0.10),0_0_38px_-6px_rgba(74,222,128,0.55)]">
                <Trophy size={36} />
              </div>
            </div>
            <StatusPill tone="green">Live</StatusPill>
            <h1 className="mt-3 text-[40px] font-black leading-[0.95] tracking-tight text-white">{wentLive.name}</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm text-neutral-400">
              The tournament is active. Share this PIN with your players — they enter it in the Titan Golf app to unlock
              the Tour tab.
            </p>

            <div className="my-8 rounded-2xl border border-[#D4AF37]/30 bg-[#D4AF37]/8 p-8">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Tournament PIN</div>
              <div className="mt-3 font-mono text-[64px] font-bold leading-none tabular-nums tracking-[10px] text-[var(--gold-bright)]">
                {wentLive.pin}
              </div>
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(wentLive.pin); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="mx-auto mt-6 flex items-center gap-2 rounded-full border border-[#D4AF37]/40 px-5 py-2.5 text-[12.5px] font-black tracking-wide text-[#D4AF37] transition-colors hover:bg-[#D4AF37]/10"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copied!' : 'Copy PIN'}
              </button>
            </div>

            <div className="flex justify-center gap-3">
              <Link
                href="/admin/tee-sheet"
                className="rounded-full border border-[#1c1c1c] bg-[#111111] px-6 py-2.5 text-[12.5px] font-black tracking-wide text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
              >
                Tee Sheet
              </Link>
              <Link
                href="/tournament/archive"
                className="rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] px-6 py-2.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110"
              >
                View Archive →
              </Link>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Wizard ────────────────────────────────────────────────────────────────
  return (
    <Shell>
      <div className="mb-8">
        <Link
          href="/tournament/archive"
          className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 transition-colors hover:text-[var(--gold-bright)]"
        >
          ← Back to Archive
        </Link>

        <div className="mt-5 overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
          <div className="p-6">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">
                {editCompId ? 'Amend Tournament' : 'New Competition'}
              </span>
              {compId && <StatusPill tone="gold">Draft Saved</StatusPill>}
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-4">
              <h1 className="text-[40px] font-black leading-[0.95] tracking-tight text-white">{STEPS[step]}</h1>
              <span className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-widest tabular-nums text-neutral-600">
                Step {step + 1} / {STEPS.length}
              </span>
            </div>
          </div>

          <div className="border-t border-[#1c1c1c] bg-[#0a0a0a] px-6 py-4">
            <div className="flex items-center">
              {STEPS.map((label, i) => {
                const done = i < step, active = i === step;
                return (
                  <div key={label} className="flex flex-1 items-center last:flex-none">
                    <button
                      type="button"
                      // Steps already reached stay reachable — the draft is
                      // saved from step 3 onwards, so jumping back to fix one
                      // field never costs the organiser the whole wizard.
                      onClick={() => { if (i <= step) setStep(i); }}
                      className="flex items-center gap-2.5"
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold tabular-nums transition-colors ${
                          active
                            ? 'border-[#D4AF37] bg-[#D4AF37]/12 text-[var(--gold-bright)] shadow-[0_0_18px_-4px_rgba(212,175,55,0.75)]'
                            : done
                              ? 'border-[#D4AF37]/40 bg-[#D4AF37]/8 text-[#D4AF37]'
                              : 'border-[#1c1c1c] bg-[#111111] text-neutral-600'
                        }`}
                      >
                        {done ? <Check size={13} /> : i + 1}
                      </span>
                      <span
                        className={`hidden text-[10px] font-black uppercase tracking-[0.13em] lg:block ${
                          active ? 'text-[var(--gold-bright)]' : done ? 'text-neutral-400' : 'text-neutral-600'
                        }`}
                      >
                        {label}
                      </span>
                    </button>
                    {i < STEPS.length - 1 && <span className={`mx-3 h-px flex-1 ${i < step ? 'bg-[#D4AF37]/40' : 'bg-[#1c1c1c]'}`} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Step 0: Format ── */}
      {step === 0 && (
        <div className="space-y-3">
          <p className="mb-4 text-sm text-neutral-400">Pick the competition type. Each format carries its own rules, minimums and leaderboard behaviour.</p>
          {FORMAT_IDS.map(id => {
            const f = FORMAT_RULES[id];
            const on = selectedFormat === id;
            return (
              <div
                key={id}
                className={`overflow-hidden rounded-2xl border transition-colors ${
                  on ? 'border-[#D4AF37]/50 bg-[#D4AF37]/8' : 'border-[#1c1c1c] bg-[#111111]'
                } ${f.available ? '' : 'opacity-45'}`}
              >
                <button
                  type="button"
                  onClick={() => pickFormat(id)}
                  disabled={!f.available}
                  className="w-full px-6 py-5 text-left disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex-1 font-black ${on ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{f.label}</div>
                    {!f.available && <StatusPill tone="neutral">Coming Soon</StatusPill>}
                    {f.isTeamFormat && f.available && <StatusPill tone="neutral">Team</StatusPill>}
                    <CheckDot on={on} />
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">{f.sub}</p>
                </button>

                {f.howItWorks && (
                  <>
                    <button
                      type="button"
                      onClick={() => setHowItWorksFor(howItWorksFor === id ? null : id)}
                      className="flex w-full items-center gap-2 border-t border-[#1c1c1c] px-6 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-[#D4AF37] transition-colors hover:bg-[#D4AF37]/5"
                    >
                      How It Works
                      <ChevronDown size={14} className={`transition-transform ${howItWorksFor === id ? 'rotate-180' : ''}`} />
                    </button>
                    {howItWorksFor === id && (
                      <ol className="space-y-2.5 border-t border-[#1c1c1c] bg-[#0a0a0a] px-6 py-5">
                        {f.howItWorks.map((line, i) => (
                          <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-neutral-400">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#D4AF37]/40 font-mono text-[10px] font-bold tabular-nums text-[#D4AF37]">
                              {i + 1}
                            </span>
                            {line}
                          </li>
                        ))}
                      </ol>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Step 1: Details ── */}
      {step === 1 && (
        <div className="space-y-5">
          <p className="text-sm text-neutral-400">Name it, set the dates, and configure the format-specific rules.</p>

          <Card>
            <div className="space-y-4">
              <TextField label="Competition Name" value={name} onChange={setName} placeholder="e.g. Titan Tour 2027" />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Year" type="number" mono min="2020" max="2040" value={year} onChange={setYear} />
                <TextField label="Logo URL (optional)" value={logoUrl} onChange={setLogoUrl} placeholder="https://…" />
              </div>
              <TextArea label="Description" value={description} onChange={setDescription} placeholder="A short blurb shown on the tournament card." rows={3} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Start Date" type="date" mono value={startDate} onChange={setStartDate} />
                <TextField label="End Date"   type="date" mono value={endDate}   onChange={setEndDate} />
              </div>
            </div>
          </Card>

          <Card>
            <Stepper
              label="Number of Rounds"
              value={days.length}
              unit={days.length === 1 ? 'round' : 'rounds'}
              onDec={removeDay}
              onInc={addDay}
              decDisabled={days.length <= 1}
              incDisabled={days.length >= 10}
            />
          </Card>

          {isTeamFmt && (
            <>
              <SectionHeading label="Team Setup" hint={rules.label} />
              <Card>
                <div className="space-y-5">
                  <Stepper
                    label="Number of Teams"
                    value={numTeamsN}
                    unit={numTeamsN === 1 ? 'team' : 'teams'}
                    onDec={() => setNumTeams(String(Math.max(rules.minTeams ?? 2, numTeamsN - (rules.requiresEvenTeams || rules.requiresOddTeams ? 2 : 1))))}
                    onInc={() => setNumTeams(String(Math.min(rules.maxTeams ?? 24, numTeamsN + (rules.requiresEvenTeams || rules.requiresOddTeams ? 2 : 1))))}
                  />
                  {(rules.minTeams != null || rules.exactPlayersPerTeam != null) && (
                    <p className="text-[11.5px] leading-relaxed text-neutral-600">
                      {rules.label} requires {rules.minTeams}–{rules.maxTeams} teams
                      {rules.requiresEvenTeams ? ' (even numbers only)' : rules.requiresOddTeams ? ' (odd numbers only)' : ''}
                      {rules.exactPlayersPerTeam != null ? `, exactly ${rules.exactPlayersPerTeam} players per team` : ''}.
                    </p>
                  )}
                  <div className="grid gap-4 sm:grid-cols-3">
                    <TextField label="Max Handicap" type="number" step="0.1" mono value={maxHandicap} onChange={setMaxHandicap} placeholder="blank = no cap" />
                    <TextField label="Points — Win"  type="number" step="0.5" mono value={ptsWin}  onChange={setPtsWin} />
                    <TextField label="Points — Half" type="number" step="0.5" mono value={ptsHalf} onChange={setPtsHalf} />
                  </div>
                  {rules.captainRotation && (
                    <TextField
                      label="Opening Rounds (Captain Rotation)"
                      type="number" mono value={openingRounds} onChange={setOpeningRounds}
                    />
                  )}
                  <Toggle
                    label="Sweep Bonus"
                    hint="Extra team points for winning every match in a round."
                    value={sweepBonusEnabled}
                    onChange={setSweepBonusEnabled}
                  />
                  {sweepBonusEnabled && (
                    <TextField label="Sweep Bonus Points" type="number" step="0.5" mono value={bonusPoints} onChange={setBonusPoints} />
                  )}
                </div>
              </Card>
            </>
          )}

          <SectionHeading label="Scoring & Extras" />
          <div className="space-y-3">
            <Toggle
              label={`Include in ${rules.individualBoardLabel} Trophy`}
              hint="Individual Stableford scores count toward the overall individual championship."
              value={includeInKronos}
              onChange={setIncludeInKronos}
            />
            <Toggle
              label="Automatic Handicap Cuts"
              hint="Titan reduces a player's tournament handicap automatically when they score over the trigger."
              value={handicapCutsEnabled}
              onChange={setHandicapCutsEnabled}
            />
            {handicapCutsEnabled && (
              <Card>
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label="Trigger Score" type="number" mono value={handicapCutTrigger} onChange={setHandicapCutTrigger} />
                    <TextField label="Minimum Handicap" type="number" step="0.1" mono value={handicapCutMinimum} onChange={setHandicapCutMinimum} />
                  </div>
                  <div>
                    <Label>Cut Bands — reduction per point over the trigger</Label>
                    <div className="overflow-hidden rounded-xl border border-[#1c1c1c]">
                      <div className="grid grid-cols-3 gap-3 bg-[#0a0a0a] px-4 py-2.5">
                        {['From', 'To', 'Cut / Point'].map(h => (
                          <span key={h} className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{h}</span>
                        ))}
                      </div>
                      {handicapCutBands.map((b, i) => (
                        <div key={i} className="grid grid-cols-3 items-center gap-3 border-t border-[#1c1c1c] bg-[#000000] px-4 py-2.5">
                          <BandInput value={b.min} onChange={v => setHandicapCutBands(prev => prev.map((x, ix) => ix === i ? { ...x, min: v ?? 0 } : x))} />
                          <BandInput value={b.max} onChange={v => setHandicapCutBands(prev => prev.map((x, ix) => ix === i ? { ...x, max: v } : x))} placeholder="∞" />
                          <BandInput value={b.cutPerPoint} onChange={v => setHandicapCutBands(prev => prev.map((x, ix) => ix === i ? { ...x, cutPerPoint: v ?? 0 } : x))} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            )}
            <Toggle
              label="Chip &amp; Birdie Commentary"
              hint="Titan's AI voices call the round in the mobile app."
              value={voiceEnabled}
              onChange={setVoiceEnabled}
            />
            <Toggle
              label="Track Shot Stats"
              hint="Players record fairways, greens and putts alongside their score."
              value={statsEnabled}
              onChange={setStatsEnabled}
            />
          </div>
        </div>
      )}

      {/* ── Step 2: Days ── */}
      {step === 2 && (
        <div className="space-y-4">
          <DaysStep
            days={days}
            isTeamFormat={isTeamFmt}
            courses={courses}
            courseTees={courseTees}
            courseHoles={courseHoles}
            onChangeDay={updateDay}
            onPickCourse={pickCourse}
          />
          <div className="flex gap-3">
            <button
              type="button" onClick={removeDay} disabled={days.length <= 1}
              className="flex items-center gap-2 rounded-full border border-[#1c1c1c] bg-[#111111] px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white disabled:opacity-30"
            >
              <Minus size={13} /> Remove Round
            </button>
            <button
              type="button" onClick={addDay} disabled={days.length >= 10}
              className="flex items-center gap-2 rounded-full border border-[#1c1c1c] bg-[#111111] px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-neutral-400 transition-colors hover:border-[#D4AF37]/40 hover:text-[#D4AF37] disabled:opacity-30"
            >
              <Plus size={13} /> Add Round
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Draft ── */}
      {step === 3 && compId && societyId && (
        <DraftStep
          compId={compId}
          societyId={societyId}
          isTeamFormat={isTeamFmt}
          exactPlayersPerTeam={rules.exactPlayersPerTeam}
          maxHandicap={maxHcpN}
          players={compPlayers}
          onReload={loadDraft}
        />
      )}

      {/* ── Step 4: Prizes ── */}
      {step === 4 && compId && (
        <PrizesStep compId={compId} boardLabel={rules.individualBoardLabel} includeIndividualBoard={includeInKronos} />
      )}

      {/* ── Step 5: Info Pack ── */}
      {step === 5 && (
        <div className="space-y-5">
          <p className="text-sm text-neutral-400">
            The essentials players need before they travel. These four notes are stored on the tournament and shown in the
            app&apos;s Info Pack alongside anything added there.
          </p>
          <Card>
            <div className="space-y-4">
              <TextArea label="Schedule" value={infoPack.schedule} onChange={v => setInfoPack(p => ({ ...p, schedule: v }))} placeholder="Day-by-day running order, meal times, prize giving…" />
              <TextArea label="Travel"   value={infoPack.travel}   onChange={v => setInfoPack(p => ({ ...p, travel: v }))}   placeholder="Flights, transfers, hotel address, parking…" />
              <TextArea label="Rules"    value={infoPack.rules}    onChange={v => setInfoPack(p => ({ ...p, rules: v }))}    placeholder="Local rules, dress code, pace of play, disputes…" />
              <TextArea label="Contacts" value={infoPack.contacts} onChange={v => setInfoPack(p => ({ ...p, contacts: v }))} placeholder="Organiser, pro shop, hotel, emergency numbers…" rows={3} />
            </div>
          </Card>
        </div>
      )}

      {/* ── Step 6: Review ── */}
      {step === 6 && (
        <div className="space-y-5">
          <p className="text-sm text-neutral-400">
            Check it over, then go live. Titan validates the setup first — anything missing is listed rather than silently
            accepted.
          </p>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-4">
            {[
              { key: 'Format',  val: rules.label,                                            gold: true },
              { key: 'Name',    val: name.trim() || '—',                                     gold: false },
              { key: 'Year',    val: year,                                                   gold: false },
              { key: 'Rounds',  val: String(days.length),                                    gold: false },
              { key: 'Players', val: String(enrolled.length),                                gold: enrolled.length > 0 },
              { key: 'Teams',   val: isTeamFmt ? String(numTeamsN) : '—',                    gold: false },
              { key: rules.individualBoardLabel, val: includeInKronos ? 'Included' : 'Off',  gold: includeInKronos },
              { key: 'Hcp Cuts', val: handicapCutsEnabled ? 'On' : 'Off',                    gold: handicapCutsEnabled },
            ].map(row => (
              <div key={row.key} className="bg-[#111111] px-4 py-3.5">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{row.key}</div>
                <div className={`mt-1.5 truncate text-[15px] font-bold leading-tight tabular-nums ${row.gold ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                  {row.val}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
            <div className="grid grid-cols-[4.5rem_1fr_6rem_4rem] gap-3 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
              {['Round', 'Course & Format', 'Tee', 'Hcp'].map(h => (
                <div key={h} className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{h}</div>
              ))}
            </div>
            {days.map((d, i) => {
              const fmt = DAY_FORMATS.find(f => f.id === d.format);
              return (
                <div
                  key={i}
                  className={`grid grid-cols-[4.5rem_1fr_6rem_4rem] items-center gap-3 border-b border-[#1c1c1c] px-5 py-4 last:border-0 ${i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'}`}
                >
                  <span className="text-[10px] font-black uppercase tracking-[0.13em] text-[#D4AF37]">R{i + 1}</span>
                  <span className="min-w-0 truncate text-sm text-neutral-300">
                    <span className="font-semibold text-white">{d.courseName || 'TBC'}</span>
                    <span className="text-neutral-600"> · </span>{fmt?.label}
                  </span>
                  <span className="truncate text-[12px] font-semibold text-neutral-400">
                    {d.teeName || '—'}{d.whsEnabled ? ' · WHS' : ''}
                  </span>
                  <span className="font-mono text-sm font-bold tabular-nums text-[var(--gold-bright)]">{d.hcpPct}%</span>
                </div>
              );
            })}
          </div>

          {goLiveIssues && goLiveIssues.length > 0 && (
            <div className="rounded-2xl border border-[#f87171]/30 bg-[#f87171]/8 p-5">
              <div className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-[#f87171]">
                {goLiveIssues.length} thing{goLiveIssues.length === 1 ? '' : 's'} to fix before going live
              </div>
              <ul className="space-y-1.5">
                {goLiveIssues.map((iss, i) => (
                  <li key={i} className="text-[13px] leading-relaxed text-[#f87171]/90">• {iss}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <div className="mt-5"><ErrorBanner>{error}</ErrorBanner></div>}

      {/* ── Footer nav ── */}
      <div className="mt-8 flex gap-3">
        {step === 0 ? (
          <Link
            href="/tournament/archive"
            className="flex items-center rounded-full border border-[#1c1c1c] bg-[#111111] px-6 py-3.5 text-[12.5px] font-black tracking-wide text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white"
          >
            Cancel
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setStep(s => s - 1)}
            className="rounded-full border border-[#1c1c1c] bg-[#111111] px-6 py-3.5 text-[12.5px] font-black tracking-wide text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white"
          >
            ← Back
          </button>
        )}

        {compId && step > 2 && step < 6 && (
          <Link
            href="/tournament/archive"
            className="flex items-center rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/8 px-6 py-3.5 text-[12.5px] font-black tracking-wide text-[#D4AF37] transition-colors hover:bg-[#D4AF37]/15"
          >
            Save Draft &amp; Exit
          </Link>
        )}

        {step < 6 ? (
          <button
            type="button"
            onClick={next}
            disabled={!canNext || saving}
            className="flex-1 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] py-3.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
          >
            {saving ? 'Saving…' : step === 2 ? 'Save & Continue →' : 'Next →'}
          </button>
        ) : (
          <button
            type="button"
            onClick={goLive}
            disabled={saving}
            className="flex-1 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] py-3.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'Checking…' : 'Finish & Go Live'}
          </button>
        )}
      </div>
    </Shell>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────
// Ambient gold wash behind the header, same top-of-page treatment as the Locker Room.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />
      <div className="relative mx-auto max-w-3xl px-6 py-12">{children}</div>
    </div>
  );
}

function BandInput({
  value, onChange, placeholder,
}: { value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  return (
    <input
      type="number"
      step="0.1"
      value={value != null ? String(value) : ''}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value.trim() === '' ? null : parseFloat(e.target.value))}
      className="w-full rounded-lg border border-[#1c1c1c] bg-[#0a0a0a] px-3 py-1.5 font-mono text-[13px] tabular-nums text-white placeholder-neutral-700 outline-none transition-colors focus:border-[#D4AF37]/50"
    />
  );
}
