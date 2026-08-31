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
    "server/auth/session": await probe(
      () => import("../server/auth/session.js")
    ),
    "server/auth/google": await probe(() => import("../server/auth/google.js")),
    "server/auth/password": await probe(
      () => import("../server/auth/password.js")
    ),
    "shared/erp": await probe(() => import("../shared/erp/index.js")),
    "server/erp/router": await probe(() => import("../server/erp/router.js")),
    "server/routers": await probe(() => import("../server/routers.js")),
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

  // 어느 배포를 보고 있는지 — 환경변수는 환경(Production/Preview)별로 따로 잡힌다.
  // 비밀이 아니라 Vercel 이 주는 배포 메타데이터다.
  const deployment = {
    environment: process.env.VERCEL_ENV ?? "(vercel 아님)",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
    // 재배포하면 커밋이 같아도 이 주소는 바뀐다 —
    // "재배포를 했는가"를 커밋만으로는 알 수 없어서 함께 내보낸다
    deploymentUrl: process.env.VERCEL_URL ?? null,
    // 환경변수가 어느 프로젝트에 들어갔는지 대조하기 위한 것
    project: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
  };

  // 실제로 잡힌 변수의 "이름"만 — 이름을 잘못 적어 넣은 경우를 잡는다.
  // 값은 절대 내보내지 않고, 우리가 정의한 접두어에 해당하는 이름만 본다.
  const knownPrefixes = ["ERP_", "SESSION_", "GOOGLE_", "SLACK_", "DATABASE_"];
  const seenNames = Object.keys(process.env)
    .filter(name => knownPrefixes.some(prefix => name.startsWith(prefix)))
    .sort();

  return new Response(
    JSON.stringify(
      { node: process.version, deployment, modules, env, seenNames },
      null,
      2
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}
