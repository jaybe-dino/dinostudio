/**
 * 알림 규칙 (§12) — 알림이 많아지면 아무도 안 본다.
 * 대표에게 가는 것은 하루 3건이 상한이고 시스템이 강제한다.
 * 도착지가 죽어 있어도 경보가 사라지면 안 되므로 알림함 적재가 기본이다 (B7).
 */
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
import { useErpUi } from "../context";

export function NotificationsScreen() {
  const { goto } = useErpUi();
  const data = trpc.erp.notifications.useQuery();

  const rules = data.data?.rules ?? [];
  const blocked = rules.filter(r => r.blockedReason);

  return (
    <div className="erp-page">
      <header>
        <h1>알림 규칙</h1>
        <p>
          도착지가 아직 정해지지 않아(B7) 전부 알림함에만 쌓입니다. 발송 실패도
          알림함에는 남습니다 — 도착지가 죽어 있어도 경보가 사라지면 안 되기
          때문입니다.
        </p>
      </header>

      <div className="erp-tiles">
        <Tile
          label="알림함"
          value={`${data.data?.delivered.length ?? 0}건`}
          note="지금 울려야 할 것"
          tone={data.data?.delivered.length ? "warn" : "ok"}
        />
        <Tile
          label="대표 상한 초과로 보류"
          value={`${data.data?.capped.length ?? 0}건`}
          note="하루 3건 상한"
        />
        <Tile
          label="발동 불가 규칙"
          value={`${blocked.length}건`}
          note="값이 없어 울릴 수 없는 규칙"
          tone={blocked.length ? "alert" : "ok"}
        />
        <Tile
          label="도착지"
          value="미정"
          note="슬랙 휴면 · 이메일/노션 어댑터 대기 (B7)"
          tone="null"
        />
      </div>

      <Card title="알림함" meta="미발송이어도 적재됩니다" body={false}>
        <div className="erp-scroll">
          <table className="erp-table">
            <thead>
              <tr>
                <th>제목</th>
                <th>내용</th>
                <th>화면</th>
                <th>발송</th>
              </tr>
            </thead>
            <tbody>
              {(data.data?.delivered ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: "var(--muted)" }}>
                    지금 울려야 할 알림이 없습니다
                  </td>
                </tr>
              ) : (
                (data.data?.delivered ?? []).map(n => (
                  <tr key={n.id}>
                    <td className="wrap">{n.title}</td>
                    <td className="wrap">{n.body}</td>
                    <td>
                      {n.screen ? (
                        <button
                          type="button"
                          className="erp-btn"
                          onClick={() => goto(n.screen!)}
                        >
                          이동
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className="erp-chip" data-tone="warn">
                        미발송 (도착지 미정)
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="티어 · 규칙" meta={`${rules.length}개`} body={false}>
        <div className="erp-scroll">
          <table className="erp-table">
            <thead>
              <tr>
                <th>티어</th>
                <th>기준</th>
                <th>수신</th>
                <th>발송</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.id}>
                  <td>
                    <span
                      className="erp-chip"
                      data-tone={
                        rule.tier === "T3"
                          ? "alert"
                          : rule.tier === "T2"
                            ? "warn"
                            : undefined
                      }
                    >
                      {rule.tier}
                    </span>
                  </td>
                  <td className="wrap">{rule.trigger}</td>
                  <td>{rule.recipients.join(" · ")}</td>
                  <td>{rule.channel}</td>
                  <td className="wrap">
                    {rule.blockedReason ? (
                      <span style={{ color: "var(--alert)" }}>
                        {rule.blockedReason}
                      </span>
                    ) : (
                      <span className="erp-chip" data-tone="ok">
                        정상
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {(data.data?.capped ?? []).length > 0 ? (
        <Note tone="warn">
          대표 수신 하루 3건 상한에 걸려 {data.data!.capped.length}건이
          보류됐습니다 — 사라지지 않고 알림함에 남습니다.
        </Note>
      ) : null}
    </div>
  );
}
