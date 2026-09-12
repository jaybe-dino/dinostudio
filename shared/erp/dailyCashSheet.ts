/**
 * 「데일리 현금흐름」 시트 → §5.2 평평한 표.
 *
 * 이 시트는 하루가 **블록**이다. 날짜 한 줄 밑에 다섯 묶음(운영경비 ·
 * 실비/환불 · 기타 · 매출 · 기타매출)이 **가로로** 놓이고, 각 묶음이
 * 중요도·항목·적요·금액 네 칸을 쓴다. 마지막에 「계」와 「종료 잔액」이 온다.
 *
 * 원장 규칙(적요 칸 금액은 후보로만 · 단위 불명은 올리지 않음 · 행을 버리지
 * 않음)은 이미 `sheetImport.ts` 가 갖고 있다. **그 규칙을 두 벌로 만들지
 * 않는다.** 이 파일은 모양만 바꾼다 — 블록을 한 줄씩 펴서 넘긴다.
 *
 * 열 번호를 박아 두지 않고 **머리글에서 찾는다.** 사람이 묶음을 하나 더
 * 넣거나 순서를 바꿔도 따라가야 하고, 무엇보다 열이 밀린 것을 열 번호로
 * 읽으면 조용히 틀린 값이 들어온다.
 */

/** 묶음 이름 → 방향. 「기타매출」이 「기타」보다 먼저 걸려야 한다 */
const GROUPS: { label: string; direction: "in" | "out" }[] = [
  { label: "기타매출", direction: "in" },
  { label: "매출", direction: "in" },
  { label: "운영경비", direction: "out" },
  { label: "실비/환불", direction: "out" },
  { label: "실비", direction: "out" },
  { label: "환불", direction: "out" },
  { label: "기타", direction: "out" },
];

const DAY = /^(\d{1,2})\/(\d{1,2})$/;
const CLOSE_ROW = /종료\s*잔액/;
const TOTAL_ROW = /^계$/;

export interface SheetGroup {
  label: string;
  direction: "in" | "out";
  title: number;
  note: number | null;
  amount: number | null;
}

export interface FlattenResult {
  /** §5.2 importSheet() 가 그대로 먹는 탭 구분 표 */
  tsv: string;
  days: string[];
  rows: number;
  /** 사람이 봐야 하는 것 — 버린 것이 아니라 못 읽은 것 */
  warnings: { day: string | null; reason: string; raw: string }[];
}

function splitRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map(line => (line.includes("\t") ? line.split("\t") : line.split(",")))
    .map(cells => cells.map(cell => cell.trim()));
}

/** 묶음 머리글 줄인가 — 운영경비·매출 같은 이름이 두 개 이상 보이면 그렇다 */
function groupHeaderAt(
  cells: string[]
): { label: string; at: number }[] | null {
  const found: { label: string; at: number }[] = [];
  cells.forEach((cell, at) => {
    if (!cell) return;
    const flat = cell.replace(/\s/g, "");
    const group = GROUPS.find(g => flat === g.label.replace(/\s/g, ""));
    if (group) found.push({ label: group.label, at });
  });
  return found.length >= 2 ? found : null;
}

/** 칸 머리글 줄인가 — 「항목」과 「금액」이 함께 있으면 그렇다 */
function isColumnHeader(cells: string[]): boolean {
  const flat = cells.map(c => c.replace(/\s/g, ""));
  return flat.includes("항목") && flat.includes("금액");
}

/**
 * 묶음 머리글 위치 + 칸 머리글 줄로 각 묶음의 항목·적요·금액 열을 찾는다.
 * 묶음의 영역은 「다음 묶음이 시작하기 전까지」다.
 */
export function readLayout(
  groupRow: { label: string; at: number }[],
  columnRow: string[]
): SheetGroup[] {
  const flat = columnRow.map(c => c.replace(/\s/g, ""));
  return groupRow
    .map((group, i) => {
      const from = group.at;
      const to = i + 1 < groupRow.length ? groupRow[i + 1].at : flat.length;
      const findIn = (name: string) => {
        for (let at = from; at < to; at += 1) if (flat[at] === name) return at;
        return null;
      };
      const title = findIn("항목");
      if (title === null) return null;
      return {
        label: group.label,
        direction:
          GROUPS.find(g => g.label === group.label)?.direction ?? "out",
        title,
        note: findIn("적요"),
        amount: findIn("금액"),
      };
    })
    .filter((g): g is SheetGroup => g !== null);
}

/**
 * 블록 시트를 한 줄씩 편다.
 *
 * 나온 표의 열은 §5.2 그대로 — 일자 · 항목 · 적요 · 지출 · 수입 · 종료잔액.
 * 묶음 이름은 적요 앞에 붙인다. 항목은 건드리지 않는다 — 거래처 대조에
 * 쓰이기 때문에 「[운영경비] 김성환」처럼 바꾸면 매칭이 깨진다.
 */
export function flattenDailyCashSheet(
  text: string,
  options: { year: number }
): FlattenResult {
  const rows = splitRows(text);
  const out: string[][] = [
    ["일자", "항목", "적요", "지출", "수입", "종료잔액"],
  ];
  const warnings: FlattenResult["warnings"] = [];
  const days: string[] = [];

  let day: string | null = null;
  let layout: SheetGroup[] = [];
  let pendingGroups: { label: string; at: number }[] | null = null;
  // 하루의 줄을 모아 두었다가 「종료 잔액」을 만나면 그 값을 붙여 내보낸다
  let buffered: {
    title: string;
    note: string;
    amount: string;
    dir: "in" | "out";
  }[] = [];

  const flushDay = (close: string) => {
    if (!day) return;
    for (const row of buffered) {
      out.push([
        day,
        row.title,
        row.note,
        row.dir === "out" ? row.amount : "",
        row.dir === "in" ? row.amount : "",
        close,
      ]);
    }
    buffered = [];
  };

  for (const cells of rows) {
    const first = (cells[0] ?? "").trim();

    const dayMatch = DAY.exec(first);
    if (dayMatch) {
      // 이전 날의 종료 잔액을 못 본 채 다음 날이 시작되면 빈 값으로 내보낸다
      flushDay("");
      day = `${options.year}-${dayMatch[1].padStart(2, "0")}-${dayMatch[2].padStart(2, "0")}`;
      days.push(day);
      continue;
    }

    const groups = groupHeaderAt(cells);
    if (groups) {
      pendingGroups = groups;
      continue;
    }

    if (isColumnHeader(cells)) {
      if (pendingGroups) {
        layout = readLayout(pendingGroups, cells);
        pendingGroups = null;
      }
      continue;
    }

    if (CLOSE_ROW.test(first)) {
      // 「종료 잔액」이 병합 셀이라 같은 글자가 여러 칸에 반복된다. 첫 숫자를 쓴다
      const close = cells.find(
        cell => /\d/.test(cell) && !CLOSE_ROW.test(cell)
      );
      flushDay(close ?? "");
      continue;
    }

    if (TOTAL_ROW.test(first)) continue; // 「계」는 시트가 계산한 값이라 안 읽는다
    if (!day) continue; // 날짜 블록 밖(머리말·잔고 요약)은 건너뛴다

    if (layout.length === 0) {
      if (cells.some(cell => cell !== "")) {
        warnings.push({
          day,
          reason: "묶음 머리글을 찾지 못해 읽지 못했습니다",
          raw: cells.join(" | "),
        });
      }
      continue;
    }

    for (const group of layout) {
      const title = (cells[group.title] ?? "").trim();
      const note = group.note === null ? "" : (cells[group.note] ?? "").trim();
      const amount =
        group.amount === null ? "" : (cells[group.amount] ?? "").trim();
      if (!title && !note && !amount) continue;
      buffered.push({
        title,
        // 묶음 이름을 적요 앞에 남긴다 — 운영경비인지 실비인지는 손익에서 갈린다
        note: note ? `${group.label} | ${note}` : group.label,
        amount,
        dir: group.direction,
      });
    }
  }

  flushDay("");

  return {
    tsv: out.map(row => row.join("\t")).join("\n"),
    days,
    rows: out.length - 1,
    warnings,
  };
}
