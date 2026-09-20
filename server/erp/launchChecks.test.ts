/**
 * 오픈 전 점검.
 *
 * 설정 하나가 잘못돼 있으면 **화면은 멀쩡해 보이고 숫자만 틀린다.** 그런
 * 것들은 문서에 적어 두는 대신 시스템이 스스로 찾아서 첫 화면에 띄워야 한다 —
 * 사람이 기억해야 하는 것은 대책이 아니다.
 */
import { describe, expect, it } from "vitest";
import {
  buildLaunchReport,
  checkCashOnHand,
  checkPayroll,
  checkTodayOverride,
} from "../../shared/erp/launchChecks.js";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Setting } from "../../shared/erp/types.js";

const setting = (
  key: string,
  value: Setting["value"],
  isProvisional = false
): Setting => ({
  key,
  value,
  isProvisional,
  ownerRole: "재무",
  updatedBy: "test",
  updatedAt: "2026-09-20T00:00:00+09:00",
});

describe("「오늘」이 과거에 박혀 있는 것 — 가장 조용한 함정", () => {
  it("**과거로 박혀 있으면 막는다**", () => {
    const c = checkTodayOverride(
      [setting("today_override", "2026-08-27")],
      "2026-09-20"
    );
    expect(c.level).toBe("blocker");
    expect(c.detail).toContain("2026-08-27");
    // 무엇이 틀어지는지 말해 줘야 사람이 움직인다
    expect(c.detail).toContain("현금흐름표");
    expect(c.action).toContain("today_override");
  });

  it("앞날로 맞춰 둔 것은 의도일 수 있다 — 알리되 막지 않는다", () => {
    const c = checkTodayOverride(
      [setting("today_override", "2026-12-31")],
      "2026-09-20"
    );
    expect(c.level).toBe("warning");
  });

  it("없으면 정상이다", () => {
    expect(checkTodayOverride([], "2026-09-20").level).toBe("ok");
  });

  it("같은 날이면 막지 않는다 — 오늘로 맞춰 둔 것뿐이다", () => {
    expect(
      checkTodayOverride(
        [setting("today_override", "2026-09-20")],
        "2026-09-20"
      ).level
    ).toBe("ok");
  });
});

describe("보유현금과 급여", () => {
  it("보유현금이 비면 막는다 — 부족액·런웨이가 안 선다", () => {
    expect(checkCashOnHand([]).level).toBe("blocker");
  });

  it("**시트에서 온 잠정값은 알린다** — 사람이 통장을 안 봤다는 뜻이다", () => {
    const c = checkCashOnHand([setting("cash_on_hand", 110_000_000, true)]);
    expect(c.level).toBe("warning");
    expect(c.action).toContain("통장");
  });

  it("사람이 확인한 값이면 정상이다", () => {
    expect(checkCashOnHand([setting("cash_on_hand", 110_000_000)]).level).toBe(
      "ok"
    );
  });

  it("급여 실액이 없으면 막는다 — 런웨이 3종이 전부 걸려 있다", () => {
    const c = checkPayroll([]);
    expect(c.level).toBe("blocker");
    expect(c.detail).toContain("런웨이");
    // 개인별이 아니라 총액이라는 것을 안내에 남긴다 (원칙 10)
    expect(c.action).toContain("월 총액");
  });
});

describe("리포트", () => {
  it("막는 것이 하나라도 있으면 ready 가 아니다", () => {
    const r = buildLaunchReport(
      [setting("today_override", "2026-08-27")],
      "2026-09-20"
    );
    expect(r.blockers).toBeGreaterThan(0);
    expect(r.ready).toBe(false);
  });

  it("다 갖춰지면 ready 다", () => {
    const r = buildLaunchReport(
      [
        setting("cash_on_hand", 110_000_000),
        setting("payroll_monthly_actual", 52_000_000),
      ],
      "2026-09-20"
    );
    expect(r.ready).toBe(true);
    expect(r.blockers).toBe(0);
  });

  it("**실제 시계로 본다** — today() 로 보면 자기 자신으로 검사하게 된다", async () => {
    // 시드에 today_override = 2026-08-27 이 들어 있다. today() 를 쓰면
    // 「오늘(=8/27)이 8/27 이니 정상」이 되어 영영 안 걸린다.
    const s = new LedgerService(new InMemoryLedgerStore());
    const report = await s.launchReport();
    const check = report.checks.find(c => c.id === "today_override");
    expect(check?.level).toBe("blocker");
  });
});
