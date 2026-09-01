export type Registration = {
  id: string;
  name: string;
  email: string;
  employee_id: string;
  gender: Gender;
  location: Location;
  dpl_played: boolean;
  self_rating: number;
  player_type: PlayerType;
  batting_style: BattingStyle;
  bowling_style: BowlingStyle;
  bowling_arm: BowlingArm;
  availability: string;
  photo_url?: string | null;
  created_at: string;
};

export type PlayerType = 'Batter' | 'Bowler' | 'All-rounder' | 'Wicketkeeper-batter';
export type Gender = 'Male' | 'Female';
export type Location = 'CZ' | 'SP' | 'Mumbai' | 'Other';
export type BattingStyle = 'Right-hand batter' | 'Left-hand batter';
export type BowlingStyle = 'Right-arm pace' | 'Left-arm pace' | 'Right-arm spin' | 'Left-arm spin' | 'Do not bowl';
export type BowlingArm = 'Right arm' | 'Left arm' | 'Not applicable';
export type RegistrationInput = Omit<Registration, 'id' | 'created_at'>;

export type SiteSettings = {
  id: number;
  registration_open: string | null;
  registration_deadline: string | null;
  player_capacity: number;
  total_teams: number;
  total_matches: number;
  champion: string | null;
};

export type Team = {
  id: string;
  name: string;
  icon: string;
  icon_url?: string;
  sort_order: number;
};
