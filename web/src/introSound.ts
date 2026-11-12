/** Звуки интро — море, бульк поплавка, пузыри, сигнал буя (Web Audio, без аудиофайлов).
 *  Общий выключатель звука — в sound.ts: при выключенном звуке интро идёт без него. */
export class SeaSound {
  private ctx: AudioContext;
  private master: GainNode;
  private waves: AudioBufferSourceNode | null = null;

  constructor() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
  }

  get running() {
    return this.ctx.state === 'running';
  }

  /** Попытка включить звук. Без клика браузер может не разрешить — тогда false, ждём касания. */
  async resume(waitMs = 300): Promise<boolean> {
    if (this.running) return true;
    try {
      await Promise.race([this.ctx.resume(), new Promise((r) => window.setTimeout(r, waitMs))]);
    } catch { /* не разрешили */ }
    return this.running;
  }

  /** Момент «сейчас» по часам звука + смещение в секундах */
  at(offset: number) {
    return this.ctx.currentTime + offset;
  }

  private noise(seconds: number, brown = false) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = white;
    }
    return buf;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(t: number, f0: number, f1: number, sweep: number, peak: number, decay: number, type: OscillatorType = 'sine') {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
    this.env(g, t, peak, 0.006, decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  private hiss(t: number, freq: number, q: number, peak: number, decay: number, toFreq?: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise(decay + 0.1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq, t);
    if (toFreq) bp.frequency.exponentialRampToValueAtTime(toFreq, t + decay);
    bp.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.01, decay);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + decay + 0.1);
  }

  /** Шум волн: коричневый шум через фильтр, медленно «дышит» */
  startWaves() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise(4, true);
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, this.ctx.currentTime + 1.5);
    const lfo = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    lfo.frequency.value = 0.16;
    depth.gain.value = 0.07;
    lfo.connect(depth).connect(g.gain);
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.waves = src;
  }

  /** Свист падения */
  whoosh(t: number, dur: number) {
    this.hiss(t, 2400, 1.2, 0.05, dur, 500);
  }

  /** «Бульк»: шлепок о воду, глухой удар, всплеск и второй, тише — вода смыкается */
  plop(t: number) {
    this.tone(t, 720, 140, 0.13, 0.55, 0.28);
    this.tone(t, 95, 60, 0.12, 0.5, 0.2);
    this.hiss(t, 1800, 0.7, 0.32, 0.5);
    this.tone(t + 0.13, 520, 190, 0.1, 0.25, 0.2);
  }

  /** Пузырь: короткий тон с растущей высотой — так звучит лопающийся пузырь */
  bubble(t: number, f: number) {
    this.tone(t, f, f * 1.8, 0.05, 0.13, 0.09);
  }

  /** Сигнал буя */
  ping(t: number) {
    this.tone(t, 1320, 1300, 0.6, 0.12, 1.2);
    this.tone(t + 0.28, 1320, 1300, 0.6, 0.05, 1.0);
  }

  fadeOut(seconds: number) {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    window.setTimeout(() => {
      this.waves?.stop();
      void this.ctx.close();
    }, seconds * 1000 + 100);
  }
}
