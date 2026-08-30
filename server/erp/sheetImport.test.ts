/**
 * §5.2 시트 → 원장 매핑 검증 — 「금액을 추정하지 않는다」가 지켜지는지가 핵심이다 (V5).
 */
import {
  candidateFromNote,
  importSheet,
  parseAmount,
  parseDate,
} from "../../shared/erp/index.js";
import { describe, expect, it } from "vitest";

const options = {
  existingCodes: [] as string[],
  actor: "test",
  fallbackYear: 2026,
};

describe("§5.2 시트 이관", () => {
  it("금액을 파싱한다", () => {
    expect(parseAmount("1,240,000")).toBe(1_240_000);
    expect(parseAmount("350000원")).toBe(350_000);
    expect(parseAmount("-")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("일자를 파싱한다", () => {
    expect(parseDate("2026-08-26", 2026)).toBe("2026-08-26");
    expect(parseDate("2026.8.6", 2026)).toBe("2026-08-06");
    expect(parseDate("8/26", 2026)).toBe("2026-08-26");
    expect(parseDate("모름", 2026)).toBeNull();
  });

  it("적요칸 숫자를 금액으로 승격하지 않는다 (V5)", () => {
    const text = [
      "일자\t항목\t적요\t지출\t수입",
      "2026-08-27\t급여 7월\t12,614,300\t\t",
      "2026-08-26\t부가세 2차\t1,200\t\t",
    ].join("\n");
    const result = importSheet(text, options);

    const payroll = result.entries[0].entry;
    expect(payroll.amount).toBeNull(); // 승격하지 않는다
    expect(payroll.amountCandidate).toBe(12_614_300); // 후보로만 남긴다
    expect(payroll.status).toBe("undecided");

    const vat = result.entries[1].entry;
    expect(vat.amount).toBeNull();
    // 1,200은 만원인지 원인지 알 수 없으므로 후보로도 올리지 않는다
    expect(vat.amountCandidate).toBeNull();
  });

  it("단위가 불명한 값은 후보에서도 제외한다", () => {
    expect(candidateFromNote("80")).toBeNull();
    expect(candidateFromNote("350")).toBeNull();
    expect(candidateFromNote("1,200")).toBeNull();
    expect(candidateFromNote("12,614,300")).toBe(12_614_300);
  });

  it("항목이 공란이면 판정 대기로 적재한다 — 행을 버리지 않는다", () => {
    const text = [
      "일자\t항목\t적요\t지출\t수입",
      "2026-08-28\t\tMBC 영업중\t30,000,000\t",
    ].join("\n");
    const result = importSheet(text, options);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].entry.status).toBe("undecided");
    expect(result.entries[0].entry.undecidedReason).toBe("항목명 없음");
    expect(result.entries[0].entry.amount).toBe(30_000_000);
  });

  it("일자를 못 읽은 줄은 버리지 않고 사유와 함께 남긴다", () => {
    const text = ["일자\t항목\t지출", "언젠가\t뭔가\t1,000"].join("\n");
    const result = importSheet(text, options);
    expect(result.entries).toHaveLength(0);
    expect(result.rejected[0].reason).toContain("일자");
  });

  it("계정·귀속은 비워 두고 사람이 태깅한다", () => {
    const text = ["일자\t항목\t지출", "2026-08-26\t대출이자\t350,000"].join(
      "\n"
    );
    const entry = importSheet(text, options).entries[0].entry;
    expect(entry.accountCode).toBeNull();
    expect(entry.buCode).toBeNull();
    expect(entry.projectId).toBeNull();
    expect(entry.status).toBe("pending"); // 금액·항목이 있으면 승인 대기
  });

  it("지정한 날짜 이전은 들여오지 않는다 (동결 구간)", () => {
    const text = [
      "일자\t항목\t지출",
      "2026-08-20\t이관 구간\t1,000",
      "2026-08-26\tDB 구간\t2,000",
    ].join("\n");
    const result = importSheet(text, { ...options, from: "2026-08-26" });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].entry.cashDate).toBe("2026-08-26");
  });

  it("같은 날 여러 건이면 순번이 이어진다", () => {
    const text = [
      "일자\t항목\t지출",
      "2026-09-01\t첫 건\t1,000",
      "2026-09-01\t둘째 건\t2,000",
    ].join("\n");
    const codes = importSheet(text, options).entries.map(e => e.entry.code);
    expect(codes).toEqual(["EX-260901-01", "EX-260901-02"]);
  });

  it("잔액 열이 있으면 일계 스냅샷으로 따로 모은다", () => {
    const text = [
      "일자\t항목\t적요\t지출\t수입\t시작잔액\t종료잔액",
      "2026-08-26\t대출이자\t\t350,000\t\t18,000,000\t17,650,000",
    ].join("\n");
    const result = importSheet(text, options);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]).toMatchObject({
      date: "2026-08-26",
      open: 18_000_000,
      close: 17_650_000,
    });
  });
});

describe("§14 시간대 — KST 고정", () => {
  it("일자 경계는 00:00 KST다 — UTC로 계산하면 오전 9시 이전이 전날로 밀린다", async () => {
    const { kstToday, kstIso, kstMonth } = await import(
      "../../shared/erp/index.js"
    );
    // 2026-08-29 08:00 KST = 2026-08-28 23:00 UTC
    const beforeNine = new Date("2026-08-28T23:00:00Z");
    expect(beforeNine.toISOString().slice(0, 10)).toBe("2026-08-28"); // UTC로는 전날
    expect(kstToday(beforeNine)).toBe("2026-08-29"); // KST로는 당일
    expect(kstMonth(beforeNine)).toBe("2026-08");
    expect(kstIso(beforeNine)).toBe("2026-08-29T08:00:00+09:00");
  });

  it("자정 직후도 같은 날로 잡힌다", async () => {
    const { kstToday } = await import("../../shared/erp/index.js");
    expect(kstToday(new Date("2026-08-31T15:00:00Z"))).toBe("2026-09-01");
    expect(kstToday(new Date("2026-08-31T14:59:00Z"))).toBe("2026-08-31");
  });
});
