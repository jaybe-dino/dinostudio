import { useEffect, useRef } from "react";
import { ExternalLink, Play, Users } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

/* ═══════════════════════════════════════════════════════════════════
   DINOSTUDIO — Live Channels Section
   Design: Cosmic dark + channel brand colors
   ═══════════════════════════════════════════════════════════════════ */

const featuredVideos = [
  { id: "xpr0JyXMn2Y", title: "삭발해도 괜찮아, 아이닉으로 다 치워버릴 거니까", channel: "의적단", views: "890K" },
  { id: "D1Rva0Q7eeo", title: "조나단, 인터뷰 중 번따?! | With.클룹", channel: "의적단", views: "866K" },
  { id: "b_uDqDGcDXc", title: "할인 실화야? 의적단 제대로 해냈다 | With.씨드비", channel: "의적단", views: "670K" },
  { id: "RBn8bitExyQ", title: "봄 최대의 적, 기미! 의적단이 책임집니다 | With이지듀", channel: "의적단", views: "584K" },
];

export default function ChannelsSection() {
  const { lang } = useLang();
  const sectionRef = useRef<HTMLElement>(null);

  const channels = [
    {
      id: "uijeokdan",
      name: "의적단",
      handle: "",
      typeKey: "channel1Type",
      color: "#c4b5fd",
      glowColor: "rgba(196,181,253,0.15)",
      descKey: "channel1Desc",
      link: "https://www.youtube.com/@studiosilok",
      embedId: "xpr0JyXMn2Y",
      stats: [
        { labelKey: "channel1Stat1Label", value: "1,600만+" },
        { labelKey: "channel1Stat2Label", value: "50만+" },
      ],
      cast: ["장성규", "조나단"],
    },
    {
      id: "budanggeorae",
      name: "부당거래",
      handle: "",
      typeKey: "channel2Type",
      color: "#67e8f9",
      glowColor: "rgba(103,232,249,0.12)",
      descKey: "channel2Desc",
      link: "",
      embedId: null,
      stats: [],
      cast: [],
    },
    {
      id: "mukboki",
      name: "문복희",
      handle: "",
      typeKey: "channel3Type",
      color: "#fbbf24",
      glowColor: "rgba(251,191,36,0.12)",
      descKey: "channel3Desc",
      link: "",
      embedId: null,
      stats: [],
      cast: ["문복희"],
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
      id="channels"
      ref={sectionRef}
      className="py-20 md:py-28 relative overflow-hidden"
      style={{
        background: "linear-gradient(180deg, var(--cosmos-void) 0%, #05050f 100%)",
      }}
    >
      <div className="container space-y-12">
        {/* Header */}
        <div className="reveal">
          <div className="cosmic-label mb-5">{t("channels", "sectionLabel", lang)}</div>
          <h2
            className="font-black text-3xl md:text-4xl text-white mb-4"
            style={{
              fontFamily: "'Space Grotesk', 'Pretendard', sans-serif",
              letterSpacing: "-0.04em",
              lineHeight: "1.05",
            }}
          >
            {t("channels", "headline1", lang)}{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #c4b5fd, #7c3aed)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {t("channels", "headline2", lang)}
            </span>
          </h2>
          <p className="text-white/40 text-sm max-w-xl">{t("channels", "desc", lang)}</p>
        </div>

        {/* Channel Cards */}
        <div className="grid md:grid-cols-3 gap-5">
          {channels.map((ch, i) => (
            <div
              key={ch.id}
              className="cosmic-card p-6 flex flex-col reveal-scale"
              style={{
                transitionDelay: `${i * 80}ms`,
                boxShadow: `0 0 40px ${ch.glowColor}`,
              }}
            >
              {/* Type badge */}
              <div
                className="text-xs font-bold uppercase tracking-widest mb-4 px-2 py-1 self-start"
                style={{
                  background: `${ch.color}12`,
                  border: `1px solid ${ch.color}25`,
                  color: ch.color,
                }}
              >
                {t("channels", ch.typeKey, lang)}
              </div>

              {/* Channel name */}
              <div
                className="font-black text-2xl text-white mb-3"
                style={{
                  fontFamily: "'Space Grotesk', 'Pretendard', sans-serif",
                  letterSpacing: "-0.03em",
                }}
              >
                {ch.name}
              </div>

              {/* Description */}
              <p className="text-sm text-white/45 leading-relaxed mb-5 flex-1">
                {t("channels", ch.descKey, lang)}
              </p>

              {/* Stats */}
              {ch.stats.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {ch.stats.map((s) => (
                    <div
                      key={s.labelKey}
                      className="p-3 text-center"
                      style={{
                        background: `${ch.color}08`,
                        border: `1px solid ${ch.color}18`,
                      }}
                    >
                      <div
                        className="font-black text-base mb-0.5"
                        style={{ color: ch.color, fontFamily: "'Space Grotesk', sans-serif" }}
                      >
                        {s.value}
                      </div>
                      <div className="text-xs text-white/30">{t("channels", s.labelKey, lang)}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Channel link button */}
              {ch.link && (
                <a
                  href={ch.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 text-xs font-bold transition-all duration-200"
                  style={{
                    background: `${ch.color}10`,
                    border: `1px solid ${ch.color}25`,
                    color: ch.color,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = `${ch.color}20`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = `${ch.color}10`;
                  }}
                >
                  <Users size={12} />
                  {t("channels", "visitChannel", lang)}
                </a>
              )}
            </div>
          ))}
        </div>

        {/* Featured embed + video grid */}
        <div className="grid lg:grid-cols-5 gap-6 reveal">
          {/* Main embed */}
          <div className="lg:col-span-3">
            <div className="text-xs font-bold text-white/20 uppercase tracking-widest mb-3">
              {lang === "en" ? "Featured: Uijeokdan" : "의적단 인기 영상"}
            </div>
            <div className="yt-embed-container mb-3">
              <iframe
                src="https://www.youtube.com/embed/xpr0JyXMn2Y"
                title="의적단"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            <a
              href="https://www.youtube.com/@studiosilok"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-bold hover:gap-2 transition-all"
              style={{ color: "#c4b5fd" }}
            >
              {t("channels", "viewAll", lang)} <ExternalLink size={11} />
            </a>
          </div>

          {/* Video thumbnails */}
          <div className="lg:col-span-2">
            <div className="text-xs font-bold text-white/20 uppercase tracking-widest mb-3">
              {lang === "en" ? "More Videos" : "더보기"}
            </div>
            <div className="space-y-3">
              {featuredVideos.map((v) => (
                <a
                  key={v.id}
                  href={`https://www.youtube.com/watch?v=${v.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 group"
                >
                  <div
                    className="relative flex-shrink-0 overflow-hidden"
                    style={{ width: "100px", aspectRatio: "16/9" }}
                  >
                    <img
                      src={`https://img.youtube.com/vi/${v.id}/mqdefault.jpg`}
                      alt={v.title}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div
                      className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "rgba(0,0,0,0.5)" }}
                    >
                      <div
                        className="w-7 h-7 flex items-center justify-center rounded-full"
                        style={{ background: "rgba(124,58,237,0.9)" }}
                      >
                        <Play size={12} className="text-white ml-0.5" />
                      </div>
                    </div>
                    <div
                      className="absolute top-1 right-1 text-xs font-bold px-1.5 py-0.5"
                      style={{ background: "rgba(0,0,0,0.8)", color: "#c4b5fd", fontSize: "10px" }}
                    >
                      {v.views}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/50 group-hover:text-white/80 transition-colors line-clamp-2 leading-snug mb-1">
                      {v.title}
                    </p>
                    <span className="text-xs" style={{ color: "#c4b5fd80" }}>
                      {v.channel}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
