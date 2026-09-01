import { useEffect, useRef } from 'react';

const COLORS = ['#ffd75e', '#ff6e40', '#ff4b6e', '#873cff', '#24c4d6', '#16c79a', '#ffffff'];

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
  shape: 'rect' | 'circle';
};

export default function Confetti({ duration = 3000 }: { duration?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement ?? document.body;
    const W = parent.clientWidth || window.innerWidth;
    const H = parent.clientHeight || window.innerHeight;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pieces: Piece[] = Array.from({ length: 170 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * 80,
      y: H * 0.42,
      vx: (Math.random() - 0.5) * 16,
      vy: -(Math.random() * 10 + 5),
      g: 0.34,
      w: Math.random() * 8 + 4,
      h: Math.random() * 10 + 5,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.38,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: Math.random() < 0.6 ? 'rect' : 'circle',
    }));

    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const elapsed = t - start;
      ctx.clearRect(0, 0, W, H);
      if (elapsed > duration) return;
      const fade = elapsed > duration - 700 ? Math.max(0, 1 - (elapsed - (duration - 700)) / 700) : 1;
      ctx.globalAlpha = fade;
      for (const p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.g;
        p.rot += p.vr;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  return <canvas ref={ref} className="auction-confetti" aria-hidden="true" />;
}
