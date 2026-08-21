import { createServiceClient } from '@/lib/supabase/service';
import PrintButton from './PrintButton';
import './newsreel.css';

// The Titan Newsreel — a public, no-login page assembled from a tournament's
// published Titan News AI stories plus the raw facts Titan already computed
// for them. Standings tables below are read straight from each story's
// input_snapshot (titan_news.input_snapshot — "exact facts package sent to
// Claude, audit trail" per that table's own schema comment), NOT
// re-derived here — this guarantees the numbers on this page always match
// what the AI actually wrote about, and avoids duplicating the app's
// scoring rules (getStandings/calcSweepBonus) in a second package that
// could drift out of sync with the real ones in src/lib/scoring.ts.

type Competition = {
  id: string; name: string; year: number | null; format: string;
  start_date: string | null; end_date: string | null;
  description: string | null; logo_url: string | null; society_id: string;
};
type PrizeCategory = {
  id: string; name: string; hcp_min: number | null; hcp_max: number | null; display_order: number;
  prize_payouts: { position: number; prize_money: number }[];
};
type CompDay = {
  id: string; day_number: number; course_name: string | null; play_date: string | null;
  ntp_hole: number | null; ld_hole: number | null; ntp_winner_id: string | null; ld_winner_id: string | null;
};
type NewsRow = {
  id: string; story_type: string; day_id: string | null;
  headline: string | null; summary: string | null; body: string | null; input_snapshot: any;
  banter_speaker: 'chip' | 'birdie' | null; banter_text: string | null; banter_scene: string | null;
};

// Fixed portraits — Chip & Birdie are the same two hosts as the RN app's
// src/lib/titanBanter.ts, copied into web/public/hosts since a Next.js
// page can't reach into the Expo app's assets/ directory. Scene images are
// Dave's own fixed set (2026-08-21), copied into web/public/hosts/scenes —
// keep this key list in sync with titanBanter.ts and the edge function's
// BANTER_SCENES.
// Headshot crops, not the full-body renders — object-fit: cover on a tall
// full-body image centers on the vertical middle by default, which crops
// to the waist/legs, not the face (Dave, 2026-08-21 — "I only [see] chips
// legs in this little circle image").
const BANTER_PORTRAITS: Record<string, string> = { chip: '/hosts/chip_headshot.png', birdie: '/hosts/birdie_headshot.png' };
const BANTER_SCENES: Record<string, string> = {
  'golf-cart':      '/hosts/scenes/golf-cart.png',
  'hiding-tree':    '/hosts/scenes/hiding-tree.png',
  'bunker':         '/hosts/scenes/bunker.png',
  'celebration':    '/hosts/scenes/celebration.png',
  'sunset-view':    '/hosts/scenes/sunset-view.png',
  'broadcast-desk': '/hosts/scenes/broadcast-desk.png',
  'hiding-bushes':  '/hosts/scenes/hiding-bushes.png',
  'giant-bunker':   '/hosts/scenes/giant-bunker.png',
};

function Banter({ speaker, text, scene }: { speaker: 'chip' | 'birdie' | null; text: string | null; scene: string | null }) {
  if (!speaker || !text) return null;
  const sceneUrl = scene ? BANTER_SCENES[scene] : null;
  return (
    <div className="banter">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={BANTER_PORTRAITS[speaker]} alt="" className="banterPortrait" />
      <div className="banterBubble">
        <div className="banterName">{speaker}</div>
        <div className="banterText">{text}</div>
      </div>
      {sceneUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sceneUrl} alt="" className="banterScene" />
      )}
    </div>
  );
}
type Team = { id: string; name: string; accent_color: string | null; logo_url: string | null };

// Bundled fallback for Titan Tour's known teams — same lookup-by-name map
// as the RN app's src/lib/assets.ts teamLogos, copied into
// web/public/teams since a Next.js page can't reach into the Expo app's
// assets/ directory. teams.logo_url (admin-uploaded, see
// admin/transfers.tsx) always wins when set — this is only the fallback
// for teams that have never had a logo uploaded.
const TEAM_LOGOS: Record<string, string> = {
  'MOB':         '/teams/TheMob.png',
  'Destroyers':  '/teams/Destroyers.png',
  'Legion Six':  '/teams/LegionSix.png',
  'Renegades':   '/teams/Renegades.png',
  'Elite':       '/teams/Rlite.png',
  'Instigators': '/teams/TheInstigators.png',
};
function teamLogoSrc(team: Team | undefined | null): string | null {
  if (!team) return null;
  return team.logo_url || TEAM_LOGOS[team.name] || null;
}
// Postgrest infers embedded relations as arrays from the select string
// unless a to-one FK hint is given — read as players[0], not players.
type CompPlayer = { player_id: string; team_id: string | null; handicap_index: number | null; players: { display_name: string }[] | null };
type MatchHole = { player_id: string; stableford_pts: number | null; match_id: string; gross_score: number | null; hole_number: number };
type MatchRow = { id: string; day_id: string };
type LeaderRow = { playerId?: string; teamId?: string; name?: string; teamName?: string; pts: number; currentPosition?: number; positionChange?: number | null };

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function posArrow(delta: number | null | undefined) {
  if (!delta) return '—';
  return delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`;
}

export default async function NewsreelPage({ params }: { params: Promise<{ competitionId: string }> }) {
  const { competitionId } = await params;
  const supabase = createServiceClient();

  const { data: comp } = await supabase
    .from('competitions')
    .select('id, name, year, format, start_date, end_date, description, logo_url, society_id')
    .eq('id', competitionId).single();

  if (!comp) {
    return <div className="newsreel"><div className="app"><div style={{ color: '#fff', padding: 40 }}>Newsreel not found.</div></div></div>;
  }
  const competition = comp as Competition;

  const [{ data: daysData }, { data: newsData }, { data: teamsData }, { data: playersData }, { data: matchesData }, { data: prizeCatData }] = await Promise.all([
    supabase.from('competition_days').select('id, day_number, course_name, play_date, ntp_hole, ld_hole, ntp_winner_id, ld_winner_id').eq('competition_id', competitionId).order('day_number'),
    supabase.from('titan_news').select('id, story_type, day_id, headline, summary, body, input_snapshot, banter_speaker, banter_text, banter_scene').eq('competition_id', competitionId).eq('status', 'published').order('created_at'),
    supabase.from('teams').select('id, name, accent_color, logo_url').eq('society_id', competition.society_id),
    supabase.from('competition_players').select('player_id, team_id, handicap_index, players(display_name)').eq('competition_id', competitionId),
    supabase.from('matches').select('id, day_id').eq('competition_id', competitionId),
    // Divisions + per-position payouts — the ONE place prize money is
    // configured now (admin/prizes.tsx's "Configure Prizes" step), not the
    // old flat competitions.prize_pool/prize_split fields removed from the
    // Build wizard (Dave, 2026-08-21 — "we have duplicates on the money
    // side of things... we only need to configure the betting in the big
    // yellow button at the end").
    supabase.from('prize_categories').select('id, name, hcp_min, hcp_max, display_order, prize_payouts(position, prize_money)').eq('competition_id', competitionId).order('display_order'),
  ]);

  const days = (daysData ?? []) as CompDay[];
  const news = (newsData ?? []) as NewsRow[];
  const teams = (teamsData ?? []) as Team[];
  const players = (playersData ?? []) as CompPlayer[];
  const matches = (matchesData ?? []) as MatchRow[];
  const { data: holesData } = matches.length
    ? await supabase.from('match_holes').select('player_id, stableford_pts, match_id, gross_score, hole_number').in('match_id', matches.map(m => m.id))
    : { data: [] as MatchHole[] };
  const holes = (holesData ?? []) as MatchHole[];

  const playerName = (id: string) => players.find(p => p.player_id === id)?.players?.[0]?.display_name ?? '—';
  const teamNameCell = (id: string | undefined, fallbackName?: string) => {
    const team = id ? teams.find(t => t.id === id) : undefined;
    const logo = teamLogoSrc(team);
    return (
      <span className="tableTeamCell">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo && <img src={logo} alt="" className="tableTeamLogo" />}
        {fallbackName ?? team?.name ?? '—'}
      </span>
    );
  };
  const teamsByPlayer: Record<string, string | null> = {};
  players.forEach(p => { teamsByPlayer[p.player_id] = p.team_id; });
  const rosterByTeam: Record<string, string[]> = {};
  players.forEach(p => { if (p.team_id) (rosterByTeam[p.team_id] ??= []).push(playerName(p.player_id)); });

  const dayReports = days
    .map(d => ({ day: d, article: news.find(n => n.story_type === 'round_report' && n.day_id === d.id) }))
    .filter(x => x.article);
  const finalReport = news.find(n => n.story_type === 'final_report') ?? null;

  // Best Round: highest single-day individual Stableford total — same
  // number the mockup's "Round of the Day" card shows, no course/par
  // lookup needed since it's points, not gross-vs-par.
  const dayIdByMatchId: Record<string, string> = {};
  matches.forEach(m => { dayIdByMatchId[m.id] = m.day_id; });
  const dailyTotals: Record<string, number> = {}; // `${playerId}:${dayId}` -> pts
  holes.forEach(h => {
    if (h.stableford_pts == null) return;
    const dayId = dayIdByMatchId[h.match_id];
    if (!dayId) return;
    const key = `${h.player_id}:${dayId}`;
    dailyTotals[key] = (dailyTotals[key] ?? 0) + h.stableford_pts;
  });
  const bestRound = Object.entries(dailyTotals).reduce<{ name: string; pts: number; dayNumber: number } | null>((best, [key, pts]) => {
    if (best && pts <= best.pts) return best;
    const [playerId, dayId] = key.split(':');
    return { name: playerName(playerId), pts, dayNumber: days.find(d => d.id === dayId)?.day_number ?? 0 };
  }, null);

  // Most Birdies — the one award that DOES need gross-vs-par, so it's
  // best-effort: only shown if every course this tournament used has
  // course_holes on file.
  const courseNames = [...new Set(days.map(d => d.course_name).filter(Boolean))] as string[];
  const { data: courseHolesData } = courseNames.length
    ? await supabase.from('course_holes').select('course_name, hole_number, par').in('course_name', courseNames)
    : { data: [] };
  const parLookup: Record<string, number> = {};
  (courseHolesData ?? []).forEach((ch: any) => { parLookup[`${ch.course_name}:${ch.hole_number}`] = ch.par; });
  const matchToCourse: Record<string, string | null> = {};
  matches.forEach(m => { matchToCourse[m.id] = days.find(d => d.id === m.day_id)?.course_name ?? null; });
  let mostBirdies: { name: string; count: number } | null = null;
  if (courseNames.every(c => Object.keys(parLookup).some(k => k.startsWith(`${c}:`)))) {
    const birdieCounts: Record<string, number> = {};
    holes.forEach(h => {
      if (h.gross_score == null) return;
      const course = matchToCourse[h.match_id];
      if (!course) return;
      const par = parLookup[`${course}:${h.hole_number}`];
      if (par == null) return;
      if (h.gross_score <= par - 1) birdieCounts[h.player_id] = (birdieCounts[h.player_id] ?? 0) + 1;
    });
    const top = Object.entries(birdieCounts).sort((a, b) => b[1] - a[1])[0];
    if (top) mostBirdies = { name: playerName(top[0]), count: top[1] };
  }

  const finalSnap = finalReport?.input_snapshot ?? null;
  const finalIndividual: LeaderRow[] = finalSnap?.finalIndividualLeaderboard ?? [];
  const finalTeams: LeaderRow[] = finalSnap?.finalTeamStandings ?? [];

  const dateRange = [fmtDate(competition.start_date), fmtDate(competition.end_date)].filter(Boolean).join(' – ');

  // Division prize money — finalIndividual is already ranked by pts, so
  // filtering it down to a division's handicap band preserves the correct
  // relative order within that division; no re-sort needed. Handicaps come
  // from competition_players since finalIndividual (the AI's own facts
  // package) never carried handicap, only name/pts/position.
  const hcpByPlayer: Record<string, number | null> = {};
  players.forEach(p => { hcpByPlayer[p.player_id] = p.handicap_index; });
  const prizeCategories = ((prizeCatData ?? []) as PrizeCategory[]).map(cat => {
    const inBand = finalIndividual.filter(row => {
      const hcp = row.playerId != null ? hcpByPlayer[row.playerId] : null;
      if (hcp == null) return false;
      if (cat.hcp_min != null && hcp < cat.hcp_min) return false;
      if (cat.hcp_max != null && hcp > cat.hcp_max) return false;
      return true;
    });
    const payoutByPosition = new Map(cat.prize_payouts.map(p => [p.position, p.prize_money]));
    const winners = inBand.map((row, i) => ({ row, position: i + 1, prizeMoney: payoutByPosition.get(i + 1) ?? null }))
      .filter(w => w.prizeMoney != null);
    return { ...cat, winners };
  }).filter(cat => cat.winners.length > 0);

  return (
    <div className="newsreel">
      <div className="app">
        <div className="topbar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="brand"><img src="/titan-logo.png" alt="Titan" className="brandLogo" /><span>TITAN <em>NEWSREEL</em></span></div>
          <div className="swipehint">SWIPE ← NEXT PAGE →</div>
          <PrintButton />
        </div>
        <div className="stage">
          <div className="book">

            {/* Cover */}
            <section className="page cover">
              <div className="page-header"><div className="title">TITAN NEWSREEL • OFFICIAL TOURNAMENT REPORT</div><div className="day">{competition.year ?? ''}</div></div>
              <div className="content">
                <div className="grid2">
                  <div className="hero">
                    {competition.logo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={competition.logo_url} alt="" className="tournamentLogo" />
                    )}
                    {dateRange && <span className="kicker">{dateRange}</span>}
                    <h1>{competition.name}</h1>
                    <p>{finalReport?.summary ?? `The complete story of the ${competition.name}, built from live tournament results.`}</p>
                    {competition.description && <p className="tournamentDescription">{competition.description}</p>}
                  </div>
                  <div>
                    {teams.length > 0 && rosterByTeam && Object.keys(rosterByTeam).length > 0 && (
                      <div className="teams">
                        {teams.filter(t => rosterByTeam[t.id]?.length).map(t => {
                          const logo = teamLogoSrc(t);
                          return (
                            <div key={t.id} className="teamcard" style={{ color: t.accent_color ?? '#fff' }}>
                              {logo ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={logo} alt="" className="teamLogo" />
                              ) : (
                                <div className="crest">{t.name.slice(0, 2).toUpperCase()}</div>
                              )}
                              <b style={{ color: '#fff' }}>{t.name.toUpperCase()}</b>
                              {(rosterByTeam[t.id] ?? []).join(' • ')}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="footer"><span>PAGE 1 • COVER</span><span>#PLAYTITAN</span></div>
            </section>

            {/* One page per published day report */}
            {dayReports.map(({ day, article }, i) => {
              const snap = article!.input_snapshot ?? {};
              const individual: LeaderRow[] = snap.individualLeaderboard ?? [];
              const teamStandings: LeaderRow[] = snap.teamStandings ?? [];
              return (
                <section className="page" key={day.id}>
                  <div className="page-header"><div className="title">TITAN NEWSREEL</div><div className="day">DAY {day.day_number}{day.course_name ? ` • ${day.course_name}` : ''}</div></div>
                  <div className="content">
                    <h2 className="headline">{article!.headline}</h2>
                    <p className="dek">{article!.summary}</p>
                    <div className="grid2">
                      <div>
                        {(article!.body ?? '').split('\n').filter(Boolean).map((para, pi) => (
                          <p className="story" key={pi}>{para}</p>
                        ))}
                        <Banter speaker={article!.banter_speaker} text={article!.banter_text} scene={article!.banter_scene} />
                      </div>
                      <div>
                        {teamStandings.length > 0 && (
                          <div className="panel">
                            <h3>Team standings</h3>
                            <table className="leader">
                              <thead><tr><th>Pos</th><th>Team</th><th>Pts</th><th>Δ</th></tr></thead>
                              <tbody>
                                {teamStandings.map((row, ri) => (
                                  <tr key={row.teamId ?? ri}><td>{row.currentPosition ?? ri + 1}</td><td>{teamNameCell(row.teamId, row.teamName)}</td><td>{row.pts}</td><td>{posArrow(row.positionChange)}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {individual.length > 0 && (
                          <div className="panel" style={{ marginTop: 9 }}>
                            <h3>Top individual</h3>
                            <table>
                              <thead><tr><th>Player</th><th>Pts</th></tr></thead>
                              <tbody>
                                {individual.slice(0, 5).map((row, ri) => (
                                  <tr key={row.playerId ?? ri}><td>{row.name ?? playerName(row.playerId!)}</td><td>{row.pts}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="footer"><span>PAGE {i + 2} • DAY {day.day_number}</span><span>{competition.name}</span></div>
                </section>
              );
            })}

            {/* Champion / final report */}
            {finalReport && (
              <section className="page champion">
                <div className="page-header"><div className="title">TITAN NEWSREEL</div><div className="day">FINAL REPORT</div></div>
                <div className="content">
                  <div className="trophy">🏆</div>
                  <h2 className="headline">{finalReport.headline}</h2>
                  <p className="dek">{finalReport.summary}</p>
                  <div className="grid2">
                    <div>
                      {(finalReport.body ?? '').split('\n').filter(Boolean).map((para, pi) => (
                        <p className="story" key={pi}>{para}</p>
                      ))}
                      <Banter speaker={finalReport.banter_speaker} text={finalReport.banter_text} scene={finalReport.banter_scene} />
                    </div>
                    <div>
                      {finalTeams.length > 0 && (
                        <div className="panel">
                          <h3>Final team standings</h3>
                          <table className="leader">
                            <thead><tr><th>Pos</th><th>Team</th><th>Pts</th></tr></thead>
                            <tbody>
                              {finalTeams.map((row, ri) => (
                                <tr key={row.teamId ?? ri}><td>{row.currentPosition ?? ri + 1}</td><td>{teamNameCell(row.teamId, row.teamName)}</td><td>{row.pts}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="footer"><span>FINAL REPORT</span><span>{competition.name.toUpperCase()} CHAMPIONS</span></div>
              </section>
            )}

            {/* Results book — money, NTP/LD, full standings, awards */}
            <section className="page">
              <div className="page-header"><div className="title">TITAN NEWSREEL</div><div className="day">RESULTS BOOK</div></div>
              <div className="content">
                <h2 className="headline">WHO WON WHAT</h2>
                <p className="dek">The closing ledger — every team, every award, and the tournament's key records.</p>
                <div className="grid2">
                  <div>
                    {prizeCategories.length > 0 && (
                      <div className="panel">
                        <h3>Prize money</h3>
                        {prizeCategories.map(cat => (
                          <div key={cat.id} className="awards" style={{ marginBottom: 8 }}>
                            <b style={{ color: '#fff' }}>{cat.name}</b>
                            {cat.winners.map(w => (
                              <div className="award" key={w.position}>
                                <b>{w.position} • {w.row.name ?? playerName(w.row.playerId!)}</b>
                                <span>£{w.prizeMoney!.toFixed(0)}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="panel" style={{ marginTop: 9 }}>
                      <h3>Side-game honours</h3>
                      <table>
                        <tbody>
                          {bestRound && <tr><td>Best round</td><td>{bestRound.name}</td><td>{bestRound.pts} pts (R{bestRound.dayNumber})</td></tr>}
                          {mostBirdies && <tr><td>Most birdies</td><td>{mostBirdies.name}</td><td>{mostBirdies.count}</td></tr>}
                          {days.filter(d => d.ntp_hole && d.ntp_winner_id).map(d => (
                            <tr key={`ntp-${d.id}`}><td>NTP (R{d.day_number}, H{d.ntp_hole})</td><td colSpan={2}>{playerName(d.ntp_winner_id!)}</td></tr>
                          ))}
                          {days.filter(d => d.ld_hole && d.ld_winner_id).map(d => (
                            <tr key={`ld-${d.id}`}><td>LD (R{d.day_number}, H{d.ld_hole})</td><td colSpan={2}>{playerName(d.ld_winner_id!)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      {!bestRound && !mostBirdies && <p className="small">No side-game records yet.</p>}
                    </div>
                  </div>
                  <div>
                    {finalIndividual.length > 0 && (
                      <div className="panel">
                        <h3>Final individual standings</h3>
                        <table>
                          <thead><tr><th>Pos</th><th>Player</th><th>Pts</th></tr></thead>
                          <tbody>
                            {finalIndividual.map((row, ri) => (
                              <tr key={row.playerId ?? ri}><td>{row.currentPosition ?? ri + 1}</td><td>{row.name ?? playerName(row.playerId!)}</td><td>{row.pts}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="footer"><span>RESULTS BOOK</span><span>{competition.name.toUpperCase()} • ARCHIVED</span></div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}
