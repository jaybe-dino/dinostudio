import { Calendar } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

/**
 * 뉴스 & 현장 소식 — 최근 행사 2건을 실제 보도 사진과 함께 소개한다.
 *
 * 사진은 공개 기사에 실린 현장 사진 원본을 client/public/news/ 에 보관해
 * 같은 도메인에서 서빙하며, 출처·제공자를 사진 바로 아래에 비링크 캡션으로만
 * 명시한다. 기사 원문 링크 UI는 넣지 않는다(2026-10-29 사용자 지시).
 *
 * 참여사 로고: /news/logos/ 의 공식 원본만 사용한다 —
 *  - hanjin-dark-bg.png: (주)한진 공식 CI 페이지의 어두운 배경용 흰색 영문 CI 원본
 *  - tiktok-white.webp: TikTok 공식 디자인 가이드 로고팩의 가로형(흰 워드마크+컬러 심볼)
 * 로고를 재현·변조하거나 다른 계열사 CI로 바꾸지 말 것. 참여사 표시 용도로만 쓴다.
 *
 * 국기: flag-icons(오픈소스, MIT) 원본 SVG 를 /news/flags/ 에 로컬 서빙.
 *
 * 카피 원칙: 기사 전문 비복제, 행사일/발행일 구분, 미확인 인원·실적·계약·공식
 * 파트너 자격 금지. 국회 워크숍은 "참여·발표"로만 소개(공동주최·기관 보증 금지).
 */

/** 워크숍 참석 8개국 — 기사에 명시된 순서 그대로 */
const COUNTRIES: Array<{ code: string; ko: string; en: string }> = [
  { code: "ma", ko: "모로코", en: "Morocco" },
  { code: "ae", ko: "UAE", en: "UAE" },
  { code: "it", ko: "이탈리아", en: "Italy" },
  { code: "br", ko: "브라질", en: "Brazil" },
  { code: "de", ko: "독일", en: "Germany" },
  { code: "my", ko: "말레이시아", en: "Malaysia" },
  { code: "uz", ko: "우즈베키스탄", en: "Uzbekistan" },
  { code: "ph", ko: "필리핀", en: "Philippines" },
];

const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.display = "none";
};

/** 한진×틱톡 카드 상단: 참여사 공식 로고 띠 (사진을 덮지 않는 별도 밴드) */
function PartnerLogoBand() {
  return (
    <div
      className="flex items-center justify-center gap-6 px-5 py-4 border-b"
      style={{ background: "rgba(3,3,10,0.85)", borderColor: "rgba(255,255,255,0.07)" }}
    >
      <img
        src="/news/logos/hanjin-dark-bg.png"
        alt="HANJIN"
        loading="lazy"
        decoding="async"
        className="h-5 md:h-6 w-auto"
        onError={hideOnError}
      />
      <span className="text-white/25 text-sm font-light select-none" aria-hidden="true">×</span>
      {/* TikTok 가로형 로고는 원본 내부 투명 여백이 커서(실제 도형이 캔버스의 절반 이하)
          한진과 "보이는" 도형 높이가 비슷해지도록 CSS 높이를 크게 잡는다. 원본 비율·색 유지. */}
      <img
        src="/news/logos/tiktok-white.webp"
        alt="TikTok"
        loading="lazy"
        decoding="async"
        className="h-10 md:h-12 w-auto"
        onError={hideOnError}
      />
    </div>
  );
}

/** 국회 워크숍 카드 상단: 참석 8개국 국기 + 국명 띠 */
function CountryFlagBand({ lang }: { lang: "ko" | "en" }) {
  return (
    <div
      className="grid grid-cols-4 gap-x-2 gap-y-2.5 px-4 py-3.5 border-b"
      style={{ background: "rgba(3,3,10,0.85)", borderColor: "rgba(255,255,255,0.07)" }}
    >
      {COUNTRIES.map(c => (
        <div
          key={c.code}
          className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 min-w-0 text-center"
        >
          <img
            src={`/news/flags/${c.code}.svg`}
            alt={`${c[lang]} ${lang === "ko" ? "국기" : "flag"}`}
            loading="lazy"
            decoding="async"
            width={24}
            height={18}
            className="shrink-0 rounded-[2px]"
            style={{ border: "1px solid rgba(255,255,255,0.15)" }}
            onError={hideOnError}
          />
          {/* 국명은 절대 말줄임하지 않는다 — 좁으면 줄바꿈으로 전체 표기 */}
          <span className="text-[11px] leading-tight text-white/55 font-medium break-words">
            {c[lang]}
          </span>
        </div>
      ))}
    </div>
  );
}

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
          {/* 카드에 reveal 클래스 금지 — Home 의 IntersectionObserver 가 lazy 마운트 전에
              등록을 끝내면 .visible 이 영영 안 붙어 카드가 opacity 0 으로 숨는다
              (#news 직접 진입·새로고침 시 재현). 뉴스 카드는 애니메이션 없이 항상 보인다. */}
          {(["e1", "e2"] as const).map(key => (
            <article key={key} className="cosmic-card p-0 overflow-hidden">
              {/* 참여사 로고 / 참석국 국기 — 사진 바로 위 별도 밴드 */}
              {key === "e1" ? <PartnerLogoBand /> : <CountryFlagBand lang={lang} />}

              {/* 보도 사진 — 원본 비율 유지, 크롭 없음 */}
              <img
                src={key === "e1" ? "/news/hanjin-oneclick-20261022.jpg" : "/news/assembly-workshop-20261019.jpg"}
                alt={t("news", `${key}Caption`, lang)}
                loading="lazy"
                decoding="async"
                className="w-full h-auto"
                onError={hideOnError}
              />
              {/* 사진 출처 — 사진 바로 아래, 링크 없는 최소 캡션 */}
              <div
                className="px-5 py-2 text-[11px] text-white/40 border-b"
                style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(3,3,10,0.5)" }}
              >
                {t("news", `${key}Caption`, lang)}
              </div>

              <div className="p-6 md:p-7">
                <div className="flex items-center gap-2 text-xs font-bold mb-3" style={{ color: "#c4b5fd" }}>
                  <Calendar size={13} className="shrink-0" />
                  <span>
                    {t("news", "eventDateLabel", lang)} {t("news", `${key}Date`, lang)}
                  </span>
                </div>
                <h3
                  className="font-black text-lg md:text-xl text-white mb-3"
                  style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", lineHeight: 1.3, textWrap: "balance", wordBreak: "keep-all" }}
                >
                  {t("news", `${key}Title`, lang)}
                </h3>
                <p className="text-white/50 text-sm" style={{ lineHeight: 1.75 }}>
                  {t("news", `${key}Desc`, lang)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
