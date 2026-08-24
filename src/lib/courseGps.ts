// Shared "does this course have GPS" predicate (Rick's brief, section 7,
// 2026-08-24) — a course counts as GPS-mapped if any of its holes carry a
// green location. Matches the existing course-picker badge logic
// (admin/build.tsx, games/new.tsx), just extracted so every Range/GPS icon
// in the app can gate on the same rule instead of always rendering.
export interface CourseGpsHole {
  green_lat?: number | null;
  green_lng?: number | null;
}

export function courseHasGps(holes: CourseGpsHole[]): boolean {
  return holes.some(h => h.green_lat != null && h.green_lng != null);
}
