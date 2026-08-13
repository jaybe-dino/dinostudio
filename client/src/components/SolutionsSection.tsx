import { useState } from "react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";
import { ExternalLink, ChevronRight, ShoppingCart, Play, Globe, BarChart3, TrendingUp, DollarSign, Zap } from "lucide-react";

const COSMIC_SOL_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663330652910/dmGrJ35z4AhFJFQ83XfsdQ/cosmic-solutions-BuTdaCdgGsVf5W67Wbk7V6.webp";
const COSMIC_FIN_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663330652910/dmGrJ35z4AhFJFQ83XfsdQ/cosmic-finance-eZCXKGr2c5E8PTipkQsB7M.webp";
const TIKTOK_BANNER_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663330652910/dmGrJ35z4AhFJFQ83XfsdQ/tiktok-shop-banner-T4FfcyUHh8etLw38yvtGBZ.webp";
const TIKTOK_MOBILE_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663330652910/dmGrJ35z4AhFJFQ83XfsdQ/tiktok-shop-mobile-386SNxdZ4dcJQqMfub4djQ.webp";

// ─── Commerce Sub-solutions ──────────────────────────────────────
// (moved inside component for lang support)

// ─── IP Channels & Finance Models ───────────────────────────────
// (moved inside component for lang support)
type Tab = "commerce" | "ip" | "finance";

export default function SolutionsSection() {
  const { lang } = useLang();
  const [activeTab, setActiveTab] = useState<Tab>("commerce");
  const isEn = lang === "en";
  const commerceSubs = [
    {
      id: "gonggu",
      icon: <ShoppingCart size={16} />,
      title: isEn ? "Group Buy" : "공동구매",
      titleFull: isEn ? "Group Buy (Domestic)" : "공동구매 (Domestic)",
      badge: isEn ? "38% Revenue Share" : "38% 매출 비중",
      color: "#c4b5fd",
      description: isEn
        ? "Boutique influencer sales powered by 7 years of sales expertise. We build brand-optimized sales channels through a network of 6 mega sellers + 4,000+ micro influencers."
        : "7년간 쌓은 영업력 기반의 부티크형 인플루언서 세일즈. 메가 셀러 6명 + 마이크로 4,000명+ 네트워크를 통해 브랜드에 최적화된 판매 채널을 구성합니다.",
      stats: [
        { label: isEn ? "Partner Brands" : "파트너 브랜드", value: "860+" },
        { label: isEn ? "Partner Sellers" : "협력 셀러", value: "4,000+" },
        { label: isEn ? "Channels" : "운영 채널", value: "170+" },
        { label: isEn ? "Countries" : "서비스 국가", value: isEn ? "6 Countries" : "6개국" },
      ],
      features: isEn ? [
        "AI-powered product–influencer matching algorithm (TIPS-selected by SMBA)",
        "Exclusive operation of Korea's top mega seller network",
        "Proprietary payment system Shorts Shop (lowest-fee PG contract)",
        "Revenue guarantee through exclusive & wholesale operations",
        "Hyundai Department Store & Coupang strategic partner management",
      ] : [
        "AI 기반 제품·인플루언서 매칭 알고리즘 (중기부 TIPS 선정)",
        "국내 최상위 메가 셀러 네트워크 독점 운영",
        "자체 결제시스템 쇼츠샵 (최저 수수료 PG 계약)",
        "기간 독점 / 총판 운영으로 수익 보장",
        "현대백화점·쿠팡 전략 파트너 입점 관리",
      ],
      link: null,
    },
    {
      id: "youtube",
      icon: <Play size={16} />,
      title: isEn ? "YouTube Commerce" : "유튜브 커머스",
      titleFull: isEn ? "YouTube Commerce (Domestic & Global)" : "유튜브 커머스 (Domestic & Global)",
      badge: isEn ? "62% Revenue Share" : "62% 매출 비중",
      color: "#67e8f9",
      description: isEn
        ? "Built on 6 years of YouTube sales data. Content viewing → product tag click → instant purchase conversion. Operating 170 commerce channels across beauty, health, food, and lifestyle."
        : "6년간 유튜브 세일즈 데이터 기반. 콘텐츠 시청 → 상품 태그 클릭 → 즉시 구매 전환 구조. 170개 커머스 채널 운영, 뷰티·헬스·식품·생활 전 카테고리 커버.",
      stats: [
        { label: isEn ? "YouTube Channels" : "유튜브 채널", value: "170" },
        { label: isEn ? "Agency Partners" : "협력 에이전시", value: "20+" },
        { label: isEn ? "Partner Sellers" : "파트너 셀러", value: "4,000+" },
        { label: isEn ? "Categories" : "운영 카테고리", value: isEn ? "All" : "전 분야" },
      ],
      features: isEn ? [
        "YouTube Shopping integration — direct in-content purchase conversion",
        "Optimized content-to-purchase conversion structure",
        "Proprietary platform with 40,000+ member base",
        "20+ agency supply network",
        "Full category coverage: beauty, healthcare, food, lifestyle",
      ] : [
        "유튜브 쇼핑 연동 — 콘텐츠 내 직접 구매 전환",
        "콘텐츠 기반 직접 구매 전환 최적화 구조",
        "자체 운영 플랫폼 4만+ 회원 기반",
        "20개+ 에이전시 공급 네트워크",
        "뷰티·헬스케어·식품·생활용품 전 카테고리 커버",
      ],
      link: "https://www.youtube.com/@studiosilok",
    },
    {
      id: "tiktok",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.79a4.85 4.85 0 01-1.07-.1z" fill="currentColor"/>
        </svg>
      ),
      title: isEn ? "TikTok Shop Cross-Border" : "틱톡샵 크로스보더",
      titleFull: isEn ? "TikTok Shop Cross-Border (Global)" : "틱톡샵 크로스보더 (Global)",
      badge: isEn ? "6 Countries Simultaneous" : "6개국 동시 진출",
      color: "#69C9D0",
      description: isEn
        ? "A cross-border commerce solution that simultaneously launches K-brands in 6 countries, leveraging top-tier celebrity and mega influencer networks in the US, Thailand, Vietnam, and beyond."
        : "미국·태국·베트남 등 글로벌 탑급 연예인 및 메가 인플루언서 네트워크를 기반으로 K-브랜드를 6개국에 동시 런칭하는 크로스보더 커머스 솔루션.",
      stats: [
        { label: isEn ? "Countries" : "진출 국가", value: isEn ? "6 Countries" : "6개국" },
        { label: isEn ? "Global Celebs" : "글로벌 셀럽", value: isEn ? "Top-Tier" : "탑급" },
        { label: isEn ? "Local Influencers" : "현지 인플루언서", value: isEn ? "Mega-Level" : "메가급" },
        { label: isEn ? "Live Commerce" : "라이브 커머스", value: isEn ? "Localized" : "현지화" },
      ],
      features: isEn ? [
        "Top-tier celebrity & mega influencer networks in US, Thailand, Vietnam",
        "Cross-border live commerce connecting global celebs with K-brands",
        "Live commerce powered by local top influencer networks across 6 countries",
        "K-brand cross-border one-stop: sourcing, logistics, payment, CS",
        "Simultaneous entry into US, Vietnam, Thailand, Malaysia, Singapore, Philippines",
      ] : [
        "미국·태국·베트남 탑급 연예인 및 메가 인플루언서 네트워크",
        "글로벌 셀럽과 K-브랜드를 연결하는 크로스보더 라이브 커머스",
        "6개국 현지 탑 인플루언서 네트워크 기반 라이브 커머스",
        "K-브랜드 크로스보더 원스톱 (소싱·물류·결제·CS)",
        "미국·베트남·태국·말레이시아·싱가포르·필리핀 동시 진출",
      ],
      link: null,
    },
  ];
  const ipChannels = [
    {
      name: isEn ? "Uijeokdan" : "의적단",
      handle: "@studiosilok",
      type: isEn ? "Commerce Entertainment IP" : "커머스 예능 IP",
      subscribers: "24.2K",
      avgViews: isEn ? "500K+" : "50만+",
      roas: "—",
      color: "#c4b5fd",
      desc: isEn
        ? '"Become my comrade!" A commerce entertainment show where Jang Sung-kyu × Jonatan donate brand-sponsored products to underprivileged communities. 16M+ cumulative views.'
        : '"너 내 동료가 돼라!" 장성규×조나단이 브랜드 협찬 제품을 소외계층에 기부하는 선한 영향력 커머스 예능. 누적 조회수 1,600만+.',
      link: "https://www.youtube.com/@studiosilok",
      embedId: "xpr0JyXMn2Y",
      videos: [
        { title: isEn ? "It's fine even if I shave my head, I'll clear it all with ANIK" : "삭발해도 괜찮아, 아이닉으로 다 치워버릴 거니까", views: "890K", link: "https://www.youtube.com/watch?v=xpr0JyXMn2Y" },
        { title: isEn ? "Jonathan, caught during interview?! | With.CLUP" : "조나단, 인터뷰 중 번따?! | With.클룹", views: "866K", link: "https://www.youtube.com/watch?v=D1Rva0Q7eeo" },
        { title: isEn ? "Is this discount real? Uijeokdan delivered | With.SEEDBY" : "할인 실화야? 의적단 제대로 해냈다 | With.씨드비", views: "670K", link: "https://www.youtube.com/watch?v=b_uDqDGcDXc" },
        { title: isEn ? "Spring's biggest enemy, dark spots! Uijeokdan takes care of it | With.EZIDEW" : "봄 최대의 적, 기미! 의적단이 책임집니다 | With이지듀", views: "584K", link: "https://www.youtube.com/watch?v=RBn8bitExyQ" },
      ],
    },
    {
      name: isEn ? "Budang Gerae" : "부당거래",
      handle: "@부당거래-d1z",
      type: isEn ? "Commerce Entertainment (New)" : "커머스 예능 (신규)",
      subscribers: isEn ? "Growing" : "성장중",
      avgViews: "400+",
      roas: "—",
      color: "#67e8f9",
      desc: isEn
        ? "The ultimate discount commerce show for the people. Launched Nov 2025 with rapid growth, becoming Dinostudio's second commerce IP."
        : "국민의, 국민에 의한, 국민을 위한 초특가 커머스 예능. 2025.11 런칭 이후 빠른 성장세를 기록하며 디노스튜디오의 두 번째 커머스 IP로 자리잡고 있습니다.",
      link: "https://www.youtube.com/@%EB%B6%80%EB%8B%B9%EA%B1%B0%EB%9E%98-d1z",
      embedId: null,
      monthlyData: [
        { month: isEn ? "M1 (Nov)" : "M1 (11월)", val: isEn ? "₩300M" : "3억" },
        { month: isEn ? "M2 (Dec)" : "M2 (12월)", val: isEn ? "₩1.1B" : "11억" },
        { month: isEn ? "M3 (Jan)" : "M3 (1월)", val: isEn ? "₩1.1B" : "11억" },
      ],
      videos: [
        { title: isEn ? "[Teaser] The ultimate discount commerce show for the people | Budang Gerae" : "[티저] 국민을 위한 초특가 커머스 예능 | 부당거래", views: "398", link: "https://www.youtube.com/@%EB%B6%80%EB%8B%B9%EA%B1%B0%EB%9E%98-d1z" },
      ],
    },
    {
      name: isEn ? "Moonbokee (Delivery)" : "딜리버리",
      handle: "",
      type: isEn ? "Global Commerce Platform" : "글로벌 커머스 플랫폼",
      subscribers: "",
      avgViews: "",
      roas: "—",
      color: "#fbbf24",
      desc: isEn
        ? "A K-content-based global commerce platform. The next-generation commerce channel connecting K-brands to global markets with domestic mega influencers."
        : "K-콘텐츠 기반의 글로벌 커머스 플랫폼. 국내 메가 인플루언서와 함께 K-브랜드를 글로벌 시장으로 연결하는 차세대 커머스 채널.",
      link: null,
      embedId: null,
      globalStats: [
        { label: isEn ? "Global Share" : "글로벌 비중", value: "65%" },
        { label: isEn ? "IP Channels" : "IP 채널 수", value: "170+" },
        { label: isEn ? "Creators" : "참여 크리에이터", value: "6" },
      ],
      videos: [],
    },
  ];

  const financeModels = [
    {
      icon: <BarChart3 size={20} />,
      title: isEn ? "Project Fund" : "프로젝트 펀드",
      subtitle: "Project Fund",
      color: "#c4b5fd",
      desc: isEn
        ? "Data-driven discovery and content production investment for YouTube commerce channels. Risk minimized through tracking of 170+ channel sales data."
        : "데이터 기반 커머스 유튜브 채널 발굴 및 콘텐츠 제작 투자. 170개 채널 판매 데이터 추적으로 리스크 최소화.",
      details: [
        { label: isEn ? "Fixed Return" : "확정 수익률", value: "10~30%" },
        { label: isEn ? "Duration" : "운영 기간", value: isEn ? "3–6 months" : "3~6개월" },
        { label: isEn ? "Fund Raising" : "펀드 모집", value: isEn ? "Quarterly" : "분기별" },
        { label: isEn ? "Tracked Channels" : "추적 채널", value: "170+" },
      ],
      features: isEn ? [
        "Data-driven brand discovery and investment review",
        "SMBA TIPS project & patent-based technology evaluation",
        "Principal-managed return structure",
        "Content fund: investor + LP structure",
      ] : [
        "데이터 기반 브랜드 발굴 및 투자 검토",
        "중기부 TIPS 과제 및 특허 기반 기술 평가",
        "원금 관리형 수익 구조",
        "콘텐츠 펀드 운영 투자사 + LP 구조",
      ],
    },
    {
      icon: <TrendingUp size={20} />,
      title: isEn ? "Brand / Content Investment" : "브랜드 / 콘텐츠 투자",
      subtitle: "Brand & Content Investment",
      color: "#67e8f9",
      desc: isEn
        ? "Direct investment in brands and content IPs with growth potential. We grow brand value together by combining commerce operations capabilities."
        : "성장 가능성 있는 브랜드와 콘텐츠 IP에 직접 투자. 커머스 운영 역량과 결합하여 브랜드 가치를 함께 키워갑니다.",
      details: [
        { label: isEn ? "Target" : "투자 대상", value: isEn ? "Brand · IP" : "브랜드·IP" },
        { label: isEn ? "Method" : "투자 방식", value: isEn ? "Direct" : "직접 투자" },
        { label: isEn ? "Partner Brands" : "협력 브랜드", value: "860+" },
        { label: isEn ? "Invested Brands" : "투자 브랜드", value: "860+" },
      ],
      features: isEn ? [
        "Investment across all categories: beauty, health food, food, lifestyle",
        "Commerce operations + Content IP synergy investment",
        "Customized investment structure by brand growth stage",
        "TikTok Shop-linked investment for global expansion",
      ] : [
        "뷰티·건강식품·식품·생활용품 전 카테고리 투자",
        "커머스 운영 + 콘텐츠 IP 시너지 결합 투자",
        "브랜드 성장 단계별 맞춤형 투자 구조",
        "글로벌 확장을 위한 TikTok Shop 연계 투자",
      ],
    },
    {
      icon: <DollarSign size={20} />,
      title: isEn ? "Equity Investment" : "지분 투자 (Equity)",
      subtitle: "Equity Investment",
      color: "#fbbf24",
      desc: isEn
        ? "Value-up through equity investment in promising brands. Achieve J-Curve growth after intensive Commerce + IP deployment."
        : "유망 브랜드 지분 투자로 기업 가치 상승(Value-up). 커머스 + IP 집중 투입 후 J-Curve 성장 실현.",
      details: [
        { label: isEn ? "Equity Range" : "지분 범위", value: "5~50%" },
        { label: isEn ? "Stage" : "투자 단계", value: "Pre-A~A" },
        { label: isEn ? "2026 Target" : "2026 목표", value: isEn ? "3 companies" : "3개사" },
        { label: isEn ? "Exit Method" : "Exit 방식", value: "IPO/M&A" },
      ],
      features: isEn ? [
        "Full category coverage: beauty, health food, lifestyle products",
        "Intensive Commerce (sales) + IP (promotion) synergy",
        "IPO / M&A advisory and exit strategy execution",
        "Brand value-up through data-driven commerce operations",
      ] : [
        "뷰티·건강식품·생활용품 전 카테고리 커버",
        "커머스(판매) + IP(홍보) 집중 투입 시너지",
        "IPO / M&A 자문 및 Exit 전략 실행",
        "데이터 기반 커머스 운영으로 브랜드 가치 상승",
      ],
    },
  ];

  const [activeCommerce, setActiveCommerce] = useState(0);
  const [activeIp, setActiveIp] = useState(0);

  const tabs = [
    { id: "commerce" as Tab, label: t("solutions", "engine1", lang), icon: <ShoppingCart size={15} />, num: "01" },
    { id: "ip" as Tab, label: t("solutions", "engine2", lang), icon: <Play size={15} />, num: "02" },
    { id: "finance" as Tab, label: t("solutions", "engine3", lang), icon: <DollarSign size={15} />, num: "03" },
  ];

  return (
    <section
      id="solutions"
      className="py-20 md:py-28 relative overflow-hidden"
      style={{ background: "linear-gradient(180deg, var(--cosmos-void) 0%, var(--cosmos-nebula) 50%, var(--cosmos-void) 100%)" }}
    >
      {/* Top cosmic divider */}
      <div className="cosmic-divider mb-0 absolute top-0 left-0 right-0" />

      {/* Background image */}
      <div className="absolute inset-0 opacity-10">
        <img src={COSMIC_SOL_IMG} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, var(--cosmos-void) 0%, transparent 30%, transparent 70%, var(--cosmos-void) 100%)" }} />
      </div>

      {/* Decorative orbs */}
      <div className="cosmic-orb" style={{ width: "400px", height: "400px", background: "radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)", top: "10%", right: "-50px" }} />
      <div className="cosmic-orb" style={{ width: "300px", height: "300px", background: "radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)", bottom: "10%", left: "-50px" }} />

      <div className="container">
        {/* Header */}
        <div className="mb-12">
          <div className="cosmic-label mb-5">{t("solutions", "sectionLabel", lang)}</div>
          <h2
            className="font-black text-4xl md:text-5xl text-white mb-4"
            style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.04em", lineHeight: "1.05" }}
          >
            {t("solutions", "headline1", lang)}
            <br />
            <span className="text-cosmic-gradient">{t("solutions", "headline2", lang)}</span>
          </h2>
          <p className="text-white/45 text-sm max-w-lg">
            {t("solutions", "subDesc", lang)}
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-2 mb-10">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-bold transition-all duration-300 ${
                activeTab === tab.id ? "cosmic-tab-active" : "text-white/40 hover:text-white/70"
              }`}
              style={{
                background: activeTab === tab.id ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.03)",
                border: activeTab === tab.id ? "1px solid rgba(124,58,237,0.4)" : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span className="text-xs opacity-50 font-mono">ENGINE {tab.num}</span>
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── COMMERCE TAB ─────────────────────────────────────────── */}
        {activeTab === "commerce" && (
          <div className="space-y-8">
            {/* Sub-tabs */}
            <div className="flex flex-wrap gap-1 p-1" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              {commerceSubs.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setActiveCommerce(i)}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold transition-all duration-200"
                  style={{
                    background: activeCommerce === i ? `rgba(${s.color === "#c4b5fd" ? "196,181,253" : s.color === "#67e8f9" ? "103,232,249" : "52,211,153"},0.15)` : "transparent",
                    color: activeCommerce === i ? s.color : "rgba(255,255,255,0.4)",
                    borderBottom: activeCommerce === i ? `2px solid ${s.color}` : "2px solid transparent",
                  }}
                >
                  {s.icon}
                  {s.title}
                </button>
              ))}
            </div>

            {/* Active sub-solution */}
            {(() => {
              const s = commerceSubs[activeCommerce];
              return (
                <div className="grid lg:grid-cols-2 gap-8">
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <span
                        className="text-xs font-bold px-3 py-1"
                        style={{ background: `${s.color}20`, color: s.color, border: `1px solid ${s.color}40` }}
                      >
                        {s.badge}
                      </span>
                    </div>
                    <h3
                      className="font-black text-2xl md:text-3xl text-white mb-4"
                      style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.03em" }}
                    >
                      {s.titleFull}
                    </h3>
                    <p className="text-white/55 leading-relaxed mb-6 text-sm">{s.description}</p>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2 mb-6">
                      {s.stats.map((st) => (
                        <div key={st.label} className="cosmic-card p-4">
                          <div className="font-black text-lg mb-0.5" style={{ color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{st.value}</div>
                          <div className="text-xs text-white/40">{st.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Features */}
                    <ul className="space-y-2">
                      {s.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-white/55">
                          <ChevronRight size={13} className="mt-0.5 flex-shrink-0" style={{ color: s.color }} />
                          {f}
                        </li>
                      ))}
                    </ul>

                    {s.link && (
                      <a href={s.link} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 mt-5 text-sm font-bold hover:gap-3 transition-all"
                        style={{ color: s.color }}
                      >
                        <ExternalLink size={13} /> {t("channels", "visitChannel", lang)}
                      </a>
                    )}
                  </div>

                  {/* Right visual */}
                  <div className="space-y-4">
                    {s.id === "tiktok" ? (
                      <div className="space-y-3">
                        {/* TikTok Shop banner image */}
                        <div className="relative overflow-hidden" style={{ height: "180px" }}>
                          <img src={TIKTOK_BANNER_IMG} alt="TikTok Shop Global" loading="lazy" decoding="async" className="w-full h-full object-cover opacity-80" />
                          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(3,3,10,0.6) 0%, transparent 60%)" }} />
                          <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5" style={{ background: "rgba(0,0,0,0.75)", border: "1px solid rgba(105,201,208,0.4)" }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.79a4.85 4.85 0 01-1.07-.1z" fill="#69C9D0"/>
                            </svg>
                            <span className="text-xs font-black" style={{ color: "#69C9D0", fontFamily: "'Space Grotesk', sans-serif" }}>TikTok Shop</span>
                          </div>
                          <div className="absolute bottom-3 right-3">
                            <img src={TIKTOK_MOBILE_IMG} alt="" loading="lazy" decoding="async" className="w-16 object-contain" style={{ filter: "drop-shadow(0 0 10px rgba(105,201,208,0.4))" }} />
                          </div>
                        </div>
                        {/* Countries grid */}
                        <div className="grid grid-cols-3 gap-1.5">
                          {[
                            { flag: "🇺🇸", country: lang === "en" ? "USA" : "미국", status: lang === "en" ? "Live" : "운영중" },
                            { flag: "🇵🇭", country: lang === "en" ? "Philippines" : "필리핀", status: lang === "en" ? "Live" : "운영중" },
                            { flag: "🇻🇳", country: lang === "en" ? "Vietnam" : "베트남", status: lang === "en" ? "Live" : "운영중" },
                            { flag: "🇹🇭", country: lang === "en" ? "Thailand" : "태국", status: lang === "en" ? "Live" : "운영중" },
                            { flag: "🇲🇾", country: lang === "en" ? "Malaysia" : "말레이시아", status: lang === "en" ? "Live" : "운영중" },
                            { flag: "🇸🇬", country: lang === "en" ? "Singapore" : "싱가포르", status: lang === "en" ? "Live" : "운영중" },
                          ].map((c) => (
                            <div key={c.country} className="flex items-center gap-1.5 p-2" style={{ background: "rgba(105,201,208,0.05)", border: "1px solid rgba(105,201,208,0.15)" }}>
                              <span className="text-base">{c.flag}</span>
                              <div>
                                <div className="text-xs font-bold text-white">{c.country}</div>
                                <div className="text-xs" style={{ color: "#69C9D0" }}>{c.status}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                        {/* AI flow */}
                        <div className="p-3" style={{ background: "rgba(105,201,208,0.04)", border: "1px solid rgba(105,201,208,0.15)" }}>
                          <div className="text-xs text-white/30 mb-2">{lang === "en" ? "AI Orchestrator Automation" : "AI 오케스트레이터 자동화"}</div>
                          <div className="flex flex-wrap gap-1">
                            {(lang === "en" ? ["Onboarding", "Affiliate Matching", "Spark Ads", "Live Commerce", "Local Influencers"] : ["온보딩", "어필리에이터 매칭", "스파크 광고", "라이브 커머스", "현지 인플루언서"]).map((tag) => (
                              <span key={tag} className="text-xs px-2 py-0.5" style={{ background: "rgba(105,201,208,0.1)", color: "#69C9D0" }}>{tag}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="relative overflow-hidden" style={{ height: "280px" }}>
                        <img src={COSMIC_SOL_IMG} alt={s.title} loading="lazy" decoding="async" className="w-full h-full object-cover opacity-60" />
                        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(3,3,10,0.7) 0%, transparent 60%)" }} />
                        <div className="absolute bottom-4 left-4 right-4">
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { label: "공동구매", pct: "38%", desc: "국내 폐쇄몰" },
                              { label: "유튜브", pct: "62%", desc: "170개 채널" },
                              { label: "틱톡샵", pct: "확장중", desc: "6개국" },
                            ].map((item) => (
                              <div key={item.label} className="text-center p-2" style={{ background: "rgba(3,3,10,0.8)", border: "1px solid rgba(124,58,237,0.2)" }}>
                                <div className="font-black text-sm" style={{ color: "#c4b5fd" }}>{item.pct}</div>
                                <div className="text-xs text-white font-bold">{item.label}</div>
                                <div className="text-xs text-white/30">{item.desc}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── IP TAB ───────────────────────────────────────────────── */}
        {activeTab === "ip" && (
          <div className="space-y-8">
            {/* Channel selector */}
            <div className="flex flex-wrap gap-1 p-1" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              {ipChannels.map((ch, i) => (
                <button
                  key={ch.name}
                  onClick={() => setActiveIp(i)}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold transition-all duration-200"
                  style={{
                    color: activeIp === i ? ch.color : "rgba(255,255,255,0.4)",
                    borderBottom: activeIp === i ? `2px solid ${ch.color}` : "2px solid transparent",
                    background: activeIp === i ? `${ch.color}10` : "transparent",
                  }}
                >
                  {ch.name}
                  <span className="text-xs opacity-50">{ch.type}</span>
                </button>
              ))}
            </div>

            {(() => {
              const ch = ipChannels[activeIp];
              return (
                <div className="grid lg:grid-cols-2 gap-8">
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-xs font-bold px-3 py-1" style={{ background: `${ch.color}15`, color: ch.color, border: `1px solid ${ch.color}30` }}>
                        {ch.type}
                      </span>
                      {ch.link && (
                        <a href={ch.link} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-white/30 hover:text-white/60 flex items-center gap-1 transition-colors"
                        >
                          {ch.handle} <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                    <h3 className="font-black text-2xl md:text-3xl text-white mb-4"
                      style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.03em" }}
                    >
                      {ch.name}
                    </h3>
                    <p className="text-white/55 leading-relaxed mb-6 text-sm">{ch.desc}</p>



                    {/* Video list */}
                    {ch.videos.length > 0 && (
                      <div>
                        <div className="text-xs font-bold text-white/25 uppercase tracking-widest mb-3">{lang === "en" ? "Featured Videos" : "주요 영상"}</div>
                        <ul className="space-y-1.5">
                          {ch.videos.map((v) => (
                            <li key={v.title}>
                              <a href={v.link} target="_blank" rel="noopener noreferrer"
                                className="flex items-center justify-between gap-3 p-3 group transition-all"
                                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
                              >
                                <span className="text-xs text-white/60 group-hover:text-white transition-colors line-clamp-1">{v.title}</span>
                                <span className="text-xs font-bold flex-shrink-0" style={{ color: ch.color }}>{v.views}</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Right */}
                  <div className="space-y-4">
                    {ch.embedId && (
                      <div className="yt-embed-container">
                        <iframe
                          src={`https://www.youtube.com/embed/${ch.embedId}`}
                          title={ch.name}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    )}

                    {ch.name === "딜리버리" && (ch as any).globalStats && (
                      <div className="cosmic-card p-5">
                        <div className="text-xs font-bold text-white/25 uppercase tracking-widest mb-4">글로벌 커머스 IP 지표</div>
                        <div className="space-y-3">
                          {(ch as any).globalStats.map((item: any) => (
                            <div key={item.label} className="flex justify-between items-center pb-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                              <span className="text-sm text-white/45">{item.label}</span>
                              <span className="font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}


          </div>
        )}

        {/* ── FINANCE TAB ──────────────────────────────────────────── */}
        {activeTab === "finance" && (
          <div className="space-y-8">
            <div className="grid lg:grid-cols-3 gap-5">
              {financeModels.map((m) => (
                <div key={m.title} className="cosmic-card p-6 flex flex-col">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 flex items-center justify-center" style={{ background: `${m.color}15`, border: `1px solid ${m.color}30`, color: m.color }}>
                      {m.icon}
                    </div>
                    <div>
                      <div className="font-black text-white text-base" style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif" }}>{m.title}</div>
                      <div className="text-xs text-white/30">{m.subtitle}</div>
                    </div>
                  </div>
                  <p className="text-sm text-white/50 leading-relaxed mb-5">{m.desc}</p>

                  <div className="grid grid-cols-2 gap-2 mb-5">
                    {m.details.map((d) => (
                      <div key={d.label} className="p-3" style={{ background: `${m.color}08`, border: `1px solid ${m.color}20` }}>
                        <div className="font-black text-base mb-0.5" style={{ color: m.color, fontFamily: "'Space Grotesk', sans-serif" }}>{d.value}</div>
                        <div className="text-xs text-white/30">{d.label}</div>
                      </div>
                    ))}
                  </div>

                  <ul className="space-y-1.5 mt-auto">
                    {m.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-white/45">
                        <ChevronRight size={11} className="mt-0.5 flex-shrink-0" style={{ color: m.color }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* 7-step journey */}
            <div className="cosmic-card p-6">
              <div className="text-xs font-bold text-white/25 uppercase tracking-widest mb-5">{lang === "en" ? "Brand Investment Journey (7 Steps)" : "브랜드 투자 여정 (7단계)"}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                {[
                  { step: "01", label: "Sourcing", desc: lang === "en" ? "Discover Hidden Value" : "숨겨진 가치 발견" },
                  { step: "02", label: "Testing", desc: lang === "en" ? "Validate PMF" : "시장성(PMF) 검증" },
                  { step: "03", label: "Partnership", desc: lang === "en" ? "Remove Marketing Risk" : "마케팅 리스크 제거" },
                  { step: "04", label: "Boosting", desc: lang === "en" ? "Revenue J-Curve" : "매출 J-Curve" },
                  { step: "05", label: "Expansion", desc: lang === "en" ? "Dominate Distribution" : "유통망 장악" },
                  { step: "06", label: "Global", desc: lang === "en" ? "Global Brand Leap" : "글로벌 브랜드 도약" },
                  { step: "07", label: "Exit", desc: lang === "en" ? "Maximize Valuation" : "기업가치 극대화" },
                ].map((s, i) => (
                  <div key={s.step} className="text-center p-3 relative" style={{ background: `rgba(124,58,237,${0.03 + i * 0.01})`, border: "1px solid rgba(124,58,237,0.1)" }}>
                    <div className="text-xs font-bold mb-1" style={{ color: "#7c3aed" }}>{s.step}</div>
                    <div className="text-xs font-bold text-white mb-1">{s.label}</div>
                    <div className="text-xs text-white/30 leading-tight">{s.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Finance image banner */}
            <div className="relative h-44 overflow-hidden">
              <img src={COSMIC_FIN_IMG} alt="파이낸스 솔루션" loading="lazy" decoding="async" className="w-full h-full object-cover opacity-50" />
              <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(3,3,10,0.95) 0%, rgba(3,3,10,0.5) 60%, transparent 100%)" }} />
              <div className="absolute inset-0 flex items-center px-8">
                <div>
                  <div className="cosmic-label-cyan mb-2">FINANCE SOLUTION</div>
                  <div className="font-black text-2xl text-white mb-2" style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif" }}>{lang === "en" ? "Beyond Simple Agency" : "단순 대행을 넘어"}</div>
                  <div className="text-sm text-white/50">{lang === "en" ? "A unique model that grows with brands by combining IP + Finance" : "IP + 파이낸스 결합으로 브랜드와 함께 성장하는 독보적 모델"}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
