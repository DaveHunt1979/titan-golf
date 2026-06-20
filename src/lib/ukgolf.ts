import { supabase } from './supabase';

export interface UKClub {
  id:            string;
  name:          string;
  city?:         string;
  county?:       string;
  postcode?:     string;
  country_code?: string;
  google_rating?: number;
  club_type?:    string;
  lat?:          number;
  lng?:          number;
}

async function invoke(body: object) {
  const { data, error } = await supabase.functions.invoke('ukgolf', { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function searchUKClubs(query: string): Promise<UKClub[]> {
  const data = await invoke({ action: 'search', query });
  return (data.clubs ?? []) as UKClub[];
}

export async function getUKClub(clubId: string): Promise<UKClub | null> {
  const data = await invoke({ action: 'club', clubId });
  return data ?? null;
}

export function clubLocation(club: UKClub): string {
  return [club.city, club.postcode].filter(Boolean).join(' · ');
}
