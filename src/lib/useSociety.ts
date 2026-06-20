import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export function useSociety() {
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: player } = await supabase
        .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!player) { setLoading(false); return; }

      const { data: member } = await supabase
        .from('society_members').select('society_id')
        .eq('player_id', player.id)
        .order('society_id')
        .limit(1)
        .maybeSingle();

      setSocietyId(member?.society_id ?? null);
      setLoading(false);
    }
    load();
  }, []);

  return { societyId, loading };
}
