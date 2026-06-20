import { supabase } from './supabase';

export interface GolfbertCourse {
  id:   number;
  name: string;
  address?: {
    city?:    string;
    state?:   string;
    country?: string;
  };
}

export interface GolfbertHole {
  number:     number;
  par?:       number; // only on paid tier
  handicap?:  number; // stroke index — only on paid tier
}

async function invoke(body: object) {
  const { data, error } = await supabase.functions.invoke('golfbert', { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function searchCourses(query: string): Promise<GolfbertCourse[]> {
  const data = await invoke({ action: 'search', query });
  return (data.resources ?? []) as GolfbertCourse[];
}

export async function getCourseHoles(courseId: number): Promise<GolfbertHole[]> {
  const data = await invoke({ action: 'holes', courseId });
  return (data.resources ?? []) as GolfbertHole[];
}

export function courseLocation(course: GolfbertCourse): string {
  const { city, state, country } = course.address ?? {};
  return [city, state, country].filter(Boolean).join(', ');
}
