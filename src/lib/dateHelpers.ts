// Shared UK-display <-> ISO/Date conversion helpers. Extracted from
// admin/build.tsx (originally local consts) so admin/info.tsx's Info Pack
// rebuild (Rick's brief, section 5) can reuse the exact same date/time
// picker conventions instead of duplicating them.

export function ukDateToIso(ukDate: string): string {
  const [dd, mm, yyyy] = ukDate.trim().split('-');
  return `${yyyy}-${mm}-${dd}`;
}

export function isoToUk(iso: string): string {
  const [yyyy, mm, dd] = iso.split('-');
  return `${dd}-${mm}-${yyyy}`;
}

export function ukDateToDate(ukDate: string): Date {
  if (!/^\d{2}-\d{2}-\d{4}$/.test(ukDate.trim())) return new Date();
  const [dd, mm, yyyy] = ukDate.trim().split('-').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

export function dateToUk(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

export function dateToHm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function hmToDate(hm: string): Date {
  const d = new Date();
  if (/^\d{2}:\d{2}$/.test(hm)) {
    const [h, m] = hm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}
