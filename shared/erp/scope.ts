/**
 * §13.1 **조회·수정 범위** — 선언이 아니라 강제.
 *
 * `ROLE_MATRIX` 에 `scope: "own_bu" | "own_input"` 이 오래 적혀 있었지만
 * **아무도 읽지 않았다.** 그래서 사업부리더가 다른 사업부 건을 목록으로
 * 받아 갔고, 담당자가 남이 올린 건을 봤다. 화면이 안 보여 준다는 것은
 * 권한이 아니다 — 주소를 알거나 API 를 직접 부르면 그대로 나온다.
 *
 * 이 파일이 그 판정을 **한 곳에** 둔다. 경로마다 따로 쓰면 반드시 한 군데를
 * 빠뜨리고, 빠진 그 한 군데가 전부를 무효로 만든다 — 이 저장소에서 「같은
 * 규칙이 두 군데」로 다섯 번 겪은 일이다.
 */
import type { Entry, Role } from "./types.js";
import { permissionFor } from "./permissions.js";

export interface ScopeActor {
  id: string;
  role: Role;
  /** 사업부리더의 소속. 없으면 범위를 알 수 없다 */
  buCode?: string | null;
}

export type ScopeKind = "all" | "own_bu" | "own_input" | "none";

/**
 * 이 사람이 원장을 어디까지 보는가.
 *
 * 읽기 권한 자체가 없으면 `none` 이다 — 그건 「전부」의 반대쪽 끝이고,
 * 범위 판정이 아니라 접근 거부다.
 */
export function scopeOf(actor: ScopeActor): ScopeKind {
  const permission = permissionFor(actor.role, "entry");
  if (!permission.read) return "none";
  const scope = permission.scope ?? "all";
  return scope === "all" ? "all" : scope;
}

/**
 * 범위가 정해지지 않은 사람인가 — **보여 주지 않는 쪽으로 닫는다.**
 *
 * 사업부리더인데 소속이 비어 있으면 「어디까지인지 모른다」이다. 모를 때
 * 전부 보여 주면 범위 규칙이 있으나 마나다. 아무것도 안 보여 주면 사람이
 * 바로 알아차리고 소속을 채운다 — 조용히 새는 것보다 낫다.
 */
export function scopeIsUndetermined(actor: ScopeActor): boolean {
  return scopeOf(actor) === "own_bu" && !actor.buCode;
}

/** 이 건이 이 사람의 범위 안인가 */
export function inScope(entry: Entry, actor: ScopeActor): boolean {
  switch (scopeOf(actor)) {
    case "none":
      return false;
    case "all":
      return true;
    case "own_bu":
      // 소속을 모르면 닫는다 (fail-closed)
      if (!actor.buCode) return false;
      return entry.buCode === actor.buCode;
    case "own_input":
      /*
       * 「본인 입력분」은 만든 사람 기준이다. 수정본(-R1)은 원본을 만든
       * 사람이 아니라 **수정한 사람**이 만든 것이므로 `createdBy` 를 본다.
       */
      return entry.createdBy === actor.id;
  }
}

/** 범위 밖은 아예 빼고 돌려준다 — 목록·합계·내보내기가 전부 이걸 쓴다 */
export function scopeEntries<T extends Entry>(
  entries: T[],
  actor: ScopeActor
): T[] {
  if (scopeOf(actor) === "all") return entries;
  return entries.filter(e => inScope(e, actor));
}

/**
 * 범위 밖을 거부할 때 쓰는 말.
 *
 * 「없습니다」로 답한다 — 「권한이 없습니다」라고 하면 **그 코드가 존재한다는
 * 사실**이 새 나간다. 다른 사업부의 건이 있는지 없는지를 코드를 넣어 보며
 * 알아낼 수 있게 된다.
 */
export const OUT_OF_SCOPE_MESSAGE = "해당 집행원장 코드를 찾을 수 없습니다";
