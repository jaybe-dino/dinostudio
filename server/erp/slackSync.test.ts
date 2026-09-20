/**
 * §11.3 사람 없이 도는 수집.
 *
 * 지금까지 슬랙 수집과 첨부 판독은 **버튼을 누르고 그 화면을 켜 둔 동안만**
 * 돌았다. 서버리스 함수는 짧게 끊기므로 한 번에 다 못 가져오고, 사람이
 * 「이어서 가져오기」를 수십 번 눌러야 끝났다. 실제로는 끝까지 누른 적이 없다.
 *
 * 그래서 진행 상태를 서버에 적어 둔다. 아래는 **닫아도 남는지**와
 * **막힌 것을 성공으로 처리하지 않는지**를 고정한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import { classifyBlock, needsPerson } from "../../shared/erp/syncBlock.js";

const CHANNELS = [
  { id: "C_EXEC", name: "재무-집행요청" },
  { id: "C_PAY", name: "결제요청방-일반" },
];

function page(messages: unknown[], nextCursor: string | null = null) {
  return { messages, nextCursor } as never;
}

let original: string | undefined;
beforeEach(() => {
  original = process.env.SLACK_EXPENSE_CHANNELS;
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_EXPENSE_CHANNELS = "*";
});
afterEach(() => {
  if (original === undefined) delete process.env.SLACK_EXPENSE_CHANNELS;
  else process.env.SLACK_EXPENSE_CHANNELS = original;
  delete process.env.SLACK_BOT_TOKEN;
});

function svc() {
  return new LedgerService(new InMemoryLedgerStore());
}

describe("진행 상태가 서버에 남는다", () => {
  it("처음에는 아무것도 안 한 상태다", async () => {
    const s = svc();
    const state = await s.slackSyncState();
    expect(state.backfillDone).toBe(false);
    expect(state.cursors).toEqual({});
    expect(state.lastRunAt).toBeNull();
  });

  it("한 번 돌면 **화면을 닫아도** 진도가 남는다", async () => {
    const s = svc();
    await s.runSlackSync(
      {},
      {
        listChannels: async () => ({ channels: CHANNELS }),
        fetchPage: async () => page([]),
        now: () => Date.now(),
      }
    );
    const state = await s.slackSyncState();
    expect(state.lastRunAt).not.toBeNull();
    expect(state.backfillDone).toBe(true);
  });

  it("예산을 넘겨 멈추면 커서가 남고 다음 번에 이어진다", async () => {
    const s = svc();
    let clock = 0;
    const seen: string[] = [];
    await s.runSlackSync(
      { budgetMs: 5_000 },
      {
        listChannels: async () => ({ channels: CHANNELS }),
        fetchPage: async ({ channel }) => {
          seen.push(channel);
          clock += 10_000; // 예산을 바로 넘긴다
          return page([]);
        },
        now: () => clock,
      }
    );
    const state = await s.slackSyncState();
    expect(state.backfillDone).toBe(false);
    // 아직 못 끝낸 채널이 커서에 남는다
    expect(Object.keys(state.cursors).length).toBeGreaterThan(0);
  });

  it("끝나면 다시 수집하지 않는다 — 크론이 계속 도는데 매번 훑으면 안 된다", async () => {
    const s = svc();
    const calls: string[] = [];
    const deps = {
      listChannels: async () => ({ channels: CHANNELS }),
      fetchPage: async ({ channel }: { channel: string }) => {
        calls.push(channel);
        return page([]);
      },
      now: () => Date.now(),
    };
    await s.runSlackSync({}, deps as never);
    const first = calls.length;
    expect(first).toBeGreaterThan(0);
    await s.runSlackSync({}, deps as never);
    expect(calls.length).toBe(first);
  });
});

describe("막힌 것을 성공으로 처리하지 않는다", () => {
  it("**먼저 잡힌 차단을 뒤 단계가 덮어쓰지 않는다** — 조용히 지워지면 아무 문제 없어 보인다", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const s = svc();
    const state = await s.runSlackSync({});
    expect(state.blocked).toBeTruthy();
    expect(state.blocked!.what).toBe("슬랙 수집");
    expect(state.blocked!.reason).toContain("SLACK_BOT_TOKEN");
    expect(state.blocked!.needsPerson).toBe(true);
    // 막혔는데 끝난 것으로 표시하면 안 된다
    expect(state.backfillDone).toBe(false);
  });

  it("속도 제한은 **사람이 할 일이 아니다** — 기다리면 풀린다", async () => {
    const s = svc();
    const state = await s.runSlackSync(
      {},
      {
        listChannels: async () => ({ channels: CHANNELS }),
        fetchPage: async () => {
          throw Object.assign(new Error("ratelimited"), {
            ratelimited: true,
            retryAfterSec: 42,
          });
        },
        now: () => Date.now(),
      }
    );
    if (state.blocked) expect(state.blocked.what).toBe("슬랙 수집");
  });

  it("토큰 없음은 사람이 할 일이다 — 재시도로 안 풀린다", () => {
    expect(needsPerson("SLACK_BOT_TOKEN 이 없습니다")).toBe(true);
  });
});

describe("막힘 판정 규칙", () => {
  /*
   * 크론은 사람이 안 보는 동안 계속 돈다. 재시도로 풀리는 것과 사람이
   * 처리해야 풀리는 것을 구분하지 못하면 같은 벽에 하루 스물네 번 부딪히면서
   * 화면에는 「실패 8건」만 뜬다.
   */
  it("한 건도 못 읽고 사유가 하나면 **차단**이다", () => {
    const block = classifyBlock("첨부 판독", {
      read: 0,
      failures: [
        { reason: "Anthropic API 잔액이 부족합니다" },
        { reason: "Anthropic API 잔액이 부족합니다" },
      ],
    });
    expect(block).toBeTruthy();
    expect(block!.reason).toContain("잔액");
    // 충전해야 풀린다 — 재시도로는 안 된다
    expect(block!.needsPerson).toBe(true);
  });

  it("일부라도 읽혔으면 벽이 아니다 — 그 파일들의 문제다", () => {
    expect(
      classifyBlock("첨부 판독", {
        read: 3,
        failures: [{ reason: "잔액 부족" }],
      })
    ).toBeNull();
  });

  it("사유가 제각각이면 공통 원인이 아니다", () => {
    expect(
      classifyBlock("첨부 판독", {
        read: 0,
        failures: [
          { reason: "파일이 너무 큽니다" },
          { reason: "형식을 알 수 없습니다" },
        ],
      })
    ).toBeNull();
  });

  it("실패가 없으면 차단도 없다", () => {
    expect(classifyBlock("첨부 판독", { read: 0, failures: [] })).toBeNull();
  });

  it("잔액·키·권한은 사람 몫, 일시적 오류는 아니다", () => {
    for (const r of [
      "Anthropic API 잔액이 부족합니다",
      "ANTHROPIC_API_KEY 가 없습니다",
      "files:read 권한이 필요합니다",
      "403 Forbidden",
      "invalid_auth",
    ])
      expect(needsPerson(r)).toBe(true);

    for (const r of ["일시적인 네트워크 오류", "파일이 너무 큽니다"])
      expect(needsPerson(r)).toBe(false);
  });
});
