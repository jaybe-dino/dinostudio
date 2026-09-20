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
  status: "ok" | "fail";
}

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
  /** 기준값을 안 주면 **미검증**이다 — 「비어 있지 않다」와 완전복구는 다르다 */
  completeness: {
    status: "ok" | "fail" | "unverified";
    rows: CompletenessRow[];
  };
  /** 0 전부 통과 · 3 읽히지만 완전복구 미검증 · 1 실패 */
  exitCode: 0 | 1 | 3;
}

export declare function runRestoreChecks(input: {
  sql: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Record<string, never>[]>;
  dir: string;
  expect?: RestoreExpectation;
  log?: (line: string) => void;
}): Promise<RestoreCheckResult>;
