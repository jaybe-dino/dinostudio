/**
 * 여신 · 한도 (docs/erp-qa.md C4)
 *
 * 마이너스통장·법인카드 한도는 실질 유동성인데 현금 현황에는 안 보였다.
 * 부족액 3,000만 원이 「망한다」인지 「빌리면 된다」인지가 이 화면에서 갈린다.
 *
 * 다만 현금과 한 숫자로 합치지 않는다 — 한도는 빌리는 돈이고, 이자가 붙고,
 * 은행이 줄일 수 있다. 합쳐 놓으면 그 사실이 사라진다.
 */
import { trpc } from "@/lib/trpc";
import { won } from "../format";
import {
  AlertBox,
  Card,
  Kpis,
  Note,
  PageHead,
  Scroll,
} from "../components/Proto";

/** 한도 소진율이 이 선을 넘으면 「빌릴 수 있다」고 말하기 어렵다 */
const USAGE_WARN = 70;

export function CreditScreen() {
  const q = trpc.erp.credit.useQuery();
  const d = q.data;

  if (q.error)
    return (
      <>
        <PageHead title="여신 · 한도" />
        <AlertBox>{q.error.message}</AlertBox>
      </>
    );

  const overall =
    d && d.totalLimit > 0
      ? Math.round((d.totalUsed / d.totalLimit) * 1000) / 10
      : null;
  const tight = overall != null && overall >= USAGE_WARN;

  return (
    <>
      <PageHead
        title="여신 · 한도"
        desc="한도는 현금이 아니라 빌릴 수 있는 돈입니다. 현금 부족액의 의미를 판단하는 데 쓰고, 현금과 합쳐서 보지 않습니다."
      />

      <Kpis
        items={[
          {
            k: "총 한도",
            v: won(d?.totalLimit ?? 0),
            s: `약정 ${d?.lines.length ?? 0}건`,
          },
          {
            k: "사용 중",
            v: won(d?.totalUsed ?? 0),
            s: overall == null ? "한도 미입력" : `소진율 ${overall}%`,
            tone: tight ? "bad" : undefined,
          },
          {
            k: "남은 한도",
            v: won(d?.totalAvailable ?? 0),
            s: "지금 더 빌릴 수 있는 금액",
            tone: tight ? "bad" : "good",
          },
          {
            k: "즉시 동원 가능액",
            v:
              d?.immediatelyAvailable == null
                ? "계산 불가"
                : won(d.immediatelyAvailable),
            s:
              d?.cashOnHand == null
                ? "현금 잔액(cash_on_hand)이 없어 합산하지 않았습니다"
                : `현금 ${won(d.cashOnHand)} + 남은 한도`,
          },
        ]}
      />

      {tight ? (
        <AlertBox>
          <b>한도 소진율 {overall}%.</b> 남은 한도를 유동성으로 계산하기 어려운
          구간입니다 — 은행이 한도를 줄이면 먼저 사라지는 돈입니다.
        </AlertBox>
      ) : null}

      <Card title="약정별 한도" sub={d?.note} bare>
        <Scroll>
          <table>
            <thead>
              <tr>
                <th>약정</th>
                <th>종류</th>
                <th className="n">한도</th>
                <th className="n">사용</th>
                <th className="n">잔여</th>
                <th className="n">소진율</th>
              </tr>
            </thead>
            <tbody>
              {(d?.lines ?? []).map(line => (
                <tr key={line.id}>
                  <td className="k">{line.name}</td>
                  <td className="nw">
                    <span className="tag">{line.kind}</span>
                  </td>
                  <td className="n">{won(line.limit)}</td>
                  <td className="n">{won(line.used)}</td>
                  <td className="n">{won(line.available)}</td>
                  <td className="n">
                    <span
                      className={`chip ${line.usageRate >= USAGE_WARN ? "a" : "g"}`}
                    >
                      {line.usageRate}%
                    </span>
                  </td>
                </tr>
              ))}
              {(d?.lines.length ?? 0) === 0 && !q.isLoading ? (
                <tr>
                  <td colSpan={6} className="s">
                    등록된 약정이 없습니다 — 기준값 화면의{" "}
                    <code>credit_lines</code> 에 넣습니다
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Scroll>
      </Card>

      <Note>
        <b>사용액은 시스템이 계산하지 않습니다.</b> 마이너스통장 사용액과 카드
        미결제액은 은행·카드사가 가진 숫자이고, 원장에서 추정하면 결제일
        시차만큼 어긋납니다. 기준값 화면의 <code>credit_lines</code> 에{" "}
        <code>{`[{ id, name, kind, limit, used }]`}</code> 형태로 넣고, 은행
        연동이 붙으면 이 자리에서 자동으로 채워집니다.
      </Note>
    </>
  );
}
