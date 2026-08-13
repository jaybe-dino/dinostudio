import { useEffect, useRef } from "react";

/* ═══════════════════════════════════════════════════════════════════
   DINOSTUDIO — Cosmic Cursor Effect
   Custom cursor with trailing nebula particles
   ═══════════════════════════════════════════════════════════════════ */

export default function CosmicCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const trailPos = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    // Only on desktop
    if (window.innerWidth < 1024) return;

    const cursor = cursorRef.current;
    const trail = trailRef.current;
    if (!cursor || !trail) return;

    const onMove = (e: MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
      cursor.style.transform = `translate(${e.clientX - 6}px, ${e.clientY - 6}px)`;
    };

    const onEnterLink = () => {
      cursor.style.width = "32px";
      cursor.style.height = "32px";
      cursor.style.opacity = "0.8";
      cursor.style.background = "rgba(124,58,237,0.3)";
      cursor.style.border = "1px solid rgba(196,181,253,0.6)";
    };

    const onLeaveLink = () => {
      cursor.style.width = "12px";
      cursor.style.height = "12px";
      cursor.style.opacity = "0.6";
      cursor.style.background = "rgba(124,58,237,0.6)";
      cursor.style.border = "1px solid rgba(196,181,253,0.4)";
    };

    const animate = () => {
      trailPos.current.x += (pos.current.x - trailPos.current.x) * 0.12;
      trailPos.current.y += (pos.current.y - trailPos.current.y) * 0.12;
      trail.style.transform = `translate(${trailPos.current.x - 20}px, ${trailPos.current.y - 20}px)`;
      rafRef.current = requestAnimationFrame(animate);
    };

    document.addEventListener("mousemove", onMove);

    const links = document.querySelectorAll("a, button");
    links.forEach((el) => {
      el.addEventListener("mouseenter", onEnterLink);
      el.addEventListener("mouseleave", onLeaveLink);
    });

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      document.removeEventListener("mousemove", onMove);
      links.forEach((el) => {
        el.removeEventListener("mouseenter", onEnterLink);
        el.removeEventListener("mouseleave", onLeaveLink);
      });
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      {/* Main cursor dot */}
      <div
        ref={cursorRef}
        className="fixed pointer-events-none z-[9999] hidden lg:block"
        style={{
          width: "12px",
          height: "12px",
          borderRadius: "50%",
          background: "rgba(124,58,237,0.6)",
          border: "1px solid rgba(196,181,253,0.4)",
          boxShadow: "0 0 8px rgba(124,58,237,0.5)",
          transition: "width 0.2s, height 0.2s, opacity 0.2s, background 0.2s",
          opacity: 0.6,
          mixBlendMode: "screen",
        }}
      />
      {/* Trail ring */}
      <div
        ref={trailRef}
        className="fixed pointer-events-none z-[9998] hidden lg:block"
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          border: "1px solid rgba(196,181,253,0.15)",
          boxShadow: "0 0 20px rgba(124,58,237,0.08)",
          mixBlendMode: "screen",
        }}
      />
    </>
  );
}
