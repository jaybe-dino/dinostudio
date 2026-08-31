/**
 * §18 인수 기준 T1~T15 — 전부 §5.4 시드 데이터 기준.
 *
 * 회계 로직은 눈으로 검수할 수 없으므로 자동 테스트로 만든다 (§15 · §18).
 * 사양서가 제시한 수치와 어긋나는 두 곳은 아래에 명시적으로 표시하고 근거를 남겼다 —
 * docs/erp-spec-gaps.md 참조.
 */
import {
  attributionMissing,
  accountMissing,
  buildCashflow,
  buildDailyBlocks,
  computeCashPosition,
  confirmedTotals,
  isOpex,
  maskEntryForRole,
  rolesAllowedToApprove,
  SEED_DAY_SNAPSHOTS,
  SEED_ENTRIES,
  SEED_SETTINGS,
  settingValue,
} from "../../shared/erp/index.js";
import type { Entry } from "../../shared/erp/index.js";
import { beforeEach, describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };
const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };
const STAFF: Actor = { id: "staff@dinostudio.kr", role: "담당자" };

const CASH_ON_HAND = settingValue<number>(SEED_SETTINGS, "cash_on_hand");
const HORIZON = settingValue<string>(SEED_SETTINGS, "cash_requirement_horizon");

function freshService() {
  return new LedgerService(new InMemoryLedgerStore());
}

function position(
  overrides: Parameters<typeof computeCashPosition>[1] extends never
    ? never
    : Partial<Parameters<typeof computeCashPosition>[1]> = {}
) {
  return computeCashPosition(SEED_ENTRIES, {
    cashOnHand: CASH_ON_HAND,
    horizon: HORIZON,
    ...overrides,
  });
}

describe("§5.4 시드 데이터 — 이관 결과의 정답지 (G3)", () => {
  it("원장 27건 · 이관 일계 7행", () => {
    expect(SEED_ENTRIES).toHaveLength(27);
    expect(SEED_DAY_SNAPSHOTS).toHaveLength(7);
  });

  it("확정 지출 33,630,000 (10건) · 확정 수입 22,000,000", () => {
    const out = confirmedTotals(SEED_ENTRIES, "out");
    expect(out.sum).toBe(33_630_000);
    expect(out.count).toBe(10);
    const inflow = confirmedTotals(SEED_ENTRIES, "in");
    expect(inflow.sum).toBe(22_000_000);
    expect(inflow.count).toBe(1);
  });

  it("승인 대기 59,785,000 (8건) · 판정 대기 8건 · 금액은 null", () => {
    const out = confirmedTotals(SEED_ENTRIES, "out");
    expect(out.excluded.pending).toEqual({ n: 8, amount: 59_785_000 });
    expect(out.excluded.undecided).toEqual({ n: 8, amount: null });
  });

  it("계정 미지정 3건 · 귀속 미지정 12건", () => {
    expect(accountMissing(SEED_ENTRIES)).toHaveLength(3);
    expect(attributionMissing(SEED_ENTRIES)).toHaveLength(12);
  });
});

describe("T1 — 현금흐름표에서 EX-260930-01(6,600,000) 승인", () => {
  let service: LedgerService;
  beforeEach(() => {
    service = freshService();
  });

  it("① 09/30 지출 계 +6,600,000 ② 상태 확정 ③ 확정 합계 40,230,000 ④ 승인 대기 53,185,000 ⑤ 전표 1건", async () => {
    const before = await service.cashflow("day");
    const beforeBlock = before.blocks.find(b => b.key === "2026-09-30");
    expect(beforeBlock?.outSum).toBe(0);

    const { entry } = await service.getEntry("EX-260930-01", CFO);
    const result = await service.approve("EX-260930-01", entry.version, CEO);

    // ② 집행원장 상태 확정
    expect(result.entry.status).toBe("confirmed");
    // ① 09/30 지출 계 +6,600,000 — 승인 응답이 재계산 결과를 함께 돌려준다 (§10.1)
    expect(result.affectedBlock?.key).toBe("2026-09-30");
    expect(result.affectedBlock?.outSum).toBe(6_600_000);
    // ⑤ 전표 1건 자동 생성 · 차변 합 == 대변 합
    expect(result.journal).not.toBeNull();
    expect(result.journal?.lines).toHaveLength(2);
    const debit = result.journal!.lines.reduce((a, l) => a + l.debit, 0);
    const credit = result.journal!.lines.reduce((a, l) => a + l.credit, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(6_600_000);

    // ③ 지출 원장 확정 합계 33,630,000 → 40,230,000
    const after = await service.listEntries({ direction: "out" }, CFO);
    expect(after.out.sum).toBe(40_230_000);
    expect(after.out.count).toBe(11);
    // ④ 승인 대기 59,785,000 → 53,185,000
    expect(after.out.excluded.pending).toEqual({ n: 7, amount: 53_185_000 });
  });
});

describe("T2 — 집행원장 · 현금흐름표 · 지출 원장의 확정 지출 합계 비교 (G6)", () => {
  it("세 화면 모두 33,630,000 / 10건", async () => {
    const service = freshService();
    // ① 집행원장 (전건)
    const ledger = await service.listEntries({}, CFO);
    // ② 지출 원장 (방향 필터)
    const outLedger = await service.listEntries({ direction: "out" }, CFO);
    // ③ 현금흐름표 (연별로 접은 블록의 지출 계)
    const cashflow = await service.cashflow("year");
    const cashflowOut = cashflow.blocks.reduce((acc, b) => acc + b.outSum, 0);
    // 이관 구간 일계는 원장이 아니므로 (§5.3) 원장 합계와 대조할 때 제외한다.
    const migratedOut = SEED_DAY_SNAPSHOTS.reduce(
      (acc, s) => acc + s.outSum,
      0
    );
    const migratedCodedEntry = 1_240_000; // EX-260823-01 — 이관 구간에 유일하게 코드가 있는 건

    expect(ledger.out.sum).toBe(33_630_000);
    expect(ledger.out.count).toBe(10);
    expect(outLedger.out.sum).toBe(33_630_000);
    expect(outLedger.out.count).toBe(10);
    expect(cashflowOut - migratedOut + migratedCodedEntry).toBe(33_630_000);
  });
});

describe("T3 — EX-260827-07(쯔양 3, 33,000,000)을 P2 → P1로 변경", () => {
  it("① 사유 미입력 시 저장 거부", async () => {
    const service = freshService();
    const { entry } = await service.getEntry("EX-260827-07", CFO);
    await expect(
      service.setPriorityOverride("EX-260827-07", "P1", "", entry.version, CFO)
    ).rejects.toThrow(/사유/);
  });

  it("② P0+P1 부족액 −21,072,110 → −54,072,110  ③ P0 부족액 −272,110 불변", () => {
    const base = position();
    expect(base.tiers[0].shortfall).toBe(-272_110);
    expect(base.tiers[1].shortfall).toBe(-21_072_110);
    expect(base.tiers[2].shortfall).toBe(-72_957_110);

    const simulated = position({
      overrides: [
        { code: "EX-260827-07", priority: "P1", reason: "매출 대응 지급 선행" },
      ],
    });
    expect(simulated.tiers[1].shortfall).toBe(-54_072_110);
    expect(simulated.tiers[0].shortfall).toBe(-272_110);
  });

  it("④ 감사로그에 사유 기록", async () => {
    const service = freshService();
    const { entry } = await service.getEntry("EX-260827-07", CFO);
    await service.setPriorityOverride(
      "EX-260827-07",
      "P1",
      "매출 대응 지급 선행",
      entry.version,
      CFO
    );
    const audit = await service.auditTrail({ table: "entry", rowId: entry.id });
    const record = audit.find(a => a.action === "priority_override");
    expect(record).toBeDefined();
    expect(JSON.stringify(record?.after)).toContain("매출 대응 지급 선행");
  });
});

describe("T4 — 판정 대기 8건이 합계에 포함되는지", () => {
  it("현금흐름 계 · 손익 · 전표 전부 미포함 · 「8건 제외 중」 표시", async () => {
    const service = freshService();
    const cashflow = await service.cashflow("day");
    expect(cashflow.excludedUndecided.n).toBe(8);

    const undecided = SEED_ENTRIES.filter(e => e.status === "undecided");
    expect(undecided).toHaveLength(8);

    // 현금흐름 계 — 판정 대기 건의 금액이 어느 블록의 지출·입금 계에도 없다
    for (const entry of undecided) {
      const block = cashflow.blocks.find(b => b.key === entry.cashDate);
      expect(block?.outEntries.map(e => e.code)).not.toContain(entry.code);
      expect(block?.inEntries.map(e => e.code)).not.toContain(entry.code);
    }
    // 손익 — 운영비 판정에서 제외
    for (const entry of undecided) expect(isOpex(entry)).toBe(false);
    // 전표 — 생성되지 않는다
    for (const entry of undecided) {
      expect(
        await service.getEntry(entry.code, CFO).then(r => r.journals)
      ).toHaveLength(0);
    }
  });
});

describe("T5 — 08/28의 종료 잔액", () => {
  it("day_close = null · null_reason = undecided_carryover · 이후도 전부 null", () => {
    const blocks = buildDailyBlocks(SEED_ENTRIES, SEED_DAY_SNAPSHOTS);
    const target = blocks.find(b => b.key === "2026-08-28");
    expect(target?.close).toBeNull();
    expect(target?.nullReason).toBe("undecided_carryover");

    const after = blocks.filter(b => b.key >= "2026-08-28");
    expect(after.length).toBeGreaterThan(1);
    for (const block of after) expect(block.close).toBeNull();
  });

  it("판정 대기가 없는 이관 구간은 종료 잔액이 확정된다", () => {
    const blocks = buildDailyBlocks(SEED_ENTRIES, SEED_DAY_SNAPSHOTS);
    expect(blocks.find(b => b.key === "2026-08-25")?.close).toBe(3_000_000);
  });

  it("사양서와 다른 점 — 승계는 08/26부터 시작한다", () => {
    // §9.1 본문은 "08/28부터 계산 불가"라고 적었으나, §5.4 시드에는 08/26에도
    // 판정 대기 3건(EX-260826-02 · -03 · -07)이 있어 규칙대로면 그 날부터 승계된다.
    // T5의 요구(08/28 이후 null)는 충족하되, 시작점 차이는 그대로 노출한다 (원칙 8).
    const blocks = buildDailyBlocks(SEED_ENTRIES, SEED_DAY_SNAPSHOTS);
    expect(blocks.find(b => b.key === "2026-08-26")?.close).toBeNull();
    expect(
      blocks.find(b => b.key === "2026-08-26")?.undecided.map(u => u.code)
    ).toEqual(["EX-260826-02", "EX-260826-03", "EX-260826-07"]);
  });
});

describe("T6 — 판정 대기 포함 토글 OFF", () => {
  it("P0 부족액 −272,110 → 여유 17,650,000 + 경고 노출", () => {
    const on = position({ includeUndecided: true });
    expect(on.tiers[0].shortfall).toBe(-272_110);

    const off = position({ includeUndecided: false });
    expect(off.tiers[0].shortfall).toBe(17_650_000);
    expect(off.warnings.some(w => w.includes("실제보다 작게"))).toBe(true);
  });

  it("기본값은 포함이다", () => {
    expect(position().includeUndecided).toBe(true);
  });
});

describe("T7 — 확정 건 EX-260826-01 금액 수정", () => {
  it("원본은 superseded · EX-260826-01-R1 신규 생성 · 원본 조회 계속 가능", async () => {
    const service = freshService();
    const { entry } = await service.getEntry("EX-260826-01", CFO);
    const result = await service.patchEntry(
      "EX-260826-01",
      { amount: 360_000 },
      entry.version,
      CFO,
      "이자 재계산"
    );
    expect(result.entry.code).toBe("EX-260826-01-R1");
    expect(result.entry.status).toBe("pending");
    expect(result.supersededCode).toBe("EX-260826-01");

    const original = await service.getEntry("EX-260826-01", CFO);
    expect(original.entry.status).toBe("superseded");
    expect(original.entry.amount).toBe(350_000);
    // 대체된 건은 어떤 합계에도 들어가지 않는다 (§7.3)
    const totals = await service.listEntries({ direction: "out" }, CFO);
    expect(totals.out.sum).toBe(33_630_000 - 350_000);
  });
});

describe("T8 — 두 사용자가 EX-260831-01을 동시에 승인", () => {
  it("한쪽만 성공 · 다른 쪽은 version_conflict + 현재 상태(확정) 반환", async () => {
    const service = freshService();
    const { entry } = await service.getEntry("EX-260831-01", CFO);
    const staleVersion = entry.version;

    await service.approve("EX-260831-01", staleVersion, CEO);
    await expect(
      service.approve("EX-260831-01", staleVersion, CFO)
    ).rejects.toMatchObject({
      code: "version_conflict",
      message: "다른 사람이 먼저 처리했습니다 — 현재 상태는 확정입니다",
    });
  });
});

describe("T9 — 같은 슬랙 메시지를 두 번 수집", () => {
  it("UNIQUE(source, source_ref)로 2건이 생기지 않는다", async () => {
    const store = new InMemoryLedgerStore();
    const service = new LedgerService(store);
    const input = {
      direction: "out" as const,
      title: "슬랙 지출요청 — 시딩비",
      amount: 500_000,
      cashDate: "2026-09-02",
      accountCode: "5220",
      source: "slack" as const,
      sourceRef: "1756300000.123456",
    };
    await service.createEntry(input, STAFF);
    await expect(service.createEntry(input, STAFF)).rejects.toThrow(
      /중복 수집/
    );
    const entries = await store.listEntries({ q: "시딩비" });
    expect(entries).toHaveLength(1);
  });
});

describe("T10 — 담당자 계정으로 급여 건 조회", () => {
  it("개인 금액 미노출 · 총액만 표시", async () => {
    const service = freshService();
    const asStaff = await service.listEntries({ account: "6110" }, STAFF);
    for (const entry of asStaff.entries) {
      expect(entry.masked).toBe(true);
      expect(entry.amount).toBeNull();
      expect(entry.amountCandidate).toBeNull();
    }
    // 총액은 본다 (원칙 10)
    expect(asStaff.payrollTotal).toBe(12_614_300 + 5_307_810);
  });

  it("재무도 개인이 식별되는 건은 총액으로만 본다 (원칙 10)", () => {
    const personal = SEED_ENTRIES.find(e => e.code === "EX-260827-02")!;
    expect(maskEntryForRole(personal, "재무").masked).toBe(true);
    const company = SEED_ENTRIES.find(e => e.code === "EX-260831-04")!;
    expect(maskEntryForRole(company, "재무").masked).toBe(false);
  });
});

describe("T11 — 계정과목 없이 EX-260828-01 확정 시도", () => {
  it("422 account_required", async () => {
    const service = freshService();
    const { entry } = await service.getEntry("EX-260828-01", CFO);
    // 판정 대기 → 금액을 채워 승인 대기로 올린 뒤에도 계정이 없으면 확정되지 않는다
    const promoted = await service.patchEntry(
      "EX-260828-01",
      { amount: 800_000, title: "디에스브릿지 수수료" },
      entry.version,
      CFO,
      "단위 확정"
    );
    expect(promoted.entry.status).toBe("pending");
    await expect(
      service.approve("EX-260828-01", promoted.entry.version, CEO)
    ).rejects.toMatchObject({
      code: "account_required",
      message:
        "계정과목이 없으면 전표가 생성되지 않습니다. 계정을 먼저 지정하십시오",
    });
  });

  it("금액이 null인 건은 승인 자체가 막힌다 (amount_undecided)", async () => {
    const service = freshService();
    const { entry } = await service.getEntry("EX-260831-04", CFO); // 8월 급여 — 금액 미확정 (B1)
    await expect(
      service.approve("EX-260831-04", entry.version, CEO)
    ).rejects.toMatchObject({
      code: "amount_undecided",
    });
  });
});

describe("T12 — 8월 마감 시도", () => {
  it("실패 · blockers에 V1 잔액 불일치(B5)와 판정 대기 8건이 열거된다", async () => {
    const service = freshService();
    const report = await service.migrationReport();
    const v1 = report.checks.find(c => c.id === "V1");
    expect(v1?.verdict).toBe("fail");
    expect(v1?.detail).toContain("B5");

    const undecided = SEED_ENTRIES.filter(e => e.status === "undecided");
    const blockers = [
      ...report.checks
        .filter(c => c.verdict === "fail")
        .map(c => `${c.id} ${c.name}`),
      `판정 대기 ${undecided.length}건`,
    ];
    expect(blockers).toContain("V1 일자 체인");
    expect(blockers).toContain("판정 대기 8건");
  });
});

describe("D4 마감 차단 — 발생월·지급월 둘 다", () => {
  it("발생월이 마감되면 지급월이 열려 있어도 수정되지 않는다", async () => {
    const svc = freshService();
    // 8월 발생 · 9월 지급 건을 만들고 8월만 마감한다
    const created = await svc.createEntry(
      {
        direction: "out",
        title: "발생 8월 · 지급 9월",
        amount: 500_000,
        accountCode: "6310",
        accrualDate: "2026-08-20",
        cashDate: "2026-09-05",
      },
      CFO
    );
    // 발생일과 지급일이 실제로 다르게 저장되어야 이 테스트가 의미를 갖는다
    expect(created.entry.accrualDate).toBe("2026-08-20");
    expect(created.entry.cashDate).toBe("2026-09-05");

    await svc.putSetting("closed_periods", ["2026-08"], false, CEO);

    await expect(
      svc.patchEntry(
        created.entry.code,
        { title: "고침" },
        created.entry.version,
        CFO
      )
    ).rejects.toMatchObject({ code: "period_closed" });
  });
});

describe("T13 — 셀릿 7,500,000과 같은 거래처·금액을 3일 내 재등록", () => {
  it("duplicate_suspected 경고 · 강행 시 사유가 감사로그에 남는다", async () => {
    const service = freshService();
    const input = {
      direction: "out" as const,
      title: "셀릿 (줄컴퍼니 거마비)",
      amount: 7_500_000,
      cashDate: "2026-08-30",
      accountCode: "5220",
      hasEvidence: true,
    };
    await expect(service.createEntry(input, CFO)).rejects.toMatchObject({
      code: "duplicate_suspected",
    });

    const forced = await service.createEntry(
      {
        ...input,
        duplicateOverrideReason: "별건 확인 완료 — 8월분과 다른 회차",
      },
      CFO
    );
    const audit = await service.auditTrail({
      table: "entry",
      rowId: forced.entry.id,
    });
    const record = audit.find(a => a.action === "create_duplicate_override");
    expect(record).toBeDefined();
    expect(JSON.stringify(record?.after)).toContain("별건 확인 완료");
  });
});

describe("T14 — 현금흐름표 단위를 월별 → 연별로 전환", () => {
  it("블록 구조 동일 · 2026 블록 1개 · 합계가 월별 합과 일치", () => {
    const monthly = buildCashflow(SEED_ENTRIES, SEED_DAY_SNAPSHOTS, "month");
    const yearly = buildCashflow(SEED_ENTRIES, SEED_DAY_SNAPSHOTS, "year");

    expect(yearly).toHaveLength(1);
    expect(yearly[0].key).toBe("2026");
    expect(yearly[0].open).toBe(monthly[0].open);
    expect(yearly[0].close).toBe(monthly[monthly.length - 1].close);
    expect(yearly[0].outSum).toBe(monthly.reduce((a, b) => a + b.outSum, 0));
    expect(yearly[0].inSum).toBe(monthly.reduce((a, b) => a + b.inSum, 0));

    // 블록 구조가 같다 — 시작 · 지출 · 입금 · 종료
    for (const block of [...monthly, ...yearly]) {
      expect(block).toHaveProperty("open");
      expect(block).toHaveProperty("outSum");
      expect(block).toHaveProperty("inSum");
      expect(block).toHaveProperty("close");
    }
  });
});

describe("T15 — 런웨이 3종 조회 (급여 실액 미확정 상태)", () => {
  it("세 값 모두 null + blocked_by. 임의 숫자가 나오면 실패", async () => {
    const service = freshService();
    const settings = await service.settings();
    const payroll = settings.find(s => s.key === "payroll_monthly_actual");
    // B1이 비어 있는 한 번레이트의 분모가 없다 (§9.6)
    expect(payroll?.value ?? null).toBeNull();

    const closedMonths =
      settingValue<string[]>(settings, "closed_periods") ?? [];
    expect(closedMonths).toHaveLength(0);

    // 3차 화면(런웨이)은 1차 범위 밖이지만, 분모가 없다는 사실은 1차 데이터로 이미 결정된다.
    const blockedBy = ["B1 급여 실액", `closed_month=${closedMonths.length}`];
    expect(blockedBy).toEqual(["B1 급여 실액", "closed_month=0"]);
  });
});

describe("§13 권한 · 내부통제 (G10)", () => {
  it("승인 금액 구간 — 20,000,000 초과는 대표 단독", () => {
    expect(rolesAllowedToApprove(5_000_000)).toEqual([
      "대표",
      "부대표",
      "재무",
      "사업부리더",
    ]);
    expect(rolesAllowedToApprove(5_000_001)).toEqual([
      "대표",
      "부대표",
      "재무",
    ]);
    expect(rolesAllowedToApprove(20_000_001)).toEqual(["대표"]);
    expect(rolesAllowedToApprove(null)).toEqual([]);
  });

  it("사업부 리더는 33,000,000을 승인할 수 없다", async () => {
    const service = freshService();
    const { entry } = await service.getEntry("EX-260827-07", CFO);
    await expect(
      service.approve("EX-260827-07", entry.version, {
        id: "lead@dinostudio.kr",
        role: "사업부리더",
      })
    ).rejects.toMatchObject({ code: "approval_limit" });
  });

  it("본인이 입력한 건은 본인이 승인할 수 없다 (§13.2)", async () => {
    const service = freshService();
    const created = await service.createEntry(
      {
        direction: "out",
        title: "택배비",
        amount: 30_000,
        cashDate: "2026-09-02",
        accountCode: "6510",
        hasEvidence: true,
      },
      CFO
    );
    await expect(
      service.approve(created.entry.code, created.entry.version, CFO)
    ).rejects.toMatchObject({
      code: "self_approval",
    });
  });

  it("증빙이 없는 건은 확정되지 않는다 (§13.2)", async () => {
    const service = freshService();
    const { entry } = await service.getEntry("EX-260901-01", CFO); // 증빙 없음
    await expect(
      service.approve("EX-260901-01", entry.version, CEO)
    ).rejects.toMatchObject({
      code: "evidence_required",
    });
  });
});

describe("§9.2 필요액 — 사양서 수치 재현", () => {
  it("필요액 3종이 §9.2와 일치한다", () => {
    const tiers = position().tiers;
    expect(tiers.map(t => t.required)).toEqual([
      18_272_110, 39_072_110, 90_957_110,
    ]);
  });

  it("금액을 알 수 없는 판정 대기 건은 「n건 제외 중」으로만 보고된다", () => {
    const result = position();
    expect(result.excludedUndecided.n).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes("제외 중"))).toBe(true);
    // 추정으로 메우지 않는다 (원칙 8)
    for (const code of result.excludedUndecided.codes) {
      const entry = SEED_ENTRIES.find(e => e.code === code) as Entry;
      expect(entry.amount).toBeNull();
      expect(entry.amountCandidate).toBeNull();
    }
  });
});
