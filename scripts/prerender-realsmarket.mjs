/**
 * /realsmarket 용 정적 HTML 프리렌더.
 *
 * SPA는 index.html 하나를 공유하므로 카카오톡·페이스북 등 OG 스크레이퍼(JS 미실행)에는
 * 홈 메타가 그대로 노출된다. 빌드 후 index.html을 복제해 /realsmarket 전용
 * title/description/OG/canonical 로 치환한 dist/public/realsmarket/index.html 을 만들면,
 * Vercel 파일시스템 매칭이 SPA rewrite 보다 먼저 이 파일을 서빙한다.
 * (앱 번들은 동일하게 로드되므로 화면은 SPA 라우팅과 똑같이 동작한다.)
 */
import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "..", "dist", "public");
const SRC = path.join(DIST, "index.html");
const OUT_DIR = path.join(DIST, "realsmarket");

const META = {
  title: "릴스마켓 | 릴스에서 시작해, 구매로 이어지는 캠페인 — 디노스튜디오",
  ogTitle: "릴스마켓 | 릴스에서 시작해, 구매로 이어지는 캠페인",
  description:
    "릴스마켓은 여러 크리에이터의 릴스 콘텐츠와 판매 접점을 하나의 캠페인으로 연결합니다. 콘텐츠 설계부터 크리에이터 섭외, 마켓 오픈, 구매전환 데이터 확인까지 디노스튜디오가 운영합니다.",
  url: "https://www.dinostudio.kr/realsmarket",
};

if (!fs.existsSync(SRC)) {
  console.error(`[prerender-realsmarket] ${SRC} not found — run vite build first`);
  process.exit(1);
}

let html = fs.readFileSync(SRC, "utf-8");

const replaceAttr = (pattern, replacement) => {
  if (!pattern.test(html)) {
    console.warn(`[prerender-realsmarket] pattern not found, skipped: ${pattern}`);
    return;
  }
  html = html.replace(pattern, replacement);
};

replaceAttr(/<title>[^<]*<\/title>/, `<title>${META.title}</title>`);
replaceAttr(
  /(<meta name="description" content=")[^"]*(")/,
  `$1${META.description}$2`
);
replaceAttr(/(<link rel="canonical" href=")[^"]*(")/, `$1${META.url}$2`);
replaceAttr(/(<meta property="og:title" content=")[^"]*(")/, `$1${META.ogTitle}$2`);
replaceAttr(
  /(<meta property="og:description" content=")[^"]*(")/,
  `$1${META.description}$2`
);
replaceAttr(/(<meta property="og:url" content=")[^"]*(")/, `$1${META.url}$2`);
replaceAttr(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${META.ogTitle}$2`);
replaceAttr(
  /(<meta name="twitter:description" content=")[^"]*(")/,
  `$1${META.description}$2`
);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "index.html"), html, "utf-8");
console.log(`[prerender-realsmarket] wrote ${path.join(OUT_DIR, "index.html")}`);
