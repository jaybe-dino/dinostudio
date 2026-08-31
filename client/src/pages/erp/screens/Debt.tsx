/**
 * 부채 원장 · 부채·조달 (§9.4)
 * 만기가 없으면 알람 규칙은 존재하되 발동하지 않는다 — 그 사실을 화면에 그대로 쓴다 (B2).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { ErpOutputs } from "../api";
import { Card, Money, Note, Tile, chipClass } from "../components/Bits";
import { DataTable, type Column } from "../components/DataTable";
import { matchesQuery, useErpUi } from "../context";
import { won } from "../format";

type Line = ErpOutputs["debt"]["lines"][number];

export function DebtScreen({ variant }: { variant: "ledger" | "funding" }) {
  const { query } = useErpUi();
  const utils = trpc.useUtils();
  const debt = trpc.erp.debt.useQuery();
  const forecast = trpc.erp.forecast.useQuery({ scenario: "Base" });
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const upsert = trpc.erp.upsertMaster.useMutation({
    onSuccess: async () => {
      setMessage(
        "저장했습니다 — 만기가 들어오면 D-30/D-14/D-7 알람이 즉시 살아납니다."
      );
      await Promise.all([
        utils.erp.debt.invalidate(),
        utils.erp.notifications.invalidate(),
      ]);
    },
    onError: e => setMessage(e.message),
  });

  const rows = (debt.data?.lines ?? []).filter(l =>
    matchesQuery(query, l.debt.creditor, l.debt.code)
  );

  const columns: Column<Line>[] = [
    {
      key: "code",
      header: "코드",
      sortValue: l => l.debt.code,
      render: l => (
        <span style={{ fontFamily: "var(--mono)" }}>{l.debt.code}</span>
      ),
    },
    {
      key: "creditor",
      header: "채권자",
      sortValue: l => l.debt.creditor,
      render: l => l.debt.creditor,
      wrap: true,
    },
    {
      key: "term",
      header: "성격",
      sortValue: l => l.debt.term,
      render: l => (
        <>
          {l.debt.term}
          {l.debt.isRelatedParty ? (
            <span className="chip" style={{ marginLeft: 4 }}>
              특수관계
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: "principal",
      header: "잔액",
      numeric: true,
      sortValue: l => l.debt.principal,
      render: l => <Money value={l.debt.principal} reason="건별 잔액 미분해" />,
    },
    {
      key: "maturity",
      header: "만기",
      sortValue: l => l.debt.maturityDate ?? "",
      render: l => l.debt.maturityDate ?? <span className="s">미확인</span>,
    },
    {
      key: "dday",
      header: "D-day",
      numeric: true,
      sortValue: l => l.dDay,
      render: l =>
        l.dDay == null ? <span className="s">발동 불가</span> : `D-${l.dDay}`,
    },
    {
      key: "interest",
      header: "월 이자",
      numeric: true,
      sortValue: l => l.debt.monthlyInterest,
      render: l => (
        <Money value={l.debt.monthlyInterest} reason="약정서 미확인" />
      ),
    },
    {
      key: "state",
      header: "상태",
      sortValue: l => l.state,
      render: l => (
        <span
          className={chipClass(
            l.state === "만기 미확인"
              ? "alert"
              : l.state === "정상"
                ? "ok"
                : "warn"
          )}
        >
          {l.state}
        </span>
      ),
    },
    {
      key: "set",
      header: "만기 입력",
      render: l => (
        <div style={{ display: "flex", gap: 4 }}>
          <input
            type="date"
            value={edit[l.debt.id] ?? l.debt.maturityDate ?? ""}
            onChange={e =>
              setEdit(prev => ({ ...prev, [l.debt.id]: e.target.value }))
            }
            style={{
              padding: "2px 4px",
              border: "1px solid var(--rule)",
              borderRadius: 4,
              font: "inherit",
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={!edit[l.debt.id] || upsert.isPending}
            onClick={() =>
              upsert.mutate({
                kind: "debt",
                payload: { ...l.debt, maturityDate: edit[l.debt.id] } as never,
              })
            }
          >
            저장
          </button>
        </div>
      ),
    },
  ];

  if (variant === "ledger") {
    return (
      <>
        <div className="ph">
          <div>
            <h1>부채 원장</h1>
            <div className="desc">
              만기·이자율·상환조건이 확인되면 13주 자금계획의 상환 라인과 만기
              알람이 함께 살아납니다. 지금은 다섯 건 전부 미확인입니다.
            </div>
          </div>
        </div>

        <div className="kpis">
          <Tile
            label="총 부채"
            value={won(debt.data?.total ?? null) ?? "계산 불가"}
            note="단기 + 장기"
            tone={debt.data?.total == null ? "null" : undefined}
          />
          <Tile
            label="단기"
            value={won(debt.data?.shortTerm ?? 0) ?? "—"}
            note="특수관계 차입"
            tone="warn"
          />
          <Tile
            label="장기 (건별 미분해)"
            value={won(debt.data?.principalUndecomposed ?? null) ?? "계산 불가"}
            note="총액만 보유 — 건별 잔액 미확인"
            tone="null"
          />
          <Tile
            label="월 이자"
            value={won(debt.data?.monthlyInterest ?? null) ?? "계산 불가"}
            note="실제 지급액 기준"
          />
          <Tile
            label="이자보상배율"
            value="계산 불가"
            note={debt.data?.interestCoverageNullReason ?? ""}
            tone="null"
          />
          <Tile
            label="만기 미확인"
            value={`${debt.data?.maturityUnknown ?? 0}건`}
            note="알람 발동 불가 (B2)"
            tone="alert"
          />
        </div>

        {(debt.data?.blockers ?? []).map(b => (
          <Note key={b} tone="alert">
            {b}
          </Note>
        ))}
        {message ? <Note>{message}</Note> : null}

        <Card title="차입 원장" meta={`${rows.length}건`} body={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={l => l.debt.id}
            initialSort={{ key: "code", dir: "asc" }}
          />
        </Card>

        <Card title="이자는 영업활동, 원금 상환만 재무활동">
          <p style={{ margin: 0 }}>
            원리금을 한 덩어리로 처리하면 영업활동이 실제보다 좋아 보입니다.
            8110 이자비용과 2210·2310 차입금은 반드시 다른 건으로 분리 입력해야
            하고, 시스템은 그 두 계정을 서로 다른 현금흐름 구간으로 자동
            분류합니다.
          </p>
        </Card>
      </>
    );
  }

  const gates = [
    {
      label: "예상런웨이 8주 미만",
      value:
        forecast.data?.expectedRunwayWeeks == null
          ? "계산 불가"
          : `${forecast.data.expectedRunwayWeeks}주`,
      fired:
        forecast.data?.expectedRunwayWeeks != null &&
        forecast.data.expectedRunwayWeeks < 8,
      blocked: forecast.data?.expectedRunwayWeeks == null,
    },
    {
      label: "커버리지 1.0 미만",
      value: "재산출 대기",
      fired: false,
      blocked: true,
    },
    {
      label: "13주 내 잔액 마이너스",
      value: forecast.data?.firstNegativeWeek
        ? `${forecast.data.firstNegativeWeek}주차`
        : "없음",
      fired: Boolean(forecast.data?.firstNegativeWeek),
      blocked: forecast.data?.expectedRunwayWeeks == null,
    },
    {
      label: "단기차입 만기 30일 전",
      value: "만기 미확인",
      fired: false,
      blocked: true,
    },
  ];

  return (
    <>
      <div className="ph">
        <div>
          <h1>부채 · 조달</h1>
          <div className="desc">
            협상장에서 통하는 말은 「매출이 늘고 있습니다」가 아니라
            「기여이익이 월 X, 커버리지가 Y까지 왔습니다」입니다. 그 숫자가
            나오려면 만기·이자·귀속이 먼저 채워져야 합니다.
          </div>
        </div>
      </div>

      <Card
        title="조달 게이트"
        meta={`${gates.filter(g => g.fired).length}건 발동 · ${gates.filter(g => g.blocked).length}건 판정 불가`}
        body={false}
      >
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>게이트</th>
                <th>현재</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {gates.map(gate => (
                <tr key={gate.label}>
                  <td>{gate.label}</td>
                  <td className={gate.blocked ? "s" : undefined}>
                    {gate.value}
                  </td>
                  <td>
                    <span
                      className={chipClass(
                        gate.fired ? "alert" : gate.blocked ? "warn" : "ok"
                      )}
                    >
                      {gate.fired
                        ? "발동"
                        : gate.blocked
                          ? "판정 불가"
                          : "정상"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="권고 순서 — 회수 → 지출 조정 → 차입">
        <p style={{ margin: 0 }}>
          회수는 비용이 0이고, 지출 조정은 신뢰 비용만 듭니다. 차입은
          마지막입니다.
        </p>
      </Card>

      <Card title="이번 분기 과제">
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            서면화 — 특수관계 차입의 만기·이자·상환조건 문서화. 조건이 없으면
            성격상 자본이어도 그냥 단기부채입니다
          </li>
          <li>
            전환 협상 — 가능하면 장기 전환 또는 출자 전환. 유동비율이 개선됩니다
          </li>
          <li>재협상 자료 — 기여이익·커버리지 데이터로 금리·만기 재협상</li>
        </ol>
      </Card>
    </>
  );
}
