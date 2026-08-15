import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minimize } from "lucide-react";

const TOTAL_SLIDES = 17;
const slideSrc = (n: number) => `/sale2/slide-${String(n).padStart(2, "0")}.webp`;

/**
 * 비공개 슬라이드 뷰어 (/sale2)
 * - 사이트 내비게이션에서 링크하지 않는 unlisted 페이지
 * - 검색엔진 차단: robots meta (아래) + vercel.json 의 X-Robots-Tag 헤더
 * - 원본 PDF 는 제공하지 않으며, 우클릭/드래그 저장을 막아 다운로드를 억제
 */
export default function Sale2() {
  const [current, setCurrent] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // index.html 의 기본 robots meta(index, follow)를 이 페이지에 머무는 동안만 noindex 로 교체
  useEffect(() => {
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    const prevContent = meta.content;
    meta.content = "noindex, nofollow, noarchive, noimageindex";
    const prevTitle = document.title;
    document.title = "DINOSTUDIO — Partnership Deck";
    return () => {
      if (created) meta!.remove();
      else meta!.content = prevContent;
      document.title = prevTitle;
    };
  }, []);

  const go = useCallback((delta: number) => {
    setCurrent(c => Math.min(TOTAL_SLIDES, Math.max(1, c + delta)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") go(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
      else if (e.key === "Home") setCurrent(1);
      else if (e.key === "End") setCurrent(TOTAL_SLIDES);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // 다음/이전 슬라이드 미리 로드
  useEffect(() => {
    [current + 1, current - 1].forEach(n => {
      if (n >= 1 && n <= TOTAL_SLIDES) {
        const img = new Image();
        img.src = slideSrc(n);
      }
    });
  }, [current]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stageRef.current?.requestFullscreen?.();
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col select-none"
      style={{ background: "#08081c" }}
      onContextMenu={e => e.preventDefault()}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-3">
          <span className="font-black tracking-wide text-white" style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif" }}>
            DINO<span style={{ color: "#a78bfa" }}>STUDIO</span>
          </span>
          <span className="text-xs text-white/40 hidden sm:inline">파트너십 조건 안내</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/40">
          <span className="tabular-nums">{current} / {TOTAL_SLIDES}</span>
          <button
            onClick={toggleFullscreen}
            className="p-2 text-white/60 hover:text-white transition-colors"
            aria-label={isFullscreen ? "전체화면 종료" : "전체화면"}
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </header>

      {/* Stage */}
      <div ref={stageRef} className="flex-1 flex items-center justify-center p-4 relative" style={{ background: "#08081c" }}>
        <div className="relative w-full max-w-6xl">
          <img
            src={slideSrc(current)}
            alt={`슬라이드 ${current}`}
            draggable={false}
            className="w-full h-auto pointer-events-none"
            style={{ aspectRatio: "16/9", boxShadow: "0 8px 60px rgba(0,0,0,0.6)" }}
          />
          {/* 저장 억제용 투명 오버레이 */}
          <div className="absolute inset-0" onContextMenu={e => e.preventDefault()} />

          {/* Nav arrows */}
          <button
            onClick={() => go(-1)}
            disabled={current === 1}
            aria-label="이전 슬라이드"
            className="absolute left-2 top-1/2 -translate-y-1/2 p-3 text-white transition-opacity disabled:opacity-20"
            style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={() => go(1)}
            disabled={current === TOTAL_SLIDES}
            aria-label="다음 슬라이드"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-3 text-white transition-opacity disabled:opacity-20"
            style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="px-4 py-3 overflow-x-auto border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex gap-2 justify-start md:justify-center min-w-max mx-auto">
          {Array.from({ length: TOTAL_SLIDES }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              onClick={() => setCurrent(n)}
              aria-label={`슬라이드 ${n}`}
              className="relative shrink-0 transition-all"
              style={{
                width: 96,
                aspectRatio: "16/9",
                outline: n === current ? "2px solid #a78bfa" : "1px solid rgba(255,255,255,0.12)",
                opacity: n === current ? 1 : 0.45,
              }}
            >
              <img src={slideSrc(n)} alt="" draggable={false} loading="lazy" className="w-full h-full object-cover pointer-events-none" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
