// Проверки чистых функций сайта (npm test). Сценарии в браузере — отдельно (Playwright).
import { describe, expect, it } from 'vitest';
import { coord, km, pct, plural, shortHash } from './format';
import { areaOf, distanceKm, esc, isCompact, pad, sectorCenter } from './geo';
import type { Sector } from './types';

const sectors: Sector[] = [
  { n: 1, south: 45.6, west: 47.6, north: 45.8, east: 47.9 },
  { n: 2, south: 45.4, west: 47.9, north: 45.6, east: 48.2 },
];

describe('форматы', () => {
  it('километры, проценты, координаты — по-русски', () => {
    expect(km(3.456)).toBe('3,5 км');
    expect(pct(0.913)).toBe('91 %');
    expect(coord(45.81234, 47.91234)).toBe('45.8123° N 47.9123° E');
    expect(shortHash('a'.repeat(30) + 'beef')).toBe('aaaa…beef');
  });
  it('склонение числительных (с неразрывным пробелом)', () => {
    const w: [string, string, string] = ['буй', 'буя', 'буёв'];
    expect(plural(1, w)).toBe('1\u00a0буй');
    expect(plural(3, w)).toBe('3\u00a0буя');
    expect(plural(11, w)).toBe('11\u00a0буёв');
    expect(plural(21, w)).toBe('21\u00a0буй');
  });
});

describe('география', () => {
  it('район — рамка вокруг всех секторов, запас расширяет её', () => {
    const a = areaOf(sectors);
    expect(a).toEqual([[45.4, 47.6], [45.8, 48.2]]);
    const [[s, w], [n, e]] = pad(a, 0.5);
    expect(s).toBeLessThan(45.4); expect(n).toBeGreaterThan(45.8);
    expect(w).toBeLessThan(47.6); expect(e).toBeGreaterThan(48.2);
    expect(sectorCenter(sectors[0])).toEqual([45.7, 47.75]);
  });
  it('расстояние по сфере', () => {
    expect(distanceKm([45.7, 47.75], [45.7, 47.75])).toBe(0);
    const d = distanceKm([45.7, 47.75], [45.8, 47.75]);      // 0,1° широты ≈ 11,1 км
    expect(d).toBeGreaterThan(11); expect(d).toBeLessThan(11.2);
  });
  it('подписи прячутся на узком экране и общем плане', () => {
    expect(isCompact(400, 10)).toBe(true);
    expect(isCompact(400, 12)).toBe(false);
    expect(isCompact(1200, 10)).toBe(false);
  });
  it('имя буя в HTML экранируется', () => {
    expect(esc('<img src=x onerror=alert(1)>&"')).not.toMatch(/[<>"]/);
  });
});
