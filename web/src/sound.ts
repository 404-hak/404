/**
 * Звук синтезируется в браузере, без аудиофайлов: сонар — для буёв и смены раздела,
 * тревога — двухтоновый сигнал. Выключается одной кнопкой, выбор запоминается.
 */
import { useEffect, useState } from 'react';

const KEY = '404-sound';
let ctx: AudioContext | null = null;
let enabled = (() => {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
})();
const listeners = new Set<(on: boolean) => void>();

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

/** Тон с плавной атакой и затуханием. */
function tone(freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine', glideTo?: number) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sound = {
  /** Короткий «пинг» сонара с эхом — выбор буя. */
  ping() { tone(1320, 0, 0.35, 0.05, 'sine', 1180); tone(1320, 0.18, 0.3, 0.018, 'sine', 1180); },
  /** Тихий щелчок — смена раздела. */
  tick() { tone(660, 0, 0.08, 0.025, 'triangle'); },
  /** Тревога: два тона, повтор. */
  alarm() { [0, 0.5].forEach((d) => { tone(880, d, 0.2, 0.12, 'square'); tone(660, d + 0.22, 0.2, 0.12, 'square'); }); },
  /** Цепочка проверена. */
  ok() { tone(784, 0, 0.18, 0.04); tone(1046, 0.12, 0.3, 0.04); },
};

/** Звук сейчас включён (для меню правой кнопки) */
export const soundEnabled = () => enabled;

export function setSound(on: boolean) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* без хранилища — только на эту вкладку */ }
  listeners.forEach((l) => l(on));
  if (on) sound.tick();
}

export function useSoundOn() {
  const [on, setOn] = useState(enabled);
  useEffect(() => {
    listeners.add(setOn);
    return () => { listeners.delete(setOn); };
  }, []);
  return on;
}
