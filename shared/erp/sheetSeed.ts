/**
 * 시트 사본 → 원장 개시 데이터.
 *
 * 「데일리 현금흐름」 시트를 **버튼 없이** 화면에 올리기 위한 경로다. 지금까지
 * 만든 재이관은 사람이 눌러야 돌았고, 그래서 아무 일도 일어나지 않았다.
 * 이것은 배포만 되면 선다.
 *
 * 중요한 것 — **새 규칙을 만들지 않는다.** 시트를 펴는 것도(flatten) 원장 건으로
 * 바꾸는 것도(importSheet) 이미 테스트가 붙은 기존 함수를 그대로 쓴다. 여기서
 * 하는 일은 둘을 잇고, 결과를 한 번 세어 보여 주는 것뿐이다.
 */
import { DAILY_CASH_SHEET, DAILY_CASH_SUMMARY } from "./data/dailyCash.js";
import { flattenDailyCashSheet, type FlattenResult } from "./dailyCashSheet.js";
import { importSheet } from "./sheetImport.js";
import type { DaySnapshot, Entry, Setting } from "./types.js";

export interface SheetSeed {
  entries: Entry[];
  snapshots: DaySnapshot[];
  settings: Setting[];
  /** 편 날짜들 — 재이관 화면이 「며칠치를 깔았는지」 보여 준다 */
  days: string[];
  /** 못 읽은 줄 — 버리지 않고 사람에게 돌려준다 */
  warnings: FlattenResult["warnings"];
  summary: {
    days: number;
    rows: number;
    /** 금액이 확정된 건 */
    ready: number;
    /** 금액을 못 읽어 사람이 봐야 하는 건 — 대부분 적요 칸에 금액이 있는 줄이다 */
    undecided: number;
    /** 승인완료로 선 건 — 금액이 있는 건만 */
    confirmed: number;
  };
}

const SHEET_YEAR = 2026;
const AS_OF = `${DAILY_CASH_SUMMARY.asOf}T00:00:00+09:00`;

function setting(
  key: string,
  value: Setting["value"],
  ownerRole: Setting["ownerRole"]
): Setting {
  return {
    key,
    value,
    // 시트에서 온 값이다 — 사람이 확인하기 전까지 확정으로 보지 않는다 (원칙 8)
    isProvisional: true,
    ownerRole,
    updatedBy: "sheet",
    updatedAt: AS_OF,
  };
}

/**
 * 시트를 원장 건으로 편다.
 *
 * 붙여 넣은 시트(`text`)도 **코드에 박아 둔 사본과 같은 길**로 보낸다. 재이관이
 * 따로 flatten + importSheet 를 부르던 때가 있었는데, 그러면 아래의 「승인완료로
 * 본다」와 「일계를 이관으로 표시하지 않는다」가 재이관에만 빠진다. 같은 규칙이
 * 두 군데 있으면 반드시 한쪽만 고치게 된다 — 이번 주에만 네 번 그랬다.
 *
 * 부르는 쪽이 매번 다시 계산하지 않도록 기본 사본은 모듈에서 한 번만 만든다
 * (아래 상수).
 */
export function buildSheetSeed(options?: {
  /** 붙여 넣은 시트. 없으면 코드에 박아 둔 사본을 쓴다 */
  text?: string;
  year?: number;
}): SheetSeed {
  const year = options?.year ?? SHEET_YEAR;
  const flat = flattenDailyCashSheet(options?.text ?? DAILY_CASH_SHEET, {
    year,
  });
  const parsed = importSheet(flat.tsv, {
    existingCodes: [],
    actor: "sheet",
    fallbackYear: year,
  });

  /*
   * **시트에 적힌 건은 이미 승인이 끝난 것으로 본다** (대표님 지시).
   *
   * 시트는 결재가 끝나고 실제로 돈이 오간 뒤에 적는 장부다. 그래서 여기 있는
   * 건을 다시 승인 대기로 세우면 「이미 나간 돈」이 현금흐름에서 빠져 잔액이
   * 맞지 않는다.
   *
   * 다만 **금액이 없는 건은 승인완료로 만들 수 없다.** 금액이 정해지지 않은
   * 건은 승인할 수 없다는 것이 §7 의 규칙이고(`amount_undecided`), 규칙을
   * 우회해 「승인됐는데 금액은 모른다」를 만들면 합계가 조용히 틀어진다.
   * 그런 건은 판정 대기로 남고, 사람이 금액을 넣는 순간 승인 대상이 된다.
   */
  const entries = parsed.entries.map(item => {
    const entry = item.entry;
    if (entry.amount == null) return entry;
    return {
      ...entry,
      status: "confirmed" as const,
      // 시트에 적혔다는 것은 그 날 실제로 집행됐다는 뜻이다
      paidAt: entry.cashDate,
      approvedBy: "sheet",
      approvedAt: entry.cashDate ? `${entry.cashDate}T00:00:00+09:00` : null,
    };
  });

  /*
   * 일계는 **이관(isMigrated)으로 표시하지 않는다.**
   *
   * 이관 표시가 붙으면 현금흐름이 그 날의 합계를 일계에서 가져온다 (§5.3 —
   * 이관 구간은 원장이 아니다). 그런데 이 시트는 「계」 칸이 0 으로 잡혀 있어
   * 그대로 쓰면 **움직임이 하나도 없는 것처럼** 보인다. 지금은 건별 원장이
   * 있으므로 합계는 원장에서 접어야 맞다.
   */
  const snapshots = parsed.snapshots.map(s => ({ ...s, isMigrated: false }));

  return {
    entries,
    snapshots,
    days: flat.days,
    warnings: flat.warnings,
    settings: [
      /*
       * 시트 맨 위의 「잔고」다. 일계의 종료 잔액을 쓰지 않는 이유가 있다 —
       * 그 칸은 사람이 직접 적고 날짜 순으로 이어지지도 않는다 (9/9 33,000,000
       * → 9/10 147,000,000). 머리말 잔고가 그나마 「지금 얼마 있나」에 가깝다.
       */
      setting("cash_on_hand", DAILY_CASH_SUMMARY.cashOnHand, "재무"),
      setting("debt_long_term_total", DAILY_CASH_SUMMARY.debtLongTerm, "재무"),
    ],
    summary: {
      days: flat.days.length,
      rows: flat.rows,
      ready: parsed.summary.ready,
      undecided: parsed.summary.undecided,
      confirmed: entries.filter(e => e.status === "confirmed").length,
    },
  };
}

/** 개시 데이터 — 모듈 적재 시 한 번만 만든다 */
export const SHEET_SEED: SheetSeed = buildSheetSeed();
