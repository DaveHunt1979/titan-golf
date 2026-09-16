-- Tournament Builder "Prize Money" toggle (Dave, 2026-09-16). Go Live has
-- required at least one Prize Category with real prize amounts since Rick's
-- brief section 13 — with no way to say "this tournament genuinely has no
-- money in it," a free/social tournament could never finish setup. Default
-- true preserves the existing required-prizes behaviour for every
-- tournament already relying on it; only newly-built ones that explicitly
-- flip this off skip the requirement (see build.tsx's computeGoLiveIssues).
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS prizes_enabled BOOLEAN NOT NULL DEFAULT true;
