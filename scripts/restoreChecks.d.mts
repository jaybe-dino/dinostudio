/**
 * `restoreChecks.mjs` 의 타입.
 *
 * 검사 도구 자체는 **빌드 없이 도는 순수 JS** 여야 한다 — 사고가 났을 때
 * `node scripts/verify-restore.mjs` 한 줄로 돌아야 하기 때문이다. 그래서 타입은
 * 여기 따로 둔다. 테스트(TS)가 이 파일을 읽는다.
 */
export declare const CRITICAL_TABLES: string[];

export interface CriticalColumn {
  table: string;
  column: string;
  since: string;
}
export declare const CRITICAL_COLUMNS: CriticalColumn[];

export interface ExpectedMigration {
  tag: string;
  when: number;
  hash: string;
}
export declare function expectedMigrations(dir: string): ExpectedMigration[];

export interface RestoreExpectation {
  /** 복구 기준 시각 — 이후 데이터가 있으면 시점이 틀린 것이다 */
  asOf?: string | null;
  entries?: number | null;
  settledTotal?: number | null;
}

export interface CompletenessRow {
  label: string;
  expected: string;
  actual: string;
  /** `unknown` — 볼 것이 없어 확인할 수 없었다. 통과가 아니다 */
  status: "ok" | "fail" | "unknown";
}

/** 완전복구를 말하려면 **셋 다** 있어야 한다 */
export declare const BASELINE_KEYS: ["asOf", "entries", "settledTotal"];

/** 기준값이 쓸 수 없으면 판정하지 않고 멈춘다 */
export declare class RestoreArgumentError extends Error {
  errors: string[];
}

/** 틀린 기준값을 **전부** 모아 돌려준다. 빈 배열이면 쓸 수 있다 */
export declare function validateExpectation(
  expect?: RestoreExpectation,
  now?: number
): string[];

export interface RestoreCheckResult {
  schema: {
    status: "ok" | "fail";
    missingTables: string[];
    missingColumns: CriticalColumn[];
  };
  migrations: {
    status: "ok" | "fail";
    missingTags: string[];
    appliedCount: number;
    expectedCount: number;
  };
  ledger: {
    entries?: number | null;
    confirmed?: number;
    undecided?: number;
    latestCreatedAt?: string | null;
    settledTotal?: number;
    latestAuditAt?: string | null;
  };
  /**
   * 기준값을 **셋 다** 주고 다 확인됐을 때만 `ok` 다.
   *
   * 하나만 맞아도 통과시키면 건수는 같은데 금액이 통째로 다른 복구본이
   * 「완전복구」로 나온다. 틀린 것이 있으면 나머지를 안 줬어도 `fail` 이다.
   */
  completeness: {
    status: "ok" | "fail" | "unverified";
    rows: CompletenessRow[];
    /** 안 준 기준값 */
    missing: ("asOf" | "entries" | "settledTotal")[];
  };
  /** 0 전부 통과 · 3 읽히지만 완전복구 미검증 · 1 실패 */
  exitCode: 0 | 1 | 3;
}

/** 쓸 수 없는 기준값이면 {@link RestoreArgumentError} 를 던진다 */
export declare function runRestoreChecks(input: {
  sql: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Record<string, never>[]>;
  dir: string;
  expect?: RestoreExpectation;
  log?: (line: string) => void;
}): Promise<RestoreCheckResult>;
