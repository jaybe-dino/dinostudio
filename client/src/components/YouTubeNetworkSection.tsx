import { useEffect, useRef, useState } from "react";
import { Play, TrendingUp } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

const agencies = [
  "씨드비", "아이닉", "클룹", "이지듀", "동국제약", "셀트리온",
  "LG생활건강", "아모레퍼시픽", "CJ제일제당", "롯데웰푸드",
  "오뚜기", "빙그레", "삼성전자", "쿠쿠", "위닉스",
  "다이슨", "샤오미", "에어팟", "발뮤다", "드롱기",
];

export default function YouTubeNetworkSection() {
  const { lang } = useLang();
  const sectionRef = useRef<HTMLElement>(null);
  const [hoveredCat, setHoveredCat] = useState<number | null>(null);
  const [animCount, setAnimCount] = useState(0);
  const countStarted = useRef(false);

  const categories = [
    { nameKey: "cat1", count: 42, color: "#f472b6", icon: "✨" },
    { nameKey: "cat2", count: 31, color: "#34d399", icon: "💊" },
    { nameKey: "cat3", count: 28, color: "#fbbf24", icon: "🍱" },
    { nameKey: "cat4", count: 24, color: "#67e8f9", icon: "🏠" },
    { nameKey: "cat5", count: 21, color: "#c4b5fd", icon: "👗" },
    { nameKey: "cat6", count: 14, color: "#fb923c", icon: "🐾" },
    { nameKey: "cat7", count: 10, color: "#94a3b8", icon: "📦" },
  ];

  const tiers = [
    { tierKey: "size1", descKey: "size1Sub", count: 3, color: "#fbbf24" },
    { tierKey: "size2", descKey: "size2Sub", count: 18, color: "#c4b5fd" },
    { tierKey: "size3", descKey: "size3Sub", count: 67, color: "#67e8f9" },
    { tierKey: "size4", descKey: "size4Sub", count: 82, color: "#34d399" },
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            if (!countStarted.current) {
              countStarted.current = true;
              const duration = 2000;
              const start = performance.now();
              const animate = (now: number) => {
                const p = Math.min((now - start) / duration, 1);
                const eased = 1 - Math.pow(1 - p, 3);
                setAnimCount(Math.floor(170 * eased));
                if (p < 1) requestAnimationFrame(animate);
              };
              requestAnimationFrame(animate);
            }
          }
        });
      },
      { threshold: 0.1 }
    );
    sectionRef.current?.querySelectorAll(".reveal, .reveal-scale").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const total = categories.reduce((s, c) => s + c.count, 0);

  return (
    <section
      id="youtube-network"
      ref={sectionRef}
      className="py-20 md:py-28 relative overflow-hidden"
      style={{
        background: "linear-gradient(180deg, var(--cosmos-void) 0%, rgba(10,5,25,1) 50%, var(--cosmos-void) 100%)",
      }}
    >
      <div
        className="cosmic-orb"
        style={{
          width: "600px",
          height: "600px",
          background: "radial-gradient(circle, rgba(255,0,0,0.06) 0%, transparent 70%)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />

      <div className="container relative z-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-14">
          <div>
            <div className="flex items-center gap-3 mb-5 reveal">
              <div
                className="flex items-center gap-2.5 px-4 py-2"
                style={{
                  background: "rgba(0,0,0,0.8)",
                  border: "1px solid rgba(255,0,0,0.3)",
                  boxShadow: "0 0 20px rgba(255,0,0,0.1)",
                }}
              >
                <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
                  <rect width="20" height="14" rx="3" fill="#FF0000" />
                  <path d="M8 4L14 7L8 10V4Z" fill="white" />
                </svg>
                <span
                  className="font-black text-sm tracking-wide text-white"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  {t("youtube", "sectionLabel", lang)}
                </span>
              </div>
              <div
                className="text-xs font-bold px-3 py-1.5"
                style={{
                  background: "rgba(255,0,0,0.08)",
                  border: "1px solid rgba(255,0,0,0.2)",
                  color: "rgba(255,120,120,0.8)",
                  letterSpacing: "0.15em",
                }}
              >
                {t("youtube", "sectionSub", lang)}
              </div>
            </div>

            <h2
              className="font-black text-4xl md:text-5xl lg:text-6xl text-white mb-4 reveal"
              style={{
                fontFamily: "'Space Grotesk', 'Pretendard', sans-serif",
                letterSpacing: "-0.04em",
                lineHeight: "1.0",
              }}
            >
              <span
                style={{
                  background: "linear-gradient(135deg, #ff6b6b 0%, #ff0000 40%, #c4b5fd 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {animCount}{t("youtube", "stat1", lang)}
              </span>
              <br />
              {t("youtube", "headline", lang)}
            </h2>
            <p className="text-white/45 text-base max-w-lg leading-relaxed reveal">
              {t("youtube", "desc", lang)}
            </p>
          </div>

          {/* Big stat */}
          <div
            className="flex-shrink-0 text-center px-10 py-8 reveal-scale"
            style={{
              background: "rgba(255,0,0,0.04)",
              border: "1px solid rgba(255,0,0,0.15)",
              boxShadow: "0 0 40px rgba(255,0,0,0.05)",
            }}
          >
            <div
              className="font-black text-6xl md:text-7xl mb-2"
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                background: "linear-gradient(135deg, #ff6b6b, #ff0000)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                textShadow: "none",
              }}
            >
              170
            </div>
            <div className="text-sm font-bold text-white/60">{t("youtube", "stat1", lang)}</div>
            <div className="text-xs text-white/30 mt-1">{t("youtube", "stat1Sub", lang)}</div>
          </div>
        </div>

        {/* Category breakdown + tier */}
        <div className="grid lg:grid-cols-2 gap-8 mb-12">
          {/* Category bars */}
          <div className="reveal">
            <div className="text-xs font-bold text-white/25 uppercase tracking-widest mb-5">
              {t("youtube", "catTitle", lang)}
            </div>
            <div className="space-y-3">
              {categories.map((cat, i) => {
                const pct = (cat.count / total) * 100;
                const isHovered = hoveredCat === i;
                return (
                  <div
                    key={cat.nameKey}
                    className="group cursor-default"
                    onMouseEnter={() => setHoveredCat(i)}
                    onMouseLeave={() => setHoveredCat(null)}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{cat.icon}</span>
                        <span
                          className="text-sm font-medium transition-colors"
                          style={{ color: isHovered ? cat.color : "rgba(255,255,255,0.6)" }}
                        >
                          {t("youtube", cat.nameKey, lang)}
                        </span>
                      </div>
                      <span
                        className="text-xs font-bold transition-colors"
                        style={{ color: isHovered ? cat.color : "rgba(255,255,255,0.35)" }}
                      >
                        {cat.count}{lang === "ko" ? "개" : ""}
                      </span>
                    </div>
                    <div
                      className="h-1.5 w-full overflow-hidden"
                      style={{ background: "rgba(255,255,255,0.06)" }}
                    >
                      <div
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          background: isHovered
                            ? `linear-gradient(90deg, ${cat.color}, ${cat.color}aa)`
                            : `linear-gradient(90deg, ${cat.color}80, ${cat.color}40)`,
                          boxShadow: isHovered ? `0 0 8px ${cat.color}60` : "none",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tier breakdown */}
          <div className="reveal">
            <div className="text-xs font-bold text-white/25 uppercase tracking-widest mb-5">
              {t("youtube", "sizeTitle", lang)}
            </div>
            <div className="space-y-3">
              {tiers.map((tier, i) => (
                <div
                  key={tier.tierKey}
                  className="flex items-center gap-4 p-4 group transition-all duration-300 reveal-scale"
                  style={{
                    background: `${tier.color}06`,
                    border: `1px solid ${tier.color}15`,
                    transitionDelay: `${i * 80}ms`,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = `${tier.color}12`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${tier.color}35`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = `${tier.color}06`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${tier.color}15`;
                  }}
                >
                  <div
                    className="flex-shrink-0 w-10 h-10 flex items-center justify-center font-black text-lg"
                    style={{
                      background: `${tier.color}15`,
                      border: `1px solid ${tier.color}30`,
                      color: tier.color,
                      fontFamily: "'Space Grotesk', sans-serif",
                    }}
                  >
                    {tier.count}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white">{t("youtube", tier.tierKey, lang)}</div>
                    <div className="text-xs text-white/35">{t("youtube", tier.descKey, lang)}</div>
                  </div>
                  <TrendingUp size={14} style={{ color: tier.color, opacity: 0.6 }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Partner brand ticker */}
        <div className="reveal">
          <div className="text-xs font-bold text-white/25 uppercase tracking-widest mb-4">
            {t("youtube", "partnerTitle", lang)}
          </div>
          <div
            className="relative overflow-hidden py-4"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
          >
            <div
              className="flex gap-6 whitespace-nowrap"
              style={{ animation: "marquee 20s linear infinite" }}
            >
              {[...agencies, ...agencies].map((brand, i) => (
                <span
                  key={i}
                  className="text-sm font-medium px-4 py-1.5 flex-shrink-0"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.45)",
                  }}
                >
                  {brand}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-between gap-5 reveal">
          <p className="text-white/40 text-sm">
            {lang === "ko"
              ? "브랜드에 최적화된 채널 매칭 및 캠페인 기획 상담을 제공합니다."
              : "We provide brand-optimized channel matching and campaign planning consultations."}
          </p>
          <button
            onClick={() => document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" })}
            className="flex items-center gap-2 px-6 py-3 text-sm font-bold transition-all duration-200"
            style={{
              background: "rgba(255,0,0,0.12)",
              border: "1px solid rgba(255,0,0,0.3)",
              color: "#ff6b6b",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,0,0,0.2)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,0,0,0.5)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,0,0,0.12)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,0,0,0.3)";
            }}
          >
            <Play size={14} />
            {t("youtube", "cta", lang)}
          </button>
        </div>
      </div>
    </section>
  );
}
