/**
 * 오늘의 3가지 · 결정 큐 (E3 비서실장)
 *
 * 대표에게 도달하는 것은 걸러진 것만이다. 4번째부터는 담당 리더로 라우팅된다.
 * 무엇이 「시급」인지는 점수 규칙이 정한다 — 에이전트가 임의로 고르지 않는다.
 * 그래서 이 화면은 순위와 함께 **점수 계산 근거를 그대로** 보여 준다.
 */
import { trpc } from "@/lib/trpc";
import {
  AXIS_LABEL,
  LEADER_SCORE_THRESHOLD,
  OWNER_SCORE_THRESHOLD,
  OWNER_SLOTS,
} from "@shared/erp";
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

const THRESHOLD_LABEL: Record<string, string> = {
  critical: "심각선 돌파",
  warning: "경보선 돌파",
  approaching: "기준선 접근 중",
  clear: "기준선 안",
};

export function TodayScreen() {
  const { openEntry } = useErpUi();
  const data = trpc.erp.decisions.useQuery();

  if (data.error)
    return (
      <>
        <PageHead title="오늘의 3가지" />
        <AlertBox>{data.error.message}</AlertBox>
      </>
    );

  const d = data.data;
  const owner = d?.owner ?? [];

  return (
    <>
      <PageHead
        title="오늘의 3가지"
        desc={
          <>
            대표에게 도달하는 것은 걸러진 것만입니다. 4번째부터는 담당 리더로
            라우팅됩니다. 무엇이 「시급」인지는 아래 점수 규칙이 정합니다 —
            에이전트가 임의로 고르지 않습니다.
          </>
        }
      />

      <OkBox>
        <b>시급 판정 기준은 감이 아니라 4개 축의 점수 합입니다.</b> 같은
        입력이면 같은 순위가 나오고, 순위가 이상하면 규칙을 고칩니다. 규칙은
        대표 승인 없이 바뀌지 않습니다. 대표 도달 조건은{" "}
        <b>합계 {OWNER_SCORE_THRESHOLD}점 이상 또는 가역성 3점</b>이고, 상위{" "}
        {OWNER_SLOTS}건만 올라갑니다.
      </OkBox>

      <Kpis
        items={[
          {
            k: "대표 도달",
            v: d ? `${d.counts.owner}건` : "—",
            s: `상위 ${OWNER_SLOTS}건`,
            tone: d && d.counts.owner > 0 ? "bad" : undefined,
          },
          {
            k: "리더 라우팅",
            v: d ? `${d.counts.leader}건` : "—",
            s: `${LEADER_SCORE_THRESHOLD}점 이상`,
          },
          {
            k: "보류함",
            v: d ? `${d.counts.held}건` : "—",
            s: "걸러낸 것 — 사라지지 않습니다",
          },
          {
            k: "임계선",
            v: d ? (THRESHOLD_LABEL[d.threshold] ?? d.threshold) : "—",
            s:
              d?.expectedRunwayWeeks != null
                ? `예상런웨이 ${d.expectedRunwayWeeks}주`
                : "예상런웨이 계산 불가",
            tone:
              d?.threshold === "critical"
                ? "bad"
                : d?.threshold === "warning"
                  ? "warn"
                  : undefined,
          },
        ]}
      />

      {owner.length === 0 && !data.isLoading ? (
        <Note>
          지금 대표가 결정해야 하는 건이 없습니다. 도달 조건을 넘긴 안건이
          없다는 뜻이고, 리더 라우팅과 보류함은 아래에 그대로 있습니다.
        </Note>
      ) : null}

      {owner.map((item, index) => (
        <Card
          key={item.code ?? item.title}
          title={`${index + 1} · ${item.title}`}
          sub={
            <>
              합계 {item.score.total}점
              {item.runwayDays != null
                ? ` · 승인하면 런웨이 −${item.runwayDays}일`
                : ""}
              {item.exception ? ` · ${item.exception}` : ""}
            </>
          }
          actions={
            item.code ? (
              <button
                type="button"
                className="btn"
                onClick={() => openEntry(item.code!)}
              >
                원장 열기
              </button>
            ) : null
          }
        >
          <table>
            <thead>
              <tr>
                <th>축</th>
                <th className="n">점수</th>
                <th>근거</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(AXIS_LABEL) as (keyof typeof AXIS_LABEL)[]).map(
                axis => (
                  <tr key={axis}>
                    <td className="k nw">{AXIS_LABEL[axis]}</td>
                    <td className="n">{item.score[axis]}</td>
                    <td>{item.score.why[axis]}</td>
                  </tr>
                )
              )}
              <tr className="sum">
                <td>합계</td>
                <td className="n">{item.score.total}</td>
                <td>{item.routing} 도달</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ))}

      <Card
        title="점수 계산 전체"
        sub={`${d?.queue.length ?? 0}건 · ${d?.today ?? ""} 기준`}
        bare
      >
        <Scroll>
          <table>
            <thead>
              <tr>
                <th>순위</th>
                <th>안건</th>
                <th className="n">가역성</th>
                <th className="n">기한</th>
                <th className="n">금액</th>
                <th className="n">임계선</th>
                <th className="n">합계</th>
                <th className="n">런웨이</th>
                <th>도달</th>
              </tr>
            </thead>
            <tbody>
              {(d?.queue ?? []).map((item, index) => (
                <tr key={item.code ?? item.title}>
                  <td className="n">{index + 1}</td>
                  <td className="k">
                    {item.code ? (
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
                        onClick={() => openEntry(item.code!)}
                      >
                        {item.title}
                      </button>
                    ) : (
                      item.title
                    )}
                  </td>
                  <td className="n">{item.score.reversibility}</td>
                  <td className="n">{item.score.deadline}</td>
                  <td className="n">{item.score.amount}</td>
                  <td className="n">{item.score.threshold}</td>
                  <td className="n">{item.score.total}</td>
                  <td className="n">
                    {item.runwayDays == null ? (
                      <span className="s">—</span>
                    ) : (
                      `−${item.runwayDays}일`
                    )}
                  </td>
                  <td className="nw">
                    <span
                      className={
                        item.routing === "대표"
                          ? "chip a"
                          : item.routing === "리더"
                            ? "chip w"
                            : "chip n"
                      }
                    >
                      {item.routing}
                    </span>
                    {item.exception ? (
                      <span className="s"> · {item.exception}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
              {(d?.queue.length ?? 0) === 0 && !data.isLoading ? (
                <tr>
                  <td colSpan={9} className="s">
                    열려 있는 안건이 없습니다
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Scroll>
      </Card>

      <Note>
        <b>월 번레이트</b>{" "}
        {d?.monthlyBurn != null ? won(d.monthlyBurn) : "계산 불가"} — 금액 영향
        점수는 이 값 대비 비율로 정해집니다. 번레이트를 모르면 금액 축에 점수를
        주지 않습니다. 추정치로 메우면 순위가 조용히 틀립니다.
      </Note>
    </>
  );
}
