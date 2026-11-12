/** Палитра неба и моря по высоте солнца — общая для фона и интро. Мультяшно: ровные цвета. */
export type V3 = [number, number, number];
export const hex = (h: string): V3 => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as V3;

/**
 * Небо и море по времени суток — ключевые кадры по высоте солнца (градусы).
 * Мультяшно: ровные цвета, без фотореализма. Между кадрами — плавно.
 */
export interface Pal { top: V3; hz: V3; far: V3; near: V3; line: V3; isle: V3; sun: V3; stars: number; clouds: number }
const P = (top: string, hz: string, far: string, near: string, line: string, isle: string, sun: string, stars: number, clouds: number): Pal =>
  ({ top: hex(top), hz: hex(hz), far: hex(far), near: hex(near), line: hex(line), isle: hex(isle), sun: hex(sun), stars, clouds });
const KEYS: [number, Pal][] = [
  [-18, P('#081129', '#1A2C55', '#1B2F59', '#071024', '#8EA5D0', '#050C1B', '#FFE7B0', 1, 0)],          // ночь
  [-8, P('#17204B', '#46467C', '#383D70', '#0E1638', '#B9B5E5', '#0D112E', '#FFD9A0', 0.6, 0.15)],    // синий час
  [-2, P('#2A3874', '#EE987A', '#B97779', '#1C2853', '#FFD2B4', '#291F37', '#FFB27A', 0.15, 0.5)],     // рассвет / закат
  [5, P('#5A82C5', '#FFC98E', '#E7B78B', '#2B5283', '#FFF0D2', '#4E493E', '#FFE29A', 0, 0.8)],          // золотой час
  [15, P('#4C89D2', '#BEE2F2', '#98CBE3', '#2D6CA5', '#FFFFFF', '#5D8265', '#FFF6DA', 0, 1)],           // утро
  [30, P('#3D84D5', '#CAEAF7', '#8CC9E5', '#2566A2', '#FFFFFF', '#678F69', '#FFFBEA', 0, 1)],           // день
];
export function palAt(alt: number): Pal {
  if (alt <= KEYS[0][0]) return KEYS[0][1];
  for (let i = 1; i < KEYS.length; i++) {
    const [a0, p0] = KEYS[i - 1], [a1, p1] = KEYS[i];
    if (alt <= a1) {
      const k = (alt - a0) / (a1 - a0);
      const m = (x: V3, y: V3) => x.map((v, j) => v + (y[j] - v) * k) as V3;
      return { top: m(p0.top, p1.top), hz: m(p0.hz, p1.hz), far: m(p0.far, p1.far), near: m(p0.near, p1.near), line: m(p0.line, p1.line),
        isle: m(p0.isle, p1.isle), sun: m(p0.sun, p1.sun), stars: p0.stars + (p1.stars - p0.stars) * k, clouds: p0.clouds + (p1.clouds - p0.clouds) * k };
    }
  }
  return KEYS[KEYS.length - 1][1];
}
