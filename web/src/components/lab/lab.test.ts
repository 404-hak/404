// Слух буя: что показывает слушатель в данную секунду и как подписаны решения уха буя (npm test).
import { describe, expect, it } from 'vitest';
import type { LabClip, LabResult } from '../../lab';
import { nowAt } from './player';
import { earChip } from './Timeline';

const clip = (i: number, over: Partial<LabClip> = {}): LabClip => ({
  i, start: (i - 1) * 4, end: i * 4, event: 'background', confidence: 0.9, probs: { background: 0.9, motor: 0.05, shot: 0.03, voice: 0.02 },
  activity: 0.5, alert: null, alert_confidence: null, note: 'фон: угроз нет', baseline: null, quiet: 0, ...over,
});
const point = (t: number, motor: number, novelty = 0.2) => ({ t, start: t - 2, activity: 0.5, novelty, background: 1 - motor, motor, shot: 0, voice: 0 });

const r: Pick<LabResult, 'timeline' | 'classes' | 'clips'> = {
  classes: ['background', 'motor', 'shot', 'voice'],
  timeline: [point(2, 0.1), point(4, 0.6), point(6, 0.97, 1.4)],
  clips: [clip(1), clip(2, { event: 'motor', note: 'мотор (0.97) — жду подтверждения следующим клипом' })],
};

describe('слушатель: что сеть слышит сейчас', () => {
  it('берёт ближайшее окно и клип, в который попала секунда', () => {
    expect(nowAt(r, 1.2)).toMatchObject({ ev: 'background', clip: { i: 1 }, unfamiliar: false });
    const n = nowAt(r, 6.3);
    expect(n.ev).toBe('motor');
    expect(n.p).toBeCloseTo(0.97);
    expect(n.clip.i).toBe(2);
    expect(n.unfamiliar).toBe(true);
  });
  it('после конца записи — последний клип', () => {
    expect(nowAt(r, 99).clip.i).toBe(2);
  });
});

describe('решения уха буя', () => {
  it('подписи: полная и короткая для телефона', () => {
    expect(earChip(r.clips[1])).toMatchObject({ text: 'мотор? ждём 2-й клип', short: 'ждём 2-й' });
    expect(earChip(clip(3, { alert: 'motor' })).short).toBe('тревога');
    expect(earChip(clip(4, { event: 'voice' })).text).toBe('голоса · не тревога');
    expect(earChip(clip(5, { note: 'похоже на мотор (0.99), но звук непривычный для сети' })).short).toBe('непривычно');
    expect(earChip(clip(6)).text).toBe('фон');
  });
});
