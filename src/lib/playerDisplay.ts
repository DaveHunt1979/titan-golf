// Shared player-name abbreviation for the "avatar + name + SHOT badge +
// stroke holes" rows (score/enter, spectate, ...) — first + last initial,
// e.g. "Dave Hunt" -> "DH". Always 2 characters, so it never needs a
// dynamic fit/fallback check, and it disambiguates players who share a
// first name (two "Chris"es become e.g. "CJ" / "CS").
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Resolves initials collisions within one specific group shown together
 * (e.g. a single match's shot-allocation panel) — first+last initial isn't
 * unique for two players who share BOTH (Ricky Snell / Ross Snell -> both
 * "RS"), so any name in a collision falls back to the first two letters of
 * its first name ("RI" / "RO") instead. */
export function dedupeInitials(fullNames: string[]): string[] {
  const base = fullNames.map(initials);
  const counts = new Map<string, number>();
  for (const b of base) counts.set(b, (counts.get(b) ?? 0) + 1);
  return fullNames.map((name, i) => {
    if ((counts.get(base[i]) ?? 0) < 2) return base[i];
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  });
}
