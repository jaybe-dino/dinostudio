/**
 * 월 마감 — blockers가 비어야만 성공한다 (§10.1 · T12).
 * 차액을 조정 전표로 만들어 억지로 통과시키지 않는다 (원칙 8).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile, chipClass } from "../components/Bits";
import { won } from "../format";

export function ClosingScreen() {
  const utils = trpc.useUtils();
  const [ym, setYm] = useState("2026-08");
  const [result, setResult] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);

  const masters = trpc.erp.masters.useQuery();
  const migration = trpc.erp.migration.useQuery();
  const ledger = trpc.erp.entries.list.useQuery({});
  const settings = trpc.erp.settings.useQuery();

  const close = trpc.erp.closePeriod.useMutation({
    onSuccess: async period => {
      setResult(
        period.carryForward.value == null
          ? `${period.ym} 마감 완료 — 이 기간의 원장 수정이 거부됩니다. ${period.carryForward.blockedBy}`
          : `${period.ym} 마감 완료 — 이 기간의 원장 수정이 거부됩니다. ${period.carryForward.ym} 기초잔액 ${won(period.carryForward.value)} 을 이월했습니다.`
      );
      setBlockers([]);
      await Promise.all([
        utils.erp.masters.invalidate(),
        utils.erp.financialStatements.invalidate(),
        utils.erp.settings.invalidate(),
      ]);
    },
    onError: async error => {
      setResult(error.message);
      await utils.erp.masters.invalidate();
      const periods = (await utils.erp.masters.fetch()).periods;
      setBlockers(periods.find(p => p.ym === ym)?.blockers ?? []);
    },
  });

  const periods = masters.data?.periods ?? [];
  // 마감이 만들어 둔 이월 기초잔액 (A12)
  const carried = (settings.data ?? [])
    .filter(item => item.key.startsWith("opening_cash:"))
    .sort((a, b) => a.key.localeCompare(b.key));
  const undecided = ledger.data?.out.excluded.undecided.n ?? 0;
  const failing = (migration.data?.checks ?? []).filter(
    c => c.verdict === "fail"
  );

  return (
    <>
      <div className="ph">
        <div>
          <h1>월 마감</h1>
          <div className="desc">
            마감된 기간의 건은 수정 자체를 거부합니다. 마감은 blockers가 하나도
            없을 때만 성공하고, 잔액이 안 맞으면 차액을 조정 전표로 만들어
            억지로 맞추지 않습니다 — 불일치를 그대로 노출하는 것이 설계
            의도입니다.
          </div>
        </div>
      </div>

      <div className="kpis">
        <Tile
          label="마감된 월"
          value={`${periods.filter(p => p.status === "closed").length}개`}
          note="번레이트 산출 조건 1"
          tone={periods.some(p => p.status === "closed") ? "ok" : "alert"}
        />
        <Tile
          label="판정 대기"
          value={`${undecided}건`}
          note="마감 차단 요인"
          tone={undecided > 0 ? "alert" : "ok"}
        />
        <Tile
          label="이관 검증 불일치"
          value={`${failing.length}건`}
          note={failing.map(c => c.id).join(" · ") || "없음"}
          tone={failing.length > 0 ? "alert" : "ok"}
        />
      </div>

      <Card title="마감 실행">
        <div className="filters">
          <label className="field">
            <span>대상 월 (YYYY-MM)</span>
            <input value={ym} onChange={e => setYm(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn pri"
            disabled={close.isPending}
            onClick={() => close.mutate({ ym })}
          >
            마감 시도
          </button>
        </div>
        {result ? (
          <div style={{ marginTop: 10 }}>
            <Note tone={blockers.length > 0 ? "alert" : undefined}>
              {result}
            </Note>
          </div>
        ) : null}
        {blockers.length > 0 ? (
          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            {blockers.map(b => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card
        title="월별 기초잔액 — 마감이 만든 이월"
        meta={`${carried.length}개월`}
        body={false}
      >
        <table>
          <thead>
            <tr>
              <th>기간</th>
              <th className="n">기초잔액</th>
              <th>출처</th>
            </tr>
          </thead>
          <tbody>
            {carried.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ color: "var(--muted)" }}>
                  아직 이월된 기초잔액이 없습니다 — 첫 마감이 끝나면 다음 달
                  기초잔액이 여기에 생깁니다
                </td>
              </tr>
            ) : (
              carried.map(item => (
                <tr key={item.key}>
                  <td style={{ fontFamily: "var(--mono)" }}>
                    {item.key.replace("opening_cash:", "")}
                  </td>
                  <td className="n">{won(Number(item.value))}</td>
                  <td>
                    <span className={chipClass("ok")}>마감 자동 이월</span>{" "}
                    {item.updatedBy ?? ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Note>
        기초잔액은 마감이 끝난 달의 현금 증감으로 계산해 다음 달로 넘깁니다 —
        사람이 매달 넣지 않습니다. 손으로 넣는 것은 이관 첫 달{" "}
        <code>cash_on_hand</code> 하나뿐이고, 그 달의 기초는 원장 밖에 있기
        때문입니다.
      </Note>

      <Card title="기간" meta={`${periods.length}개`} body={false}>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>기간</th>
                <th>상태</th>
                <th>마감자</th>
                <th>차단 사유</th>
              </tr>
            </thead>
            <tbody>
              {periods.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: "var(--muted)" }}>
                    아직 마감을 시도한 기간이 없습니다
                  </td>
                </tr>
              ) : (
                periods.map(period => (
                  <tr key={period.ym}>
                    <td style={{ fontFamily: "var(--mono)" }}>{period.ym}</td>
                    <td>
                      <span
                        className={chipClass(
                          period.status === "closed" ? "ok" : "warn"
                        )}
                      >
                        {period.status === "closed" ? "마감" : "열림"}
                      </span>
                    </td>
                    <td>{period.closedBy ?? "—"}</td>
                    <td className="wrap">
                      {period.blockers.join(" · ") || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
