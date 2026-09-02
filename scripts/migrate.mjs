/**
 * 배포할 때 마이그레이션을 적용한다.
 *
 * 왜 빌드에서 하나 — 대표님이 터미널을 열지 않아도 스키마가 따라오게 하려는
 * 것이다. Vercel 빌드는 환경변수를 그대로 갖고 있으므로 Neon 을 연결한 다음
 * 배포 한 번이면 테이블이 만들어진다.
 *
 * DATABASE_URL 이 없으면 **조용히 건너뛴다** — 메모리 시드로 도는 상태가
 * 유효한 동작이기 때문이다(그때는 붙일 DB 가 아예 없다). 반대로 값이 있는데
 * 실패하면 빌드를 세운다: 스키마가 안 맞는 채로 배포되면 첫 조회에서 터지고,
 * 그때는 원인이 훨씬 안 보인다.
 */
import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL 없음 — 건너뜁니다 (메모리 시드로 동작)");
  process.exit(0);
}

console.log("[migrate] 마이그레이션 적용");
execSync("npx drizzle-kit migrate", { stdio: "inherit" });
console.log("[migrate] 완료");
