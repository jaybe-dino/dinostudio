/**
 * 대조 — 「이 글이 원장의 어느 건인가」.
 *
 * 가장 중요한 것은 **자동으로 잇지 않는 것**이다. 잘못 이으면 같은 지출이
 * 두 번 잡히거나(이중계상), 결재가 끝난 것처럼 보이는데 실제로는 다른 건이
 * 결재된 상태가 된다. 그래서 「확실」은 이름과 금액이 **둘 다** 맞을 때만 준다.
 *
 * 값은 예시이고, 이름의 모양(법인격 표기·회차 접미사)만 실제와 같게 뒀다.
 */
import { describe, expect, it } from "vitest";
import {
  matchEntries,
  nameSimilarity,
  normalizeName,
} from "../../shared/erp/matching.js";
import {
  classifyNote,
  parseContractRequest,
  parseDecisionThread,
} from "../../shared/erp/slackNotes.js";
import type { Entry } from "../../shared/erp/types.js";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표", stepUpFresh: true };

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: "id",
    code: "EX-260911-01",
    version: 1,
    direction: "out",
    status: "pending",
    title: "액티브스 PPL 운영수수료",
    noteRaw: null,
    note: null,
    amount: 3_850_000,
    amountCandidate: null,
    amountSupply: null,
    amountVat: null,
    accrualDate: null,
    cashDate: "2026-09-09",
    accountCode: "6320",
    nature: "직접원가",
    buCode: "NET",
    projectId: null,
    partyId: null,
    priority: "P2",
    hasEvidence: true,
    isPersonal: false,
    source: "manual",
    sourceRef: null,
    createdBy: "a@b.kr",
    createdAt: "2026-09-09T00:00:00+09:00",
    undecidedReason: null,
    ...over,
  } as Entry;
}

describe("이름 비교", () => {
  it("법인격 표기를 걷어낸다", () => {
    expect(normalizeName("주식회사 액티브스")).toBe("액티브스");
    expect(normalizeName("(주)액티브스")).toBe("액티브스");
  });

  it("한쪽이 다른 쪽에 들어 있으면 같은 이름으로 본다", () => {
    expect(nameSimilarity("액티브스", "주식회사 액티브스")).toBe(1);
  });

  it("전혀 다른 이름은 낮다", () => {
    expect(nameSimilarity("액티브스", "퍼스트메카")).toBeLessThan(0.3);
  });

  it("빈 이름은 0 이다", () => {
    expect(nameSimilarity("", "액티브스")).toBe(0);
  });
});

describe("확실과 유사를 가른다", () => {
  const entries = [entry()];

  it("이름과 금액이 둘 다 맞으면 확실", () => {
    const out = matchEntries(
      { name: "주식회사 액티브스", amount: 3_850_000, date: "2026-09-09" },
      entries
    );
    expect(out.verdict).toBe("확실");
  });

  it("**이름만 맞으면 확실이 아니다** — 회차가 다른 같은 거래처일 수 있다", () => {
    const out = matchEntries({ name: "액티브스 PPL 운영수수료" }, entries);
    expect(out.verdict).toBe("유사");
    expect(out.note).toContain("사람이 확인");
  });

  it("금액이 다르면 근거에 그대로 적는다", () => {
    const out = matchEntries(
      { name: "액티브스 PPL 운영수수료", amount: 1_000_000 },
      entries
    );
    expect(out.verdict).toBe("유사");
    expect(out.candidates[0].reasons.join(" ")).toContain("금액이 다릅니다");
  });

  it("짝이 없으면 없음 — 아직 안 들어온 건일 수 있다", () => {
    const out = matchEntries({ name: "전혀다른회사이름" }, entries);
    expect(out.verdict).toBe("없음");
    expect(out.candidates).toHaveLength(0);
  });

  it("후보는 점수순이다", () => {
    const out = matchEntries({ name: "액티브스", amount: 3_850_000 }, [
      entry({ code: "A", amount: 1 }),
      entry({ code: "B" }),
    ]);
    expect(out.candidates[0].code).toBe("B");
  });
});

describe("지출결의서 스레드", () => {
  it("항목을 줄 단위로 읽고 승인을 잡는다", () => {
    const note = parseDecisionThread([
      { text: "김성환고문\n\n박재우 컨설턴트\n\n유튜버시딩 2건", user: "joon" },
      { text: "네승인", user: "jaybe" },
    ]);
    expect(note.items).toEqual([
      "김성환고문",
      "박재우 컨설턴트",
      "유튜버시딩 2건",
    ]);
    expect(note.approved).toBe(true);
    expect(note.decidedBy).toBe("jaybe");
  });

  it("답이 없으면 아직 결재 전이다 — 승인으로 넘겨짚지 않는다", () => {
    const note = parseDecisionThread([{ text: "김성환고문", user: "joon" }]);
    expect(note.approved).toBeNull();
  });

  it("반려는 뒤집히지 않는다 — 사람이 봐야 할 상태다", () => {
    const note = parseDecisionThread([
      { text: "항목A", user: "joon" },
      { text: "보류", user: "jaybe" },
      { text: "네승인", user: "joon" },
    ]);
    expect(note.approved).toBe(false);
  });

  it("「승인」 표시를 항목으로 세지 않는다", () => {
    const note = parseDecisionThread([
      { text: "항목A", user: "joon" },
      { text: "네승인", user: "jaybe" },
    ]);
    expect(note.items).toEqual(["항목A"]);
  });

  it("멘션과 꾸밈을 걷어낸다", () => {
    const note = parseDecisionThread([
      { text: "<@U1|오준영> *항목A*", user: "joon" },
    ]);
    expect(note.items).toEqual(["항목A"]);
  });
});

describe("계약서 서명요청", () => {
  it("꺾쇠 제목에서 이름을 뽑는다", () => {
    const note = parseContractRequest(
      "< 예시먼트 Sena 님 크리에이터 계약 건 >\n<@U1> 여기에 공유 한번만 더 해주세요 !"
    );
    expect(note.names.join(" ")).toContain("예시먼트");
  });

  it("「…계약서 서명」 앞의 이름을 뽑는다", () => {
    const note = parseContractRequest(
      "<@U1> 부대표님, 예시코스메틱(닥터예시) 틱톡샵 계약서 서명 부탁드립니다."
    );
    expect(note.names.join(" ")).toContain("예시코스메틱");
  });

  it("못 찾으면 빈 목록이다 — 틀린 짝을 만들지 않는다", () => {
    expect(parseContractRequest("확인 부탁드립니다").names).toEqual([]);
  });
});

describe("글의 종류를 가른다", () => {
  it("지출결의서", () => {
    expect(classifyNote("<@U1> 지출결의서")).toBe("지출결의서");
  });

  it("계약서 서명요청", () => {
    expect(classifyNote("틱톡샵 계약서 서명 부탁드립니다")).toBe(
      "계약서 서명요청"
    );
    expect(classifyNote("모두싸인 전자계약 올려놓았습니다")).toBe(
      "계약서 서명요청"
    );
  });

  it("지출 요청은 여기 해당하지 않는다", () => {
    expect(
      classifyNote("기업명: 예시\n지출 금액(VAT 포함): 총 100,000원")
    ).toBeNull();
  });
});

describe("검수함 — 결의서·계약서는 원장 건이 아니라 참조로 선다", () => {
  it("금액 없는 결의서도 버리지 않는다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    const out = await s.collectSlackMessage(
      {
        channel: "C_DECISION",
        ts: "1.1",
        text: "<@U1|허정발> 지출결의서\n김성환고문\n박재우 컨설턴트",
        user: "joon",
      },
      CEO
    );
    expect(out.status).toBe("note");
  });

  it("계약서 서명요청도 참조로 남는다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    const out = await s.collectSlackMessage(
      {
        channel: "C_CONTRACT",
        ts: "2.1",
        text: "<@U1> 부대표님, 예시코스메틱 틱톡샵 계약서 서명 부탁드립니다.",
        user: "jy",
      },
      CEO
    );
    expect(out.status).toBe("note");
  });

  it("잡담은 여전히 버린다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    const out = await s.collectSlackMessage(
      { channel: "C1", ts: "3.1", text: "오늘 점심 뭐 드세요?", user: "U1" },
      CEO
    );
    expect(out.status).toBe("ignored");
  });

  it("참조 기록은 원장과 대조돼 반영 여부가 나온다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    await s.createEntry(
      {
        direction: "out",
        title: "김성환고문",
        amount: 2_000_000,
        cashDate: "2026-09-11",
        accountCode: null,
        nature: "미지정",
        buCode: null as never,
        hasEvidence: false,
        noteRaw: null,
        source: "manual",
        sourceRef: "x1",
      },
      CEO
    );
    await s.collectSlackMessage(
      {
        channel: "C_DECISION",
        ts: "4.1",
        text: "지출결의서\n김성환고문\n아직없는항목이름",
        user: "joon",
      },
      CEO
    );

    const out = await s.crossReference(CEO);
    const row = out.rows.find(r => r.kind === "지출결의서")!;
    expect(row.names).toContain("김성환고문");
    const found = row.matches.find(m => m.name === "김성환고문")!;
    expect(found.verdict).not.toBe("없음");
    const missing = row.matches.find(m => m.name === "아직없는항목이름")!;
    expect(missing.verdict).toBe("없음");
    expect(row.note).toContain("원장에 없는 항목이 있습니다");
  });

  it("원문의 주민번호·계좌번호는 대조 결과에서도 가려진다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    await s.collectSlackMessage(
      {
        channel: "C_DECISION",
        ts: "5.1",
        text: "지출결의서\n홍길동\n주민번호: 900101-1234567",
        user: "joon",
      },
      CEO
    );
    const out = await s.crossReference(CEO);
    expect(out.rows[0].raw).not.toContain("900101-1234567");
  });
});
