import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// "God" tier — Dave + Rick only, not scoped to any one society (see
// players.is_platform_admin, migration 20260918030000). Controls shared
// platform data no society admin should be able to touch: the courses
// database today, possibly more later.
export function usePlatformAdmin() {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) { setIsPlatformAdmin(false); setLoading(false); } return; }
      const { data } = await supabase.from('players').select('is_platform_admin').eq('auth_uid', user.id).maybeSingle();
      if (!cancelled) {
        setIsPlatformAdmin(!!(data as any)?.is_platform_admin);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { isPlatformAdmin, loading };
}
