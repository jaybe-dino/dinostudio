import { createContext, useContext } from "react";

export interface ErpUi {
  /** 전 화면 어디서든 집행원장 코드를 눌러 상세를 연다 */
  openEntry: (code: string) => void;
  /** 상단 검색 칸 — 현재 화면의 표에서 일치 행만 */
  query: string;
  goto: (screen: string) => void;
}

export const ErpUiContext = createContext<ErpUi>({
  openEntry: () => {},
  query: "",
  goto: () => {},
});

export function useErpUi() {
  return useContext(ErpUiContext);
}

/** 상단 검색 칸의 필터 — 코드·항목·적요 어디든 걸린다 */
export function matchesQuery(
  query: string,
  ...fields: (string | null | undefined)[]
): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return fields.some(field => (field ?? "").toLowerCase().includes(needle));
}
