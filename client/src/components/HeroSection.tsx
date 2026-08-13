import { useState, useEffect, useRef } from "react";
import { ChevronDown, Rocket, Zap, Globe } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663330652910/dmGrJ35z4AhFJFQ83XfsdQ/cosmic-hero-DmQ2ymtFBoDSf2b6jYYiS4.webp";

function CounterItem({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !started.current) {
          started.current = true;
          const duration = 2500;
          const startTime = performance.now();
          const update = (ts: number) => {
            const p = Math.min((ts - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 4);
            setCount(Math.floor(value * eased));
            if (p < 1) requestAnimationFrame(update);
          };
          requestAnimationFrame(update);
        }
      },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div ref={ref} className="text-center">
      <div className="flex items-end justify-center gap-0.5 mb-1">
        <span
          className="font-black text-3xl md:text-4xl text-white"
          style={{ fontFamily: "'Space Grotesk', sans-serif", textShadow: "0 0 20px rgba(124,58,237,0.6)" }}
        >
          {count.toLocaleString("ko-KR")}
        </span>
        <span className="font-bold text-base mb-1" style={{ color: "#c4b5fd" }}>
          {suffix}
        </span>
      </div>
      <p className="text-xs text-white/40 font-medium">{label}</p>
    </div>
  );
}

export default function HeroSection() {
  const { lang } = useLang();
  const [visible, setVisible] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let lastT = 0;
    const handleMouse = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastT < 32) return;
      lastT = now;
      setMousePos({
        x: (e.clientX / window.innerWidth - 0.5) * 20,
        y: (e.clientY / window.innerHeight - 0.5) * 20,
      });
    };
    window.addEventListener("mousemove", handleMouse, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouse);
  }, []);

  const scrollToAbout = () => {
    document.getElementById("about")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section
      className="relative min-h-screen flex flex-col justify-center overflow-hidden"
      style={{ background: "var(--cosmos-void)" }}
    >
      {/* Cosmic background image with parallax */}
      <div
        className="absolute inset-0 transition-transform duration-100"
        style={{ transform: `translate(${mousePos.x * 0.3}px, ${mousePos.y * 0.3}px) scale(1.05)` }}
      >
        <img
          src={HERO_BG}
          alt="cosmic background"
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="w-full h-full object-cover opacity-40"
        />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(3,3,10,0.3) 0%, rgba(3,3,10,0.1) 40%, rgba(3,3,10,0.8) 80%, rgba(3,3,10,1) 100%)" }}
        />
      </div>

      {/* Nebula orbs */}
      <div
        className="cosmic-orb animate-nebula-drift"
        style={{ width: "600px", height: "600px", background: "radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 70%)", top: "-100px", left: "-100px", willChange: "transform" }}
      />
      <div
        className="cosmic-orb"
        style={{ width: "400px", height: "400px", background: "radial-gradient(circle, rgba(6,182,212,0.1) 0%, transparent 70%)", bottom: "100px", right: "-50px", animation: "nebula-drift 25s ease-in-out infinite reverse" }}
      />

      {/* Cosmic grid */}
      <div
        className="absolute inset-0 cosmic-grid opacity-30"
        style={{ transform: `translate(${mousePos.x * 0.1}px, ${mousePos.y * 0.1}px)` }}
      />

      {/* Content */}
      <div className="container relative z-10 pt-28 pb-20">
        <div className="max-w-4xl">
          {/* Badges */}
          <div className={`flex items-center gap-3 mb-6 flex-wrap transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            <div
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold"
              style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", color: "#c4b5fd", letterSpacing: "0.15em" }}
            >
              <Rocket size={11} />
              BRAND SALES BUILDER
            </div>
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold"
              style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(105,201,208,0.4)", color: "#69C9D0", boxShadow: "0 0 12px rgba(105,201,208,0.15)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.79a4.85 4.85 0 01-1.07-.1z" fill="#69C9D0"/>
              </svg>
              {t("hero", "badge1", lang)}
            </div>
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold"
              style={{ background: "rgba(103,232,249,0.08)", border: "1px solid rgba(103,232,249,0.3)", color: "#67e8f9" }}
            >
              {t("hero", "badge2", lang)}
            </div>
          </div>

          {/* Headline */}
          <h1
            className={`font-black text-5xl md:text-7xl lg:text-8xl text-white mb-6 transition-all duration-700 delay-100 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
            style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.04em", lineHeight: "1.0" }}
          >
            {t("hero", "headline1", lang)}
            <br />
            <span
              style={{ background: "linear-gradient(135deg, #c4b5fd 0%, #818cf8 40%, #67e8f9 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}
            >
              {t("hero", "headline2", lang)}
            </span>
          </h1>

          {/* Sub */}
          <p className={`text-base md:text-lg text-white/50 max-w-xl mb-10 leading-relaxed transition-all duration-700 delay-200 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            {t("hero", "sub", lang).split("\n").map((line, i) => (
              <span key={i}>{line}{i === 0 && <br />}</span>
            ))}
          </p>

          {/* CTAs */}
          <div className={`flex flex-wrap gap-3 mb-16 transition-all duration-700 delay-300 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            <button
              onClick={() => document.getElementById("solutions")?.scrollIntoView({ behavior: "smooth" })}
              className="btn-cosmic-primary flex items-center gap-2"
            >
              <Zap size={15} />
              {t("hero", "cta1", lang)}
            </button>
            <button
              onClick={() => document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" })}
              className="btn-cosmic-outline flex items-center gap-2"
            >
              <Globe size={15} />
              {t("hero", "cta2", lang)}
            </button>
          </div>

          {/* Stats */}
          <div className={`grid grid-cols-2 md:grid-cols-4 gap-6 transition-all duration-700 delay-400 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            <div className="py-4 px-2 border-l" style={{ borderColor: "rgba(103,232,249,0.4)" }}>
              <CounterItem value={170} suffix={t("hero", "stat1Suffix", lang)} label={t("hero", "stat1Label", lang)} />
            </div>
            <div className="py-4 px-2 border-l" style={{ borderColor: "rgba(124,58,237,0.3)" }}>
              <CounterItem value={860} suffix={t("hero", "stat2Suffix", lang)} label={t("hero", "stat2Label", lang)} />
            </div>
            <div className="py-4 px-2 border-l" style={{ borderColor: "rgba(124,58,237,0.3)" }}>
              <CounterItem value={50} suffix={t("hero", "stat3Suffix", lang)} label={t("hero", "stat3Label", lang)} />
            </div>
            <div className="py-4 px-2 border-l" style={{ borderColor: "rgba(105,201,208,0.3)" }}>
              <CounterItem value={6} suffix={t("hero", "stat4Suffix", lang)} label={t("hero", "stat4Label", lang)} />
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <button
        onClick={scrollToAbout}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/30 hover:text-white/60 transition-colors animate-bounce"
      >
        <span className="text-xs tracking-widest" style={{ letterSpacing: "0.2em" }}>SCROLL</span>
        <ChevronDown size={18} />
      </button>
    </section>
  );
}
