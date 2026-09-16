import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Trips screens need "who am I" (to stamp created_by) and "am I an admin or
// owner" (admin+owner edit/delete, enforced again server-side by RLS).
export function useSocietyRole(societyId: string | null) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function fetch() {
      setLoading(true);
      if (!societyId) {
        if (active) { setPlayerId(null); setRole(null); setIsPlatformAdmin(false); setLoading(false); }
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setLoading(false); return; }

      const { data: player } = await supabase
        .from('players').select('id, is_platform_admin').eq('auth_uid', user.id).maybeSingle();
      if (!player) { if (active) setLoading(false); return; }

      const { data: member } = await supabase
        .from('society_members').select('role')
        .eq('society_id', societyId).eq('player_id', player.id).maybeSingle();

      if (!active) return;
      setPlayerId(player.id);
      setRole(member?.role ?? null);
      setIsPlatformAdmin(!!player.is_platform_admin);
      setLoading(false);
    }
    fetch();
    return () => { active = false; };
  }, [societyId]);

  // God (is_platform_admin) has full admin power in every society per RLS
  // (20260916010000_platform_admin_universal_bypass.sql), independent of
  // whether they've ever joined this one as a real member — isAdmin/isOwner
  // must reflect that so admin-only UI isn't hidden from them here either.
  return {
    playerId, role, isPlatformAdmin,
    isOwner: role === 'owner' || isPlatformAdmin,
    isAdmin: role === 'admin' || isPlatformAdmin,
    loading,
  };
}
