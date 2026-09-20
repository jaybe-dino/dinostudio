/**
 * §5.7 **시트와 원장의 차이** — 읽기만 한다.
 *
 * 시트는 실무에서 계속 쓰고 있고, 원장은 이미 운영 데이터가 들어가 있다.
 * 그래서 「최신 시트로 다시 깔기」는 이제 쓸 수 없다 — 그 사이 사람이 원장에서
 * 고친 것, 슬랙에서 올라온 것이 전부 날아간다.
 *
 * 대신 **무엇이 다른지만 보여 준다.** 고치는 것은 사람이 건별로 한다.
 * 이 파일에는 쓰기가 한 줄도 없다.
 *
 * 짝짓는 키 — `sourceRef` 는 `sheet:{날짜}:{줄번호}` 라 **시트 중간에 한 줄만
 * 끼워 넣어도 뒤가 전부 밀린다.** 그래서 먼저 (날짜 + 항목명)으로 맞춰 보고,
 * 그게 안 되면 sourceRef 로 맞춘다. 사람이 보는 기준과 같게 하는 것이다.
 */
import type { Entry } from "./types.js";

export type SheetDiffKind =
  | "시트에만"
  | "원장에만"
  | "금액 다름"
  | "방향 다름"
  | "시트 안 중복";

export interface SheetDiffRow {
  kind: SheetDiffKind;
  date: string | null;
  title: string;
  /** 시트 쪽 값 */
  sheetAmount: number | null;
  sheetDirection: "in" | "out" | null;
  /** 원장 쪽 값 */
  ledgerCode: string | null;
  ledgerAmount: number | null;
  ledgerDirection: "in" | "out" | null;
  ledgerStatus: string | null;
  /** 사람이 무엇을 해야 하는가 */
  action: string;
}

export interface SheetDiff {
  rows: SheetDiffRow[];
  summary: Record<SheetDiffKind, number> & { total: number };
  /** 대조에 쓴 원장 건수 — 시트에서 온 건만 본다 */
  ledgerCompared: number;
}

const key = (date: string | null, title: string) =>
  `${date ?? ""}|${title.trim()}`;

/**
 * 시트에서 편 건과 원장을 맞춰 본다.
 *
 * 원장 쪽은 **시트에서 온 건만** 본다 (`source === "migration"`). 슬랙에서
 * 올라온 건이나 사람이 직접 넣은 건은 시트에 없는 것이 당연하므로, 그것까지
 * 「시트에 없음」으로 세면 목록이 쓸모없어진다.
 */
export function diffSheetAgainstLedger(
  sheetEntries: Entry[],
  ledger: Entry[]
): SheetDiff {
  const fromSheet = ledger.filter(
    e =>
      e.source === "migration" &&
      e.status !== "cancelled" &&
      e.status !== "superseded"
  );

  const ledgerByKey = new Map<string, Entry[]>();
  for (const e of fromSheet) {
    const k = key(e.cashDate, e.title);
    const list = ledgerByKey.get(k);
    if (list) list.push(e);
    else ledgerByKey.set(k, [e]);
  }

  const rows: SheetDiffRow[] = [];
  const matched = new Set<string>();
  const seenInSheet = new Map<string, number>();

  for (const s of sheetEntries) {
    const k = key(s.cashDate, s.title);
    seenInSheet.set(k, (seenInSheet.get(k) ?? 0) + 1);

    const candidates = (ledgerByKey.get(k) ?? []).filter(
      e => !matched.has(e.id)
    );
    const hit = candidates[0];
    if (!hit) {
      rows.push({
        kind: "시트에만",
        date: s.cashDate,
        title: s.title,
        sheetAmount: s.amount,
        sheetDirection: s.direction,
        ledgerCode: null,
        ledgerAmount: null,
        ledgerDirection: null,
        ledgerStatus: null,
        action:
          "원장에 없습니다 — 시트에 새로 적힌 건이면 원장에 직접 넣으십시오",
      });
      continue;
    }
    matched.add(hit.id);

    if (s.direction !== hit.direction) {
      rows.push({
        kind: "방향 다름",
        date: s.cashDate,
        title: s.title,
        sheetAmount: s.amount,
        sheetDirection: s.direction,
        ledgerCode: hit.code,
        ledgerAmount: hit.amount,
        ledgerDirection: hit.direction,
        ledgerStatus: hit.status,
        action:
          "수입/지출이 반대입니다 — 손익 부호가 걸린 문제라 먼저 확인하십시오",
      });
      continue;
    }

    /*
     * 금액이 **둘 다 있을 때만** 비교한다. 한쪽이 비어 있는 것은 「다름」이
     * 아니라 「아직 모름」이다 (원칙 8). 그걸 차이로 세면 판정 대기 47건이
     * 전부 차이 목록에 올라와 정작 진짜 차이가 묻힌다.
     */
    if (s.amount != null && hit.amount != null && s.amount !== hit.amount) {
      rows.push({
        kind: "금액 다름",
        date: s.cashDate,
        title: s.title,
        sheetAmount: s.amount,
        sheetDirection: s.direction,
        ledgerCode: hit.code,
        ledgerAmount: hit.amount,
        ledgerDirection: hit.direction,
        ledgerStatus: hit.status,
        action:
          hit.status === "confirmed"
            ? "원장은 이미 승인된 건입니다 — 시트가 맞으면 수정본을 만드십시오"
            : "어느 쪽이 맞는지 확인해 원장을 고치십시오",
      });
    }
  }

  for (const [k, n] of Array.from(seenInSheet.entries())) {
    if (n < 2) continue;
    const [date, title] = k.split("|");
    rows.push({
      kind: "시트 안 중복",
      date: date || null,
      title,
      sheetAmount: null,
      sheetDirection: null,
      ledgerCode: null,
      ledgerAmount: null,
      ledgerDirection: null,
      ledgerStatus: null,
      action: `시트에 같은 날 같은 항목이 ${n}번 있습니다 — 둘 다 맞는 건인지 확인하십시오`,
    });
  }

  for (const e of fromSheet) {
    if (matched.has(e.id)) continue;
    rows.push({
      kind: "원장에만",
      date: e.cashDate,
      title: e.title,
      sheetAmount: null,
      sheetDirection: null,
      ledgerCode: e.code,
      ledgerAmount: e.amount,
      ledgerDirection: e.direction,
      ledgerStatus: e.status,
      action:
        "시트에서 지워졌거나 이름이 바뀌었습니다 — 취소할 건인지 확인하십시오",
    });
  }

  const summary = {
    시트에만: 0,
    원장에만: 0,
    "금액 다름": 0,
    "방향 다름": 0,
    "시트 안 중복": 0,
    total: rows.length,
  } as SheetDiff["summary"];
  for (const r of rows) summary[r.kind] += 1;

  return { rows, summary, ledgerCompared: fromSheet.length };
}
