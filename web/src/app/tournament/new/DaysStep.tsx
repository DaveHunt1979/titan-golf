'use client';

import {
  DAY_FORMATS, HCP_OPTIONS, teeLabel,
  type DayConfig, type DayFormatId, type SelectableTee,
} from '@/lib/tournamentBuilder';
import { Label, Pill, SelectField, StatusPill, TextField, Toggle } from './ui';

export interface CourseHole { hole_number: number; par: number; }

/**
 * Round Setup — one card per round, matching the mobile builder's Days step
 * field for field: course, tee box (a single organiser-set tee for the whole
 * round), date, tee time, slope/course rating, WHS on/off, day format,
 * handicap allowance and the two side games.
 */
export default function DaysStep({
  days, isTeamFormat, courses, courseTees, courseHoles, onChangeDay, onPickCourse,
}: {
  days: DayConfig[];
  isTeamFormat: boolean;
  courses: string[];
  courseTees: Record<string, SelectableTee[]>;
  courseHoles: Record<string, CourseHole[]>;
  onChangeDay: (i: number, patch: Partial<DayConfig>) => void;
  onPickCourse: (i: number, courseName: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-400">
        Set the course, tee box, date and format for each round. The tee box is set once per round and played by every
        enrolled player — WHS handicaps are calculated from that tee&apos;s own rating and slope.
      </p>

      {days.map((day, i) => {
        const tees  = courseTees[day.courseName] ?? [];
        const holes = courseHoles[day.courseName] ?? [];
        const par3  = holes.filter(h => h.par === 3).map(h => h.hole_number).sort((a, b) => a - b);
        const par5  = holes.filter(h => h.par === 5).map(h => h.hole_number).sort((a, b) => a - b);
        // A WHS round can only produce real numbers if its tee resolves to a
        // fully rated course_tees row — surfaced here, per round, rather than
        // only at Go Live.
        const teeKey  = day.teeName ? `${day.teeName}|${day.teeGender}` : '';
        const picked  = tees.find(t => `${t.tee_name}|${t.gender ?? ''}` === teeKey);
        const teeRated = !!picked && picked.par != null && picked.course_rating != null && picked.slope_rating != null;
        const dayFormats = DAY_FORMATS.filter(f => isTeamFormat || !f.teamOnly);
        // A hydrated draft can name a course the master list hasn't finished
        // loading (or that has since been renamed) — keep it selectable rather
        // than silently blanking the round's course.
        const courseOptions = day.courseName && !courses.includes(day.courseName)
          ? [day.courseName, ...courses]
          : courses;

        return (
          <div key={i} className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
            <div className="flex items-center gap-3 border-b border-[#1c1c1c] bg-[#0a0a0a] px-6 py-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/8 font-mono text-[11px] font-bold tabular-nums text-[var(--gold-bright)]">
                {i + 1}
              </span>
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#D4AF37]">Round {i + 1}</span>
              <span className="h-px flex-1 bg-[#1c1c1c]" />
              {day.whsEnabled && <StatusPill tone={teeRated ? 'green' : 'red'}>{teeRated ? 'WHS Ready' : 'WHS Needs Tee'}</StatusPill>}
              <span className="font-mono text-[11px] font-semibold tabular-nums text-neutral-600">{day.hcpPct}% hcp</span>
            </div>

            <div className="space-y-5 p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Course"
                  value={day.courseName}
                  onChange={v => onPickCourse(i, v)}
                  placeholder="Select a course…"
                  options={courseOptions.map(c => ({ value: c, label: c }))}
                />
                <SelectField
                  label="Tee Box"
                  value={teeKey && tees.some(t => `${t.tee_name}|${t.gender ?? ''}` === teeKey) ? teeKey : ''}
                  onChange={v => {
                    const [tee_name, gender] = v.split('|');
                    const match = tees.find(t => t.tee_name === tee_name && (t.gender ?? '') === (gender ?? ''));
                    onChangeDay(i, {
                      teeName: tee_name ?? '',
                      teeGender: gender ?? '',
                      // The round's ratings come from the tee itself, never
                      // guessed — picking a tee fills them in, and the fields
                      // below stay editable for a course with no tee data.
                      ...(match?.course_rating != null ? { courseRating: String(match.course_rating) } : {}),
                      ...(match?.slope_rating  != null ? { slopeRating:  String(match.slope_rating)  } : {}),
                    });
                  }}
                  placeholder={day.courseName ? (tees.length ? 'Select a tee…' : 'No tee data for this course') : 'Pick a course first'}
                  options={tees.map(t => ({
                    value: `${t.tee_name}|${t.gender ?? ''}`,
                    label: `${teeLabel(t)}${t.course_rating != null && t.slope_rating != null ? ` · CR ${t.course_rating} / SR ${t.slope_rating}` : ' · unrated'}`,
                  }))}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Date"     type="date" value={day.playDate} onChange={v => onChangeDay(i, { playDate: v })} mono />
                <TextField label="Tee Time" type="time" value={day.teeTime}  onChange={v => onChangeDay(i, { teeTime: v })}  mono />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Course Rating" type="number" step="0.1" mono
                  value={day.courseRating} onChange={v => onChangeDay(i, { courseRating: v })} placeholder="e.g. 72.4"
                />
                <TextField
                  label="Slope Rating" type="number" mono
                  value={day.slopeRating} onChange={v => onChangeDay(i, { slopeRating: v })} placeholder="e.g. 130"
                />
              </div>

              <Toggle
                label="World Handicap System"
                hint="Calculate each player's playing handicap from this round's tee rating and slope."
                value={day.whsEnabled}
                onChange={v => onChangeDay(i, { whsEnabled: v })}
              />

              <div>
                <Label>Round Format</Label>
                <div className="flex flex-wrap gap-2">
                  {dayFormats.map(f => (
                    <Pill
                      key={f.id}
                      selected={day.format === f.id}
                      onClick={() => onChangeDay(i, { format: f.id as DayFormatId })}
                      title={f.label}
                      sub={f.sub}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Label>Handicap Allowance</Label>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {HCP_OPTIONS.map(h => (
                    <button
                      key={h.pct}
                      type="button"
                      onClick={() => onChangeDay(i, { hcpPct: h.pct })}
                      className={`rounded-xl border py-2.5 text-xs font-bold transition-colors ${
                        day.hcpPct === h.pct
                          ? 'border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[var(--gold-bright)]'
                          : 'border-[#1c1c1c] bg-[#000000] text-neutral-400 hover:border-neutral-700 hover:bg-[#111111]'
                      }`}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label>Side Games</Label>
                <SideGame
                  title="Longest Drive"
                  hint="Usually a par 5."
                  enabled={day.ldEnabled}
                  hole={day.ldHole}
                  suggested={par5}
                  onToggle={v => onChangeDay(i, { ldEnabled: v, ldHole: v ? day.ldHole : null })}
                  onPick={h => onChangeDay(i, { ldHole: h })}
                />
                <SideGame
                  title="Nearest the Pin"
                  hint="Usually a par 3."
                  enabled={day.ntpEnabled}
                  hole={day.ntpHole}
                  suggested={par3}
                  onToggle={v => onChangeDay(i, { ntpEnabled: v, ntpHole: v ? day.ntpHole : null })}
                  onPick={h => onChangeDay(i, { ntpHole: h })}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SideGame({
  title, hint, enabled, hole, suggested, onToggle, onPick,
}: {
  title: string;
  hint: string;
  enabled: boolean;
  hole: number | null;
  suggested: number[];
  onToggle: (v: boolean) => void;
  onPick: (h: number) => void;
}) {
  // Falls back to all 18 holes when the course has no hole data loaded, so a
  // side game is still configurable on a course that predates course_holes.
  const holes = suggested.length > 0 ? suggested : Array.from({ length: 18 }, (_, i) => i + 1);
  return (
    <div className={`rounded-xl border p-4 transition-colors ${enabled ? 'border-[#D4AF37]/30 bg-[#D4AF37]/5' : 'border-[#1c1c1c] bg-[#000000]'}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-bold ${enabled ? 'text-[var(--gold-bright)]' : 'text-neutral-300'}`}>{title}</div>
          <div className="text-[11px] text-neutral-600">{hint}</div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          aria-pressed={enabled}
          aria-label={title}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            enabled ? 'bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))]' : 'bg-[#1c1c1c]'
          }`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
      {enabled && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {holes.map(h => (
            <button
              key={h}
              type="button"
              onClick={() => onPick(h)}
              className={`h-9 w-9 rounded-lg border font-mono text-[12px] font-bold tabular-nums transition-colors ${
                hole === h
                  ? 'border-[#D4AF37]/60 bg-[#D4AF37]/15 text-[var(--gold-bright)]'
                  : 'border-[#1c1c1c] bg-[#0a0a0a] text-neutral-500 hover:border-neutral-700 hover:text-neutral-300'
              }`}
            >
              {h}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
