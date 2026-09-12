/**
 * 「데일리 현금흐름」 시트 어댑터.
 *
 * 실제 시트의 **모양 그대로** 고정한다 (숫자는 예시). 특히 9/11 처럼 금액이
 * 「적요」 칸에 들어가 있는 날이 있는데, 그 때문에 시트 자신의 「계」가 0 으로
 * 잡히고 종료 잔액이 과대계상돼 있다. 어댑터는 그것을 **고치지 않는다** —
 * 있는 그대로 넘기고, 원장 쪽이 「판정 대기」로 세운다 (원칙 8).
 */
import { describe, expect, it } from "vitest";
import { flattenDailyCashSheet } from "../../shared/erp/dailyCashSheet.js";
import { importSheet } from "../../shared/erp/sheetImport.js";

const GROUP_ROW =
  "운영경비\t\t\t\t실비/환불\t\t\t\t기타\t\t\t\t\t매출\t\t\t기타매출\t\t";
const COLUMN_ROW =
  "중요도\t항목\t적요\t금액\t중요도\t항목\t적요\t금액\t중요도\t항목\t적요\t금액\t\t항목\t적요\t금액\t항목\t적요\t금액";

function block(day: string, rows: string[], close: string) {
  return [
    day,
    GROUP_ROW,
    COLUMN_ROW,
    ...rows,
    "계\t\t\t0\t\t\t\t0\t\t\t\t0\t\t\t\t0\t\t\t0",
    `종료 잔액\t종료 잔액\t종료 잔액\t${close}`,
  ].join("\n");
}

const YEAR = { year: 2026 };

describe("블록을 한 줄씩 편다", () => {
  it("하루에 여러 묶음이 있으면 각각 한 줄이 된다", () => {
    const sheet = block(
      "9/16",
      [
        "\t\t\t\t\t\t\t\t\t\t\t\t\t셀락바이오\t\t23,100,000\tMK코스메틱\t\t1,800,000",
      ],
      "157,370,000"
    );
    const out = flattenDailyCashSheet(sheet, YEAR);
    expect(out.rows).toBe(2);
    expect(out.days).toEqual(["2026-09-16"]);
    expect(out.tsv).toContain("셀락바이오");
    expect(out.tsv).toContain("MK코스메틱");
  });

  it("매출은 수입 칸으로, 경비는 지출 칸으로 간다", () => {
    const sheet = block(
      "9/14",
      [
        "3\t지브이엔\t\t1,500,000\t\t저스트컴퍼니\t\t3,300,000\t\t\t\t\t\t유한양행\t\t41,800,000",
      ],
      "132,670,000"
    );
    const rows = flattenDailyCashSheet(sheet, YEAR)
      .tsv.split("\n")
      .slice(1)
      .map(line => line.split("\t"));

    const gvn = rows.find(r => r[1] === "지브이엔")!;
    expect(gvn[3]).toBe("1,500,000"); // 지출
    expect(gvn[4]).toBe(""); // 수입 아님

    const yuhan = rows.find(r => r[1] === "유한양행")!;
    expect(yuhan[3]).toBe("");
    expect(yuhan[4]).toBe("41,800,000");
  });

  it("묶음 이름을 적요에 남긴다 — 운영경비인지 실비인지는 손익에서 갈린다", () => {
    const sheet = block(
      "9/14",
      ["\t지브이엔\t\t1,500,000\t\t저스트컴퍼니\t\t3,300,000"],
      "0"
    );
    const tsv = flattenDailyCashSheet(sheet, YEAR).tsv;
    expect(tsv).toContain("운영경비");
    expect(tsv).toContain("실비/환불");
  });

  it("항목은 건드리지 않는다 — 거래처 대조에 쓰인다", () => {
    const sheet = block(
      "9/16",
      ["\t\t\t\t\t\t\t\t\t\t\t\t\t셀락바이오\t\t100"],
      "0"
    );
    const rows = flattenDailyCashSheet(sheet, YEAR).tsv.split("\n");
    expect(rows[1].split("\t")[1]).toBe("셀락바이오");
  });

  it("종료 잔액을 그 날의 모든 줄에 붙인다", () => {
    const sheet = block(
      "9/14",
      ["\t지브이엔\t\t1,500,000\t\t저스트컴퍼니\t\t3,300,000"],
      "132,670,000"
    );
    const rows = flattenDailyCashSheet(sheet, YEAR)
      .tsv.split("\n")
      .slice(1)
      .map(line => line.split("\t"));
    expect(rows.every(r => r[5] === "132,670,000")).toBe(true);
  });

  it("「계」 줄은 읽지 않는다 — 시트가 계산한 값이다", () => {
    const sheet = block("9/14", ["\t지브이엔\t\t1,500,000"], "0");
    expect(flattenDailyCashSheet(sheet, YEAR).rows).toBe(1);
  });

  it("빈 줄과 머리말(잔고·부채 요약)은 건너뛴다", () => {
    const sheet = [
      "잔고\t잔고\t145,000,000",
      "단기부채\t단기부채\t240,000,000\t조대표님 1.5, 의장님 0.9",
      "",
      block("9/16", ["\t\t\t\t\t\t\t\t\t\t\t\t\t셀락바이오\t\t100"], "0"),
    ].join("\n");
    const out = flattenDailyCashSheet(sheet, YEAR);
    expect(out.rows).toBe(1);
    expect(out.days).toEqual(["2026-09-16"]);
  });

  it("여러 날이 이어져도 각자의 날짜를 붙인다", () => {
    const sheet = [
      block("9/14", ["\t지브이엔\t\t1,500,000"], "132,670,000"),
      block("9/15", ["\t삼도 조정료\t\t950,000"], "132,470,000"),
    ].join("\n");
    const out = flattenDailyCashSheet(sheet, YEAR);
    expect(out.days).toEqual(["2026-09-14", "2026-09-15"]);
    const rows = out.tsv
      .split("\n")
      .slice(1)
      .map(l => l.split("\t"));
    expect(rows.find(r => r[1] === "삼도 조정료")![0]).toBe("2026-09-15");
  });

  it("묶음 머리글은 한 번만 나와도 다음 날에 그대로 쓴다", () => {
    const sheet = [
      block("9/14", ["\t지브이엔\t\t1,500,000"], "0"),
      "9/15",
      "\t삼도 조정료\t\t950,000",
      "종료 잔액\t종료 잔액\t종료 잔액\t0",
    ].join("\n");
    const out = flattenDailyCashSheet(sheet, YEAR);
    expect(out.rows).toBe(2);
    expect(out.warnings).toHaveLength(0);
  });
});

describe("열이 밀린 날 — 고치지 않고 판정 대기로 넘긴다", () => {
  /** 실제 9/11. 금액이 「적요」 칸에 들어가 있어 시트의 계가 0 이다 */
  const drifted = block(
    "9/11",
    [
      "\t김성환\t2,000,000\t\t\t액티브스 7월 시딩\t1,330,000\t\t\t박재우 컨설턴트 2차\t11,000,000\t11,000,000",
      "\t대표님 7월\t12,614,300\t\t\t페르소나 AI PPL\t5,500,000",
      "\t이상호\t967000",
    ],
    "135,970,000"
  );

  it("금액 칸은 비고 적요에 숫자가 남는다 — 승격하지 않는다", () => {
    const rows = flattenDailyCashSheet(drifted, YEAR)
      .tsv.split("\n")
      .slice(1)
      .map(l => l.split("\t"));
    const kim = rows.find(r => r[1] === "김성환")!;
    expect(kim[3]).toBe(""); // 지출 칸 비어 있음
    expect(kim[2]).toContain("2,000,000"); // 적요에 숫자
  });

  it("원장은 이것을 금액 미확정으로 세운다 (원칙 8)", () => {
    const flat = flattenDailyCashSheet(drifted, YEAR);
    const result = importSheet(flat.tsv, {
      existingCodes: [],
      actor: "ceo@dinostudio.kr",
      fallbackYear: 2026,
    });
    const kim = result.entries.find(e => e.entry.title === "김성환")!;
    expect(kim.entry.amount).toBeNull();
    expect(kim.entry.amountCandidate).toBe(2_000_000);
    expect(kim.flags.join(" ")).toMatch(/적요/);
  });

  it("단위를 알 수 없는 값은 후보로도 올리지 않는다", () => {
    // 967000 은 쉼표가 없지만 자릿수가 커서 후보가 된다. 그보다 작은 값을 본다
    const small = block("9/9", ["\t부가세2차\t1,200"], "0");
    const flat = flattenDailyCashSheet(small, YEAR);
    const result = importSheet(flat.tsv, {
      existingCodes: [],
      actor: "ceo@dinostudio.kr",
      fallbackYear: 2026,
    });
    const vat = result.entries.find(e => e.entry.title === "부가세2차")!;
    expect(vat.entry.amount).toBeNull();
    expect(vat.entry.amountCandidate).toBeNull();
  });

  it("한 행도 버리지 않는다", () => {
    const flat = flattenDailyCashSheet(drifted, YEAR);
    const result = importSheet(flat.tsv, {
      existingCodes: [],
      actor: "ceo@dinostudio.kr",
      fallbackYear: 2026,
    });
    expect(result.entries).toHaveLength(flat.rows);
    expect(result.rejected).toHaveLength(0);
  });
});
