/**
 * 세무 일정 (docs/erp-qa.md B4 · B5 · B7 · B10 · A15)
 *
 * 놓치면 가산세가 붙는 것만 모은다.
 * 특히 **우리가 발행해야 하는 세금계산서** — 지금까지 시스템은 받는 것만 다뤘다.
 */
import { trpc } from "@/lib/trpc";
import { DEADLINE_WARN_DAYS } from "@shared/erp";
import { useErpUi } from "../context";
import { won } from "../format";
import {
  AlertBox,
  Card,
  Kpis,
  Note,
  OkBox,
  PageHead,
  Scroll,
} from "../components/Proto";

const STATUS_CHIP: Record<string, string> = {
  발행완료: "chip g",
  발행대기: "chip",
  기한임박: "chip w",
  기한초과: "chip a",
};

export function TaxScreen() {
  const { openEntry } = useErpUi();
  const tax = trpc.erp.tax.useQuery();
  const vat = trpc.erp.vat.useQuery(undefined);

  if (tax.error)
    return (
      <>
        <PageHead title="세무 일정" />
        <AlertBox>{tax.error.message}</AlertBox>
      </>
    );

  const d = tax.data;
  const urgent = (d?.calendar ?? []).filter(
    c => c.daysLeft <= DEADLINE_WARN_DAYS
  );

  return (
    <>
      <PageHead
        title="세무 일정"
        desc="놓치면 가산세가 붙는 것만 모았습니다. 「알아두면 좋은 것」은 넣지 않았습니다 — 캘린더가 길어지면 아무도 보지 않습니다."
      />

      <Kpis
        items={[
          {
            k: "발행 기한 초과",
            v: d ? `${d.counts.overdue}건` : "—",
            s: "지연발행 가산세 대상",
            tone: d && d.counts.overdue > 0 ? "bad" : undefined,
          },
          {
            k: "발행 기한 임박",
            v: d ? `${d.counts.soon}건` : "—",
            s: "5일 이내",
            tone: d && d.counts.soon > 0 ? "warn" : undefined,
          },
          {
            k: "이번 분기 부가세",
            v:
              d?.vat == null
                ? "계산 불가"
                : d.vat.isRefund
                  ? `환급 ${won(Math.abs(d.vat.payable))}`
                  : won(d.vat.payable),
            s: d?.vat?.period.label ?? "과세기간 확인 필요",
          },
          {
            k: "임박한 신고",
            v: `${urgent.length}건`,
            s: `${DEADLINE_WARN_DAYS}일 이내`,
            tone: urgent.length > 0 ? "warn" : undefined,
          },
        ]}
      />

      {d && d.counts.overdue > 0 ? (
        <AlertBox>
          <b>세금계산서 발행 기한을 넘긴 건이 {d.counts.overdue}건 있습니다.</b>{" "}
          공급일이 속한 달의 다음 달 10일이 기한이고, 넘기면 지연발행 가산세가
          붙습니다. 아래 표에서 「기한초과」를 먼저 처리하십시오.
        </AlertBox>
      ) : null}

      <Card title="신고 · 납부 캘린더" sub="기한이 가까운 순서" bare>
        <Scroll>
          <table>
            <thead>
              <tr>
                <th>세목</th>
                <th>내용</th>
                <th>기한</th>
                <th className="n">남은 일수</th>
                <th className="n">금액</th>
                <th>놓치면</th>
              </tr>
            </thead>
            <tbody>
              {(d?.calendar ?? []).map(c => (
                <tr key={`${c.kind}-${c.dueDate}`}>
                  <td className="nw">
                    <span
                      className={
                        c.daysLeft < 0
                          ? "chip a"
                          : c.daysLeft <= DEADLINE_WARN_DAYS
                            ? "chip w"
                            : "chip"
                      }
                    >
                      {c.kind}
                    </span>
                  </td>
                  <td className="k">{c.label}</td>
                  <td className="m nw">{c.dueDate}</td>
                  <td className="n">
                    {c.daysLeft < 0 ? `${c.daysLeft}일` : `D-${c.daysLeft}`}
                  </td>
                  <td className="n">
                    {c.amount == null ? (
                      <span className="s">계산 불가</span>
                    ) : (
                      won(c.amount)
                    )}
                  </td>
                  <td className="s">{c.penalty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      </Card>

      <Note>
        <b>금액이 「계산 불가」인 것은 0 이 아닙니다.</b> 시스템이 아직 그
        금액을 모른다는 뜻입니다 — 4대보험·법인세는 외부 자료가 필요하고,
        지급명세서는 금액 신고가 아닙니다. 0 으로 채우면 「낼 게 없다」로
        읽힙니다.
      </Note>

      <Card
        title="우리가 발행해야 하는 세금계산서"
        sub={`${d?.obligations.length ?? 0}건 · 공급일 다음 달 10일이 기한`}
        bare
      >
        <Scroll>
          <table>
            <thead>
              <tr>
                <th>상태</th>
                <th>코드</th>
                <th>항목</th>
                <th>공급일</th>
                <th>발행기한</th>
                <th className="n">남은 일수</th>
                <th className="n">금액</th>
                <th>계산서번호</th>
              </tr>
            </thead>
            <tbody>
              {(d?.obligations ?? []).map(o => (
                <tr key={o.code}>
                  <td className="nw">
                    <span className={STATUS_CHIP[o.status] ?? "chip"}>
                      {o.status}
                    </span>
                  </td>
                  <td className="nw">
                    <button
                      type="button"
                      className="m"
                      style={{
                        border: 0,
                        background: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: "var(--accent)",
                        font: "inherit",
                      }}
                      onClick={() => openEntry(o.code)}
                    >
                      {o.code}
                    </button>
                  </td>
                  <td className="k">{o.title}</td>
                  <td className="m nw">{o.supplyDate}</td>
                  <td className="m nw">{o.dueDate}</td>
                  <td className="n">
                    {o.status === "발행완료"
                      ? "—"
                      : o.daysLeft < 0
                        ? `${o.daysLeft}일`
                        : `D-${o.daysLeft}`}
                  </td>
                  <td className="n">{won(o.amount)}</td>
                  <td className="m s">{o.invoiceNo ?? "—"}</td>
                </tr>
              ))}
              {(d?.obligations.length ?? 0) === 0 && !tax.isLoading ? (
                <tr>
                  <td colSpan={8} className="s">
                    발행 의무가 있는 매출 건이 없습니다
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Scroll>
      </Card>

      <Card
        title="부가세 과세기간"
        sub="마감은 월 단위인데 신고는 분기 단위입니다"
        bare
      >
        <Scroll>
          <table>
            <thead>
              <tr>
                <th>과세기간</th>
                <th>기간</th>
                <th>신고기한</th>
                <th className="n">매출세액</th>
                <th className="n">매입세액</th>
                <th className="n">낼 돈</th>
              </tr>
            </thead>
            <tbody>
              {(vat.data?.settlements ?? []).map(s => (
                <tr
                  key={s.period.label}
                  className={
                    s.period.label === vat.data?.currentPeriod?.label
                      ? "hl"
                      : undefined
                  }
                >
                  <td className="k nw">{s.period.label}</td>
                  <td className="m nw">
                    {s.period.from} ~ {s.period.to}
                  </td>
                  <td className="m nw">{s.period.dueDate}</td>
                  <td className="n">{won(s.output)}</td>
                  <td className="n">{won(s.input)}</td>
                  <td className="n">
                    {s.isRefund ? (
                      <span style={{ color: "var(--accent)" }}>
                        환급 {won(Math.abs(s.payable))}
                      </span>
                    ) : (
                      won(s.payable)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      </Card>

      <OkBox>
        <b>기한과 세율은 세무대리인 확인이 필요합니다.</b> 회사 형태·규모에 따라
        달라지고, 반기납부 특례 같은 예외도 있습니다. 이 화면은 「놓치지 않게
        하는 것」이 목적이고, 최종 판단은 세무대리인이 합니다.
      </OkBox>
    </>
  );
}
