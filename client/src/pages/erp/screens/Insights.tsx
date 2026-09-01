/**
 * 경영 지표 (docs/erp-qa.md E4 · E5 · E7)
 *
 * 회계 숫자가 아니라 **판단에 쓰는 숫자**다. 그래서 회계 계단과 나란히 두지 않고
 * 별도 화면으로 뺐다 — 섞으면 세무·감사에 나가는 숫자와 구분이 안 된다.
 */
import { trpc } from "@/lib/trpc";
import { CONCENTRATION_WARN } from "@shared/erp";
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

const pct = (value: number | null | undefined) =>
  value == null ? "계산 불가" : `${Math.round(value * 1000) / 10}%`;

export function InsightsScreen() {
  const q = trpc.erp.insights.useQuery();

  if (q.error)
    return (
      <>
        <PageHead title="경영 지표" />
        <AlertBox>{q.error.message}</AlertBox>
      </>
    );

  const d = q.data;
  const c = d?.concentration;
  const p = d?.productivity;
  const concentrated = c?.top1 != null && c.top1 > CONCENTRATION_WARN;

  return (
    <>
      <PageHead
        title="경영 지표"
        desc="회계 숫자가 아니라 판단에 쓰는 숫자입니다. 세무·감사에 나가는 것은 재무제표 쪽이고, 이 화면은 채용·수주·집중도 판단용입니다."
      />

      <Kpis
        items={[
          {
            k: "상위 1곳 매출 비중",
            v: pct(c?.top1),
            s: concentrated
              ? "이 거래처를 잃으면 회사가 흔들립니다"
              : "특정 거래처 편중 없음",
            tone: concentrated ? "bad" : undefined,
          },
          {
            k: "상위 3곳 합계",
            v: pct(c?.top3),
            s: `거래처 ${c?.rows.length ?? 0}곳`,
          },
          {
            k: "인당 매출",
            v: p?.revenuePerHead == null ? "계산 불가" : won(p.revenuePerHead),
            s: p?.blockedBy ?? `인원 ${p?.headcount}명`,
            tone: p?.revenuePerHead == null ? undefined : "good",
          },
          {
            k: "인당 이익",
            v: p?.profitPerHead == null ? "계산 불가" : won(p.profitPerHead),
            s: p?.blockedBy ?? "채용 판단의 근거",
            tone:
              p?.profitPerHead != null && p.profitPerHead < 0
                ? "bad"
                : undefined,
          },
        ]}
      />

      {concentrated ? (
        <AlertBox>
          <b>{c?.verdict}</b> 투자 실사에서 반드시 묻는 숫자입니다 — 묻기 전에
          알고 있어야 합니다.
        </AlertBox>
      ) : c?.rows.length ? (
        <OkBox>{c.verdict}</OkBox>
      ) : (
        <Note>{c?.verdict}</Note>
      )}

      <Card
        title="거래처별 매출"
        sub={`합계 ${won(c?.total ?? 0)} · 허핀달 지수 ${c?.hhi == null ? "계산 불가" : Math.round(c.hhi * 1000) / 1000}`}
        bare
      >
        <Scroll>
          <table>
            <thead>
              <tr>
                <th>순위</th>
                <th>거래처</th>
                <th className="n">매출</th>
                <th className="n">비중</th>
              </tr>
            </thead>
            <tbody>
              {(c?.rows ?? []).map((row, i) => (
                <tr key={`${row.partyId ?? row.name}-${i}`}>
                  <td className="n">{i + 1}</td>
                  <td className="k">
                    {row.name}
                    {row.partyId == null ? (
                      <span className="tag n">거래처 미지정</span>
                    ) : null}
                  </td>
                  <td className="n">{won(row.amount)}</td>
                  <td className="n">{pct(row.share)}</td>
                </tr>
              ))}
              {(c?.rows.length ?? 0) === 0 && !q.isLoading ? (
                <tr>
                  <td colSpan={4} className="s">
                    확정 매출이 없습니다
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Scroll>
      </Card>

      <Note>
        <b>거래처 미지정 건은 하나로 묶지 않았습니다.</b> 묶으면 없는 편중이
        생깁니다 — 서로 다른 거래처일 수 있기 때문입니다. 거래처를 채워 넣으면
        비중이 정확해집니다.
      </Note>

      <Card
        title="프로젝트 예상 마진"
        sub="진행 중인 것도 보입니다 — 적자 프로젝트를 끝날 때까지 모르면 안 됩니다"
        bare
      >
        <Scroll>
          <table>
            <thead>
              <tr>
                <th>프로젝트</th>
                <th className="n">계약</th>
                <th className="n">기투입</th>
                <th className="n">잔여 추정</th>
                <th className="n">예상 마진</th>
                <th className="n">마진율</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {(d?.projects ?? []).map(row => (
                <tr key={row.projectId}>
                  <td className="k">{row.name}</td>
                  <td className="n">{won(row.contractAmount)}</td>
                  <td className="n">{won(row.spent)}</td>
                  <td className="n">
                    {row.remainingEstimate == null ? (
                      <span className="s">미입력</span>
                    ) : (
                      won(row.remainingEstimate)
                    )}
                  </td>
                  <td className="n">
                    {row.expectedMargin == null ? (
                      <span className="s">계산 불가</span>
                    ) : (
                      <span
                        style={{
                          color:
                            row.expectedMargin < 0 ? "var(--alert)" : undefined,
                        }}
                      >
                        {won(row.expectedMargin)}
                      </span>
                    )}
                  </td>
                  <td className="n">
                    {row.expectedMarginRate == null
                      ? "—"
                      : `${row.expectedMarginRate}%`}
                  </td>
                  <td className="nw">
                    {row.done ? (
                      <span className="chip g">완료</span>
                    ) : row.blockedBy ? (
                      <span className="chip w" title={row.blockedBy}>
                        추정 필요
                      </span>
                    ) : (
                      <span className="chip">진행 중</span>
                    )}
                  </td>
                </tr>
              ))}
              {(d?.projects.length ?? 0) === 0 && !q.isLoading ? (
                <tr>
                  <td colSpan={7} className="s">
                    프로젝트가 없습니다
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Scroll>
      </Card>

      <Note>
        <b>잔여 원가는 시스템이 추정하지 않습니다.</b> 사람이 넣어야 합니다 —
        시스템이 추정치를 만들면 그 숫자에 근거가 없는데 수주·중단 판단에
        쓰입니다. 기준값 화면의 <code>project_remaining_estimates</code> 에
        프로젝트별로 넣습니다.
      </Note>
    </>
  );
}
