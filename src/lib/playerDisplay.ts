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
