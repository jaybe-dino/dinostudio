import { useEffect, useRef } from "react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

const partners = [
  "현대백화점", "쿠팡", "CJ온스타일", "GS홈쇼핑", "롯데홈쇼핑",
  "네이버쇼핑", "카카오커머스", "11번가", "이지듀", "동국제약",
  "씨드비", "아이닉", "클룹", "CNT Tech", "원데이흑염소",
  "닥터지", "라운드랩", "메디힐", "마녀공장", "에스트라",
];

export default function ResultsSection() {
  const { lang } = useLang();
  const sectionRef = useRef<HTMLElement>(null);

  const highlights = [
    { val: "860개+", labelKey: "highlight1Label", color: "#c4b5fd" },
    { val: "7년+", labelKey: "highlight2Label", color: "#fbbf24" },
    { val: "170개", labelKey: "highlight3Label", color: "#34d399" },
    { val: "6개국", labelKey: "highlight4Label", color: "#67e8f9" },
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("visible")),
      { threshold: 0.08 }
    );
    sectionRef.current?.querySelectorAll(".reveal, .reveal-scale").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="results"
      ref={sectionRef}
      className="py-20 md:py-28 relative overflow-hidden"
      style={{ background: "var(--cosmos-void)" }}
    >
      <div
        className="cosmic-orb"
        style={{
          width: "400px",
          height: "400px",
          background: "radial-gradient(circle, rgba(6,182,212,0.07) 0%, transparent 70%)",
          top: "20%",
          left: "-100px",
        }}
      />

      <div className="container">
        {/* Header */}
        <div className="mb-12 reveal">
          <div className="cosmic-label-cyan mb-5">Partners</div>
          <h2
            className="font-black text-4xl md:text-5xl text-white mb-4"
            style={{
              fontFamily: "'Space Grotesk', 'Pretendard', sans-serif",
              letterSpacing: "-0.04em",
              lineHeight: "1.05",
            }}
          >
            {t("results", "headline1", lang)}
            <br />
            <span
              style={{
                background: "linear-gradient(135deg, #67e8f9, #06b6d4)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {t("results", "headline2", lang)}
            </span>
          </h2>
          <p className="text-white/40 text-sm max-w-lg">
            {t("results", "desc", lang)}
          </p>
        </div>

        {/* Highlight stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-14 reveal">
          {highlights.map((h) => (
            <div
              key={h.labelKey}
              className="cosmic-card p-5 text-center group transition-all duration-300"
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
                (e.currentTarget as HTMLElement).style.boxShadow = `0 12px 40px ${h.color}20`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                (e.currentTarget as HTMLElement).style.boxShadow = "";
              }}
            >
              <div
                className="font-black text-3xl mb-1"
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  color: h.color,
                  textShadow: `0 0 20px ${h.color}50`,
                }}
              >
                {h.val}
              </div>
              <div className="text-xs text-white/50 font-medium">{t("results", h.labelKey, lang)}</div>
            </div>
          ))}
        </div>

        {/* Partner marquee */}
        <div className="reveal">
          <div className="text-xs font-bold text-white/20 uppercase tracking-widest mb-5">
            {t("results", "partnerTitle", lang)}
          </div>
          {/* Marquee row 1 */}
          <div className="overflow-hidden mb-3">
            <div
              className="flex gap-3 whitespace-nowrap"
              style={{ animation: "marquee 25s linear infinite" }}
            >
              {[...partners, ...partners].map((p, i) => (
                <span
                  key={i}
                  className="inline-flex items-center text-xs font-medium px-4 py-2 text-white/50 flex-shrink-0 transition-colors hover:text-white/80"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
          {/* Marquee row 2 (reverse) */}
          <div className="overflow-hidden">
            <div
              className="flex gap-3 whitespace-nowrap"
              style={{ animation: "marquee-reverse 30s linear infinite" }}
            >
              {[...partners.slice(10), ...partners.slice(0, 10), ...partners.slice(10), ...partners.slice(0, 10)].map((p, i) => (
                <span
                  key={i}
                  className="inline-flex items-center text-xs font-medium px-4 py-2 text-white/35 flex-shrink-0 transition-colors hover:text-white/70"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
