/**
 * 어느 채널의 메시지를 수집하나 (§11.1)
 *
 * 대표 요청 — 채널 ID 를 환경변수에 하나하나 넣는 대신 「봇을 초대한 모든
 * 채널」을 수집하고 싶다. 슬랙은 봇이 들어가 있는 채널의 message.channels 만
 * 보내므로, 초대 자체가 허용 목록이 된다.
 *
 * 다만 기본값은 닫혀 있어야 한다 — 앱을 설치했다는 이유만으로 수집이 조용히
 * 시작되면 안 된다. 그래서 `*` 를 명시해야 그 모드가 켜진다.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isWatchedChannel } from "./integrations/slack.js";

const KEYS = ["SLACK_EXPENSE_CHANNELS", "SLACK_IGNORE_CHANNELS"] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("기본값은 닫힘", () => {
  it("설정이 없으면 아무 채널도 수집하지 않는다", () => {
    expect(isWatchedChannel("C01ABC")).toBe(false);
  });

  it("빈 문자열도 닫힘이다", () => {
    process.env.SLACK_EXPENSE_CHANNELS = "";
    expect(isWatchedChannel("C01ABC")).toBe(false);
  });
});

describe("채널 ID 목록 — 적은 것만", () => {
  it("목록에 있으면 수집한다", () => {
    process.env.SLACK_EXPENSE_CHANNELS = "C01ABC, C02DEF";
    expect(isWatchedChannel("C01ABC")).toBe(true);
    expect(isWatchedChannel("C02DEF")).toBe(true);
  });

  it("목록에 없으면 수집하지 않는다", () => {
    process.env.SLACK_EXPENSE_CHANNELS = "C01ABC";
    expect(isWatchedChannel("C09XYZ")).toBe(false);
  });
});

describe("`*` — 봇을 초대한 모든 채널", () => {
  it("어느 채널이든 수집한다", () => {
    process.env.SLACK_EXPENSE_CHANNELS = "*";
    expect(isWatchedChannel("C01ABC")).toBe(true);
    expect(isWatchedChannel("C09XYZ")).toBe(true);
  });

  it("무시 목록은 `*` 보다 우선한다 — 실수로 초대된 채널을 뺄 수 있다", () => {
    process.env.SLACK_EXPENSE_CHANNELS = "*";
    process.env.SLACK_IGNORE_CHANNELS = "C0GENERAL";
    expect(isWatchedChannel("C0GENERAL")).toBe(false);
    expect(isWatchedChannel("C01ABC")).toBe(true);
  });

  it("목록과 `*` 를 같이 적어도 `*` 가 이긴다", () => {
    process.env.SLACK_EXPENSE_CHANNELS = "C01ABC,*";
    expect(isWatchedChannel("C09XYZ")).toBe(true);
  });
});

describe("무시 목록은 좁은 모드에서도 동작한다", () => {
  it("목록에 있어도 무시 목록에 있으면 빼낸다", () => {
    process.env.SLACK_EXPENSE_CHANNELS = "C01ABC,C02DEF";
    process.env.SLACK_IGNORE_CHANNELS = "C02DEF";
    expect(isWatchedChannel("C01ABC")).toBe(true);
    expect(isWatchedChannel("C02DEF")).toBe(false);
  });
});
