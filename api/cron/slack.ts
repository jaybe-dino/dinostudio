/**
 * GET /api/cron/slack — 슬랙 수집과 첨부 판독을 **사람 없이** 이어 간다.
 *
 * 왜 필요한가 — 지금까지 이 두 가지는 버튼을 누르고 **그 화면을 켜 둔 동안만**
 * 돌았다. 서버리스 함수는 짧게 끊기므로 한 번에 다 못 가져오고, 그래서 사람이
 * 「이어서 가져오기」를 수십 번 눌러야 끝났다. 실제로는 끝까지 누른 적이 없고
 * 첨부 133건이 미판독으로 남았다. 시간이 대신 눌러 준다.
 *
 * 접근 통제는 알림 크론과 같다 — `CRON_SECRET` 이 없으면 아무 것도 하지 않는다.
 * 인증 없이 열어 두면 밖에서 슬랙 호출을 무한히 트리거할 수 있다.
 *
 * 응답에는 **건수와 막힌 이유만** 담는다. 수집한 메시지 본문에는 주민등록번호와
 * 계좌번호가 들어 있으므로 크론 로그에 절대 싣지 않는다.
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
          "CRON_SECRET 이 설정되지 않았습니다 — 인증 없이 슬랙 수집을 트리거할 수 없습니다",
      },
      503
    );
  if (req.headers.get("authorization") !== `Bearer ${secret}`)
    return json({ ok: false, reason: "unauthorized" }, 401);

  try {
    const state = await getLedgerService().runSlackSync();
    return json(
      {
        ok: true,
        backfillDone: state.backfillDone,
        collected: state.collected,
        attachmentsRead: state.attachmentsRead,
        attachmentsRemaining: state.attachmentsRemaining,
        // 막힌 것은 막혔다고 말한다 — 성공으로 처리하지 않는다
        blocked: state.blocked,
        failures: state.failures.length,
      },
      200
    );
  } catch (error) {
    return json(
      {
        ok: false,
        reason: error instanceof Error ? error.message : "슬랙 수집 실패",
      },
      500
    );
  }
}
