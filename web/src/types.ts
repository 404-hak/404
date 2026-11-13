// Зеркало моделей API (api/app/models.py)
export type AlertKind = 'motor' | 'shot' | 'silence' | 'offline';
export type AlertStatus = 'new' | 'intercept' | 'resolved';
export type BuoyStatus = 'ok' | 'warn' | 'alert' | 'offline';
export type Mode = 'calm' | 'alertness' | 'alarm' | 'intercept';

export interface Buoy {
  id: string; name: string; lat: number; lon: number; sector: number;
  status: BuoyStatus; battery: number; last_seen: string; health: number;
}
export interface Match { vessel_id: string; last_seen: string; similarity: number }
export interface Alert {
  id: string; buoy_id: string; buoy_name: string; sector: number; kind: AlertKind; ts: string;
  lat: number; lon: number; confidence: number; status: AlertStatus; message: string;
  distance_km: number | null; match: Match | null; prev_hash: string; hash: string;
  intercept_at: string | null; resolved_at: string | null; synthetic: boolean;
  intercept_by?: string | null; resolved_by?: string | null;
  /** SHA-256 звукового клипа-улики (есть, если тревогу подняла нейросеть по звуку буя) */
  audio_sha256?: string | null; probs?: Record<string, number> | null; source?: 'audio' | 'manual' | 'system';
  /** Буи, которые слышали этот источник, и где катер — оценка по громкости у нескольких буёв (не улика) */
  heard_by?: { buoy_id: string; ts: string; level_db: number; excess_db: number | null }[];
  estimate?: Estimate | null;
  /** Итог инспектора: задержан или ложная тревога (ложные — примеры для дообучения сети) */
  verdict?: Verdict | null;
}
export interface Estimate { lat: number; lon: number; radius_km: number; buoys: number; method: 'loudness' }
export type Verdict = 'confirmed' | 'false';
/** Куда вести катер инспектора: к оценке места по нескольким буям, если она есть, иначе — к бую. */
export const target = (a: Alert): [number, number] => (a.estimate ? [a.estimate.lat, a.estimate.lon] : [a.lat, a.lon]);
export interface Forecast {
  ts: string; moon_phase: string; moon_illumination: number; weekday: string; water_temp: number;
  wind_ms: number; risk: number; level: 'low' | 'elevated' | 'high'; hot_sectors: number[];
  message: string; demo: boolean; weather?: 'open-meteo' | 'seasonal';
}
export interface Sector { n: number; south: number; west: number; north: number; east: number }
export interface State {
  mode: Mode; now: string; buoys: Buoy[]; alerts: Alert[]; forecast: Forecast; sectors: Sector[];
  links: [string, string][]; inspector: [number, number]; center: [number, number];
}

export interface NightStat { date: string; risk: number; moon_illumination: number; events: number; by_kind: Record<string, number> }
export interface Stats {
  days: number; nights: NightStat[]; by_kind: Record<string, number>; by_sector: Record<string, number>;
  by_hour: number[]; total: number; reaction_median_min: number | null; synthetic: boolean;
}
export interface NightForecast {
  date: string; weekday: string; moon_phase: string; moon_illumination: number; water_temp: number;
  risk: number; level: 'low' | 'elevated' | 'high'; wind_ms?: number; weather?: 'open-meteo' | 'seasonal';
}
export interface ChainCheck { ok: boolean; checked: number; broken_at: string | null; audio_checked?: number; reason?: string | null; journal_checked?: number; journal_head?: string | null }

export type Role = 'observer' | 'duty' | 'senior';
export interface Me { login: string | null; name: string; role: Role; role_title: string; accounts: boolean }
export interface TeamMember { login: string; name: string; role: Role; created: string; disabled: boolean }
export interface JournalEntry { seq: number; ts: string; actor: string; action: string; target: string | null; data: Record<string, unknown>; prev: string; hash: string }
