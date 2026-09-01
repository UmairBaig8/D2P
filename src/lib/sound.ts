// Synthesized auction sounds via Web Audio (no assets needed).
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    const resume = () => { if (ctx && ctx.state === 'suspended') void ctx.resume(); };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function knock(at: number, volume: number): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + at;

  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(240, t0);
  osc.frequency.exponentialRampToValueAtTime(85, t0 + 0.12);
  g.gain.setValueAtTime(volume, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.18);

  const dur = 0.035;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2600;
  bp.Q.value = 0.9;
  const ng = c.createGain();
  ng.gain.setValueAtTime(volume * 0.5, t0);
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(bp).connect(ng).connect(c.destination);
  src.start(t0);
}

function tone(at: number, fromHz: number, toHz: number, duration: number, volume: number): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(fromHz, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(toHz, 1), t0 + duration);
  g.gain.setValueAtTime(volume, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export function playGavel(): void {
  try {
    knock(0, 0.9);
    knock(0.17, 0.75);
  } catch {
    /* audio unavailable */
  }
}

export function playBuzz(): void {
  try {
    tone(0, 340, 160, 0.35, 0.5);
    tone(0.36, 220, 120, 0.3, 0.4);
  } catch {
    /* audio unavailable */
  }
}
