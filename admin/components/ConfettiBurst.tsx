import { useEffect, useRef } from 'react';

/**
 * A burst of confetti over the page each time `fire` changes — for a booking,
 * a new client, a target reached. Drawn on one canvas for three seconds and
 * gone; nothing to click, nothing left behind. Skipped for someone whose system
 * asks for reduced motion.
 */
const COLORS = ['#f59e0b', '#10b981', '#6366f1', '#ef4444', '#ec4899', '#22d3ee', '#facc15'];

export function ConfettiBurst({ fire, pieces = 160 }: { fire: number; pieces?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!fire) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);

    const particles = Array.from({ length: pieces }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 160,
      y: window.innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 13 - 4,
      size: 6 + Math.random() * 6,
      spin: Math.random() * Math.PI,
      spinSpeed: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    let frame = 0;
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of particles) {
        p.vy += 0.32;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.spinSpeed;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - frame / 190);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      frame += 1;
      if (frame < 190) raf = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [fire, pieces]);

  return <canvas ref={canvasRef} aria-hidden="true" className="fixed inset-0 w-screen h-screen pointer-events-none z-[120]" />;
}
