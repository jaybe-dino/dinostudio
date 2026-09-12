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
import { flattenDailyCashSheet } from "./dailyCashSheet.js";
import { importSheet } from "./sheetImport.js";
import type { DaySnapshot, Entry, Setting } from "./types.js";

export interface SheetSeed {
  entries: Entry[];
  snapshots: DaySnapshot[];
  settings: Setting[];
  summary: {
    days: number;
    rows: number;
    /** 금액이 확정된 건 */
    ready: number;
    /** 금액을 못 읽어 사람이 봐야 하는 건 — 대부분 적요 칸에 금액이 있는 줄이다 */
    undecided: number;
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
 * 시트 사본을 원장 건으로 편다.
 *
 * 부르는 쪽이 매번 다시 계산하지 않도록 모듈에서 한 번만 만든다 (아래 상수).
 */
export function buildSheetSeed(): SheetSeed {
  const flat = flattenDailyCashSheet(DAILY_CASH_SHEET, { year: SHEET_YEAR });
  const parsed = importSheet(flat.tsv, {
    existingCodes: [],
    actor: "sheet",
    fallbackYear: SHEET_YEAR,
  });

  return {
    entries: parsed.entries.map(item => item.entry),
    snapshots: parsed.snapshots,
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
    },
  };
}

/** 개시 데이터 — 모듈 적재 시 한 번만 만든다 */
export const SHEET_SEED: SheetSeed = buildSheetSeed();
