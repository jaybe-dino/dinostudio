/**
 * 서비스 팩토리 — DATABASE_URL 이 있으면 PostgreSQL(Neon), 없으면 메모리 저장소.
 * server/db.ts 의 graceful degradation 과 같은 방식이다.
 *
 * 메모리로 뜰 때 무엇을 담을지가 한 번 바뀌었다. 예전에는 §5.4 시드(명세의
 * 예제 데이터)를 담았는데, 이제 **실제 「데일리 현금흐름」 시트 사본**을 담는다.
 * 화면을 열었을 때 예제가 아니라 우리 숫자가 보여야 하기 때문이고, 무엇보다
 * 「버튼을 눌러야 들어온다」는 경로가 실제로는 아무도 누르지 않아 계속 비어
 * 있었기 때문이다.
 *
 * §5.4 시드는 그대로 남아 있다 — 이관 검증(V1~V8)과 인수 테스트가 그 데이터를
 * 기준으로 쓰고 있고, 그쪽은 명세의 고정 예제라 바뀌면 안 된다.
 */
import {
  ROLES,
  SEED_SETTINGS,
  SEED_STAGE2_SETTINGS,
  SHEET_SEED,
  type Role,
} from "../../shared/erp/index.js";
import { createDb } from "../dbPool.js";
import { DrizzleLedgerStore } from "./drizzleStore.js";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore, type LedgerStore } from "./store.js";

let cached: LedgerService | null = null;
let backedByDb = false;

/**
 * 메모리 저장소에 담을 개시 데이터 — 시트 사본에서 편 원장 건.
 *
 * 기준값은 시트에서 온 두 개(보유현금 · 장기부채)를 **기존 기준값 위에 덮어
 * 쓴다**. 나머지 기준값(급여 실액 · 배부 기준 등)은 시트에 없으므로 그대로 둔다 —
 * 통째로 갈아치우면 화면에서 입력할 칸 자체가 사라진다 (전에 한 번 낸 사고다).
 */
function sheetSeed() {
  const base = [...SEED_SETTINGS, ...SEED_STAGE2_SETTINGS];
  const fromSheet = new Map(SHEET_SEED.settings.map(s => [s.key, s]));
  return {
    entries: SHEET_SEED.entries,
    snapshots: SHEET_SEED.snapshots,
    settings: base.map(s => fromSheet.get(s.key) ?? s),
  };
}

/**
 * 지금 원장이 DB 에 있는가, 메모리에 있는가.
 * 화면에 그대로 보여 준다 — 메모리면 재시작에 사라지므로 사람이 알아야 한다.
 */
export function storeIsDatabase(): boolean {
  getLedgerService();
  return backedByDb;
}

export function getLedgerService(): LedgerService {
  if (cached) return cached;
  let store: LedgerStore;
  if (process.env.DATABASE_URL) {
    try {
      store = new DrizzleLedgerStore(createDb(process.env.DATABASE_URL));
      backedByDb = true;
    } catch (error) {
      console.warn(
        "[ERP] PostgreSQL 연결 실패 — 시드 메모리 저장소로 대체합니다:",
        error
      );
      store = new InMemoryLedgerStore(sheetSeed());
    }
  } else {
    store = new InMemoryLedgerStore(sheetSeed());
  }
  cached = new LedgerService(store);
  return cached;
}

/**
 * 화면에서 배정한 역할 캐시 (§13.1 · G13).
 * 매 요청마다 DB를 보지 않도록 들고 있고, 사용자 저장 시 갱신한다.
 */
const assignedRoles = new Map<string, Role>();
/** 소속 사업부 — 사업부리더의 조회 범위가 여기서 나온다 (§13.1) */
const assignedBu = new Map<string, string>();

export function setAssignedRoles(
  users: {
    email: string;
    role: Role;
    buCode?: string | null;
    active: boolean;
  }[]
) {
  assignedRoles.clear();
  assignedBu.clear();
  for (const user of users) {
    if (!user.active) continue;
    const key = user.email.trim().toLowerCase();
    assignedRoles.set(key, user.role);
    if (user.buCode) assignedBu.set(key, user.buCode);
  }
}

/**
 * 이 사람의 소속 사업부.
 *
 * 사용자 배정이 우선이고, 없으면 `ERP_ROLE_MAP` 에서 읽는다 — 거기서는
 * `"사업부리더:IP"` 처럼 역할 뒤에 붙여 쓴다. 첫 리더를 계정 배정 화면 없이
 * 넣기 위한 부트스트랩이다.
 *
 * **못 찾으면 null 을 돌려준다.** 그러면 리더는 아무것도 못 본다
 * (fail-closed) — 범위를 모를 때 전부 보여 주면 규칙이 있으나 마나다.
 */
export function resolveErpBu(email: string | null | undefined): string | null {
  const key = (email ?? "").trim().toLowerCase();
  const assigned = assignedBu.get(key);
  if (assigned) return assigned;
  const raw = process.env.ERP_ROLE_MAP;
  if (!raw || !email) return null;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    const found = map[email] ?? map[key];
    const bu = typeof found === "string" ? found.split(":")[1] : null;
    return bu?.trim() || null;
  } catch {
    return null;
  }
}

/** 테스트에서 저장소를 갈아끼울 때 사용 */
export function setLedgerService(service: LedgerService | null) {
  cached = service;
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * §13.1 역할 해석. 순서 —
 *   ① ERP_ROLE_MAP 환경변수 (email → 역할 JSON)
 *   ② ERP_DEFAULT_ROLE 환경변수
 *   ③ 개발 환경에서만 재무로 폴백. 프로덕션은 명시적 설정 없이는 접근 불가 (G10)
 */
export function resolveErpRole(email: string | null | undefined): Role | null {
  // 배정된 사용자가 있으면 그것이 우선한다. 환경변수는 첫 대표를 넣기 위한 부트스트랩이다.
  const assigned = assignedRoles.get((email ?? "").trim().toLowerCase());
  if (assigned) return assigned;
  const raw = process.env.ERP_ROLE_MAP;
  if (raw && email) {
    try {
      const map = JSON.parse(raw) as Record<string, string>;
      const found = map[email] ?? map[email.toLowerCase()];
      // `"사업부리더:IP"` — 역할 뒤에 사업부를 붙여 쓸 수 있다
      const role = typeof found === "string" ? found.split(":")[0].trim() : "";
      if (role && isRole(role)) return role;
    } catch (error) {
      console.warn("[ERP] ERP_ROLE_MAP 파싱 실패:", error);
    }
  }
  const fallback = process.env.ERP_DEFAULT_ROLE;
  if (fallback && isRole(fallback)) return fallback;
  if (process.env.NODE_ENV !== "production") return "재무";
  return null;
}

export { LedgerService } from "./service.js";
export type { Actor } from "./service.js";
export { InMemoryLedgerStore } from "./store.js";
export type { LedgerStore, EntryFilter } from "./store.js";
export { DrizzleLedgerStore } from "./drizzleStore.js";
export { ErpError, erpError } from "./errors.js";
export type { ErpErrorCode } from "./errors.js";
