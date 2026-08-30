/**
 * §11.1 슬랙 지출요청 파싱 — 봇 정형 메시지는 규칙으로, 수기는 AI로.
 * 규칙 파서가 「추정하지 않는다」를 지키는지가 핵심이다.
 */
import {
  looksLikeExpenseRequest,
  parseKoreanAmount,
  parseSlackExpense,
} from "../../shared/erp/index.js";
import { describe, expect, it } from "vitest";
import {
  verifySlackSignature,
  isWatchedChannel,
} from "../integrations/slack.js";

const BOT_MESSAGE = `기업명: 액티브스
지출 내용: 액티브스 운영수수료 (엔지니어TV)
착수일: 2026-08-10
최종 업로드일: 2026-08-25
금액: 3,850,000 (VAT 포함)
지출 요청일: 2026-08-31
입금계좌: 국민 123-456-789
계산서 발행: O
회차: 2
사업부: 네트워크`;

describe("§11.1 슬랙 정형 메시지", () => {
  it("봇 양식을 전부 읽는다", () => {
    const result = parseSlackExpense(BOT_MESSAGE, 2026);
    expect(result.ok).toBe(true);
    expect(result.fields).toMatchObject({
      partyName: "액티브스",
      title: "액티브스 운영수수료 (엔지니어TV)",
      startDate: "2026-08-10",
      deliverDate: "2026-08-25",
      requestDate: "2026-08-31",
      amount: 3_850_000,
      bankAccount: "국민 123-456-789",
      invoiceIssued: true,
      roundNo: 2,
      buCode: "NET",
    });
  });

  it("VAT 표기는 원문 그대로 보존하고 공급가액·세액을 역산하지 않는다 (B3)", () => {
    const result = parseSlackExpense(BOT_MESSAGE, 2026);
    expect(result.fields.vatNotation).toBe("VAT 포함");
    expect(result.fields.amountSupply).toBeNull();
    expect(result.fields.amountVat).toBeNull();
    expect(result.warnings.some(w => w.includes("B3"))).toBe(true);
  });

  it("공급가액과 세액이 둘 다 적혀 있을 때만 분리한다", () => {
    const text =
      "기업명: 가\n지출 내용: 나\n금액: 공급가액 1,000,000 세액 100,000\n지출 요청일: 2026-09-01\n입금계좌: 신한 1\n계산서 발행: O";
    const result = parseSlackExpense(text, 2026);
    expect(result.fields.amountSupply).toBe(1_000_000);
    expect(result.fields.amountVat).toBe(100_000);
    expect(result.fields.amount).toBe(1_100_000);
  });

  it("필수 항목이 비면 ok가 아니고 무엇이 빠졌는지 알려준다", () => {
    const result = parseSlackExpense(
      "기업명: 액티브스\n지출 내용: 수수료",
      2026
    );
    expect(result.ok).toBe(false);
    expect(result.missingRequired).toContain("amount");
    expect(result.missingRequired).toContain(
      "입금계좌" in result.fields ? "bankAccount" : "bankAccount"
    );
  });

  it("라벨이 하나도 없으면 규칙 파서는 손을 뗀다 — AI로 넘어간다", () => {
    const result = parseSlackExpense(
      "오늘 스튜디오A 외주비 처리 부탁드려요",
      2026
    );
    expect(result.matchedFields).toBe(0);
    expect(result.ok).toBe(false);
  });

  it("금액 단위를 읽는다", () => {
    expect(parseKoreanAmount("3,850,000")).toBe(3_850_000);
    expect(parseKoreanAmount("110만원")).toBe(1_100_000);
    expect(parseKoreanAmount("")).toBeNull();
  });

  it("잡담은 검수함에 쌓지 않는다", () => {
    expect(looksLikeExpenseRequest("점심 뭐 드세요")).toBe(false);
    expect(looksLikeExpenseRequest(BOT_MESSAGE)).toBe(true);
  });
});

describe("§11.1 슬랙 수신 보안", () => {
  it("서명 비밀키가 없으면 받지 않는다", () => {
    const result = verifySlackSignature(
      "body",
      "v0=x",
      String(Math.floor(Date.now() / 1000)),
      undefined
    );
    expect(result.ok).toBe(false);
  });

  it("5분이 지난 요청은 거부한다 (재전송 공격)", () => {
    const old = String(Math.floor(Date.now() / 1000) - 600);
    const result = verifySlackSignature("body", "v0=x", old, "secret");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("만료");
  });

  it("올바른 서명은 통과한다", async () => {
    const { createHmac } = await import("node:crypto");
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "payload=1";
    const signature = `v0=${createHmac("sha256", "secret").update(`v0:${ts}:${body}`).digest("hex")}`;
    expect(verifySlackSignature(body, signature, ts, "secret").ok).toBe(true);
  });

  it("지정한 채널이 아니면 수집하지 않는다 — 채널 밖 요청은 접수되지 않는다", () => {
    const before = process.env.SLACK_EXPENSE_CHANNELS;
    process.env.SLACK_EXPENSE_CHANNELS = "C123,C456";
    expect(isWatchedChannel("C123")).toBe(true);
    expect(isWatchedChannel("C999")).toBe(false);
    delete process.env.SLACK_EXPENSE_CHANNELS;
    // 설정이 없으면 아무 채널도 받지 않는다 — 열어두는 것이 기본값이면 안 된다
    expect(isWatchedChannel("C123")).toBe(false);
    if (before) process.env.SLACK_EXPENSE_CHANNELS = before;
  });
});
