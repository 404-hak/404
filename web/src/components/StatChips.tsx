import type { State } from '../types';
import { pct } from '../format';

const Chip = ({ label, value, tone = '', wide = false }: { label: string; value: string; tone?: string; wide?: boolean }) => (
  <div className={`${wide ? 'hidden sm:block ' : ''}rounded-[9px] border border-line bg-surface/90 px-2.5 py-1.5 backdrop-blur`}>
    <div className="font-mono text-[9px] tracking-[.06em] text-muted">{label}</div>
    <div className={`font-mono text-[14px] font-medium ${tone}`}>{value}</div>
  </div>
);

export default function StatChips({ state }: { state: State }) {
  const f = state.forecast;
  const health = state.buoys.reduce((s, b) => s + b.health, 0) / state.buoys.length;
  const online = state.buoys.filter((b) => b.status !== 'offline').length;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-wrap gap-2">
      <Chip label="РИСК НОЧИ" value={pct(f.risk)} tone={f.level === 'low' ? 'text-accent' : 'text-warn'} />
      <Chip label="ВОДА" value={`${f.water_temp > 0 ? '+' : ''}${Math.round(f.water_temp)}°`} />
      <Chip label="ЛУНА" value={pct(f.moon_illumination)} />
      <Chip label="ЗДОРОВЬЕ" value={pct(health)} wide />
      <Chip label="БУИ НА СВЯЗИ" value={`${online}/${state.buoys.length}`} wide />
    </div>
  );
}
