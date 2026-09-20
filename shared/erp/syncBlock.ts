/**
 * 「막힌 것」과 「그냥 실패한 것」을 가른다.
 *
 * 크론은 사람이 안 보는 동안 계속 돈다. 그래서 **재시도로 풀리는 것**과
 * **사람이 처리해야 풀리는 것**을 구분하지 못하면, 같은 벽에 하루에 스물네 번
 * 부딪히면서 화면에는 「실패 8건」만 뜬다. 사람은 무엇을 해야 하는지 모른다.
 *
 * 잔액 부족 · 키 없음 · 권한 부족은 **충전하거나 고치기 전까지 영영 안 풀린다.**
 * 그건 실패가 아니라 차단이고, 그렇게 적어야 한다.
 */
export interface SyncBlock {
  what: string;
  reason: string;
  /** 사람이 처리해야 풀리는가 — 재시도로는 안 풀린다 */
  needsPerson: boolean;
}

/**
 * 사람 손이 필요한 사유인가.
 *
 * 넓게 잡는다 — 애매하면 사람에게 알리는 쪽이 낫다. 조용히 재시도만 도는 것이
 * 가장 나쁘다.
 */
export function needsPerson(reason: string): boolean {
  return /잔액|부족|credit|billing|quota|api[ _-]?key|API 키|토큰|token|권한|scope|forbidden|unauthorized|not_authed|invalid_auth|401|403|설정되지 않|없습니다/i.test(
    reason
  );
}

/**
 * 판독 결과에서 차단을 판정한다.
 *
 * **한 건도 못 읽었고 실패 사유가 전부 같을 때만** 차단으로 본다. 일부가
 * 읽혔다면 벽이 아니라 그 파일들의 문제고, 사유가 제각각이면 공통 원인이
 * 아니다. 그 둘을 차단으로 부르면 「차단」이라는 말이 의미를 잃는다.
 */
export function classifyBlock(
  what: string,
  result: { read: number; failures: { reason: string }[] }
): SyncBlock | null {
  if (result.read > 0) return null;
  if (result.failures.length === 0) return null;
  const reasons = new Set(result.failures.map(f => f.reason));
  if (reasons.size !== 1) return null;
  const only = result.failures[0].reason;
  return { what, reason: only, needsPerson: needsPerson(only) };
}
