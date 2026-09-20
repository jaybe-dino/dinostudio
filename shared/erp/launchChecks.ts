/**
 * 오픈 전 점검 — **사람이 기억해야 하는 것은 대책이 아니다.**
 *
 * 설정 하나가 잘못돼 있으면 화면 전체가 조용히 틀린 숫자를 보여 줄 수 있다.
 * 그런 것들은 문서에 적어 두는 대신 **시스템이 스스로 찾아서** 첫 화면에
 * 띄운다. 막는 것(blocker)과 알리는 것(warning)을 구분해, 막는 것은
 * 오픈 전에 반드시 지나가게 한다.
 */
import type { Setting } from "./types.js";
import { settingValue } from "./seed.js";

export interface LaunchCheck {
  id: string;
  /** blocker = 이대로 열면 숫자가 틀린다 · warning = 열 수는 있다 */
  level: "blocker" | "warning" | "ok";
  title: string;
  detail: string;
  /** 사람이 할 일 — 어디서 무엇을 */
  action: string | null;
}

/**
 * 「오늘」이 과거에 박혀 있는가.
 *
 * §5.4 시드는 `today_override` 를 2026-08-27 로 넣는다. 데모 데이터를 그
 * 날짜로 보이게 하려는 값인데, **운영 DB 에 그대로 남으면** 시스템 전체가
 * 그 날을 오늘로 여긴다 — 현금흐름표의 「오늘」 블록, 채권 연령, 지급 기한,
 * 부족액이 전부 그 날 기준이 된다. 화면은 멀쩡해 보이고 숫자만 틀린다.
 *
 * 이 저장소에서 가장 조용한 함정이라 blocker 로 둔다.
 */
export function checkTodayOverride(
  settings: Setting[],
  realToday: string
): LaunchCheck {
  const override = settingValue<string>(settings, "today_override");
  if (!override)
    return {
      id: "today_override",
      level: "ok",
      title: "「오늘」이 실제 날짜입니다",
      detail: `오늘 = ${realToday}`,
      action: null,
    };
  // 오늘로 맞춰 둔 것은 아무것도 바꾸지 않는다
  if (override === realToday)
    return {
      id: "today_override",
      level: "ok",
      title: "「오늘」이 실제 날짜입니다",
      detail: `설정값이 오늘(${realToday})과 같습니다`,
      action: null,
    };
  if (override > realToday)
    return {
      id: "today_override",
      level: "warning",
      title: "「오늘」이 앞날로 맞춰져 있습니다",
      detail: `설정값 ${override} · 실제 ${realToday} — 앞날을 미리 보려는 설정이면 그대로 두십시오`,
      action: "기준값 → today_override",
    };
  return {
    id: "today_override",
    level: "blocker",
    title: "「오늘」이 과거에 박혀 있습니다",
    detail:
      `설정값 ${override} · 실제 ${realToday}. 이대로 두면 현금흐름표의 「오늘」, ` +
      "채권 연령, 지급 기한, 부족액이 전부 그 날 기준으로 계산됩니다 — " +
      "화면은 멀쩡해 보이고 숫자만 틀립니다.",
    action: "기준값 → today_override 를 비우십시오",
  };
}

/** 보유현금이 시트에서 온 잠정값 그대로인가 */
export function checkCashOnHand(settings: Setting[]): LaunchCheck {
  const row = settings.find(s => s.key === "cash_on_hand");
  if (!row || row.value == null)
    return {
      id: "cash_on_hand",
      level: "blocker",
      title: "보유현금이 비어 있습니다",
      detail: "부족액과 런웨이가 계산되지 않습니다.",
      action: "기준값 → cash_on_hand 에 통장 잔액 합계를 넣으십시오",
    };
  if (row.isProvisional)
    return {
      id: "cash_on_hand",
      level: "warning",
      title: "보유현금이 잠정값입니다",
      detail: `${row.value} — 시트에서 옮겨 온 값이고 사람이 확인하지 않았습니다.`,
      action: "통장 잔액 합계를 확인해 기준값을 덮어쓰십시오",
    };
  return {
    id: "cash_on_hand",
    level: "ok",
    title: "보유현금이 확인됐습니다",
    detail: String(row.value),
    action: null,
  };
}

/** 급여 실액 — 런웨이 3종이 전부 여기에 걸려 있다 */
export function checkPayroll(settings: Setting[]): LaunchCheck {
  const value = settingValue<number>(settings, "payroll_monthly_actual");
  if (value == null)
    return {
      id: "payroll",
      level: "blocker",
      title: "급여 실액이 없습니다",
      detail: "번레이트의 최대 항목이라 런웨이 3종이 전부 「계산 불가」입니다.",
      action: "기준값 → payroll_monthly_actual (월 총액, 개인별 금액 아님)",
    };
  return {
    id: "payroll",
    level: "ok",
    title: "급여 실액이 들어 있습니다",
    detail: "월 총액 기준",
    action: null,
  };
}

export interface LaunchReport {
  checks: LaunchCheck[];
  blockers: number;
  warnings: number;
  /** 이대로 열어도 숫자가 틀리지 않는가 */
  ready: boolean;
}

export function buildLaunchReport(
  settings: Setting[],
  realToday: string
): LaunchReport {
  const checks = [
    checkTodayOverride(settings, realToday),
    checkCashOnHand(settings),
    checkPayroll(settings),
  ];
  const blockers = checks.filter(c => c.level === "blocker").length;
  return {
    checks,
    blockers,
    warnings: checks.filter(c => c.level === "warning").length,
    ready: blockers === 0,
  };
}
