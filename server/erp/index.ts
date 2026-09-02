/**
 * 서비스 팩토리 — DATABASE_URL 이 있으면 PostgreSQL(Neon), 없으면 §5.4 시드
 * 메모리 저장소. server/db.ts 의 graceful degradation 과 같은 방식이다.
 */
import { ROLES, type Role } from "../../shared/erp/index.js";
import { createDb } from "../dbPool.js";
import { DrizzleLedgerStore } from "./drizzleStore.js";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore, type LedgerStore } from "./store.js";

let cached: LedgerService | null = null;
let backedByDb = false;

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
      store = new InMemoryLedgerStore();
    }
  } else {
    store = new InMemoryLedgerStore();
  }
  cached = new LedgerService(store);
  return cached;
}

/**
 * 화면에서 배정한 역할 캐시 (§13.1 · G13).
 * 매 요청마다 DB를 보지 않도록 들고 있고, 사용자 저장 시 갱신한다.
 */
const assignedRoles = new Map<string, Role>();

export function setAssignedRoles(
  users: { email: string; role: Role; active: boolean }[]
) {
  assignedRoles.clear();
  for (const user of users) {
    if (user.active)
      assignedRoles.set(user.email.trim().toLowerCase(), user.role);
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
      if (found && isRole(found)) return found;
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
