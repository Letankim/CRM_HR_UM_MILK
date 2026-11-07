'use client';

import { useEffect, useRef } from 'react';
import { TrophyOutlined } from '@ant-design/icons';

interface FireworksCanvasOverlayProps {
  active: boolean;
  durationMs?: number;
  label?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  color: string;
  radius: number;
}

const PALETTE = ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2'];

/**
 * Hiệu ứng Pháo hoa Canvas 2D chúc mừng khi ứng viên đạt điểm tuyệt đối 13/13 trong kỳ phỏng vấn.
 */
export function FireworksCanvasOverlay({
  active,
  durationMs = 2400,
  label = 'ĐẠT ĐIỂM TUYỆT ĐỐI 13/13 — ỨNG VIÊN XUẤT SẮC',
}: FireworksCanvasOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: Particle[] = [];
    const spawnBurst = (cx: number, cy: number) => {
      for (let i = 0; i < 42; i++) {
        const angle = (Math.PI * 2 * i) / 42 + (Math.random() - 0.5) * 0.12;
        const speed = 2.2 + Math.random() * 4.8;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          color: PALETTE[i % PALETTE.length]!,
          radius: 2 + Math.random() * 2,
        });
      }
    };

    spawnBurst(canvas.width * 0.3, canvas.height * 0.32);
    spawnBurst(canvas.width * 0.7, canvas.height * 0.32);
    spawnBurst(canvas.width * 0.5, canvas.height * 0.24);

    const burstTimer = window.setInterval(() => {
      spawnBurst(
        canvas.width * (0.2 + Math.random() * 0.6),
        canvas.height * (0.18 + Math.random() * 0.35),
      );
    }, 650);

    let rafId = 0;
    const startMs = performance.now();

    const render = (now: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.06;
        p.vx *= 0.985;
        p.alpha -= 0.014;
        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (now - startMs < durationMs || particles.length > 0) {
        rafId = window.requestAnimationFrame(render);
      }
    };

    rafId = window.requestAnimationFrame(render);
    const stopTimer = window.setTimeout(() => window.clearInterval(burstTimer), Math.max(800, durationMs - 900));

    return () => {
      window.removeEventListener('resize', resize);
      window.clearInterval(burstTimer);
      window.clearTimeout(stopTimer);
      window.cancelAnimationFrame(rafId);
    };
  }, [active, durationMs]);

  if (!active) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2500 }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#0F172A',
          color: '#FFFFFF',
          border: '1px solid #2563EB',
          borderRadius: 4,
          padding: '8px 16px',
          fontWeight: 600,
          fontSize: 13,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <TrophyOutlined style={{ color: '#F59E0B' }} />
        <span>{label}</span>
      </div>
    </div>
  );
}
