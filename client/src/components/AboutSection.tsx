import { useEffect } from "react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

export default function AboutSection() {
  const { lang } = useLang();

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("visible")),
      { threshold: 0.1 }
    );
    document.querySelectorAll(".reveal, .reveal-left, .reveal-scale").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const metrics = [
    { val: "860개+", valEn: "860+", labelKey: "metric1Label", subKey: "metric1Sub", color: "#c4b5fd" },
    { val: "170개", valEn: "170", labelKey: "metric2Label", subKey: "metric2Sub", color: "#67e8f9" },
    { val: "50+", valEn: "50+", labelKey: "metric3Label", subKey: "metric3Sub", color: "#c4b5fd" },
    { val: "6개국", valEn: "6 Countries", labelKey: "metric4Label", subKey: "metric4Sub", color: "#69C9D0" },
    { val: "7년+", valEn: "7+ Years", labelKey: "metric5Label", subKey: "metric5Sub", color: "#fbbf24" },
    { val: "3개", valEn: "3 IPs", labelKey: "metric6Label", subKey: "metric6Sub", color: "#34d399" },
  ];

  const engines = [
    { icon: "🛒", labelKey: "engine1Label", descKey: "engine1Desc" },
    { icon: "🎬", labelKey: "engine2Label", descKey: "engine2Desc" },
    { icon: "💎", labelKey: "engine3Label", descKey: "engine3Desc" },
  ];

  return (
    <section id="about" className="py-20 md:py-28 relative overflow-hidden nebula-bg">
      <div
        className="cosmic-orb"
        style={{ width: "500px", height: "500px", background: "radial-gradient(circle, rgba(79,70,229,0.08) 0%, transparent 70%)", top: "50%", right: "-100px", transform: "translateY(-50%)" }}
      />

      <div className="container">
        <div className="max-w-3xl mb-16">
          <div className="cosmic-label mb-5 reveal">{t("about", "sectionLabel", lang)}</div>
          <h2
            className="font-black text-4xl md:text-5xl text-white mb-6 reveal"
            style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.04em", lineHeight: "1.05" }}
          >
            {t("about", "headline1", lang)}
            <br />
            <span className="text-cosmic-gradient">{lang === "ko" ? "콘텐츠" : "Content"}</span>
            {lang === "ko" ? "로 연결합니다" : " " + t("about", "headline2", lang).replace("Connecting Brands with Consumers Through Content", "with Consumers Through Content")}
          </h2>
          <p className="text-white/60 leading-relaxed text-base reveal" style={{ maxWidth: "640px" }}>
            {lang === "ko" ? (
              <>디노스튜디오는 <strong className="text-white font-semibold">커머스 예능 제작사</strong>입니다. 단순한 광고가 아닌, 소비자가 자발적으로 소비하는 콘텐츠 안에 브랜드를 녹여 실질적인 매출 성장을 만들어냅니다.</>
            ) : (
              <>Dinostudio is a <strong className="text-white font-semibold">commerce entertainment production company</strong>. We embed brands into content that consumers voluntarily engage with—not just ads—to drive real, measurable sales growth.</>
            )}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-14 items-start">
          <div>
            <div className="space-y-5 mb-10">
              <div className="p-5 reveal" style={{ background: "rgba(79,70,229,0.06)", border: "1px solid rgba(124,58,237,0.2)", borderLeft: "3px solid rgba(124,58,237,0.6)" }}>
                <div className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-2" style={{ letterSpacing: "0.15em" }}>
                  {t("about", "missionLabel", lang)}
                </div>
                <p className="text-white/80 text-sm leading-relaxed">{t("about", "missionText", lang)}</p>
              </div>

              <div className="p-5 reveal" style={{ background: "rgba(6,182,212,0.05)", border: "1px solid rgba(6,182,212,0.15)", borderLeft: "3px solid rgba(6,182,212,0.5)" }}>
                <div className="text-xs font-bold text-cyan-400 uppercase tracking-widest mb-2" style={{ letterSpacing: "0.15em" }}>
                  {t("about", "whatWeDoLabel", lang)}
                </div>
                <p className="text-white/70 text-sm leading-relaxed">{t("about", "whatWeDoText", lang)}</p>
              </div>

              <div className="p-5 reveal" style={{ background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.15)", borderLeft: "3px solid rgba(52,211,153,0.4)" }}>
                <div className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-2" style={{ letterSpacing: "0.15em" }}>
                  {t("about", "ourEdgeLabel", lang)}
                </div>
                <p className="text-white/70 text-sm leading-relaxed">{t("about", "ourEdgeText", lang)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 reveal">
              {engines.map((e) => (
                <div key={e.labelKey} className="cosmic-card p-3 text-center">
                  <div className="text-2xl mb-2">{e.icon}</div>
                  <div className="text-xs font-bold text-white mb-1">{t("about", e.labelKey, lang)}</div>
                  <div className="text-xs text-white/30">{t("about", e.descKey, lang)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {metrics.map((m, i) => (
              <div key={m.labelKey} className="cosmic-card p-4 reveal-scale" style={{ transitionDelay: `${i * 80}ms` }}>
                <div
                  className="font-black text-xl mb-1"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: m.color, textShadow: `0 0 15px ${m.color}50` }}
                >
                  {lang === "ko" ? m.val : m.valEn}
                </div>
                <div className="text-xs font-semibold text-white mb-0.5">{t("about", m.labelKey, lang)}</div>
                <div className="text-xs text-white/30">{t("about", m.subKey, lang)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
