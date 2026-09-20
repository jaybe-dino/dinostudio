/**
 * 지급 순서 (docs/erp-qa.md C8)
 *
 * 우선순위는 P0~P3 하나뿐이었다. 같은 P1 안에 열 건이 있으면 무엇을 먼저 낼지는
 * 사람이 그때그때 정했고, 그 결과 연체 건이 뒤로 밀렸다.
 *
 * 순서 — ① 이미 기한이 지난 것 ② 기한이 가까운 것 ③ 금액이 큰 것.
 * 연체를 앞에 두는 이유는 이자·신뢰 비용이 붙기 때문이고, 금액을 마지막에 두는
 * 이유는 큰 건을 먼저 내면 작은 건 여러 개가 동시에 연체되기 때문이다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { shortDate, won } from "../format";
import { AlertBox, Card, Note, PageHead, Scroll } from "../components/Proto";
import { SettleDialog } from "../components/SettleDialog";

function dueChip(daysToDue: number | null) {
  if (daysToDue == null) return <span className="chip n">기한 미입력</span>;
  if (daysToDue < 0) return <span className="chip a">{-daysToDue}일 연체</span>;
  if (daysToDue === 0) return <span className="chip a">오늘</span>;
  if (daysToDue <= 7) return <span className="chip w">{daysToDue}일 남음</span>;
  return <span className="chip">{daysToDue}일 남음</span>;
}

export function PaymentOrderScreen() {
  const q = trpc.erp.paymentOrder.useQuery();
  const me = trpc.erp.me.useQuery();
  const d = q.data;
  /*
   * 실제로 나갔는지 확인하는 사람은 통장을 여는 역할이다 (§13.1). 담당자에게
   * 버튼을 보여 주면 눌러 보고 거절당하는데, 그건 안내가 아니라 헛수고다.
   */
  const canSettle = ["대표", "부대표", "재무"].includes(me.data?.role ?? "");
  const [settling, setSettling] = useState<string | null>(null);

  if (q.error)
    return (
      <>
        <PageHead title="지급 순서" />
        <AlertBox>{q.error.message}</AlertBox>
      </>
    );

  const overdue = (d?.groups ?? []).flatMap(g =>
    g.entries.filter(e => e.daysToDue != null && e.daysToDue < 0)
  );

  return (
    <>
      <PageHead
        title="지급 순서"
        desc="같은 우선순위 안에서 낼 순서를 기한·연체·금액으로 정렬했습니다. 연체가 먼저이고 금액이 마지막입니다 — 큰 건을 먼저 내면 작은 건 여러 개가 같이 연체됩니다."
      />

      {overdue.length > 0 ? (
        <AlertBox>
          <b>이미 기한이 지난 건이 {overdue.length}건 있습니다.</b> 합계{" "}
          {won(overdue.reduce((s, e) => s + (e.entry.amount ?? 0), 0))} — 등급과
          무관하게 이 건들이 먼저입니다.
        </AlertBox>
      ) : null}

      {(d?.groups ?? []).map(group => (
        <Card
          key={group.priority}
          title={`${group.priority} · ${group.entries.length}건`}
          sub={`합계 ${won(group.total)} · 기준일 ${shortDate(d?.today ?? "")}`}
          bare
        >
          <Scroll>
            <table>
              <thead>
                <tr>
                  <th className="n">순서</th>
                  <th>코드</th>
                  <th>거래처</th>
                  <th>항목</th>
                  <th>기한</th>
                  <th>상태</th>
                  <th className="n">남은 금액</th>
                  <th>입출금</th>
                </tr>
              </thead>
              <tbody>
                {group.entries.map((row, i) => (
                  <tr key={row.entry.id}>
                    <td className="n k">{i + 1}</td>
                    <td className="nw">{row.entry.code}</td>
                    <td>
                      {row.partyName ?? (
                        <span className="s">거래처 미지정</span>
                      )}
                    </td>
                    <td className="k">{row.entry.title}</td>
                    <td className="nw">
                      {row.due ? (
                        shortDate(row.due)
                      ) : (
                        <span className="s">—</span>
                      )}
                    </td>
                    <td className="nw">{dueChip(row.daysToDue)}</td>
                    <td className="n">
                      {row.entry.amount == null ? (
                        <span className="s">판정 대기</span>
                      ) : (
                        <>
                          {won(row.settlement.remaining ?? row.entry.amount)}
                          {row.settlement.state === "부분 확인" ? (
                            <div className="s">
                              전체 {won(row.entry.amount)} · 확인{" "}
                              {won(row.settlement.settled)}
                            </div>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="nw">
                      {row.entry.status !== "confirmed" ? (
                        <span className="s">승인 후</span>
                      ) : !canSettle ? (
                        <span className="s">재무 확인</span>
                      ) : (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setSettling(row.entry.code)}
                        >
                          {row.settlement.state === "부분 확인"
                            ? "나머지 확인"
                            : "입출금 확인"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </Card>
      ))}

      {(d?.groups.length ?? 0) === 0 && !q.isLoading ? (
        <Note>아직 낼 것으로 남아 있는 건이 없습니다.</Note>
      ) : null}

      {settling ? (
        <SettleDialog
          code={settling}
          onClose={() => setSettling(null)}
          onDone={() => {
            setSettling(null);
            void q.refetch();
          }}
        />
      ) : null}

      <Note>
        <b>이 순서는 제안입니다 — 시스템이 지급을 실행하지 않습니다.</b>{" "}
        <b>「입출금 확인」은 이미 나간 돈을 기록하는 것</b>이지 이체를 실행하는
        것이 아닙니다. 통장에서 실제로 빠진 것을 보고 누르십시오. 기한이 비어
        있는 건은 정렬 근거가 없어 뒤로 갑니다. 계약의 지급조건이 마스터에 들어
        있으면 기한이 자동으로 채워집니다.
      </Note>
    </>
  );
}
