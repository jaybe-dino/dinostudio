/**
 * 배포할 때 마이그레이션을 적용한다.
 *
 * 왜 빌드에서 하나 — 대표님이 터미널을 열지 않아도 스키마가 따라오게 하려는
 * 것이다. Vercel 빌드는 환경변수를 그대로 갖고 있으므로 Neon 을 연결한 다음
 * 배포 한 번이면 테이블이 만들어진다. 연결 문자열이 사람 손을 거치지 않는다.
 *
 * DATABASE_URL 이 없으면 **조용히 건너뛴다** — 메모리 시드로 도는 상태가
 * 유효한 동작이기 때문이다(그때는 붙일 DB 가 아예 없다). 반대로 값이 있는데
 * 실패하면 빌드를 세운다: 스키마가 안 맞는 채로 배포되면 첫 조회에서 터지고,
 * 그때는 원인이 훨씬 안 보인다.
 *
 * drizzle-kit CLI 를 쓰지 않고 런타임 마이그레이터를 쓰는 이유 — drizzle-kit 은
 * devDependency 다. 빌드 환경이 개발 의존성을 건너뛰도록 설정되면 그 순간
 * 배포가 깨진다. 여기서 쓰는 것은 애플리케이션이 이미 의존하는 두 패키지뿐이다.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] DATABASE_URL 없음 — 건너뜁니다 (메모리 시드로 동작)");
  process.exit(0);
}

console.log("[migrate] 마이그레이션 적용");
try {
  await migrate(drizzle(neon(url)), { migrationsFolder: "./drizzle" });
  console.log("[migrate] 완료");
} catch (error) {
  // 값이 있는데 실패한 것이므로 배포를 세운다
  console.error(
    "[migrate] 실패 —",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
}
