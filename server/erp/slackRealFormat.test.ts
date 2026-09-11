/**
 * 실제 채널 양식으로 파싱되는가 (§11.1)
 *
 * 배경 — 슬랙을 붙인 뒤 #재무-집행요청 · #결제요청방 의 **실제 글**을 읽어
 * 보니 라벨 사전과 말이 달랐다. 메시지는 검수함에 들어오지만 칸이 거의 비어서
 * 사람이 전부 다시 치는 상태였다. 연동이 붙어 있는데 일을 하지 않는 것이다.
 *
 * 여기 고정하는 것은 **양식의 모양**이다. 계좌번호·거래처명은 실제 값을 쓰지
 * 않는다 — 테스트 파일은 레포에 영원히 남고, 거래처 계좌가 거기 있을 이유가 없다.
 */
import { describe, expect, it } from "vitest";
import {
  looksLikeExpenseRequest,
  parseSlackExpense,
} from "../../shared/erp/index.js";

/** #재무-집행요청 양식 — 사업부/목적/날짜/금액/입금 은행/계좌번호/예금주 */
const 집행요청 = `<@U000|담당자> 집행요청
사업부: 커머스
목적: 네이버쇼핑 충전
날짜: 2026-08-02
금액: 100,000원
입금 은행 : 예시은행
계좌번호 : 00000000000000
예금주 : 예시상사(주)
입금유효기간 : 2026년 08월 05일
* 입금 후 계산서 자동발행`;

/** #결제요청방-일반 양식 — 정산 신청날짜/목적/기업명/착수일/정산금액/계좌 */
const 정산요청 = `<@U000|담당자> <@U001|담당자2>
정산 신청날짜: 2026.10.30
목적: 예시 캠페인 콘텐츠 운영
기업명: 예시컴퍼니 주식회사
착수일: 2026년 08월 01일
최종업로드: 2026년 09월 19일
*(입금) 요청 날짜: 2026.10.31*
*정산금액: 5,039,000원 (VAT별도)*
계좌: 00000000000000 예시은행 / 예금주: 예시컴퍼니 주식회사
계산서 발행완료`;

describe("#재무-집행요청 양식", () => {
  it("1차 관문을 통과한다", () => {
    expect(looksLikeExpenseRequest(집행요청)).toBe(true);
  });

  it("목적을 항목으로 읽는다 — 전에는 통째로 놓쳤다", () => {
    expect(parseSlackExpense(집행요청).fields.title).toBe("네이버쇼핑 충전");
  });

  it("예금주를 거래처로 읽는다", () => {
    expect(parseSlackExpense(집행요청).fields.partyName).toBe("예시상사(주)");
  });

  it("날짜를 요청일로 읽는다", () => {
    expect(parseSlackExpense(집행요청).fields.requestDate).toBe("2026-08-02");
  });

  it("금액을 정수 원으로 읽는다", () => {
    expect(parseSlackExpense(집행요청).fields.amount).toBe(100_000);
  });

  it("계좌번호를 계좌로 읽는다", () => {
    expect(parseSlackExpense(집행요청).fields.bankAccount).toBe(
      "00000000000000"
    );
  });

  it("콜론 없는 「계산서 자동발행」을 읽는다", () => {
    expect(parseSlackExpense(집행요청).fields.invoiceIssued).toBe(true);
  });

  it("필수 항목이 모두 차서 검수함에서 바로 올릴 수 있다", () => {
    const result = parseSlackExpense(집행요청);
    expect(result.missingRequired).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("#결제요청방-일반 양식", () => {
  it("1차 관문을 통과한다", () => {
    expect(looksLikeExpenseRequest(정산요청)).toBe(true);
  });

  it("정산금액을 금액으로 읽는다 — 전에는 금액이 통째로 비었다", () => {
    expect(parseSlackExpense(정산요청).fields.amount).toBe(5_039_000);
  });

  it("VAT 표기를 원문 그대로 보존하고 분리하지 않는다 (B3 미확정)", () => {
    const result = parseSlackExpense(정산요청);
    expect(result.fields.vatNotation).toBe("VAT별도");
    expect(result.fields.amountSupply).toBeNull();
    expect(result.fields.amountVat).toBeNull();
    expect(result.warnings.some(w => w.includes("B3"))).toBe(true);
  });

  it("기업명 · 목적 · 착수일을 읽는다", () => {
    const { fields } = parseSlackExpense(정산요청);
    expect(fields.partyName).toBe("예시컴퍼니 주식회사");
    expect(fields.title).toBe("예시 캠페인 콘텐츠 운영");
    expect(fields.startDate).toBe("2026-08-01");
  });

  it("(입금) 요청 날짜를 요청일로 읽는다", () => {
    expect(parseSlackExpense(정산요청).fields.requestDate).toBe("2026-10-31");
  });

  it("콜론 없는 「계산서 발행완료」를 읽는다", () => {
    expect(parseSlackExpense(정산요청).fields.invoiceIssued).toBe(true);
  });

  it("필수 항목이 모두 찬다", () => {
    expect(parseSlackExpense(정산요청).missingRequired).toEqual([]);
  });
});

describe("잡담은 여전히 안 들어온다", () => {
  it("인사말은 관문을 통과하지 못한다", () => {
    expect(
      looksLikeExpenseRequest("오늘 점심 뭐 드셨어요? 저는 김치찌개")
    ).toBe(false);
  });

  it("단어 하나만으로는 통과하지 못한다", () => {
    expect(
      looksLikeExpenseRequest("이번 정산은 다음 주에 하기로 했습니다")
    ).toBe(false);
  });
});

describe("모르는 사업부는 지어내지 않는다", () => {
  it("사전에 없는 사업부명은 비우고 경고를 남긴다", () => {
    const result = parseSlackExpense(`목적: 테스트
사업부: 보양해
금액: 10,000원`);
    expect(result.fields.buCode).toBeNull();
    expect(result.warnings.some(w => w.includes("사업부"))).toBe(true);
  });
});
