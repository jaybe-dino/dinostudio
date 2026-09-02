/**
 * 종합 현황 — 확정도 배지와 「계산 불가」 표시가 이 화면의 핵심이다.
 * 값이 없으면 0으로 그리지 않고 무엇이 필요한지를 쓴다 (§10.2 · 원칙 8).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile, chipClass } from "../components/Bits";
import { useErpUi } from "../context";
import { shortfallTone, signedWon, won } from "../format";

const BLOCKERS = [
  { id: "B1", text: "급여 실액 — 번레이트의 최대 항목", owner: "대표" },
  { id: "B2", text: "차입 약정서 5건 만기·이자율", owner: "대표" },
  {
    id: "B3",
    text: "VAT 표기 기준 — 전사 통일 vs 원장 분리 저장",
    owner: "재무 + 대표",
  },
  { id: "B5", text: "이관 조정 사유 — 08/24 잔액 불일치", owner: "재무" },
  {
    id: "B9",
    text: "부가세 2차 금액 불일치 — 12,000,000(카드) vs 적요칸 1,200",
    owner: "재무",
  },
];

export function OverviewScreen() {
  const { goto } = useErpUi();
  const ledger = trpc.erp.entries.list.useQuery({});
  const position = trpc.erp.views.cashPosition.useQuery({
    includeUndecided: true,
  });
  const cashflow = trpc.erp.views.cashflow.useQuery({ unit: "month" });
  const migration = trpc.erp.migration.useQuery();
  const me = trpc.erp.me.useQuery();
  const store = trpc.erp.storeStatus.useQuery();
  const utils = trpc.useUtils();
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const seed = trpc.erp.seedDatabase.useMutation({
    onSuccess: async result => {
      const { accounts, snapshots, entries, settings } = result.inserted;
      setSeedMessage(
        `적재 완료 — 계정과목 ${accounts}개 확인 · 이관 일계 ${snapshots}행 · 원장 ${entries}건 · 기준값 ${settings}개` +
          (result.skipped > 0
            ? ` (이미 있던 ${result.skipped}건은 건드리지 않았습니다)`
            : "")
      );
      await utils.erp.invalidate();
    },
    onError: error => setSeedMessage(error.message),
  });

  const undecided = ledger.data?.out.excluded.undecided.n ?? 0;
  const pending = ledger.data?.out.excluded.pending ?? { n: 0, amount: null };
  const failing = (migration.data?.checks ?? []).filter(
    c => c.verdict === "fail"
  );
  const lastBlock = cashflow.data?.blocks.at(-1);

  return (
    <>
      <div className="ph">
        <div>
          <h1>종합 현황</h1>
          <div className="desc">
            {me.data ? `${me.data.role} 권한으로 보고 있습니다. ` : ""}
            지표마다 확정도가 붙습니다. 계산 불가는 오류가 아니라 「무엇이 아직
            없다」는 답입니다.
          </div>
        </div>
      </div>

      <div className="kpis">
        <Tile
          label="보유현금"
          value={won(position.data?.cashOnHand ?? null) ?? "계산 불가"}
          note={
            position.data?.cashOnHandIsProvisional
              ? "임시 · 계좌 대사 전"
              : "확정"
          }
          tone={position.data?.cashOnHand == null ? "null" : undefined}
        />
        <Tile
          label="P0까지 부족액"
          value={
            signedWon(position.data?.tiers[0].shortfall ?? null) ?? "계산 불가"
          }
          note="기업 신용과 직결 · 연기 불가"
          tone={shortfallTone(position.data?.tiers[0].shortfall ?? null)}
        />
        <Tile
          label="확정 지출"
          value={won(ledger.data?.out.sum ?? 0) ?? "—"}
          note={`${ledger.data?.out.count ?? 0}건 · 확정`}
        />
        <Tile
          label="확정 수입"
          value={won(ledger.data?.in.sum ?? 0) ?? "—"}
          note={`${ledger.data?.in.count ?? 0}건 · 확정`}
        />
        <Tile
          label="승인 대기"
          value={won(pending.amount) ?? "계산 불가"}
          note={`${pending.n}건 · 예약런웨이만`}
          tone="warn"
        />
        <Tile
          label="판정 대기"
          value="계산 불가"
          note={`${undecided}건 · 어떤 합계에도 없음`}
          tone="null"
        />
        <Tile
          label="월 번레이트"
          value="계산 불가"
          note="B1 급여 실액 · 마감된 월 0개"
          tone="null"
        />
        <Tile
          label="런웨이 3종"
          value="계산 불가"
          note="분모 없음 — 라벨 없이 「런웨이」라 쓰지 않습니다"
          tone="null"
        />
      </div>

      {lastBlock && lastBlock.close == null ? (
        <Note tone="warn">
          최근 월 종료 잔액이 확정되지 않았습니다 — 판정 대기 승계. 판정 대기
          건의 금액·단위가 확정되면 그 날부터 다시 이어집니다.
        </Note>
      ) : null}

      {store.data ? (
        <Card
          title="원장이 어디에 저장되고 있나"
          meta={store.data.database ? "PostgreSQL (Neon)" : "메모리"}
        >
          <Note tone={store.data.database ? undefined : "alert"}>
            {store.data.note}
          </Note>

          {store.data.database && (migration.data?.entryCount ?? 0) === 0 ? (
            <div style={{ marginTop: 10 }}>
              <Note tone="warn">
                <b>DB 는 붙었지만 아직 비어 있습니다.</b> §5.4 시드(원장 27건 ·
                이관 일계 7행 · 계정과목 · 기준값)를 넣으면 이관 검증 리포트가
                아래에 나옵니다.
              </Note>
              <button
                type="button"
                className="btn pri"
                style={{ marginTop: 8 }}
                disabled={seed.isPending || me.data?.role !== "대표"}
                onClick={() => seed.mutate()}
              >
                {seed.isPending ? "적재 중…" : "시드 적재 + 이관 검증 실행"}
              </button>
              {me.data?.role !== "대표" ? (
                <p className="s" style={{ marginTop: 6 }}>
                  원장 전체를 만드는 작업이라 대표만 실행할 수 있습니다.
                </p>
              ) : null}
            </div>
          ) : null}

          {seedMessage ? (
            <div style={{ marginTop: 10 }}>
              <Note>{seedMessage}</Note>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card
        title="이관 검증 리포트 (§5.5)"
        meta={`${migration.data?.entryCount ?? 0}건 원장 · ${migration.data?.snapshotCount ?? 0}행 일계`}
        body={false}
      >
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>검증</th>
                <th>식</th>
                <th>결과</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {(migration.data?.checks ?? []).map(check => (
                <tr key={check.id}>
                  <td style={{ fontFamily: "var(--mono)" }}>{check.id}</td>
                  <td>{check.name}</td>
                  <td className="s">{check.formula}</td>
                  <td>
                    <span
                      className={chipClass(
                        check.verdict === "pass"
                          ? "ok"
                          : check.verdict === "fail"
                            ? "alert"
                            : "info"
                      )}
                    >
                      {check.verdict === "pass"
                        ? "통과"
                        : check.verdict === "fail"
                          ? "불일치"
                          : "대상 아님"}
                    </span>
                  </td>
                  <td className="wrap">{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {failing.length > 0 ? (
        <Note tone="alert">
          월 마감 차단 {failing.length}건 —{" "}
          {failing.map(c => `${c.id} ${c.name}`).join(" · ")}
          {undecided > 0 ? ` · 판정 대기 ${undecided}건` : ""}. 차액을 조정
          전표로 만들어 억지로 맞추지 않습니다.
        </Note>
      ) : null}

      <Card title="지금 막고 있는 것" meta="코드로 해결되지 않는 항목">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>내용</th>
                <th>담당</th>
              </tr>
            </thead>
            <tbody>
              {BLOCKERS.map(b => (
                <tr key={b.id}>
                  <td style={{ fontFamily: "var(--mono)" }}>{b.id}</td>
                  <td className="wrap">{b.text}</td>
                  <td>{b.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="btn" onClick={() => goto("cashflow")}>
          현금흐름표로
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => goto("cash-position")}
        >
          현금 현황으로
        </button>
        <button type="button" className="btn" onClick={() => goto("approvals")}>
          승인 대기로
        </button>
      </div>
    </>
  );
}
