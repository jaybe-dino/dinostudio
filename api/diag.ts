/**
 * GET /api/diag — 배포 진단용 임시 엔드포인트.
 *
 * 정적 import 가 하나도 없다. 그래야 다른 모듈이 전부 깨져 있어도 이 파일만은 뜨고,
 * 무엇이 깨졌는지 말해줄 수 있다. 원인을 잡으면 지운다.
 *
 * 비밀값은 절대 내보내지 않는다 — 환경변수는 "있다/없다"만 본다.
 */

async function probe(load: () => Promise<unknown>): Promise<string> {
  try {
    await load();
    return "ok";
  } catch (error) {
    if (error instanceof Error)
      return `${error.name}: ${error.message.split("\n")[0]}`;
    return String(error);
  }
}

export async function GET(): Promise<Response> {
  const modules: Record<string, string> = {
    jose: await probe(() => import("jose")),
    "server/auth/session": await probe(() => import("../server/auth/session")),
    "server/auth/google": await probe(() => import("../server/auth/google")),
    "server/auth/password": await probe(
      () => import("../server/auth/password")
    ),
    "shared/erp": await probe(() => import("../shared/erp")),
    "server/erp/router": await probe(() => import("../server/erp/router")),
    "server/routers": await probe(() => import("../server/routers")),
  };

  // 값이 아니라 설정 여부만 — 비밀번호·비밀키가 밖으로 나가면 안 된다
  const env: Record<string, boolean> = {};
  for (const key of [
    "SESSION_SECRET",
    "ERP_PASSWORD",
    "ERP_ALLOWED_DOMAIN",
    "ERP_ROLE_MAP",
    "DATABASE_URL",
    "GOOGLE_CLIENT_ID",
  ])
    env[key] = Boolean(process.env[key]);

  return new Response(
    JSON.stringify({ node: process.version, modules, env }, null, 2),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}
