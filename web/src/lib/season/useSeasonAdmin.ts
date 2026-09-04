'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * The same society admin/owner gate used by /admin, /admin/codes and
 * /admin/tee-sheet, shared across the three Season pages. Redirects to login
 * or the dashboard exactly as those pages do, and hands back the admin's
 * society once the check passes.
 */
export function useSeasonAdmin() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [societyName, setSocietyName] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/auth/login'); return; }

      const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!player) { router.push('/dashboard'); return; }

      const { data: member } = await supabase
        .from('society_members').select('role, society_id')
        .eq('player_id', player.id).order('joined_at', { ascending: true }).limit(1).maybeSingle();
      if (!member || !['admin', 'owner'].includes(member.role ?? '')) { router.push('/dashboard'); return; }

      const { data: society } = await supabase
        .from('societies').select('name').eq('id', member.society_id).single();

      setSocietyId(member.society_id);
      setSocietyName((society as { name: string } | null)?.name ?? null);
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { loading, societyId, societyName };
}
