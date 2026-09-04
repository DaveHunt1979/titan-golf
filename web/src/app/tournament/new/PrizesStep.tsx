'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Plus, Trash2 } from 'lucide-react';
import { Card, ErrorBanner, Label, SectionHeading, StatusPill, TextField } from './ui';

interface PayoutDraft { position: number; prize_money: string; }

interface Category {
  id: string;
  name: string;
  hcp_min: number | null;
  hcp_max: number | null;
  display_order: number;
  prize_payouts: { position: number; prize_money: number }[];
}

/**
 * Prize categories (divisions) and their per-position payouts, writing to the
 * same prize_categories / prize_payouts tables the mobile PrizeCategoriesEditor
 * uses, plus the overall trophy prize on competitions.kronos_overall_prize.
 *
 * Deliberately simpler than the mobile editor: no "auto-split into 3 divisions
 * by handicap" shortcut, just direct add/edit/remove of a category and of each
 * payout position.
 */
export default function PrizesStep({
  compId, boardLabel, includeIndividualBoard,
}: {
  compId: string;
  boardLabel: 'Kronos' | 'Individual';
  includeIndividualBoard: boolean;
}) {
  const supabase = createClient();

  const [cats,    setCats]    = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [overall, setOverall] = useState('');

  const [editId,      setEditId]      = useState<string | null>(null);
  const [formOpen,    setFormOpen]    = useState(false);
  const [editName,    setEditName]    = useState('');
  const [editHcpMin,  setEditHcpMin]  = useState('');
  const [editHcpMax,  setEditHcpMax]  = useState('');
  const [editPayouts, setEditPayouts] = useState<PayoutDraft[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: catRows }, { data: comp }] = await Promise.all([
      supabase.from('prize_categories')
        .select('id, name, hcp_min, hcp_max, display_order, prize_payouts(position, prize_money)')
        .eq('competition_id', compId).order('display_order'),
      supabase.from('competitions').select('kronos_overall_prize').eq('id', compId).single(),
    ]);
    setCats(((catRows ?? []) as unknown as Category[]));
    const prize = (comp as { kronos_overall_prize: number | null } | null)?.kronos_overall_prize;
    setOverall(prize != null ? String(prize) : '');
    setLoading(false);
  }, [supabase, compId]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditId(null);
    setEditName('');
    setEditHcpMin('');
    setEditHcpMax('');
    setEditPayouts([{ position: 1, prize_money: '' }, { position: 2, prize_money: '' }, { position: 3, prize_money: '' }]);
    setFormOpen(true);
  }

  function openEdit(cat: Category) {
    setEditId(cat.id);
    setEditName(cat.name);
    setEditHcpMin(cat.hcp_min != null ? String(cat.hcp_min) : '');
    setEditHcpMax(cat.hcp_max != null ? String(cat.hcp_max) : '');
    const existing = [...cat.prize_payouts].sort((a, b) => a.position - b.position);
    setEditPayouts(existing.length > 0
      ? existing.map(p => ({ position: p.position, prize_money: String(p.prize_money) }))
      : [{ position: 1, prize_money: '' }]);
    setFormOpen(true);
  }

  async function saveCategory() {
    if (!editName.trim()) { setError('Give the category a name.'); return; }
    setSaving(true); setError('');

    const hcp_min = editHcpMin.trim() ? parseFloat(editHcpMin) : null;
    const hcp_max = editHcpMax.trim() ? parseFloat(editHcpMax) : null;
    let categoryId = editId;

    if (editId) {
      const { error: err } = await supabase.from('prize_categories')
        .update({ name: editName.trim(), hcp_min, hcp_max }).eq('id', editId);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const display_order = cats.length + 1;
      const { data, error: err } = await supabase.from('prize_categories')
        .insert({ competition_id: compId, name: editName.trim(), hcp_min, hcp_max, display_order })
        .select('id').single();
      if (err || !data) { setError(err?.message ?? 'Could not save the category.'); setSaving(false); return; }
      categoryId = (data as { id: string }).id;
    }

    // Payouts are replaced wholesale rather than diffed — the (category_id,
    // position) unique constraint makes an upsert-by-position no simpler, and
    // a category's payout ladder is small.
    await supabase.from('prize_payouts').delete().eq('category_id', categoryId!);
    const valid = editPayouts
      .filter(p => p.prize_money.trim() !== '' && parseFloat(p.prize_money) > 0)
      .map(p => ({ category_id: categoryId!, position: p.position, prize_money: parseFloat(p.prize_money) }));
    if (valid.length > 0) {
      const { error: payErr } = await supabase.from('prize_payouts').insert(valid);
      if (payErr) { setError(payErr.message); setSaving(false); return; }
    }

    setSaving(false);
    setFormOpen(false);
    await load();
  }

  async function deleteCategory(cat: Category) {
    setSaving(true);
    await supabase.from('prize_categories').delete().eq('id', cat.id);
    setSaving(false);
    await load();
  }

  async function saveOverall(value: string) {
    setOverall(value);
    const amount = value.trim() ? parseFloat(value) : null;
    await supabase.from('competitions')
      .update({ kronos_overall_prize: Number.isFinite(amount as number) ? amount : null })
      .eq('id', compId);
  }

  function catRange(cat: Category) {
    if (cat.hcp_min != null && cat.hcp_max != null) return `HCP ${cat.hcp_min} – ${cat.hcp_max}`;
    if (cat.hcp_min != null) return `HCP ${cat.hcp_min}+`;
    if (cat.hcp_max != null) return `Up to HCP ${cat.hcp_max}`;
    return 'All handicaps';
  }

  if (loading) return <p className="text-sm text-neutral-500">Loading prizes…</p>;

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-400">
        Set up the prize divisions and what each finishing position pays. A category with no prize money attached blocks
        Go Live, the same as it does in the app.
      </p>

      {includeIndividualBoard && (
        <Card>
          <TextField
            label={`${boardLabel} Trophy — Overall Prize`}
            type="number"
            step="1"
            mono
            value={overall}
            onChange={saveOverall}
            placeholder="e.g. 250"
          />
          <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-600">
            The overall trophy winner is excluded from their division prize — it rolls down instead. Leave this blank and
            that player wins nothing at all.
          </p>
        </Card>
      )}

      <SectionHeading label="Prize Categories" hint={`${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}`} />

      {cats.length === 0 && !formOpen && (
        <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] px-6 py-5 text-sm text-neutral-500">
          No categories yet. Most societies run Division 1 / 2 / 3 split by handicap.
        </div>
      )}

      <div className="space-y-3">
        {cats.map(cat => {
          const payouts = [...cat.prize_payouts].sort((a, b) => a.position - b.position);
          return (
            <div key={cat.id} className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
              <div className="flex items-center gap-3 border-b border-[#1c1c1c] bg-[#0a0a0a] px-6 py-3.5">
                <span className="min-w-0 flex-1 truncate font-black text-white">{cat.name}</span>
                <span className="text-[11px] font-semibold text-neutral-500">{catRange(cat)}</span>
                <StatusPill tone={payouts.length === 0 ? 'red' : 'green'}>
                  {payouts.length === 0 ? 'No prizes' : `${payouts.length} paid`}
                </StatusPill>
              </div>
              {payouts.length > 0 && (
                <div className="grid grid-cols-2 gap-px bg-[#1c1c1c] sm:grid-cols-4">
                  {payouts.map(p => (
                    <div key={p.position} className="bg-[#111111] px-4 py-3">
                      <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Position {p.position}</div>
                      <div className="mt-1 font-mono text-[15px] font-bold tabular-nums text-[var(--gold-bright)]">£{p.prize_money}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 border-t border-[#1c1c1c] px-6 py-3">
                <button
                  type="button"
                  onClick={() => openEdit(cat)}
                  className="rounded-full border border-[#1c1c1c] bg-[#000000] px-4 py-1.5 text-[11px] font-black uppercase tracking-widest text-neutral-400 transition-colors hover:border-[#D4AF37]/40 hover:text-[#D4AF37]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => deleteCategory(cat)}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-full border border-[#1c1c1c] bg-[#000000] px-4 py-1.5 text-[11px] font-black uppercase tracking-widest text-neutral-600 transition-colors hover:border-[#f87171]/40 hover:text-[#f87171]"
                >
                  <Trash2 size={12} /> Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {formOpen ? (
        <Card>
          <div className="space-y-4">
            <TextField label="Category Name" value={editName} onChange={setEditName} placeholder="e.g. Division 1" />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Handicap From" type="number" step="0.1" mono value={editHcpMin} onChange={setEditHcpMin} placeholder="blank = no lower bound" />
              <TextField label="Handicap To"   type="number" step="0.1" mono value={editHcpMax} onChange={setEditHcpMax} placeholder="blank = no upper bound" />
            </div>

            <div>
              <Label>Payouts</Label>
              <div className="space-y-2">
                {editPayouts.map((p, idx) => (
                  <div key={p.position} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-[11px] font-black uppercase tracking-widest text-[#D4AF37]">Pos {p.position}</span>
                    <input
                      type="number"
                      value={p.prize_money}
                      onChange={e => setEditPayouts(prev => prev.map((x, i) => i === idx ? { ...x, prize_money: e.target.value } : x))}
                      placeholder="0"
                      className="w-full rounded-lg border border-[#1c1c1c] bg-[#000000] px-4 py-2.5 font-mono text-sm tabular-nums text-white placeholder-neutral-700 outline-none transition-colors focus:border-[#D4AF37]/50"
                    />
                    <button
                      type="button"
                      onClick={() => setEditPayouts(prev => prev.filter((_, i) => i !== idx).map((x, i) => ({ ...x, position: i + 1 })))}
                      aria-label={`Remove position ${p.position}`}
                      className="shrink-0 text-neutral-700 transition-colors hover:text-[#f87171]"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setEditPayouts(prev => [...prev, { position: prev.length + 1, prize_money: '' }])}
                className="mt-3 flex items-center gap-1.5 rounded-full border border-[#1c1c1c] bg-[#000000] px-4 py-2 text-[11px] font-black uppercase tracking-widest text-neutral-400 transition-colors hover:border-[#D4AF37]/40 hover:text-[#D4AF37]"
              >
                <Plus size={12} /> Add Position
              </button>
            </div>

            {error && <ErrorBanner>{error}</ErrorBanner>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setFormOpen(false); setError(''); }}
                className="rounded-full border border-[#1c1c1c] bg-[#000000] px-6 py-2.5 text-[12.5px] font-black tracking-wide text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveCategory}
                disabled={saving}
                className="flex-1 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] py-2.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110 disabled:opacity-50"
              >
                {saving ? 'Saving…' : editId ? 'Save Category' : 'Add Category'}
              </button>
            </div>
          </div>
        </Card>
      ) : (
        <button
          type="button"
          onClick={openNew}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#1c1c1c] bg-[#0a0a0a] py-4 text-[12px] font-black uppercase tracking-widest text-neutral-500 transition-colors hover:border-[#D4AF37]/40 hover:text-[#D4AF37]"
        >
          <Plus size={14} /> Add Prize Category
        </button>
      )}
    </div>
  );
}
