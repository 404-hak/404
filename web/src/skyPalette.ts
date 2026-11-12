/** Палитра неба и моря по высоте солнца — общая для фона и интро. Спокойные, приглушённые тона. */
export type V3 = [number, number, number];
export const hex = (h: string): V3 => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as V3;

/**
 * Небо и море по времени суток — ключевые кадры по высоте солнца (градусы).
 * Спокойно и плавно: между ключевыми кадрами цвета перетекают.
 */
export interface Pal { top: V3; hz: V3; far: V3; near: V3; line: V3; isle: V3; sun: V3; stars: number; clouds: number }
const P = (top: string, hz: string, far: string, near: string, line: string, isle: string, sun: string, stars: number, clouds: number): Pal =>
  ({ top: hex(top), hz: hex(hz), far: hex(far), near: hex(near), line: hex(line), isle: hex(isle), sun: hex(sun), stars, clouds });
const KEYS: [number, Pal][] = [
  [-18, P('#070F22', '#1B2B4A', '#18294A', '#060E1E', '#7F95BD', '#0A1426', '#FFE2B0', 1, 0.25)],      // ночь
  [-8, P('#141D40', '#3B4470', '#2D3661', '#0B1430', '#A7A8D2', '#111632', '#FFD3A0', 0.55, 0.35)],    // синий час
  [-2, P('#263465', '#BF8678', '#8E6C7C', '#172447', '#EBC3B0', '#262236', '#FFB98A', 0.12, 0.55)],    // рассвет / закат
  [5, P('#4C71AC', '#E2BE98', '#BFA28D', '#26497A', '#FCE6CC', '#47473F', '#FFE0A6', 0, 0.6)],          // золотой час
  [15, P('#477CB9', '#B6D3E4', '#8FB6CE', '#2A5C8E', '#F2F8FD', '#587563', '#FFF3D8', 0, 0.55)],        // утро
  [30, P('#3D74B5', '#C0D9E7', '#86B0CA', '#235585', '#F4F9FD', '#5F7C67', '#FFF8E8', 0, 0.5)],         // день
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
