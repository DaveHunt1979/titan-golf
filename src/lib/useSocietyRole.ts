import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Trips screens need "who am I" (to stamp created_by) and "am I an admin or
// owner" (admin+owner edit/delete, enforced again server-side by RLS).
export function useSocietyRole(societyId: string | null) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function fetch() {
      setLoading(true);
      if (!societyId) {
        if (active) { setPlayerId(null); setRole(null); setLoading(false); }
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setLoading(false); return; }

      const { data: player } = await supabase
        .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!player) { if (active) setLoading(false); return; }

      const { data: member } = await supabase
        .from('society_members').select('role')
        .eq('society_id', societyId).eq('player_id', player.id).maybeSingle();

      if (!active) return;
      setPlayerId(player.id);
      setRole(member?.role ?? null);
      setLoading(false);
    }
    fetch();
    return () => { active = false; };
  }, [societyId]);

  return { playerId, role, isOwner: role === 'owner', isAdmin: role === 'admin', loading };
}
