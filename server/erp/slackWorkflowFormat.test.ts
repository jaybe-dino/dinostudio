/**
 * 실제로 쓰는 지출 요청 양식 — 슬랙 **워크플로**가 올리는 글.
 *
 * 이 파일이 생긴 이유가 곧 결함 두 개다.
 *
 *   ① 진짜 지출 요청은 사람이 아니라 **워크플로 봇**이 올린다
 *      (`subtype: "bot_message"`). 그런데 수집기가 봇 글을 전부 버리고
 *      있었다. 채널을 제대로 붙여도 수집함은 영원히 비었을 것이다
 *   ② 그 양식의 라벨이 `지출 금액(VAT 포함)` · `계산서 발행 여부` 인데,
 *      라벨 사전은 `금액` · `계산서발행` 만 알고 있었다. **금액과 계산서
 *      여부 — 가장 중요한 두 칸이 통째로 안 읽혔다**
 *
 * 값은 예시로 바꿔 적고 **모양만** 실제와 같게 둔다.
 */
import { describe, expect, it } from "vitest";
import {
  looksLikeExpenseRequest,
  parseSlackExpense,
} from "../../shared/erp/slackParse.js";
import { isCollectableMessage } from "../integrations/slackHistory.js";

/** #지출-네트워크-사업부 · #지출-비즈니스-사업부 워크플로 양식 */
const WORKFLOW = [
  "<@ULVEMUPH7|오준영> 부대표님, <@U0A919H242K|이상혁> 책임님",
  "",
  "기업명: 주식회사 예시네트워크",
  "지출 내용: 예시부부X캐치웰 온라인 마케팅 계약",
  "착수일: 2026-07-21",
  "최종 업로드일: 2026-08-02",
  "지출 금액(VAT 포함): 총 10,560,000원",
  "지출 요청일: 2026-09-30",
  "입금 계좌: 예시은행 140-011-990198 주식회사 예시네트워크",
  "계산서 발행 여부: O",
].join("\n");

describe("워크플로 봇 글을 수집한다", () => {
  it("bot_message 를 버리지 않는다 — 진짜 지출 요청이 전부 이 형태다", () => {
    expect(
      isCollectableMessage({
        type: "message",
        subtype: "bot_message",
        ts: "1787022847.071709",
        text: WORKFLOW,
      })
    ).toBe(true);
  });

  it("사람이 쓴 글도 그대로 수집한다", () => {
    expect(
      isCollectableMessage({ type: "message", ts: "1.1", text: "집행요청" })
    ).toBe(true);
  });

  it("참여 알림은 계속 버린다", () => {
    expect(
      isCollectableMessage({
        type: "message",
        subtype: "channel_join",
        ts: "1.1",
        text: "has joined",
      })
    ).toBe(false);
  });

  it("수정 이벤트는 버린다 — 같은 글이 두 번 들어오면 중복이 된다", () => {
    expect(
      isCollectableMessage({
        type: "message",
        subtype: "message_changed",
        ts: "1.1",
        text: "x",
      })
    ).toBe(false);
  });

  it("파일 공유는 버린다", () => {
    expect(
      isCollectableMessage({
        type: "message",
        subtype: "file_share",
        ts: "1.1",
        text: "x",
      })
    ).toBe(false);
  });
});

describe("워크플로 양식을 끝까지 읽는다", () => {
  const parsed = parseSlackExpense(WORKFLOW, 2026);

  it("지출 요청으로 판별한다", () => {
    expect(looksLikeExpenseRequest(WORKFLOW)).toBe(true);
  });

  it("「지출 금액(VAT 포함)」 — 괄호가 붙어도 금액을 읽는다", () => {
    expect(parsed.fields.amount).toBe(10_560_000);
  });

  it("VAT 표기는 원문 그대로 남긴다 (B3)", () => {
    expect(parsed.fields.vatNotation).toMatch(/VAT/i);
    // 전사 기준이 없으므로 공급가액·세액을 추정해 쪼개지 않는다 (원칙 8)
    expect(parsed.fields.amountSupply).toBeNull();
    expect(parsed.fields.amountVat).toBeNull();
  });

  it("「계산서 발행 여부: O」 — 꼬리말이 붙어도 읽는다", () => {
    expect(parsed.fields.invoiceIssued).toBe(true);
  });

  it("기업명 · 지출 내용 · 착수일 · 최종 업로드일 · 지출 요청일", () => {
    expect(parsed.fields.partyName).toBe("주식회사 예시네트워크");
    expect(parsed.fields.title).toBe("예시부부X캐치웰 온라인 마케팅 계약");
    expect(parsed.fields.startDate).toBe("2026-07-21");
    expect(parsed.fields.deliverDate).toBe("2026-08-02");
    expect(parsed.fields.requestDate).toBe("2026-09-30");
  });

  it("입금 계좌를 은행·번호 그대로 담는다", () => {
    expect(parsed.fields.bankAccount).toContain("140-011-990198");
  });

  it("필수 항목이 다 찼으므로 검수함에서 바로 처리할 수 있다", () => {
    expect(parsed.missingRequired).toEqual([]);
  });
});

describe("계산서 발행 여부 X · 다른 표기", () => {
  const base = (line: string) =>
    parseSlackExpense(
      ["기업명: 예시상사", "지출 금액(VAT 포함): 총 100,000원", line].join(
        "\n"
      ),
      2026
    );

  it("X 면 미발행", () => {
    expect(base("계산서 발행 여부: X").fields.invoiceIssued).toBe(false);
  });

  it("「계산서: O」 처럼 짧게 적어도 읽는다", () => {
    expect(base("계산서: O").fields.invoiceIssued).toBe(true);
  });

  it("원화 기호가 붙은 금액도 읽는다", () => {
    const parsed = parseSlackExpense(
      ["기업명: 예시", "지출 금액(VAT 포함): 총 ₩1,146,600원"].join("\n"),
      2026
    );
    expect(parsed.fields.amount).toBe(1_146_600);
  });

  it("쉼표 없는 금액도 읽는다 — 워크플로에 그대로 들어오는 경우가 있다", () => {
    const parsed = parseSlackExpense(
      ["기업명: 예시", "지출 금액(VAT 포함): 총 360000원"].join("\n"),
      2026
    );
    expect(parsed.fields.amount).toBe(360_000);
  });
});

describe("라벨을 느슨하게 풀지는 않았다", () => {
  it("「계좌번호」가 「번호」로 잘못 걸리지 않는다", () => {
    const parsed = parseSlackExpense(
      ["기업명: 예시", "계좌번호: 110-387-690168"].join("\n"),
      2026
    );
    expect(parsed.fields.bankAccount).toBe("110-387-690168");
    expect(parsed.fields.amount).toBeNull();
  });

  it("모르는 라벨은 그냥 넘긴다", () => {
    const parsed = parseSlackExpense(
      ["기업명: 예시", "담당자 연락처: 010-0000-0000"].join("\n"),
      2026
    );
    expect(parsed.fields.amount).toBeNull();
    expect(parsed.fields.partyName).toBe("예시");
  });
});
