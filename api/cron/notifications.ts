/**
 * GET /api/cron/notifications — 알림을 정기적으로 계산해 도착지로 보낸다.
 *
 * 왜 필요한가 — 알림 계산은 지금까지 **누가 알림 화면을 열 때만** 돌았다.
 * 아무도 열지 않으면 「D-7 만기」도, 「P0 부족」도 아무 데도 가지 않는다.
 * 경보는 사람이 보러 오지 않아도 도착해야 하므로 시간이 이것을 대신 호출한다.
 *
 * 사람 세션이 없으므로 재무 역할로 계산한다 — 급여 개인 금액은 응답 단계에서
 * 마스킹되고, 알림 본문에는 개인별 금액이 들어가지 않는다.
 *
 * 접근 통제 — Vercel Cron 은 `Authorization: Bearer $CRON_SECRET` 을 붙여
 * 호출한다. `CRON_SECRET` 이 설정돼 있으면 그것과 맞지 않는 요청은 거부하고,
 * 설정돼 있지 않으면 아무 것도 하지 않는다 — 인증 없이 열어 두면 밖에서
 * 알림을 무한히 트리거할 수 있다.
 */
import { getLedgerService } from "../../server/erp/index.js";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: [
      ["Content-Type", "application/json; charset=utf-8"],
      ["Cache-Control", "no-store"],
    ],
  });
}

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return json(
      {
        ok: false,
        reason:
          "CRON_SECRET 이 설정되지 않았습니다 — 인증 없이 알림을 트리거할 수 없습니다",
      },
      503
    );

  if (req.headers.get("authorization") !== `Bearer ${secret}`)
    return json({ ok: false, reason: "unauthorized" }, 401);

  try {
    const result = await getLedgerService().notifications({
      id: "cron",
      role: "재무",
    });
    // 무엇이 몇 건인지만 남긴다 — 알림 본문을 로그에 남기지 않는다
    return json(
      {
        ok: true,
        delivered: result.delivered.length,
        unread: result.unread,
        destination: result.destination,
        cappedForCeo: result.capped.length,
      },
      200
    );
  } catch (error) {
    return json(
      {
        ok: false,
        reason: error instanceof Error ? error.message : "알림 계산 실패",
      },
      500
    );
  }
}
