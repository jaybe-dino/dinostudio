import { useEffect, useRef } from "react";
import { ExternalLink, Globe, ShoppingBag, Star, Users } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

const TIKTOK_BANNER =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663330652910/dmGrJ35z4AhFJFQ83XfsdQ/tiktok-shop-banner-T4FfcyUHh8etLw38yvtGBZ.webp";
const TIKTOK_MOBILE =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663330652910/dmGrJ35z4AhFJFQ83XfsdQ/tiktok-shop-mobile-386SNxdZ4dcJQqMfub4djQ.webp";

export default function TikTokSection() {
  const { lang } = useLang();
  const sectionRef = useRef<HTMLElement>(null);

  const countries = [
    { flag: "🇺🇸", nameKey: "country1", descKey: "country1Desc", color: "#69C9D0" },
    { flag: "🇵🇭", nameKey: "country2", descKey: "country2Desc", color: "#69C9D0" },
    { flag: "🇻🇳", nameKey: "country3", descKey: "country3Desc", color: "#69C9D0" },
    { flag: "🇹🇭", nameKey: "country4", descKey: "country4Desc", color: "#69C9D0" },
    { flag: "🇲🇾", nameKey: "country5", descKey: "country5Desc", color: "#69C9D0" },
    { flag: "🇸🇬", nameKey: "country6", descKey: "country6Desc", color: "#69C9D0" },
  ];

  const features = [
    { icon: <Star size={18} />, titleKey: "feature1Title", descKey: "feature1Desc" },
    { icon: <Users size={18} />, titleKey: "feature2Title", descKey: "feature2Desc" },
    { icon: <ShoppingBag size={18} />, titleKey: "feature3Title", descKey: "feature3Desc" },
    { icon: <Globe size={18} />, titleKey: "feature4Title", descKey: "feature4Desc" },
  ];

  const stats = [
    { valKey: "stat1Val", labelKey: "stat1Label", subKey: "stat1Sub" },
    { valKey: "stat2Val", labelKey: "stat2Label", subKey: "stat2Sub" },
    { valKey: "stat3Val", labelKey: "stat3Label", subKey: "stat3Sub" },
    { valKey: "stat4Val", labelKey: "stat4Label", subKey: "stat4Sub" },
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => e.isIntersecting && e.target.classList.add("visible")),
      { threshold: 0.08 }
    );
    sectionRef.current
      ?.querySelectorAll(".reveal, .reveal-left, .reveal-scale")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="tiktokshop"
      ref={sectionRef}
      className="py-24 md:py-32 relative overflow-hidden"
      style={{ background: "var(--cosmos-void)" }}
    >
      <div className="absolute inset-0 pointer-events-none">
        <img
          src={TIKTOK_BANNER}
          loading="lazy"
          decoding="async"
          alt=""
          className="w-full h-full object-cover opacity-20"
          style={{ objectPosition: "center 40%" }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(3,3,10,0.85) 0%, rgba(3,3,10,0.5) 40%, rgba(3,3,10,0.85) 80%, rgba(3,3,10,1) 100%)",
          }}
        />
      </div>

      <div
        className="cosmic-orb"
        style={{
          width: "500px",
          height: "500px",
          background: "radial-gradient(circle, rgba(105,201,208,0.12) 0%, transparent 70%)",
          top: "10%",
          right: "-100px",
        }}
      />

      <div className="container relative z-10">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14">
          <div>
            <div className="flex items-center gap-3 mb-5 reveal">
              <div
                className="flex items-center gap-2.5 px-4 py-2"
                style={{
                  background: "rgba(0,0,0,0.8)",
                  border: "1px solid rgba(105,201,208,0.4)",
                  boxShadow: "0 0 20px rgba(105,201,208,0.15)",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.79a4.85 4.85 0 01-1.07-.1z"
                    fill="#69C9D0"
                  />
                </svg>
                <span
                  className="font-black text-sm tracking-wide"
                  style={{ color: "#69C9D0", fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  {t("tiktok", "sectionLabel", lang)}
                </span>
                <span
                  className="text-xs font-bold px-2 py-0.5"
                  style={{ background: "rgba(105,201,208,0.15)", color: "#69C9D0" }}
                >
                  {t("tiktok", "sectionSub", lang)}
                </span>
              </div>
              <div
                className="text-xs font-bold px-3 py-1.5"
                style={{
                  background: "rgba(105,201,208,0.08)",
                  border: "1px solid rgba(105,201,208,0.2)",
                  color: "rgba(105,201,208,0.7)",
                  letterSpacing: "0.15em",
                }}
              >
                CROSS-BORDER COMMERCE
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
              {t("tiktok", "headline1", lang)}
              <br />
              <span
                style={{
                  background: "linear-gradient(135deg, #69C9D0 0%, #ffffff 50%, #69C9D0 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {t("tiktok", "headline2", lang)}
              </span>
            </h2>
            <p className="text-white/50 text-base max-w-lg leading-relaxed reveal">
              {t("tiktok", "desc", lang)}
            </p>
          </div>

          <div className="hidden lg:block flex-shrink-0 reveal-scale">
            <img
              src={TIKTOK_MOBILE}
              loading="lazy"
              decoding="async"
              alt="TikTok Shop Live Commerce"
              className="w-52 object-contain"
              style={{ filter: "drop-shadow(0 0 30px rgba(105,201,208,0.3))" }}
            />
          </div>
        </div>

        {/* Stats bar */}
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-px mb-12 reveal"
          style={{ background: "rgba(105,201,208,0.1)" }}
        >
          {stats.map((s) => (
            <div
              key={s.labelKey}
              className="text-center py-5 px-4"
              style={{ background: "rgba(3,3,10,0.9)" }}
            >
              <div
                className="font-black text-2xl mb-1"
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  color: "#69C9D0",
                  textShadow: "0 0 20px rgba(105,201,208,0.5)",
                }}
              >
                {t("tiktok", s.valKey, lang)}
              </div>
              <div className="text-xs font-bold text-white mb-0.5">{t("tiktok", s.labelKey, lang)}</div>
              <div className="text-xs text-white/30">{t("tiktok", s.subKey, lang)}</div>
            </div>
          ))}
        </div>

        {/* Main content: countries + features */}
        <div className="grid lg:grid-cols-2 gap-8 mb-10">
          {/* Countries */}
          <div className="reveal-left">
            <div
              className="text-xs font-bold text-white/30 uppercase tracking-widest mb-4"
              style={{ letterSpacing: "0.2em" }}
            >
              {t("tiktok", "countriesTitle", lang)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {countries.map((c, i) => (
                <div
                  key={c.nameKey}
                  className="flex items-center gap-3 p-4 group transition-all duration-300 reveal-scale"
                  style={{
                    background: "rgba(105,201,208,0.04)",
                    border: "1px solid rgba(105,201,208,0.12)",
                    transitionDelay: `${i * 60}ms`,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(105,201,208,0.1)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(105,201,208,0.35)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(105,201,208,0.04)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(105,201,208,0.12)";
                  }}
                >
                  <span className="text-3xl">{c.flag}</span>
                  <div>
                    <div className="font-bold text-white text-sm">{t("tiktok", c.nameKey, lang)}</div>
                    <div className="text-xs" style={{ color: "#69C9D0" }}>
                      {t("tiktok", c.descKey, lang)}
                    </div>
                  </div>
                  <div
                    className="ml-auto w-2 h-2 rounded-full"
                    style={{
                      background: "#69C9D0",
                      boxShadow: "0 0 8px #69C9D0",
                      animation: "pulse-glow 2s ease-in-out infinite",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Features */}
          <div className="space-y-3 reveal">
            <div
              className="text-xs font-bold text-white/30 uppercase tracking-widest mb-4"
              style={{ letterSpacing: "0.2em" }}
            >
              {lang === "ko" ? "디노스튜디오 틱톡샵 솔루션" : "Dinostudio TikTok Shop Solutions"}
            </div>
            {features.map((f, i) => (
              <div
                key={f.titleKey}
                className="flex gap-4 p-4 transition-all duration-300 reveal-scale"
                style={{
                  background: "rgba(13,13,43,0.7)",
                  border: "1px solid rgba(105,201,208,0.1)",
                  transitionDelay: `${i * 80}ms`,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(105,201,208,0.3)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(105,201,208,0.06)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(105,201,208,0.1)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(13,13,43,0.7)";
                }}
              >
                <div
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center"
                  style={{
                    background: "rgba(105,201,208,0.1)",
                    border: "1px solid rgba(105,201,208,0.2)",
                    color: "#69C9D0",
                  }}
                >
                  {f.icon}
                </div>
                <div>
                  <div
                    className="font-bold text-white text-sm mb-1"
                    style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif" }}
                  >
                    {t("tiktok", f.titleKey, lang)}
                  </div>
                  <p className="text-xs text-white/45 leading-relaxed">{t("tiktok", f.descKey, lang)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center gap-4 pt-4 reveal">
          <a
            href="https://tpartners.live"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold transition-all duration-200"
            style={{
              background: "rgba(105,201,208,0.1)",
              border: "1px solid rgba(105,201,208,0.3)",
              color: "#69C9D0",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(105,201,208,0.2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(105,201,208,0.1)";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.79a4.85 4.85 0 01-1.07-.1z"
                fill="currentColor"
              />
            </svg>
            TikTok Shop Partners
            <ExternalLink size={12} />
          </a>
          <button
            onClick={() => document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" })}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white transition-all duration-200"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
            }}
          >
            {t("tiktok", "cta", lang)}
          </button>
        </div>
      </div>
    </section>
  );
}
