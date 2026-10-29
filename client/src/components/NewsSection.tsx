import { Calendar, ExternalLink } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

/**
 * 뉴스 & 현장 소식 — 최근 행사 2건을 실제 보도 사진과 함께 소개한다.
 *
 * 사진은 공개 기사에 실린 현장 사진 원본을 client/public/news/ 에 보관해
 * 같은 도메인에서 서빙하며, 출처·제공자를 사진 바로 아래에 명시한다.
 * 원본 해상도가 작으므로(500~600px) 카드 폭 이상으로 무리하게 키우지 않는다.
 *
 * 카피 원칙: 기사 전문을 복제하지 않고 사실만 새로 요약한다. 행사일과 기사
 * 발행일을 구분해 표기한다. 확인되지 않은 참석 인원·실적·계약 성과·공식
 * 파트너 자격은 쓰지 않으며, 국회 워크숍은 디노스튜디오가 "참여·발표"한
 * 행사로만 소개한다(공동주최·기관 보증으로 표현 금지).
 */

type Article = { media: { ko: string; en: string }; date: string | null; url: string };

const EVENTS: Array<{
  key: "e1" | "e2";
  img: string;
  articles: Article[];
}> = [
  {
    key: "e1",
    img: "/news/hanjin-oneclick-20261022.jpg",
    articles: [
      {
        media: { ko: "컨슈머타임스", en: "Consumertimes" },
        date: "2026.10.23",
        url: "https://www.cstimes.com/news/articleView.html?idxno=725120",
      },
      {
        media: { ko: "아이뉴스24", en: "inews24" },
        date: "2026.10.28",
        url: "https://www.inews24.com/view/2019722",
      },
    ],
  },
  {
    key: "e2",
    img: "/news/assembly-workshop-20261019.jpg",
    articles: [
      {
        media: { ko: "조선일보", en: "Chosun Ilbo" },
        date: "2026.10.20",
        url: "https://www.chosun.com/economy/smb-venture/2026/10/20/FE2XSR63PJDKDP3AGOTBC3VOAE/",
      },
      {
        media: { ko: "인더스트리뉴스", en: "Industry News" },
        date: null,
        url: "https://www.industrynews.co.kr/news/articleView.html?idxno=87903",
      },
    ],
  },
];

export default function NewsSection() {
  const { lang } = useLang();

  return (
    <section id="news" className="py-20 md:py-28 relative overflow-hidden">
      <div
        className="cosmic-orb"
        style={{
          width: "440px",
          height: "440px",
          background: "radial-gradient(circle, rgba(124,58,237,0.1) 0%, transparent 70%)",
          top: "0%",
          right: "-80px",
        }}
      />

      <div className="container relative">
        <div className="cosmic-label mb-5">{t("news", "sectionLabel", lang)}</div>
        <h2
          className="font-black text-3xl md:text-5xl text-white mb-3"
          style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.03em" }}
        >
          {t("news", "headline1", lang)}{" "}
          <span className="text-cosmic-gradient">{t("news", "headline2", lang)}</span>
        </h2>
        <p className="text-white/45 text-sm md:text-base mb-10">{t("news", "desc", lang)}</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {EVENTS.map(event => (
            <article key={event.key} className="cosmic-card p-0 overflow-hidden reveal">
              {/* 보도 사진 — 원본 비율 유지, 크롭 없음 */}
              <img
                src={event.img}
                alt={t("news", `${event.key}Caption`, lang)}
                loading="lazy"
                decoding="async"
                className="w-full h-auto"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              {/* 사진 출처 — 사진 바로 아래 */}
              <div
                className="px-5 py-2 text-[11px] text-white/40 border-b"
                style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(3,3,10,0.5)" }}
              >
                {t("news", `${event.key}Caption`, lang)}
              </div>

              <div className="p-6 md:p-7">
                <div className="flex items-center gap-2 text-xs font-bold mb-3" style={{ color: "#c4b5fd" }}>
                  <Calendar size={13} className="shrink-0" />
                  <span>
                    {t("news", "eventDateLabel", lang)} {t("news", `${event.key}Date`, lang)}
                  </span>
                </div>
                <h3
                  className="font-black text-lg md:text-xl text-white mb-3"
                  style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", lineHeight: 1.3, textWrap: "balance" }}
                >
                  {t("news", `${event.key}Title`, lang)}
                </h3>
                <p className="text-white/50 text-sm mb-5" style={{ lineHeight: 1.75 }}>
                  {t("news", `${event.key}Desc`, lang)}
                </p>

                {/* 기사 원문 링크 — 매체명 + 발행일 */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-white/30">
                    {t("news", "readOriginal", lang)}
                  </span>
                  {event.articles.map(article => (
                    <a
                      key={article.url}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white/70 hover:text-white hover:border-violet-500/50 transition-all"
                      style={{ border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.03)" }}
                    >
                      {article.media[lang]}
                      {article.date ? <span className="text-white/35 font-normal">{article.date}</span> : null}
                      <ExternalLink size={11} className="text-white/40" />
                    </a>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
