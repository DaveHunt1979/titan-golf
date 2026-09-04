'use client';

import type { ReactNode } from 'react';
import { Check, Minus, Plus } from 'lucide-react';

/**
 * Shared builder primitives. The status vocabulary here is the same one the
 * admin tee-sheet board and the tournament archive already use:
 * GOLD #D4AF37 = draft (and, elsewhere, complete), GREEN #4ade80 = live,
 * RED #f87171 = destructive / unassigned / error. No new colours.
 */

export const GOLD  = '#D4AF37';
export const GREEN = '#4ade80';
export const RED   = '#f87171';

export function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">{label}</h2>
      <span className="h-px flex-1 bg-[#1c1c1c]" />
      {hint && <span className="text-[11px] font-semibold text-neutral-600">{hint}</span>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6 ${className}`}>{children}</div>;
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">{children}</span>;
}

const INPUT_CLS =
  'w-full rounded-lg border border-[#1c1c1c] bg-[#000000] px-4 py-3 text-sm text-white placeholder-neutral-600 outline-none transition-colors focus:border-[#D4AF37]/50 focus:ring-1 focus:ring-[#D4AF37]/20';

export function TextField({
  label, value, onChange, placeholder, type = 'text', mono, min, max, step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${INPUT_CLS} ${mono ? 'font-mono tabular-nums' : ''} [color-scheme:dark]`}
      />
    </label>
  );
}

export function TextArea({
  label, value, onChange, placeholder, rows = 4,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <textarea
        value={value}
        rows={rows}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${INPUT_CLS} resize-y leading-relaxed`}
      />
    </label>
  );
}

export function SelectField({
  label, value, onChange, options, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${INPUT_CLS} appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23737373%22 stroke-width=%222%22><path d=%22M6 9l6 6 6-6%22/></svg>')] bg-[length:18px_18px] bg-[right_0.9rem_center] bg-no-repeat pr-11`}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Toggle({
  label, hint, value, onChange, disabled,
}: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-4 rounded-2xl border p-5 transition-colors ${
        value ? 'border-[#D4AF37]/30 bg-[#D4AF37]/5' : 'border-[#1c1c1c] bg-[#111111]'
      } ${disabled ? 'opacity-45' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className={`font-bold ${value ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{label}</div>
        {hint && <div className="mt-0.5 text-sm text-neutral-500">{hint}</div>}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!value)}
        aria-pressed={value}
        aria-label={label}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed ${
          value ? 'bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))]' : 'bg-[#1c1c1c]'
        }`}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

export function Stepper({
  label, value, onDec, onInc, unit, decDisabled, incDisabled, locked, lockedHint,
}: {
  label: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
  unit?: string;
  decDisabled?: boolean;
  incDisabled?: boolean;
  locked?: boolean;
  lockedHint?: string;
}) {
  const btn =
    'flex h-12 w-12 items-center justify-center rounded-xl border border-[#1c1c1c] bg-[#000000] text-[#D4AF37] transition-colors hover:border-[#D4AF37]/40 hover:bg-[#D4AF37]/8 disabled:opacity-30 disabled:hover:border-[#1c1c1c] disabled:hover:bg-[#000000]';
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-4">
        <button type="button" onClick={onDec} disabled={locked || decDisabled} aria-label={`Decrease ${label}`} className={btn}>
          <Minus size={18} />
        </button>
        <span className="min-w-[6rem] text-center font-mono text-[26px] font-bold leading-none tabular-nums text-white">
          {value}
          {unit && <span className="ml-1.5 text-[12px] font-bold text-neutral-600">{unit}</span>}
        </span>
        <button type="button" onClick={onInc} disabled={locked || incDisabled} aria-label={`Increase ${label}`} className={btn}>
          <Plus size={18} />
        </button>
        {locked && lockedHint && (
          <span className="rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/8 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-[#D4AF37]">
            {lockedHint}
          </span>
        )}
      </div>
    </div>
  );
}

/** Selectable pill used for day formats, handicap allowances, tees, holes. */
export function Pill({
  selected, onClick, title, sub, disabled,
}: {
  selected: boolean; onClick: () => void; title: string; sub?: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border px-4 py-2 text-left text-sm transition-colors disabled:opacity-35 ${
        selected
          ? 'border-[#D4AF37]/50 bg-[#D4AF37]/10'
          : 'border-[#1c1c1c] bg-[#000000] hover:border-neutral-700 hover:bg-[#111111]'
      }`}
    >
      <div className={`font-bold ${selected ? 'text-[var(--gold-bright)]' : 'text-neutral-300'}`}>{title}</div>
      {sub && <div className={`text-[10px] ${selected ? 'text-[#D4AF37]/70' : 'text-neutral-600'}`}>{sub}</div>}
    </button>
  );
}

/** GOLD = draft/pending, GREEN = ready/live, RED = blocking problem. */
export function StatusPill({ tone, children }: { tone: 'gold' | 'green' | 'red' | 'neutral'; children: ReactNode }) {
  const cls = {
    gold:    'border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#D4AF37]',
    green:   'border-[#4ade80]/35 bg-[#4ade80]/10 text-[#4ade80]',
    red:     'border-[#f87171]/35 bg-[#f87171]/10 text-[#f87171]',
    neutral: 'border-[#1c1c1c] bg-[#0a0a0a] text-neutral-500',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${cls}`}>
      {tone === 'green' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4ade80]" />}
      {children}
    </span>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#f87171]/30 bg-[#f87171]/8 px-4 py-3 text-sm text-[#f87171]">{children}</div>
  );
}

export function CheckDot({ on }: { on: boolean }) {
  return on ? (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#D4AF37]/15 text-[var(--gold-bright)]">
      <Check size={13} />
    </span>
  ) : (
    <span className="h-6 w-6 rounded-full border border-[#1c1c1c]" />
  );
}
