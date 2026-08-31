/**
 * §14 시간대 — KST 고정. 일자 경계는 00:00 KST.
 *
 * 서버가 UTC로 돌면 한국 시각 09:00 이전은 전날로 잡힌다. 현금흐름표의 일자,
 * D-day, 마감 기간이 전부 하루씩 밀리므로 날짜는 반드시 이 함수로만 만든다.
 */
export const KST_OFFSET_MINUTES = 9 * 60;

/** 지금(KST) 기준 YYYY-MM-DD */
export function kstToday(now: Date = new Date()): string {
  return kstDate(now);
}

export function kstDate(value: Date): string {
  const shifted = new Date(value.getTime() + KST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** KST 오프셋이 붙은 ISO 8601 — 감사로그·이력의 시각 표기 (§10 시각 규약) */
export function kstIso(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + KST_OFFSET_MINUTES * 60_000);
  return `${shifted.toISOString().slice(0, 19)}+09:00`;
}

/** YYYY-MM (KST) */
export function kstMonth(now: Date = new Date()): string {
  return kstToday(now).slice(0, 7);
}

/**
 * 두 날짜 사이의 영업일 수 (주말 제외, 시작일 제외 · 종료일 포함).
 *
 * 「3영업일 내」 같은 기한 판정에 쓴다. 달력일로 세면 금요일 기한이
 * 수요일에도 「2일 남음」으로 읽혀 실제보다 여유가 있어 보인다.
 *
 * 공휴일은 반영하지 않는다 — 공휴일 표를 들고 있지 않으므로,
 * 세는 것보다 적게 남았을 수 있다는 쪽으로만 틀린다.
 */
export function businessDaysBetween(from: string, to: string): number {
  if (to <= from) return 0;
  let days = 0;
  const cursor = new Date(`${from}T00:00:00+09:00`);
  const end = new Date(`${to}T00:00:00+09:00`);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) days += 1;
  }
  return days;
}
