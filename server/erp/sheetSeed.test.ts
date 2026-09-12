/**
 * 시트 사본이 개시 데이터가 된다.
 *
 * 「버튼을 눌러야 들어온다」는 경로는 실제로 아무도 누르지 않아 계속 비어
 * 있었다. 이 테스트는 **누르지 않아도 서 있는지**를 본다.
 *
 * 그리고 시트를 그대로 믿지 않는다는 것도 함께 고정한다 — 적요 칸 금액은
 * 후보로만, 단위 불명은 후보로도 안 올림, 그리고 **매출이 지출로 뒤집히지
 * 않을 것**.
 */
import { describe, expect, it } from "vitest";
import { SHEET_SEED } from "../../shared/erp/sheetSeed.js";
import { DAILY_CASH_SUMMARY } from "../../shared/erp/data/dailyCash.js";

const byTitle = (title: string) =>
  SHEET_SEED.entries.find(e => e.title === title);

describe("시트가 원장 건으로 선다", () => {
  it("2026-09 구간이 전부 들어온다", () => {
    expect(SHEET_SEED.summary.days).toBe(17);
    expect(SHEET_SEED.entries.length).toBe(SHEET_SEED.summary.rows);
    expect(SHEET_SEED.entries.length).toBeGreaterThan(50);
  });

  it("날짜가 9/3 ~ 9/18 안에 든다", () => {
    const dates = SHEET_SEED.entries
      .map(e => e.cashDate)
      .filter((d): d is string => d != null)
      .sort();
    expect(dates[0]).toBe("2026-09-03");
    expect(dates.at(-1)).toBe("2026-09-18");
  });

  it("일계(종료 잔액)도 함께 들어온다", () => {
    expect(SHEET_SEED.snapshots.length).toBeGreaterThan(5);
  });

  it("한 건도 버리지 않는다 — 못 읽은 것도 판정 대기로 선다", () => {
    expect(SHEET_SEED.summary.ready + SHEET_SEED.summary.undecided).toBe(
      SHEET_SEED.entries.length
    );
  });
});

describe("방향이 뒤집히지 않는다 — 손익 부호가 걸린 문제다", () => {
  it("금액 칸이 찬 매출은 수입이다", () => {
    expect(byTitle("셀락바이오")?.direction).toBe("in");
    expect(byTitle("유한양행(영탁)")?.direction).toBe("in");
  });

  it("**금액이 적요 칸에 있는 매출도 수입이다**", () => {
    // 금액만 보고 방향을 정하면 이 줄들이 전부 지출로 뒤집힌다
    expect(byTitle("의적단2 잔금")?.direction).toBe("in");
    expect(byTitle("최선정 정산")?.direction).toBe("in");
    expect(byTitle("제이엠더블유(로아띠 온보딩)")?.direction).toBe("in");
    expect(byTitle("페르소나AI X 머니클래스 PPL_잔금(50%)")?.direction).toBe(
      "in"
    );
  });

  it("경비는 지출이다", () => {
    expect(byTitle("허이사")?.direction).toBe("out");
    expect(byTitle("4대 보험료")?.direction).toBe("out");
    expect(byTitle("저스트컴퍼니")?.direction).toBe("out");
  });
});

describe("시트를 그대로 믿지 않는다", () => {
  it("금액 칸에 적힌 값만 확정으로 본다", () => {
    const 저스트 = byTitle("저스트컴퍼니")!;
    expect(저스트.amount).toBe(3_300_000);
  });

  it("적요 칸 금액은 **후보로만** 둔다 — 시트의 계가 0 으로 잡히던 줄들이다", () => {
    const 허이사 = byTitle("허이사")!;
    expect(허이사.amount).toBeNull();
    expect(허이사.amountCandidate).toBe(6_787_100);
  });

  it("단위를 알 수 없는 값은 후보로도 올리지 않는다", () => {
    // 부가세2차 「1,200」 — 원인지 천원인지 만원인지 알 수 없다
    const 부가세 = byTitle("부가세2차")!;
    expect(부가세.amount).toBeNull();
    expect(부가세.amountCandidate).toBeNull();
  });

  it("금액이 아예 없는 줄도 남는다 — 사람이 채워야 한다", () => {
    const 지브이엔 = byTitle("지브이엔")!;
    expect(지브이엔.amount).toBeNull();
  });

  it("대부분이 판정 대기다 — 시트가 그렇게 생겼기 때문이다", () => {
    expect(SHEET_SEED.summary.undecided).toBeGreaterThan(
      SHEET_SEED.summary.ready
    );
  });
});

describe("머리말 요약", () => {
  it("보유현금은 시트 맨 위 「잔고」를 쓴다", () => {
    const cash = SHEET_SEED.settings.find(s => s.key === "cash_on_hand");
    expect(cash?.value).toBe(DAILY_CASH_SUMMARY.cashOnHand);
    expect(cash?.value).toBe(145_000_000);
  });

  it("시트에서 온 값은 확정으로 보지 않는다 (원칙 8)", () => {
    expect(SHEET_SEED.settings.every(s => s.isProvisional)).toBe(true);
  });

  it("장기부채도 옮긴다", () => {
    const debt = SHEET_SEED.settings.find(
      s => s.key === "debt_long_term_total"
    );
    expect(debt?.value).toBe(790_000_000);
  });
});
