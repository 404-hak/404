// Лаборатория нейросети: типы ответа /api/lab/*, запросы, перекодировка звука в WAV 16 кГц
import type { BuoyStatus } from './types';

export type LabEvent = 'background' | 'motor' | 'shot' | 'voice';
export type Medium = 'water' | 'air';
export type LabAlert = 'motor' | 'shot' | 'silence' | null;

export interface LabClip {
  i: number; start: number; end: number; event: LabEvent; confidence: number; probs: Record<LabEvent, number>;
  activity: number; alert: LabAlert; alert_confidence: number | null; note: string; baseline: number | null; quiet: number; novelty?: number;
}
export interface LabFeature { key: string; label: string; unit: string; hint: string; value: number }
export interface LabMotor {
  window_start: number; probability: number; f0_hz: number; rpm_if_crank: number; harmonicity: number;
  psd: { hz_step: number; db: number[] }; harmonics: { k: number; hz: number; db: number }[];
  fingerprint: number[]; matches: { vessel_id: string; similarity: number; threshold?: number; last_seen: string; seen: number }[];
  match_threshold: number; verdict: string;
}
export interface LabResult {
  id: string; source: 'scene' | 'upload' | 'buoy'; title: string; truth: string | null;
  marks: { start: number; end: number; label: string }[]; vessel?: string | null; sha256?: string; ts?: string | null; medium?: Medium;
  duration_s: number; sr: number; level_db: number; peak: number; classes: LabEvent[];
  thresholds: { motor: number; shot: number };
  wave: { min: number[]; max: number[] };
  spec: { frames: number; bands: number; hop_s: number; win_s: number; db_lo: number; db_hi: number; data: string; mel_hz: number[] };
  timeline: ({ t: number; start: number; activity: number; novelty?: number } & Record<LabEvent, number>)[];
  clips: LabClip[]; main_clip: number; features: LabFeature[];
  motor: LabMotor | null;
  impulse: { t: number; crest_db: number; rise_ms: number; centroid_khz: number; width_ms: number; low_share: number; shot_probability: number; shot_window_start: number;
    zoom: { t0: number; t1: number; y: number[] } };
  nature: { activity: number; bio_curve: number[]; frame_s: number; band_hz: [number, number] };
  verdict: { alerts: { kind: Exclude<LabAlert, null>; clip: number; confidence: number }[]; event: LabEvent; confidence: number; novelty?: number; unfamiliar?: boolean };
}
export type Preset = 'motor-archive' | 'motor-new' | 'shot' | 'night' | 'silence' | 'voices' | 'imitation' | 'mouth-motor' | 'room' | 'claps' | 'thunder' | 'wave' | 'airplane' | 'oar' | 'fish' | 'rain';
export interface SceneParams { preset: Preset; vessel: 'boat-A' | 'boat-B' | 'boat-C'; duration_s: number; snr_db: number; activity: number; seed: number; medium: Medium }

export interface ModelMeta {
  version: string; classes: LabEvent[]; embedding_dim: number;
  trained_on: { synthetic_event_clips: number; synthetic_vessel_clips: number; real_event_clips: number; real_vessel_clips: number; train_vessels: number };
  thresholds: { motor: number; shot: number; match: number };
  metrics: {
    events: { accuracy: number; recall_motor: number; recall_shot: number; false_alarm_background: number; motor_recall_by_snr: Record<string, number>; confusion: number[][];
      accuracy_by_medium?: Record<Medium, number> };
    bio: { mae: number; r2: number };
    vessels_held_out: { auc: number; eer: number; tpr_at_far1: number; identification_rank1: number; vessels: number; same_mean: number; diff_mean: number; tpr_template_far1?: number };
    calibration?: { background_clips: number; false_motor_per_clip: number; false_motor_two_in_row: number; false_shot_per_clip: number;
      motor_recall_per_clip: number; motor_recall_by_snr: Record<string, number>; shot_recall: number;
      false_shot_on_mouth_imitation?: number; mouth_imitations?: number; voice_recognised?: number; shot_recall_underwater?: number;
      false_motor_on_mouth_imitation?: number;
      by_medium?: Record<Medium, { false_shot_per_clip: number; shot_recall: number; false_motor_per_clip: number; motor_recall_per_clip: number }> };
  };
}
export interface ClipRec { sha256: string; buoy_id: string; ts: string; event: LabEvent; confidence: number; activity: number; note: string; alert_id: string | null }
export type { BuoyStatus };

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const j = await r.json(); msg = j.detail ?? msg; } catch { /* текст ошибки не JSON */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const labApi = {
  scene: (p: SceneParams) => fetch('/api/lab/scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(json<LabResult>),
  analyze: (wav: Blob, name: string) => fetch(`/api/lab/analyze?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav }).then(json<LabResult>),
  clip: (sha: string) => fetch(`/api/lab/clip/${sha}`, { method: 'POST' }).then(json<LabResult>),
  model: () => fetch('/api/model').then(json<{ available: boolean; meta: ModelMeta | null }>),
  clips: (limit = 14) => fetch(`/api/clips?limit=${limit}`).then(json<ClipRec[]>),
};

export const audioUrl = (r: LabResult) => `/api/lab/audio/${r.id}`;

// ---------- любой звук → WAV 16 кГц моно ----------
const SR = 16000;
export const MAX_S = 30;

/** Декодирует то, что умеет браузер (WAV, MP3, OGG, M4A, запись микрофона), и приводит к WAV 16 кГц моно. */
export async function toWav16k(blob: Blob): Promise<{ wav: Blob; seconds: number; trimmed: boolean }> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const seconds = Math.min(buf.duration, MAX_S);
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * SR)), SR);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return { wav: encodeWav(out.getChannelData(0)), seconds, trimmed: buf.duration > MAX_S };
  } finally {
    void ctx.close();
  }
}

function encodeWav(x: Float32Array): Blob {
  const b = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(b);
  const s = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return new Blob([b], { type: 'audio/wav' });
}

export const EVENT_RU: Record<LabEvent, string> = { background: 'Фон', motor: 'Мотор', shot: 'Выстрел', voice: 'Голоса людей' };
/** Голоса людей — свой цвет: не угроза, но и не фон */
export const VOICE = '#7FB2E5';
export const ALERT_RU: Record<Exclude<LabAlert, null>, string> = { motor: 'мотор', shot: 'выстрел', silence: 'тишина' };
export const fmtS = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const pct0 = (v: number) => `${Math.round(v * 100)} %`;
export const num = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
