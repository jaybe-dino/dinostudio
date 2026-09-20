/**
 * §5.7 시트와 원장의 차이.
 *
 * 「최신 시트로 다시 깔기」는 이제 쓸 수 없다 — 그 사이 사람이 원장에서 고친
 * 것과 슬랙에서 올라온 것이 전부 날아간다. 대신 무엇이 다른지만 보여 주고
 * 고치는 것은 사람이 건별로 한다.
 *
 * 그래서 이 파일이 지키는 것은 두 가지다.
 *   ① **아무것도 안 쓴다** — 대조는 읽기다
 *   ② 진짜 차이만 올린다. 「아직 모름」을 차이로 세면 판정 대기가 전부 올라와
 *      정작 볼 것이 묻힌다
 */
import { describe, expect, it } from "vitest";
import { diffSheetAgainstLedger } from "../../shared/erp/sheetDiff.js";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";
import type { Entry } from "../../shared/erp/types.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };

const row = (over: Partial<Entry>): Entry =>
  ({
    id: `id-${over.code ?? "x"}`,
    code: (over.code as string) ?? "EX-1",
    direction: "out",
    status: "confirmed",
    title: "저스트컴퍼니",
    amount: 3_300_000,
    amountCandidate: null,
    cashDate: "2026-09-14",
    accrualDate: "2026-09-14",
    accountCode: "5210",
    nature: "직접원가",
    internalTransferId: null,
    paidAt: null,
    payMethod: null,
    source: "migration",
    sourceRef: "sheet:2026-09-14:1",
    hasEvidence: true,
    isPersonal: false,
    version: 1,
    ...over,
  }) as Entry;

describe("진짜 차이만 올린다", () => {
  it("같으면 아무것도 안 올라온다", () => {
    const d = diffSheetAgainstLedger([row({})], [row({})]);
    expect(d.summary.total).toBe(0);
  });

  it("시트에만 있으면 「시트에만」", () => {
    const d = diffSheetAgainstLedger([row({ code: "EX-1" })], []);
    expect(d.summary["시트에만"]).toBe(1);
    expect(d.rows[0].action).toContain("원장에 없습니다");
  });

  it("원장에만 있으면 「원장에만」 — 시트에서 지워진 것이다", () => {
    const d = diffSheetAgainstLedger([], [row({ code: "EX-1" })]);
    expect(d.summary["원장에만"]).toBe(1);
    expect(d.rows[0].ledgerCode).toBe("EX-1");
  });

  it("금액이 다르면 양쪽 값을 같이 보여 준다", () => {
    const d = diffSheetAgainstLedger(
      [row({ amount: 3_300_000 })],
      [row({ amount: 3_000_000 })]
    );
    expect(d.summary["금액 다름"]).toBe(1);
    expect(d.rows[0].sheetAmount).toBe(3_300_000);
    expect(d.rows[0].ledgerAmount).toBe(3_000_000);
  });

  it("승인된 건이면 **수정본을 만들라**고 안내한다 — 조용히 못 고친다", () => {
    const d = diffSheetAgainstLedger(
      [row({ amount: 3_300_000 })],
      [row({ amount: 3_000_000, status: "confirmed" })]
    );
    expect(d.rows[0].action).toContain("수정본");
  });

  it("방향이 다르면 따로 센다 — 손익 부호가 걸린 문제다", () => {
    const d = diffSheetAgainstLedger(
      [row({ direction: "in", accountCode: "4110" })],
      [row({ direction: "out" })]
    );
    expect(d.summary["방향 다름"]).toBe(1);
  });

  it("**한쪽 금액이 비어 있는 것은 차이가 아니다** — 아직 모르는 것이다", () => {
    // 판정 대기 47건이 전부 차이 목록에 올라오면 정작 볼 것이 묻힌다
    const d = diffSheetAgainstLedger(
      [row({ amount: null })],
      [row({ amount: 3_300_000 })]
    );
    expect(d.summary["금액 다름"]).toBe(0);
    expect(d.summary.total).toBe(0);
  });

  it("시트 안에 같은 줄이 두 번 있으면 알려 준다", () => {
    const d = diffSheetAgainstLedger(
      [row({ code: "A" }), row({ code: "B" })],
      [row({ code: "L1", id: "l1" })]
    );
    expect(d.summary["시트 안 중복"]).toBe(1);
  });

  it("**슬랙·수기 건은 대조 대상이 아니다** — 시트에 없는 것이 당연하다", () => {
    const d = diffSheetAgainstLedger(
      [],
      [
        row({ code: "SL-1", id: "s1", source: "slack" }),
        row({ code: "MA-1", id: "m1", source: "manual" }),
      ]
    );
    expect(d.summary.total).toBe(0);
    expect(d.ledgerCompared).toBe(0);
  });

  it("취소·대체된 건도 대조하지 않는다", () => {
    const d = diffSheetAgainstLedger(
      [],
      [
        row({ code: "C-1", id: "c1", status: "cancelled" }),
        row({ code: "S-1", id: "s1", status: "superseded" }),
      ]
    );
    expect(d.summary.total).toBe(0);
  });
});

describe("대조는 읽기다 — 아무것도 쓰지 않는다", () => {
  it("돌려도 원장 건수와 내용이 그대로다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    const before = await s.listEntries({}, CEO);
    const beforeVersions = before.entries.map(e => `${e.code}:${e.version}`);

    const diff = await s.sheetDiff({}, CEO);
    expect(diff.rows.length).toBeGreaterThan(0); // 시드와 시트는 다르다

    const after = await s.listEntries({}, CEO);
    expect(after.total).toBe(before.total);
    expect(after.entries.map(e => `${e.code}:${e.version}`)).toEqual(
      beforeVersions
    );
  });

  it("붙여 넣지 않으면 코드에 든 사본과 비교하고 기준일을 알려 준다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    const diff = await s.sheetDiff({}, CEO);
    expect(diff.source).toBe("embedded");
    expect(diff.asOf).toBeTruthy();
  });
});
