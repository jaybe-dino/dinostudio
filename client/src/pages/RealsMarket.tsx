import { lazy, Suspense, useEffect } from "react";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clapperboard,
  ExternalLink,
  Instagram,
  Link2,
  Mail,
} from "lucide-react";
import StarCanvas from "@/components/StarCanvas";

const ContactSection = lazy(() => import("@/components/ContactSection"));

/**
 * 릴스마켓 공개 소개 페이지 (/realsmarket)
 *
 * 카피 원칙 (마케팅 합의 사항 — 수정 시 주의):
 * - ROAS 등 성과 수치를 홍보 문구로 쓰지 않고, 성과를 보장하는 표현을 쓰지 않는다.
 * - 마켓 수는 "제안 기준"임을 명시하고, 최종 구성은 협의로 확정됨을 밝힌다.
 * - 부가세 포함 여부·일반 소요기간은 미확정 → 견적/협의 시 확인 문구로만 안내한다.
 * - 참고 영상은 Instagram 링크로만 제공하고 고객사명·성과 수치를 덧붙이지 않는다.
 */

const META = {
  title: "릴스마켓 | 릴스에서 시작해, 구매로 이어지는 캠페인 — 디노스튜디오",
  description:
    "릴스마켓은 여러 크리에이터의 릴스 콘텐츠와 판매 접점을 하나의 캠페인으로 연결합니다. 콘텐츠 설계부터 크리에이터 섭외, 마켓 오픈, 구매전환 데이터 확인까지 디노스튜디오가 운영합니다.",
  url: "https://www.dinostudio.kr/realsmarket",
};

/** 이 페이지에 머무는 동안만 SEO/OG 메타를 교체하고, 떠날 때 원래 값으로 복원한다. */
function usePageMeta() {
  useEffect(() => {
    const restores: Array<() => void> = [];

    const prevTitle = document.title;
    document.title = META.title;
    restores.push(() => {
      document.title = prevTitle;
    });

    const swap = (selector: string, attr: string, value: string) => {
      const el = document.head.querySelector<HTMLElement>(selector);
      if (!el) return;
      const prev = el.getAttribute(attr);
      el.setAttribute(attr, value);
      restores.push(() => {
        if (prev === null) el.removeAttribute(attr);
        else el.setAttribute(attr, prev);
      });
    };

    swap('meta[name="description"]', "content", META.description);
    swap('link[rel="canonical"]', "href", META.url);
    swap('meta[property="og:title"]', "content", "릴스마켓 | 릴스에서 시작해, 구매로 이어지는 캠페인");
    swap('meta[property="og:description"]', "content", META.description);
    swap('meta[property="og:url"]', "content", META.url);
    swap('meta[name="twitter:title"]', "content", "릴스마켓 — 디노스튜디오");
    swap('meta[name="twitter:description"]', "content", META.description);

    return () => {
      restores.forEach(fn => fn());
    };
  }, []);
}

/** Home 과 동일한 스크롤 리빌 패턴 */
function useScrollReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) entry.target.classList.add("visible");
        });
      },
      { threshold: 0.08 }
    );
    const timer = setTimeout(() => {
      document.querySelectorAll(".reveal, .reveal-left, .reveal-scale").forEach(el => observer.observe(el));
    }, 300);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
}

function scrollToContact() {
  document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
}

const PROCESS_STEPS = [
  {
    title: "콘텐츠 전략 설계",
    desc: "제품 USP를 기반으로 콘텐츠 가이드와 후킹 포인트, 핵심 메시지, 구매 유도 구조를 설계합니다.",
  },
  {
    title: "크리에이터 구성·섭외",
    desc: "캠페인 목표와 제품 특성에 맞춰 크리에이터 라인업을 구성하고 섭외를 진행합니다.",
  },
  {
    title: "샘플링·콘텐츠 제작",
    desc: "크리에이터가 제품을 직접 경험하는 샘플링을 거쳐 릴스 콘텐츠를 제작합니다.",
  },
  {
    title: "릴스 업로드·마켓 순차 오픈",
    desc: "릴스 업로드와 함께 판매 링크가 연결된 마켓을 순차적으로 오픈합니다.",
  },
  {
    title: "성과 데이터 확인",
    desc: "조회·도달·클릭·구매전환 데이터를 확인하며 캠페인 결과를 투명하게 공유합니다.",
  },
];

const BUDGET_TIERS = [
  {
    price: "3,000만원",
    badge: "최소 시작 예산",
    points: ["5개 이상 마켓", "초기 시장 반응 검증"],
    highlight: false,
  },
  {
    price: "5,000만원",
    badge: "확장 구성",
    points: ["8개 이상 마켓", "메가 크리에이터 포함", "콘텐츠 볼륨 및 구매전환 확대"],
    highlight: true,
  },
  {
    price: "1억원",
    badge: "대규모 확산",
    points: ["20개 이상 마켓", "메가 크리에이터 포함", "대규모 확산 캠페인"],
    highlight: false,
  },
];

const DELIVERABLES = [
  "제품 USP 기반 콘텐츠 가이드·후킹·메시지·구매 유도 설계",
  "캠페인 목표에 맞춘 크리에이터 구성 및 섭외",
  "샘플링 및 릴스 콘텐츠 제작 운영",
  "릴스 업로드와 판매 링크 연동 마켓 순차 오픈",
  "조회·도달·클릭·구매전환 데이터 리포트",
];

const REFERENCE_LINKS = [
  { label: "참고 영상 1", url: "https://www.instagram.com/p/DdIqmORyYiB/" },
  { label: "참고 영상 2", url: "https://www.instagram.com/reel/DcvYthqTt9s/" },
];

const FAQS = [
  {
    q: "캠페인 기간은 얼마나 걸리나요?",
    a: "제품 제공, 크리에이터 섭외, 콘텐츠 제작 일정에 따라 달라집니다. 상담 시 제품과 일정 조건을 확인한 뒤 함께 협의해 확정합니다.",
  },
  {
    q: "예산에 부가세가 포함되어 있나요?",
    a: "부가세 포함 여부는 견적 안내 시 함께 확인드립니다.",
  },
  {
    q: "마켓 수는 확정인가요?",
    a: "표기된 마켓 수는 제안 기준입니다. 최종 구성은 제품 특성, 크리에이터 섭외 상황, 조건 협의를 통해 확정됩니다.",
  },
  {
    q: "제작된 콘텐츠를 자사 채널이나 광고에 쓸 수 있나요?",
    a: "콘텐츠 2차 활용은 범위와 조건에 따라 별도 협의로 진행됩니다. 상담 시 활용 계획을 알려주시면 함께 안내드립니다.",
  },
  {
    q: "판매 성과가 보장되나요?",
    a: "특정 성과를 보장하지는 않습니다. 대신 조회·도달·클릭·구매전환 데이터를 투명하게 확인하며 캠페인을 운영하고, 결과를 기반으로 다음 단계를 함께 설계합니다.",
  },
];

export default function RealsMarket() {
  usePageMeta();
  useScrollReveal();

  return (
    <div className="min-h-screen" style={{ background: "var(--cosmos-void)" }}>
      <StarCanvas />

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          background: "rgba(3,3,10,0.92)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(124,58,237,0.15)",
        }}
      >
        <div className="container flex items-center justify-between h-16">
          <a href="/" className="flex items-baseline gap-0.5" aria-label="디노스튜디오 홈으로">
            <span
              className="font-black text-lg text-white tracking-tight"
              style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.03em" }}
            >
              DINO
            </span>
            <span
              className="font-black text-lg tracking-tight"
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                letterSpacing: "-0.03em",
                background: "linear-gradient(135deg, #c4b5fd, #818cf8)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              STUDIO
            </span>
            <span className="hidden sm:inline text-xs text-white/35 ml-3 font-semibold">릴스마켓</span>
          </a>
          <button onClick={scrollToContact} className="btn-cosmic-primary px-4 py-2 text-xs md:text-sm">
            캠페인 문의
          </button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-28 overflow-hidden">
        <div
          className="cosmic-orb"
          style={{
            width: "700px",
            height: "700px",
            background: "radial-gradient(circle, rgba(124,58,237,0.14) 0%, transparent 70%)",
            top: "-10%",
            right: "-15%",
          }}
        />
        <div className="cosmic-grid absolute inset-0 opacity-20" />
        <div className="container relative">
          <div className="cosmic-label mb-6">REELS MARKET</div>
          <h1
            className="font-black text-4xl md:text-6xl text-white mb-6"
            style={{
              fontFamily: "'Space Grotesk', 'Pretendard', sans-serif",
              letterSpacing: "-0.04em",
              lineHeight: 1.08,
              textWrap: "balance",
            }}
          >
            릴스에서 시작해,
            <br />
            <span className="text-cosmic-gradient">구매로 이어지는 캠페인</span>
          </h1>
          <p className="text-white/55 text-base md:text-lg max-w-xl mb-8" style={{ lineHeight: 1.7 }}>
            여러 크리에이터의 콘텐츠와 판매 접점을 하나의 캠페인으로 연결합니다.
          </p>

          <div className="flex flex-wrap gap-2 mb-10">
            {["다수 크리에이터 동시 캠페인", "판매 링크 연동 마켓 오픈", "최소 시작 예산 3,000만원"].map(badge => (
              <span
                key={badge}
                className="text-xs font-bold px-3 py-1.5"
                style={{
                  color: "#c4b5fd",
                  background: "rgba(124,58,237,0.12)",
                  border: "1px solid rgba(124,58,237,0.3)",
                }}
              >
                {badge}
              </span>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={scrollToContact} className="btn-cosmic-primary flex items-center justify-center gap-2 px-7 py-4 text-sm">
              캠페인 상담하기 <ArrowRight size={15} />
            </button>
            <a
              href="#budget"
              className="flex items-center justify-center gap-2 px-7 py-4 text-sm font-bold text-white/70 hover:text-white transition-colors"
              style={{ border: "1px solid rgba(255,255,255,0.14)" }}
            >
              예산 구성 보기
            </a>
          </div>
        </div>
      </section>

      {/* ── 캠페인 개요 ─────────────────────────────────────────── */}
      <section className="py-16 md:py-24" style={{ background: "var(--cosmos-nebula)" }}>
        <div className="container">
          <div className="cosmic-label mb-5">What is Reels Market</div>
          <h2
            className="font-black text-3xl md:text-4xl text-white mb-10"
            style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.03em", textWrap: "balance" }}
          >
            콘텐츠·판매·데이터를
            <br className="md:hidden" /> <span className="text-cosmic-gradient">하나의 캠페인으로</span>
          </h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                icon: Clapperboard,
                title: "다수 크리에이터 릴스 콘텐츠",
                desc: "여러 크리에이터가 제품 USP에 맞춰 설계된 릴스 콘텐츠를 동시에 제작·업로드합니다.",
              },
              {
                icon: Link2,
                title: "판매 링크 노출·마켓 오픈",
                desc: "콘텐츠에 판매 링크를 노출하고, 캠페인 일정에 맞춰 마켓을 순차적으로 오픈합니다.",
              },
              {
                icon: BarChart3,
                title: "구매 전환 데이터 확인",
                desc: "조회·도달·클릭·구매전환 데이터를 확인하며 캠페인 전 과정을 투명하게 운영합니다.",
              },
            ].map(card => (
              <div key={card.title} className="cosmic-card p-7 reveal">
                <div
                  className="w-10 h-10 flex items-center justify-center mb-5"
                  style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", color: "#c4b5fd" }}
                >
                  <card.icon size={17} />
                </div>
                <h3 className="font-bold text-white text-lg mb-2.5">{card.title}</h3>
                <p className="text-white/45 text-sm" style={{ lineHeight: 1.7 }}>
                  {card.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 운영 과정 ───────────────────────────────────────────── */}
      <section className="py-16 md:py-24">
        <div className="container">
          <div className="cosmic-label mb-5">Process</div>
          <h2
            className="font-black text-3xl md:text-4xl text-white mb-10"
            style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.03em" }}
          >
            캠페인 <span className="text-cosmic-gradient">운영 과정</span>
          </h2>
          <div className="space-y-3 max-w-3xl">
            {PROCESS_STEPS.map((step, i) => (
              <div key={step.title} className="cosmic-card flex gap-5 p-6 reveal">
                <div
                  className="shrink-0 font-black text-sm w-9 h-9 flex items-center justify-center"
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    color: "#c4b5fd",
                    background: "rgba(124,58,237,0.12)",
                    border: "1px solid rgba(124,58,237,0.3)",
                  }}
                >
                  {i + 1}
                </div>
                <div>
                  <h3 className="font-bold text-white text-base mb-1">{step.title}</h3>
                  <p className="text-white/45 text-sm" style={{ lineHeight: 1.7 }}>
                    {step.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 예산 구성 ───────────────────────────────────────────── */}
      <section id="budget" className="py-16 md:py-24" style={{ background: "var(--cosmos-nebula)" }}>
        <div className="container">
          <div className="cosmic-label mb-5">Budget</div>
          <h2
            className="font-black text-3xl md:text-4xl text-white mb-3"
            style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.03em" }}
          >
            예산 <span className="text-cosmic-gradient">구성</span>
          </h2>
          <p className="text-white/45 text-sm mb-10">최소 시작 예산은 3,000만원이며, 규모에 따라 구성이 확장됩니다.</p>

          <div className="grid md:grid-cols-3 gap-4 items-stretch">
            {BUDGET_TIERS.map(tier => (
              <div
                key={tier.price}
                className="cosmic-card p-7 flex flex-col reveal"
                style={tier.highlight ? { borderColor: "rgba(124,58,237,0.5)", background: "rgba(124,58,237,0.06)" } : undefined}
              >
                <div
                  className="text-[11px] font-bold tracking-widest uppercase mb-4"
                  style={{ color: tier.highlight ? "#c4b5fd" : "rgba(255,255,255,0.35)" }}
                >
                  {tier.badge}
                </div>
                <div
                  className="font-black text-3xl text-white mb-6"
                  style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.02em" }}
                >
                  {tier.price}
                </div>
                <ul className="space-y-2.5 mb-6 flex-1">
                  {tier.points.map(p => (
                    <li key={p} className="flex items-start gap-2.5 text-sm text-white/60">
                      <CheckCircle2 size={15} className="shrink-0 mt-0.5" style={{ color: "#c4b5fd" }} />
                      {p}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={scrollToContact}
                  className={tier.highlight ? "btn-cosmic-primary w-full py-3 text-sm" : "w-full py-3 text-sm font-bold text-white/70 hover:text-white transition-colors"}
                  style={tier.highlight ? undefined : { border: "1px solid rgba(255,255,255,0.14)" }}
                >
                  상담 요청
                </button>
              </div>
            ))}
          </div>

          <p className="text-white/35 text-xs mt-6 max-w-2xl" style={{ lineHeight: 1.7 }}>
            표기된 마켓 수는 제안 기준이며, 최종 구성은 제품·섭외·조건 협의를 통해 확정됩니다. 부가세 포함 여부는 견적 시
            안내드립니다.
          </p>
        </div>
      </section>

      {/* ── 제공 항목 ───────────────────────────────────────────── */}
      <section className="py-16 md:py-24">
        <div className="container">
          <div className="cosmic-label mb-5">Deliverables</div>
          <h2
            className="font-black text-3xl md:text-4xl text-white mb-10"
            style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.03em" }}
          >
            제공 <span className="text-cosmic-gradient">항목</span>
          </h2>
          <div className="cosmic-card p-7 md:p-9 max-w-3xl reveal">
            <ul className="space-y-4">
              {DELIVERABLES.map(item => (
                <li key={item} className="flex items-start gap-3 text-sm md:text-base text-white/65">
                  <CheckCircle2 size={17} className="shrink-0 mt-0.5" style={{ color: "#c4b5fd" }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── 참고 영상 ───────────────────────────────────────────── */}
      <section className="py-16 md:py-24" style={{ background: "var(--cosmos-nebula)" }}>
        <div className="container">
          <div className="cosmic-label mb-5">Reference</div>
          <h2
            className="font-black text-3xl md:text-4xl text-white mb-3"
            style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.03em" }}
          >
            참고 <span className="text-cosmic-gradient">영상</span>
          </h2>
          <p className="text-white/45 text-sm mb-8">릴스마켓 캠페인으로 제작된 콘텐츠 형식을 Instagram에서 확인하실 수 있습니다.</p>
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
            {REFERENCE_LINKS.map(ref => (
              <a
                key={ref.url}
                href={ref.url}
                target="_blank"
                rel="noopener noreferrer"
                className="cosmic-card flex items-center gap-4 p-6 hover:border-violet-500/40 transition-all"
              >
                <div
                  className="w-10 h-10 shrink-0 flex items-center justify-center"
                  style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", color: "#c4b5fd" }}
                >
                  <Instagram size={17} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white mb-0.5">{ref.label}</div>
                  <div className="text-xs text-white/35 flex items-center gap-1">
                    Instagram에서 보기 <ExternalLink size={11} />
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section className="py-16 md:py-24">
        <div className="container">
          <div className="cosmic-label mb-5">FAQ</div>
          <h2
            className="font-black text-3xl md:text-4xl text-white mb-10"
            style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.03em" }}
          >
            자주 묻는 <span className="text-cosmic-gradient">질문</span>
          </h2>
          <div className="space-y-3 max-w-3xl">
            {FAQS.map(faq => (
              <details key={faq.q} className="cosmic-card group">
                <summary className="flex items-center justify-between gap-4 p-6 cursor-pointer list-none text-white font-bold text-sm md:text-base [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <span className="text-white/30 shrink-0 transition-transform group-open:rotate-45 text-lg leading-none">+</span>
                </summary>
                <p className="px-6 pb-6 text-white/50 text-sm" style={{ lineHeight: 1.75 }}>
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── 상담 CTA + 기존 문의 폼 ─────────────────────────────── */}
      <Suspense fallback={<div style={{ minHeight: "400px" }} />}>
        <ContactSection />
      </Suspense>

      <footer className="py-10 border-t" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(3,3,10,1)" }}>
        <div className="container flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="text-xs text-white/30" style={{ lineHeight: 1.8 }}>
            주식회사 디노스튜디오 · 서울특별시 서초구 서초대로 48길 101, 그룹메가타워 2층
            <br />© {new Date().getFullYear()} DINO STUDIO. All rights reserved.
          </div>
          <a href="mailto:chief@dinostudio.kr" className="flex items-center gap-2 text-xs font-bold text-white/50 hover:text-white transition-colors">
            <Mail size={13} /> chief@dinostudio.kr
          </a>
        </div>
      </footer>
    </div>
  );
}
