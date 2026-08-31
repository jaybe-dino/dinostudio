/**
 * 번레이트 마스터 (§9.6) — 추정으로 만들지 않는다.
 * 라벨 없이 「런웨이」라고 쓰지 않는다 (원칙 3). 세 값이 전부 null이면 그대로 null이라고 쓴다.
 */
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
import { won } from "../format";

export function BurnRateScreen() {
  const runway = trpc.erp.runway.useQuery();
  const data = runway.data;

  const metric = (
    m: typeof data extends undefined
      ? never
      : NonNullable<typeof data>["simple"] | undefined,
    unit: string
  ) => (m?.value == null ? "계산 불가" : `${m.value}${unit}`);

  return (
    <>
      <div className="ph">
        <div>
          <h1>번레이트 마스터</h1>
          <div className="desc">
            월 번레이트 = 마감된 월의 운영비입니다. 고정비+변동비는 추정 분모라
            폐기했습니다. 마감된 월이 없거나 급여 실액이 미확정이면 런웨이 세 값
            모두 null입니다 — 임의 숫자를 내지 않습니다.
          </div>
        </div>
      </div>

      <div className="kpis">
        <Tile
          label="월 번레이트"
          value={won(data?.burnRate.value ?? null) ?? "계산 불가"}
          note={
            data?.burnRate.nullReason
              ? "분모 없음 — 마감된 월 0개"
              : "마감 월 실측"
          }
          tone={data?.burnRate.value == null ? "null" : undefined}
        />
        <Tile
          label="단순런웨이"
          value={metric(data?.simple, "개월")}
          note="보유현금 ÷ 월 번레이트"
          tone={data?.simple.value == null ? "null" : undefined}
        />
        <Tile
          label="예상런웨이"
          value={metric(data?.expected, "주")}
          note="13주 예측 잔액이 음수가 되는 시점"
          tone={
            data?.expected.value == null
              ? "null"
              : data.expected.value < 8
                ? "alert"
                : "ok"
          }
        />
        <Tile
          label="예약런웨이"
          value={metric(data?.reserved, "개월")}
          note="(보유현금 − 승인대기) ÷ 월 번레이트"
          tone={data?.reserved.value == null ? "null" : undefined}
        />
      </div>

      <Note tone="warn">
        지금 런웨이를 말해야 하면 확정 운영비만으로 계산한 <b>하한</b> 값을 쓰고
        반드시 「하한」 라벨을 붙이십시오 — 현재 확정 운영비{" "}
        {won(data?.lowerBoundMonthlyOpex ?? 0)}원(원장 확보 구간). 이것은 월
        번레이트가 아닙니다.
      </Note>

      <Card
        title="번레이트 산출 조건"
        meta={`6개 중 ${data?.conditionsMet ?? 0}개 충족`}
        body={false}
      >
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>조건</th>
                <th>현재</th>
                <th>담당</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {(data?.conditions ?? []).map(condition => (
                <tr key={condition.n}>
                  <td style={{ fontFamily: "var(--mono)" }}>{condition.n}</td>
                  <td className="wrap">{condition.label}</td>
                  <td>{condition.current}</td>
                  <td>{condition.owner}</td>
                  <td>
                    <span
                      className="chip"
                      data-tone={condition.met ? "ok" : "alert"}
                    >
                      {condition.met ? "충족" : "미충족"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="운영비 분해"
        meta="총지출 − (통과원가 + 차입 원금 + 부가세 + 자산 취득)"
        body={false}
      >
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th className="num">금액</th>
                <th className="num">건수</th>
                <th>번레이트 반영</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>확정 운영비</td>
                <td className="num">{won(data?.opex.opex.amount ?? 0)}</td>
                <td className="num">{data?.opex.opex.count ?? 0}</td>
                <td>
                  <span className="chip g">포함</span>
                </td>
              </tr>
              <tr>
                <td>통과원가 (받아야 나감)</td>
                <td className="num">
                  {won(data?.opex.passThrough.amount ?? 0)}
                </td>
                <td className="num">{data?.opex.passThrough.count ?? 0}</td>
                <td>
                  <span className="chip">제외</span>
                </td>
              </tr>
              <tr>
                <td>차입 원금 · 부가세 · 자산 취득</td>
                <td className="num">
                  {won(data?.opex.nonOperating.amount ?? 0)}
                </td>
                <td className="num">{data?.opex.nonOperating.count ?? 0}</td>
                <td>
                  <span className="chip">제외</span>
                </td>
              </tr>
              <tr>
                <td>판정 대기</td>
                <td className="num s">계산 불가</td>
                <td className="num">{data?.opex.undecided.count ?? 0}</td>
                <td>
                  <span className="chip a">산입 불가</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="폐기한 값 — 다시 쓰지 않습니다">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            월 고정비 54,647,500 / 월 변동비 18,441,290 / 월 번레이트 73,088,790
          </li>
          <li>단순런웨이 1.1주 / 예상 6주 / 예약 0주</li>
          <li>
            손익분기 순매출 392,955,269 · 593,994,565 / 주의 임계선 36,544,395
          </li>
          <li>
            고정비 커버리지 0.46배 · 0.62배 / 9월 번레이트 예산 73,088,790
          </li>
        </ul>
        <p style={{ margin: "8px 0 0" }}>
          고정비 6줄 중 급여·4대보험·이자 3종이 추정이었고, 변동비의 3개월
          이동평균은 원장에 근거가 없는 숫자였습니다. 추정 분모에서 파생된
          임계선·손익분기·커버리지도 함께 근거를 잃습니다.
        </p>
      </Card>
    </>
  );
}
