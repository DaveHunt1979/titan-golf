export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Society {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string;
  plan_tier: 'free' | 'society' | 'club';
  instagram_url: string | null;
}

export interface Player {
  id: string;
  auth_uid: string | null;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
  nickname: string | null;
  cdh_number: string | null;
  bag: Record<string, { brand?: string; model?: string }> | null;
}

export interface Team {
  id: string;
  society_id: string;
  name: string;
  accent_color: string;
  sort_order: number;
}

export interface Competition {
  id: string;
  society_id: string;
  name: string;
  year: number | null;
  format: string;
  status: 'draft' | 'active' | 'complete';
  settings: Json;
  info_sections: Json[];
  include_in_kronos: boolean;
  pin: string | null;
}

export interface CompetitionDay {
  id: string;
  competition_id: string;
  day_number: number;
  course_name: string | null;
  course_par: number;
  course_rating: number | null;
  slope_rating: number;
  play_date: string | null;
}

export interface Match {
  id: string;
  competition_id: string;
  day_id: string;
  match_number: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_player_ids: string[];
  away_player_ids: string[];
  status: 'upcoming' | 'in_progress' | 'complete';
  winner: 'home' | 'away' | 'half' | null;
  result_str: string | null;
  holes_string: string;
  is_singles: boolean;
  round_format: 'matchplay' | 'stableford' | 'medal';
  hcp_allowance: number;
  side_games: string[];
  locked: boolean;
}

export interface MatchHole {
  id: string;
  match_id: string;
  player_id: string;
  hole_number: number;
  score: 'h' | 'a' | 'f' | null;
  gross_score: number | null;
  net_score: number | null;
  stableford_pts: number | null;
  revision: number;
}

export interface CourseHole {
  id: string;
  course_name: string;
  hole_number: number;
  par: number;
  stroke_index: number;
  yardage: number | null;
  hole_name: string | null;
}

export interface Champion {
  id: string;
  society_id: string;
  year: number;
  award_name: string;
  winner_name: string;
  winner_type: 'team' | 'player';
  detail: string | null;
}

export interface Notification {
  id: string;
  society_id: string | null;
  type: string;
  payload: Json;
  target: 'spectator' | 'all' | 'player';
  player_id: string | null;
  created_at: string;
}
