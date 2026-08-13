import { useEffect, useRef } from "react";

/* ─────────────────────────────────────────────
   StarCanvas — 성능 최적화 버전
   ① 파티클 수: 화면 픽셀 / 7000, 최대 180개
   ② 별 글로우 RadialGradient 제거 → 단순 arc
   ③ mousemove throttle (16ms)
   ④ 슈팅스타 spawn 확률 낮춤 (0.003 → 0.0015)
   ⑤ 탭 비활성화 시 애니메이션 일시정지
   ⑥ passive event listeners
   ───────────────────────────────────────────── */

interface Star {
  x: number;
  y: number;
  z: number;
  size: number;
  opacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
  color: string;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  opacity: number;
  life: number;
  maxLife: number;
}

const STAR_COLORS = ["255,255,255", "200,180,255", "180,220,255", "150,200,255"];

export default function StarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const starsRef = useRef<Star[]>([]);
  const shootingStarsRef = useRef<ShootingStar[]>([]);
  const animFrameRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const lastMouseTimeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initStars();
    };

    const initStars = () => {
      const count = Math.min(
        Math.floor((canvas.width * canvas.height) / 7000),
        180
      );
      starsRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random(),
        size: Math.random() * 1.5 + 0.2,
        opacity: Math.random() * 0.6 + 0.2,
        twinkleSpeed: Math.random() * 0.012 + 0.003,
        twinkleOffset: Math.random() * Math.PI * 2,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      }));
    };

    const spawnShootingStar = () => {
      const angle = (Math.random() * 30 - 15) * (Math.PI / 180);
      const speed = Math.random() * 7 + 5;
      shootingStarsRef.current.push({
        x: Math.random() * canvas.width * 0.7,
        y: Math.random() * canvas.height * 0.4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + 2,
        length: Math.random() * 90 + 50,
        opacity: 0,
        life: 0,
        maxLife: Math.random() * 50 + 35,
      });
    };

    const draw = (time: number) => {
      if (pausedRef.current) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 패럴랙스 강도 줄임 (30 → 12)
      const mx = mouseRef.current.x / canvas.width - 0.5;
      const my = mouseRef.current.y / canvas.height - 0.5;

      // 별 그리기 — RadialGradient 없이 단순 arc만 사용
      starsRef.current.forEach((star) => {
        const sx = star.x + mx * star.z * 12;
        const sy = star.y + my * star.z * 12;
        const twinkle = Math.sin(time * star.twinkleSpeed + star.twinkleOffset);
        const alpha = star.opacity * (0.6 + twinkle * 0.4);
        const size = star.size * (0.85 + twinkle * 0.15);

        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${star.color},${alpha})`;
        ctx.fill();
      });

      // 슈팅스타 그리기
      shootingStarsRef.current = shootingStarsRef.current.filter((ss) => {
        ss.life++;
        ss.x += ss.vx;
        ss.y += ss.vy;
        const progress = ss.life / ss.maxLife;
        ss.opacity =
          progress < 0.2
            ? progress / 0.2
            : progress > 0.7
            ? 1 - (progress - 0.7) / 0.3
            : 1;

        const tailX = ss.x - ss.vx * (ss.length / 10);
        const tailY = ss.y - ss.vy * (ss.length / 10);
        const grad = ctx.createLinearGradient(tailX, tailY, ss.x, ss.y);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(1, `rgba(255,255,255,${ss.opacity})`);
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(ss.x, ss.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        return ss.life < ss.maxLife;
      });

      if (Math.random() < 0.0015) spawnShootingStar();

      animFrameRef.current = requestAnimationFrame(draw);
    };

    // mousemove throttle — 16ms
    const handleMouseMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastMouseTimeRef.current < 16) return;
      lastMouseTimeRef.current = now;
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };

    // 탭 비활성화 시 일시정지
    const handleVisibility = () => {
      pausedRef.current = document.hidden;
    };

    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);

    resize();
    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("visibilitychange", handleVisibility);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="star-canvas"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
