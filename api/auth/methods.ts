/**
 * GET /api/auth/methods — 로그인 화면이 어떤 수단을 그려야 하는지 알려준다.
 * 설정되지 않은 로그인 버튼을 보여 주면 눌렀을 때 500이 나므로, 켜진 것만 그린다.
 * 비밀·설정값 자체는 절대 내보내지 않고 켜짐/꺼짐만 준다.
 */
import { googleConfigured } from "../../server/auth/google";
import { passwordLoginConfigured } from "../../server/auth/password";

/*
 * Vercel 서버리스 런타임은 이 파일을 정적으로 훑어 어떤 HTTP 메서드를 다루는지 정한다.
 * `export { handler as GET }` 같은 별칭 재export 는 그 탐지에 잡히지 않아
 * FUNCTION_INVOCATION_FAILED 로 죽는다 — 그래서 메서드마다 선언형으로 내보낸다.
 */
export function GET(): Response {
  return new Response(
    JSON.stringify({
      google: googleConfigured(),
      password: passwordLoginConfigured(),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}
