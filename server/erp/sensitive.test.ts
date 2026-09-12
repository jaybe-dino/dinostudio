/**
 * 주민등록번호 — 보관하되 가린다.
 *
 * 실비 정산 요청에 사람이 주민번호를 평문으로 적어 온다. 원천징수 지급명세서에
 * 실제로 쓰는 값이라 **지우지 않는다.** 대신 화면에는 가리고, 원본은 비밀번호를
 * 다시 받은 뒤에만 열고, 연 것을 감사로그에 남긴다.
 *
 * 이 테스트에서 더 중요한 쪽은 **계좌번호를 주민번호로 오인하지 않는 것**이다.
 * 주민번호를 놓치면 화면에 노출되지만, 계좌번호를 가려 버리면 그 계좌로는
 * 송금을 못 한다. 아래 값들은 전부 실제 메시지에 나오는 **형태**이고 숫자는
 * 예시로 바꿔 적었다.
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_MASK,
  hasSensitive,
  maskSensitive,
  RRN_MASK,
} from "../../shared/erp/sensitive.js";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표", stepUpFresh: true };
const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무", stepUpFresh: true };
const LEADER: Actor = {
  id: "lead@dinostudio.kr",
  role: "사업부리더",
  stepUpFresh: true,
};

describe("주민번호를 찾는다", () => {
  it("하이픈이 있는 형태", () => {
    const out = maskSensitive("주민번호: 930807-2071310");
    expect(out.found).toBe(1);
    expect(out.text).toBe(`주민번호: ${RRN_MASK}`);
  });

  it("「주민」 줄이면 구분자가 없어도 찾는다", () => {
    expect(maskSensitive("주민번호:9308072071310").found).toBe(1);
    expect(maskSensitive("주민번호:950706 2185314").found).toBe(1);
  });

  it("슬랙이 전화번호로 오인해 감싼 것도 찾는다", () => {
    // 슬랙은 13자리를 <tel:...> 로 감싼다. 그 안의 숫자가 그대로 남으면 안 된다
    const out = maskSensitive("주민번호: <tel:9308072071310|930807-2071310>");
    expect(out.text).not.toMatch(/930807/);
    expect(out.text).not.toMatch(/9308072071310/);
  });

  it("여러 줄에 섞여 있어도 각각 찾는다", () => {
    const out = maskSensitive(
      ["성함: 홍길동", "주민번호: 900101-1234567", "금액: 15만원"].join("\n")
    );
    expect(out.found).toBe(1);
    expect(out.text).toContain("성함: 홍길동");
    expect(out.text).toContain("금액: 15만원");
  });
});

describe("계좌번호도 가린다 — 은행마다 모양이 달라서 라벨을 따라간다", () => {
  // 채널에 실제로 올라온 형태들이다 (숫자는 그대로 두면 안 되므로 형태만 본다)
  const accounts = [
    "계좌번호: 1002-251-156248",
    "계좌번호: 3333059947514",
    "계좌: 81140104329418 국민은행",
    "계좌번호 : 기업은행 063-095494-01-014",
    "계좌번호: 356-0006-1039-63",
    "계좌: 110-387-690168",
    "계좌번호 12391-04-0356807",
    "계좌번호: 318002-04-152655",
    "계좌: 302-0356-7784-11",
    "계좌번호: 110-256-31-3127",
    "계좌번호:3333-14-7923438",
    "계좌번호: 465101-01-040272",
    "하나은행 : 234-890498-40607 성낙훈",
    "기업은행 08201618297681 카페24주식회사",
    "계좌번호 : 11604098418022",
  ];

  for (const line of accounts) {
    it(`가린다 — ${line}`, () => {
      const out = maskSensitive(line);
      expect(out.found).toBeGreaterThan(0);
      expect(out.text).toContain(ACCOUNT_MASK);
      expect(out.text).not.toMatch(/\d{8}/);
    });
  }

  it("은행 이름은 남긴다 — 어디로 보내는지는 봐야 한다", () => {
    const out = maskSensitive("계좌번호 : 기업은행 063-095494-01-014");
    expect(out.text).toContain("기업은행");
  });

  it("예금주는 남긴다 — 누구에게 보내는지는 봐야 한다", () => {
    const out = maskSensitive(
      "계좌: 81140104329418 / 예금주: 주식회사 액티브스"
    );
    expect(out.text).toContain("주식회사 액티브스");
  });

  it("계좌로 쓰인 전화번호도 가린다", () => {
    // 실제로 계좌번호 칸에 휴대폰 번호를 적는 경우가 있다 (토스·카카오)
    expect(maskSensitive("계좌번호: 010-3937-8459").found).toBe(1);
  });
});

describe("가리지 말아야 할 것은 건드리지 않는다", () => {
  it("금액은 그대로 둔다 — 쉼표를 허용하지 않아서 섞이지 않는다", () => {
    const line = "금액: total 1,500,000원 [vat 별도]";
    expect(maskSensitive(line)).toMatchObject({ text: line, found: 0 });
  });

  it("금액이 계좌 줄에 없으면 자릿수가 많아도 그대로 둔다", () => {
    const line = "금액 : 1838700원";
    expect(maskSensitive(line)).toMatchObject({ text: line, found: 0 });
  });

  it("사업자등록번호는 그대로 둔다 — 공개 정보이고 거래처 대조에 쓴다", () => {
    const line = "사업자번호: 592-26-01833";
    expect(maskSensitive(line)).toMatchObject({ text: line, found: 0 });
  });

  it("날짜를 주민번호로 보지 않는다", () => {
    expect(maskSensitive("날짜: 250323").found).toBe(0);
  });

  it("목적·사업부 줄은 손대지 않는다", () => {
    const line = "사업부: IMC\n목적: 포인트앤x립앤아이 리무버 (쇼츠)";
    expect(maskSensitive(line)).toMatchObject({ text: line, found: 0 });
  });
});

describe("검수함 — 화면에는 가려서 나간다", () => {
  const message = [
    "<@U1> 집행요청",
    "사업부: IMC",
    "목적: 리무버 쇼츠",
    "금액: total 150,000원 [3.3% 공제후 입금]",
    "성함: 홍길동",
    "주민번호: 900101-1234567",
    "은행명: 예시은행",
    "계좌번호: 1002-251-156248",
  ].join("\n");

  async function collected() {
    const s = new LedgerService(new InMemoryLedgerStore());
    await s.collectSlackMessage(
      { channel: "C1", ts: "1000.1", text: message, user: "U1" },
      CEO
    );
    return s;
  }

  it("원본은 저장된다 — 원천징수 신고에 필요한 값이다", async () => {
    const s = await collected();
    const revealed = await s.revealIntakeRaw(
      (await s.masters(CEO)).intakes[0].id,
      CEO
    );
    expect(revealed.raw).toContain("900101-1234567");
  });

  it("목록에는 가려서 나간다 — 프론트가 아니라 여기서 가린다", async () => {
    const s = await collected();
    const intake = (await s.masters(CEO)).intakes[0];
    expect(intake.raw).not.toContain("900101-1234567");
    expect(intake.raw).toContain(RRN_MASK);
    expect(intake.hasSensitive).toBe(true);
    // 계좌번호도 가린다. 다만 은행 이름은 남아 어디로 보내는지는 보인다
    expect(intake.raw).not.toContain("1002-251-156248");
    expect(intake.raw).toContain(ACCOUNT_MASK);
    expect(intake.sensitiveKinds).toEqual(
      expect.arrayContaining(["주민번호", "계좌번호"])
    );
  });

  it("대표라도 목록에서는 못 본다 — 여는 행위를 따로 남기기 위해서다", async () => {
    const s = await collected();
    expect((await s.masters(CEO)).intakes[0].raw).not.toContain("900101");
  });

  it("가릴 것이 없으면 보기 버튼을 띄우지 않는다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    await s.collectSlackMessage(
      {
        channel: "C1",
        ts: "2000.1",
        text: "사업부: IMC\n목적: 제작비\n금액: 1,100,000원\n계산서 발행완료",
        user: "U1",
      },
      CEO
    );
    expect((await s.masters(CEO)).intakes[0].hasSensitive).toBe(false);
  });
});

describe("원본 열람 — 재인증과 기록 (D7)", () => {
  async function ready() {
    const s = new LedgerService(new InMemoryLedgerStore());
    await s.collectSlackMessage(
      {
        channel: "C1",
        ts: "3000.1",
        text: "집행요청\n금액: 150,000원\n주민번호: 900101-1234567\n계좌번호: 1002-251-156248",
        user: "U1",
      },
      CEO
    );
    const id = (await s.masters(CEO)).intakes[0].id;
    return { s, id };
  }

  it("비밀번호를 다시 확인하지 않았으면 열리지 않는다", async () => {
    const { s, id } = await ready();
    await expect(
      s.revealIntakeRaw(id, { ...CEO, stepUpFresh: false })
    ).rejects.toThrow(/비밀번호를 다시/);
  });

  it("원천징수를 다루지 않는 역할은 열 수 없다", async () => {
    const { s, id } = await ready();
    await expect(s.revealIntakeRaw(id, LEADER)).rejects.toThrow(
      /원천징수와 지급을 처리하는 역할만/
    );
  });

  it("재무는 열 수 있다 — 실제로 신고하는 사람이다", async () => {
    const { s, id } = await ready();
    const out = await s.revealIntakeRaw(id, CFO);
    expect(out.raw).toContain("900101-1234567");
  });

  it("연 것이 감사로그에 남는다", async () => {
    const { s, id } = await ready();
    await s.revealIntakeRaw(id, CFO);
    const trail = await s.auditTrail({ table: "intake", rowId: id });
    expect(trail.some(row => row.action === "reveal_sensitive")).toBe(true);
    expect(trail.find(row => row.action === "reveal_sensitive")?.actor).toBe(
      CFO.id
    );
  });

  it("없는 건은 열리지 않는다", async () => {
    const { s } = await ready();
    await expect(s.revealIntakeRaw("없는id", CEO)).rejects.toThrow();
  });
});

describe("hasRrn", () => {
  it("빈 값에 놀라지 않는다", () => {
    expect(hasSensitive(null)).toBe(false);
    expect(hasSensitive(undefined)).toBe(false);
    expect(hasSensitive("")).toBe(false);
  });
});
