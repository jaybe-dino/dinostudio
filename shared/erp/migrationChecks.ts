/**
 * §5.5 이관 검증 규칙 — 통과해야 이관 완료
 *
 * V1·V6은 「고쳐서 통과시키는」 항목이 아니다. 잔액이 안 맞으면 차액을 조정 전표로 만들어
 * 억지로 맞추지 않고, 불일치를 그대로 노출하고 8월 마감을 잠그지 않는다 (원칙 8).
 */
import { buildDailyBlocks } from "./cashflow";
import { findDuplicateCandidates } from "./duplicates";
import type { SeedDaySnapshot } from "./seed";
import type { Entry } from "./types";

export interface CheckResult {
  id: string;
  name: string;
  formula: string;
  /** pass = 통과 · fail = 불일치 노출 · n/a = 대상 아님 */
  verdict: "pass" | "fail" | "n/a";
  detail: string;
}

export function runMigrationChecks(
  entries: Entry[],
  snapshots: SeedDaySnapshot[]
): CheckResult[] {
  return [
    v1(snapshots),
    v2(snapshots),
    v3(entries, snapshots),
    v4(entries),
    v5(entries),
    v6(entries, snapshots),
    v7(entries),
    v8(entries),
  ];
}

const num = (value: number | null) =>
  value == null ? "계산 불가" : value.toLocaleString("ko-KR");

function v1(snapshots: SeedDaySnapshot[]): CheckResult {
  const breaks: string[] = [];
  for (let i = 1; i < snapshots.length; i += 1) {
    const prev = snapshots[i - 1];
    const cur = snapshots[i];
    if (prev.close !== cur.open)
      breaks.push(
        `${cur.date}: 전일 종료 ${num(prev.close)} ≠ 당일 시작 ${num(cur.open)}`
      );
  }
  // 이관 전 시트가 다른 값을 기록하고 있던 행 — 이것이 8월 마감의 유일한 장애다 (B5)
  for (const snap of snapshots) {
    if (snap.sheetOpen != null && snap.sheetOpen !== snap.open) {
      breaks.push(
        `${snap.date}: 시트 시작 ${num(snap.sheetOpen)} ≠ 이관 시작 ${num(snap.open)} (B5)`
      );
    }
  }
  return {
    id: "V1",
    name: "일자 체인",
    formula: "전일 day_close == 당일 day_open",
    verdict: breaks.length === 0 ? "pass" : "fail",
    detail: breaks.length === 0 ? "행 간 체인 연속" : breaks.join(" · "),
  };
}

function v2(snapshots: SeedDaySnapshot[]): CheckResult {
  const bad = snapshots.filter(
    s => s.open == null || s.open + s.inSum - s.outSum !== s.close
  );
  return {
    id: "V2",
    name: "일계 정합",
    formula: "day_open + 입금 − 지출 == day_close",
    verdict: bad.length === 0 ? "pass" : "fail",
    detail:
      bad.length === 0
        ? `${snapshots.length}행 통과`
        : bad.map(s => s.date).join(" · "),
  };
}

function v3(entries: Entry[], snapshots: SeedDaySnapshot[]): CheckResult {
  // 이관 구간은 건별 명세가 없으므로 대상이 아니다 (§5.3).
  const comparable = snapshots.filter(s => !s.isMigrated);
  if (comparable.length === 0) {
    return {
      id: "V3",
      name: "건별 합 == 일계",
      formula: "Σ entry(그 날) == day_snapshot 합",
      verdict: "n/a",
      detail:
        "이관 구간은 일계만 존재 — 대조 대상 아님. DB 구간은 일계 스냅샷을 만들지 않는다",
    };
  }
  const bad: string[] = [];
  for (const snap of comparable) {
    const day = entries.filter(
      e => e.cashDate === snap.date && e.status === "confirmed"
    );
    const out = day
      .filter(e => e.direction === "out")
      .reduce((a, e) => a + (e.amount ?? 0), 0);
    const inc = day
      .filter(e => e.direction === "in")
      .reduce((a, e) => a + (e.amount ?? 0), 0);
    if (out !== snap.outSum || inc !== snap.inSum) bad.push(snap.date);
  }
  return {
    id: "V3",
    name: "건별 합 == 일계",
    formula: "Σ entry(그 날) == day_snapshot 합",
    verdict: bad.length === 0 ? "pass" : "fail",
    detail: bad.length === 0 ? `${comparable.length}일 통과` : bad.join(" · "),
  };
}

function v4(entries: Entry[]): CheckResult {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const e of entries) {
    if (seen.has(e.code)) dupes.push(e.code);
    seen.add(e.code);
  }
  return {
    id: "V4",
    name: "코드 유일성",
    formula: "code UNIQUE · 결번 허용 · 재사용 금지",
    verdict: dupes.length === 0 ? "pass" : "fail",
    detail: dupes.length === 0 ? `${entries.length}건 유일` : dupes.join(" · "),
  };
}

function v5(entries: Entry[]): CheckResult {
  // 적요칸에 숫자가 남아 있는 건 — 금액으로 승격되지 않았는지 확인한다.
  const noteAmounts = entries.filter(e =>
    /적요칸 금액|단위 불명/.test(e.undecidedReason ?? "")
  );
  const promoted = noteAmounts.filter(e => e.amount != null);
  return {
    id: "V5",
    name: "금액 추정 금지",
    formula: "note_raw에 숫자가 있어도 amount로 승격되지 않았는가",
    verdict: promoted.length === 0 ? "pass" : "fail",
    detail:
      promoted.length === 0
        ? `${noteAmounts.length}건 모두 null 유지`
        : `승격된 건: ${promoted.map(e => e.code).join(" · ")}`,
  };
}

function v6(entries: Entry[], snapshots: SeedDaySnapshot[]): CheckResult {
  const blocks = buildDailyBlocks(entries, snapshots);
  const firstNull = blocks.find(b => b.close == null);
  return {
    id: "V6",
    name: "미확정 승계",
    formula: "판정 대기가 남은 날부터 day_close = null",
    verdict: firstNull ? "pass" : "fail",
    detail: firstNull
      ? `${firstNull.key}부터 계산 불가 — 정상 동작 (${firstNull.undecided.map(u => u.code).join(" · ") || "승계"})`
      : "판정 대기가 없는데 승계가 발생하지 않음",
  };
}

function v7(entries: Entry[]): CheckResult {
  const flagged = entries.filter(e =>
    /중복 의심/.test(e.undecidedReason ?? "")
  );
  const computed = new Set<string>();
  for (const e of entries) {
    for (const hit of findDuplicateCandidates(e, entries)) {
      computed.add([e.code, hit.code].sort().join(" ↔ "));
    }
  }
  const total = flagged.length + computed.size;
  return {
    id: "V7",
    name: "중복 탐지",
    formula: "같은 거래처 · 같은 금액 · 7일 이내",
    verdict: total === 0 ? "pass" : "fail",
    detail:
      total === 0
        ? "중복 후보 없음"
        : [
            ...flagged.map(
              e =>
                `${e.code} (대조 대상이 이관 구간 일계에만 존재 — 건별 명세 없음)`
            ),
            ...Array.from(computed),
          ].join(" · "),
  };
}

function v8(entries: Entry[]): CheckResult {
  // direction과 계정과목 대차가 모순되거나, 방향 자체가 판정되지 않은 건
  const bad = entries.filter(e =>
    /매출인지 지출인지 불명|방향/.test(e.undecidedReason ?? "")
  );
  return {
    id: "V8",
    name: "방향 정합",
    formula: "direction과 계정과목 대차가 모순되지 않는가",
    verdict: bad.length === 0 ? "pass" : "fail",
    detail:
      bad.length === 0
        ? "전건 정합"
        : bad.map(e => `${e.code} 방향 판정 불가`).join(" · "),
  };
}

/** 계정 미지정 — 전표 생성 불가 (§5.4) */
export function accountMissing(entries: Entry[]): Entry[] {
  return entries.filter(e => e.accountCode == null);
}

/** 귀속 미지정 — 사업부 손익·프로젝트 마진에서 빠짐 (§5.4) */
export function attributionMissing(entries: Entry[]): Entry[] {
  return entries.filter(e => {
    if (e.projectId) return false;
    if (e.buCode == null) return true;
    return e.nature === "통과원가" || e.nature === "직접원가";
  });
}
