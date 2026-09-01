/**
 * 신뢰도 배지 (docs/erp-qa.md E12)
 *
 * 「이 숫자를 믿을 수 있나」가 화면마다 다르게 표현되고 있었다.
 * 한 컴포넌트로 모아서 같은 말이 같은 모양으로 보이게 한다.
 *
 * 확정 / 추정 / 미확정 비율을 그대로 보여 준다 — 「신뢰도 높음」 같은
 * 요약어를 쓰지 않는다. 요약하면 사람이 근거를 못 따라간다.
 */

export interface ConfidenceInput {
  /** 확정된 건수 */
  confirmed: number;
  /** 추정이 섞인 건수 */
  estimated?: number;
  /** 금액·항목이 확정되지 않은 건수 */
  undecided?: number;
}

export function Confidence({
  confirmed,
  estimated = 0,
  undecided = 0,
  label = "이 숫자의 근거",
}: ConfidenceInput & { label?: string }) {
  const total = confirmed + estimated + undecided;
  if (total === 0)
    return <span className="chip n">근거 없음 — 건이 없습니다</span>;

  const pct = (n: number) => Math.round((n / total) * 100);
  // 미확정이 하나라도 있으면 그 사실이 가장 중요하다
  const tone = undecided > 0 ? "a" : estimated > 0 ? "w" : "g";

  return (
    <span
      className={`chip ${tone}`}
      title={`${label} — 확정 ${confirmed}건 · 추정 ${estimated}건 · 미확정 ${undecided}건`}
    >
      확정 {pct(confirmed)}%{estimated > 0 ? ` · 추정 ${pct(estimated)}%` : ""}
      {undecided > 0 ? ` · 미확정 ${pct(undecided)}%` : ""}
    </span>
  );
}

/**
 * 배부 기준 병기 (E8).
 *
 * 배부 화면은 따로 있었지만, 손익 숫자를 보는 자리에서 「이 숫자가 무슨 기준으로
 * 나뉘었나」가 안 보였다. 기준을 모르면 그 숫자로 사업부를 비교할 수 없다.
 */
export function AllocationBasis({ basis }: { basis: string | null }) {
  if (!basis) return null;
  return (
    <span className="tag n" title="공통비 배부 기준">
      배부: {basis}
    </span>
  );
}
