/**
 * 13주 자금계획 (§9.5) — Base / Stress / Upside.
 * 성사확률(B10)과 상환 라인(B2)이 없으면 그만큼을 빼고 계산하고, 뺐다는 사실을 노출한다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
import { shortDate, signedWon, won } from "../format";

const SCENARIOS = ["Base", "Stress", "Upside"] as const;
type Scenario = (typeof SCENARIOS)[number];

const DESCRIPTION: Record<Scenario, string> = {
  Base: "예정대로 회수·집행",
  Stress: "회수 −30% · 지출 +10%",
  Upside: "회수 +10%",
};

export function Forecast13wScreen() {
  const [scenario, setScenario] = useState<Scenario>("Base");
  const forecast = trpc.erp.forecast.useQuery({ scenario });

  return (
    <>
      <div className="ph">
        <div>
          <h1>13주 자금계획</h1>
          <div className="desc">
            주차별 잔액(w) = 잔액(w−1) + 예정입금(w) − 예정지출(w). 예정입금은
            계산서가 발행된 미수의 입금예정일만 넣습니다 — 발행 전 파이프라인은
            성사확률이 정해지기 전까지 넣지 않습니다.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {SCENARIOS.map(s => (
          <button
            key={s}
            type="button"
            className="btn"
            aria-pressed={scenario === s}
            onClick={() => setScenario(s)}
          >
            {s} <span className="s">· {DESCRIPTION[s]}</span>
          </button>
        ))}
      </div>

      <div className="kpis">
        <Tile
          label="시작 잔액"
          value={won(forecast.data?.weeks[0]?.open ?? null) ?? "계산 불가"}
          note="보유현금 (계좌 대사 기준)"
          tone={forecast.data?.weeks[0]?.open == null ? "null" : undefined}
        />
        <Tile
          label="잔액이 처음 음수가 되는 주차"
          value={
            forecast.data?.firstNegativeWeek
              ? `${forecast.data.firstNegativeWeek}주차`
              : "없음"
          }
          note="13주 안에서"
          tone={forecast.data?.firstNegativeWeek ? "alert" : "ok"}
        />
        <Tile
          label="예상런웨이"
          value={
            forecast.data?.expectedRunwayWeeks == null
              ? "계산 불가"
              : `${forecast.data.expectedRunwayWeeks}주`
          }
          note="라벨 없이 「런웨이」라 쓰지 않습니다"
          tone={
            forecast.data?.expectedRunwayWeeks == null
              ? "null"
              : forecast.data.expectedRunwayWeeks < 8
                ? "alert"
                : "ok"
          }
        />
        <Tile
          label="연체 미수 (주차 미반영)"
          value={won(forecast.data?.overdueNotScheduled.amount ?? 0) ?? "—"}
          note={`${forecast.data?.overdueNotScheduled.codes.length ?? 0}건 · 회수 일정이 잡히면 그 주차에 들어갑니다`}
          tone={forecast.data?.overdueNotScheduled.amount ? "warn" : undefined}
        />
        <Tile
          label="13주 말 잔액"
          value={
            signedWon(forecast.data?.weeks.at(-1)?.close ?? null) ?? "계산 불가"
          }
          note={scenario}
          tone={
            forecast.data?.weeks.at(-1)?.close == null
              ? "null"
              : (forecast.data.weeks.at(-1)!.close ?? 0) < 0
                ? "alert"
                : "ok"
          }
        />
      </div>

      {(forecast.data?.blockers ?? []).map(b => (
        <Note key={b} tone="warn">
          {b}
        </Note>
      ))}

      <Card
        title={`주차별 잔액 · ${scenario}`}
        meta={DESCRIPTION[scenario]}
        body={false}
      >
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>주차</th>
                <th>기간</th>
                <th className="num">시작</th>
                <th className="num">예정입금</th>
                <th className="num">예정지출</th>
                <th className="num">종료</th>
                <th>근거</th>
              </tr>
            </thead>
            <tbody>
              {(forecast.data?.weeks ?? []).map(week => (
                <tr key={week.index}>
                  <td style={{ fontFamily: "var(--mono)" }}>W{week.index}</td>
                  <td>
                    {shortDate(week.start)} – {shortDate(week.end)}
                  </td>
                  <td className="num">
                    {won(week.open) ?? <span className="s">계산 불가</span>}
                  </td>
                  <td className="num">{won(week.inflow)}</td>
                  <td className="num">{won(week.outflow)}</td>
                  <td
                    className="num"
                    style={{
                      color: (week.close ?? 0) < 0 ? "var(--alert)" : undefined,
                    }}
                  >
                    {won(week.close) ?? <span className="s">계산 불가</span>}
                  </td>
                  <td className="wrap s">
                    {[...week.inflowCodes, ...week.outflowCodes].join(" ") ||
                      "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="파이프라인을 넣으려면">
        <p style={{ margin: 0 }}>
          성사 가능성 상/중/하를 확률(예: 70 / 40 / 10)로 확정해 주시면 발행
          대기 건이 예정입금에 가중 반영됩니다. 확정 전까지는 낙관 편향을 막기
          위해 0으로 둡니다. Stress 시나리오는 확정서가 없는 건을 특히 0으로
          봅니다.
        </p>
      </Card>
    </>
  );
}
