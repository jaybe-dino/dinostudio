/**
 * GET /api/auth/methods — 로그인 화면이 어떤 수단을 그려야 하는지 알려준다.
 * 설정되지 않은 로그인 버튼을 보여 주면 눌렀을 때 500이 나므로, 켜진 것만 그린다.
 * 비밀·설정값 자체는 절대 내보내지 않고 켜짐/꺼짐만 준다.
 */
import { googleConfigured } from "../../server/auth/google";
import { passwordLoginConfigured } from "../../server/auth/password";

function handler(): Response {
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

export { handler as GET };
