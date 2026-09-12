/**
 * #계산서발행요청 워크플로 양식 — **들어오는 돈**이다.
 *
 * 같은 워크스페이스에 양식이 두 가지인데 둘 다 워크플로 봇이 같은 모양으로
 * 올린다. 지출 집행 요청은 우리가 보내는 돈이고, 계산서 발행 요청은 우리가
 * 청구하는 돈이다. **둘을 같은 방향으로 적재하면 매출이 지출로 잡혀 손익
 * 부호가 통째로 뒤집힌다.**
 *
 * 값은 예시로 바꿔 적고 모양만 실제와 같게 둔다.
 */
import { describe, expect, it } from "vitest";
import {
  inferDirection,
  looksLikeExpenseRequest,
  parseSlackExpense,
} from "../../shared/erp/slackParse.js";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표", stepUpFresh: true };

/** #계산서발행요청 양식 */
const INVOICE = [
  "계산서: <@ULVEMUPH7|오준영> 부대표님, <@U0A919H242K|이상혁> 책임님,",
  "",
  "요청자: <@U0AHXT0UGJF|최재영>",
  "업체명 : 주식회사 예시",
  "거래처 세금계산서 수취용 이메일 주소 : billing@example.com",
  "작성일자 : 2026-09-11",
  "품목명 : 주식회사 예시_틱톡샵_9월 운영비",
  "금액(부가세 포함) : 총 ₩3,300,000원",
  "청구발행",
  "입금 예정일 : 2026-09-21",
].join("\n");

/** #지출-네트워크-사업부 양식 — 비교용 */
const EXPENSE = [
  "기업명: 주식회사 예시네트워크",
  "지출 내용: 예시 온라인 마케팅 계약",
  "지출 금액(VAT 포함): 총 10,560,000원",
  "지출 요청일: 2026-09-30",
  "입금 계좌: 예시은행 140-011-990198",
  "계산서 발행 여부: O",
].join("\n");

describe("방향을 가른다", () => {
  it("계산서 발행 요청은 **들어오는 돈**이다", () => {
    expect(inferDirection(INVOICE)).toBe("in");
  });

  it("지출 집행 요청은 나가는 돈이다", () => {
    expect(inferDirection(EXPENSE)).toBe("out");
  });

  it("애매하면 지출로 본다 — 대부분이 지출이고 검수함에서 사람이 본다", () => {
    expect(inferDirection("기업명: 예시\n금액: 100,000원")).toBe("out");
  });

  it("「계산서 발행 여부: O」 는 들어오는 돈이 아니다", () => {
    // 지출 요청에도 계산서 얘기가 나온다. 이것으로 방향을 뒤집으면 안 된다
    expect(inferDirection("지출 내용: 제작비\n계산서 발행 여부: O")).toBe(
      "out"
    );
  });
});

describe("계산서 발행 요청 양식을 읽는다", () => {
  const parsed = parseSlackExpense(INVOICE, 2026);

  it("수집 대상으로 판별한다", () => {
    expect(looksLikeExpenseRequest(INVOICE)).toBe(true);
  });

  it("방향이 수입이다", () => {
    expect(parsed.fields.direction).toBe("in");
  });

  it("「업체명」을 거래처로 읽는다", () => {
    expect(parsed.fields.partyName).toBe("주식회사 예시");
  });

  it("「품목명」을 내용으로 읽는다", () => {
    expect(parsed.fields.title).toBe("주식회사 예시_틱톡샵_9월 운영비");
  });

  it("「금액(부가세 포함)」 — 괄호를 벗기고 원화 기호도 넘긴다", () => {
    expect(parsed.fields.amount).toBe(3_300_000);
  });

  it("「입금 예정일」을 요청일로 읽는다 — 돈이 들어올 날이다", () => {
    expect(parsed.fields.requestDate).toBe("2026-09-21");
  });
});

describe("원장에 적재될 때 방향이 유지된다", () => {
  async function promote(text: string) {
    const s = new LedgerService(new InMemoryLedgerStore());
    await s.collectSlackMessage(
      { channel: "C1", ts: `${Math.random()}`, text, user: "U1" },
      CEO
    );
    const intake = (await s.masters(CEO)).intakes[0];
    const result = await s.promoteIntake(intake.id, CEO);
    return result.entry;
  }

  it("계산서 발행 요청은 **수입**으로 적재된다", async () => {
    const entry = await promote(INVOICE);
    expect(entry.direction).toBe("in");
    expect(entry.code.startsWith("IN-")).toBe(true);
  });

  it("지출 집행 요청은 지출로 적재된다", async () => {
    const entry = await promote(EXPENSE);
    expect(entry.direction).toBe("out");
    expect(entry.code.startsWith("EX-")).toBe(true);
  });
});
