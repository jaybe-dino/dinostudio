import { useEffect, useRef } from "react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

export default function TeamSection() {
  const { lang } = useLang();
  const sectionRef = useRef<HTMLElement>(null);

  const strengths = [
    {
      icon: "🎬",
      titleKey: "strength1Title",
      descKey: "strength1Desc",
      color: "#c4b5fd",
    },
    {
      icon: "🌐",
      titleKey: "strength2Title",
      descKey: "strength2Desc",
      color: "#67e8f9",
    },
    {
      icon: "🚀",
      titleKey: "strength3Title",
      descKey: "strength3Desc",
      color: "#69C9D0",
    },
    {
      icon: "💎",
      titleKey: "strength4Title",
      descKey: "strength4Desc",
      color: "#fbbf24",
    },
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("visible")),
      { threshold: 0.08 }
    );
    sectionRef.current?.querySelectorAll(".reveal, .reveal-left, .reveal-scale").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="team"
      ref={sectionRef}
      className="py-20 md:py-28 relative overflow-hidden"
      style={{ background: "var(--cosmos-void)" }}
    >
      <div
        className="cosmic-orb"
        style={{
          width: "400px",
          height: "400px",
          background: "radial-gradient(circle, rgba(251,191,36,0.06) 0%, transparent 70%)",
          bottom: "0",
          right: "0",
        }}
      />

      <div className="container space-y-16">
        {/* Strengths */}
        <div>
          <div className="cosmic-label mb-5 reveal">Why Dinostudio</div>
          <h2
            className="font-black text-3xl md:text-4xl text-white mb-10 reveal"
            style={{
              fontFamily: "'Space Grotesk', 'Pretendard', sans-serif",
              letterSpacing: "-0.04em",
              lineHeight: "1.05",
            }}
          >
            {t("team", "headline1", lang)}{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #c4b5fd, #7c3aed)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {t("team", "headline2", lang)}
            </span>
            {t("team", "headline3", lang)}
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {strengths.map((s, i) => (
              <div
                key={s.titleKey}
                className="cosmic-card p-6 group transition-all duration-300 reveal-scale"
                style={{ transitionDelay: `${i * 80}ms` }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
                  (e.currentTarget as HTMLElement).style.borderColor = `${s.color}40`;
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 12px 40px ${s.color}15`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                  (e.currentTarget as HTMLElement).style.borderColor = "";
                  (e.currentTarget as HTMLElement).style.boxShadow = "";
                }}
              >
                <div className="flex items-start gap-4">
                  <div
                    className="text-3xl w-12 h-12 flex items-center justify-center flex-shrink-0"
                    style={{
                      background: `${s.color}10`,
                      border: `1px solid ${s.color}25`,
                    }}
                  >
                    {s.icon}
                  </div>
                  <div>
                    <div
                      className="font-black text-base text-white mb-2"
                      style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif" }}
                    >
                      {t("team", s.titleKey, lang)}
                    </div>
                    <p className="text-sm text-white/50 leading-relaxed">{t("team", s.descKey, lang)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
