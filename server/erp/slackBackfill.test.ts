/**
 * §11.1 슬랙 과거 메시지 백필.
 *
 * 이 기능이 필요한 이유 자체가 하나의 함정이었다 — 슬랙 Events API 는
 * **구독을 켠 다음**에 올라온 메시지만 보낸다. 연동을 끝냈다고 과거가
 * 들어오지는 않는다. 아래 테스트는 그 구멍을 메운 경로를 고정한다.
 *
 * 특히 조심할 것
 *   · 실시간 경로와 **같은 규칙**으로 걸러야 한다 (채널 허용 · 지출 판별)
 *   · 여러 번 눌러도 같은 건이 두 번 들어오면 안 된다
 *   · 슬랙은 새 앱의 history 를 분당 1회로 조인다 — 429 에서 기다리지 않고
 *     커서를 돌려주고 멈춰야 한다
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";
import {
  isCollectableMessage,
  type SlackHistoryMessage,
} from "../integrations/slackHistory.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };
const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };

/** 실제 #재무-집행요청 형태 — 값은 전부 예시다 */
function request(n: number): string {
  return [
    "사업부: 네트워크",
    `목적: 예시 캠페인 ${n}차 제작비`,
    "날짜: 8/20",
    "금액: 1,100,000원",
    "입금 은행 : 예시은행",
    "계좌번호 : 00000000000000",
    "예금주 : 예시상사(주)",
    "* 입금 후 계산서 자동발행",
  ].join("\n");
}

function page(
  messages: SlackHistoryMessage[],
  nextCursor: string | null = null
) {
  return { messages, nextCursor };
}

const CHANNELS = [
  { id: "C_EXEC", name: "재무-집행요청" },
  { id: "C_PAY", name: "결제요청방-일반" },
];

let originalChannels: string | undefined;
let originalIgnore: string | undefined;

beforeEach(() => {
  originalChannels = process.env.SLACK_EXPENSE_CHANNELS;
  originalIgnore = process.env.SLACK_IGNORE_CHANNELS;
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_EXPENSE_CHANNELS = "*";
  delete process.env.SLACK_IGNORE_CHANNELS;
});

afterEach(() => {
  delete process.env.SLACK_BOT_TOKEN;
  if (originalChannels === undefined) delete process.env.SLACK_EXPENSE_CHANNELS;
  else process.env.SLACK_EXPENSE_CHANNELS = originalChannels;
  if (originalIgnore === undefined) delete process.env.SLACK_IGNORE_CHANNELS;
  else process.env.SLACK_IGNORE_CHANNELS = originalIgnore;
});

function svc() {
  return new LedgerService(new InMemoryLedgerStore());
}

/** 채널마다 정해진 페이지를 돌려주는 가짜 슬랙 */
function fakeSlack(pages: Record<string, ReturnType<typeof page>[]>) {
  const calls: { channel: string; cursor: string | null }[] = [];
  const at: Record<string, number> = {};
  return {
    calls,
    listChannels: async () => ({ channels: CHANNELS }),
    fetchPage: async (args: {
      channel: string;
      cursor?: string | null;
      oldest: string;
    }) => {
      calls.push({ channel: args.channel, cursor: args.cursor ?? null });
      const index = at[args.channel] ?? 0;
      at[args.channel] = index + 1;
      return pages[args.channel]?.[index] ?? page([]);
    },
  };
}

describe("§11.1 슬랙 백필 — 구독 이전의 과거를 가져온다", () => {
  it("한 달치를 훑어 검수함에 넣는다", async () => {
    const s = svc();
    const slack = fakeSlack({
      C_EXEC: [
        page([
          { type: "message", ts: "1000.1", text: request(1), user: "U1" },
          { type: "message", ts: "1000.2", text: request(2), user: "U1" },
        ]),
      ],
      C_PAY: [
        page([{ type: "message", ts: "1000.3", text: request(3), user: "U2" }]),
      ],
    });

    const result = await s.backfillSlackHistory({ days: 30 }, CEO, slack);

    expect(result.totals.collected).toBe(3);
    expect(result.remaining).toBe(false);
    expect(result.days).toBe(30);
    const intakes = await s.masters(CEO).then(m => m.intakes);
    expect(intakes).toHaveLength(3);
    expect(intakes.every(i => i.source === "slack")).toBe(true);
  });

  it("days 가 그대로 조회 하한(oldest)이 된다", async () => {
    const s = svc();
    let oldest = "";
    const slack = {
      listChannels: async () => ({ channels: [CHANNELS[0]] }),
      fetchPage: async (args: { oldest: string }) => {
        oldest = args.oldest;
        return page([]);
      },
    };
    const fixedNow = Date.UTC(2026, 8, 11);
    await s.backfillSlackHistory({ days: 30 }, CEO, {
      ...slack,
      now: () => fixedNow,
    });
    expect(Number(oldest)).toBe(Math.floor(fixedNow / 1000) - 30 * 86_400);
  });

  it("두 번 눌러도 같은 건이 두 번 들어가지 않는다", async () => {
    const s = svc();
    const messages = [
      { type: "message", ts: "2000.1", text: request(1), user: "U1" },
    ];
    const first = fakeSlack({ C_EXEC: [page(messages)] });
    await s.backfillSlackHistory({ days: 30 }, CEO, first);

    const second = fakeSlack({ C_EXEC: [page(messages)] });
    const again = await s.backfillSlackHistory({ days: 30 }, CEO, second);

    expect(again.totals.collected).toBe(0);
    expect(again.totals.duplicate).toBe(1);
    const intakes = await s.masters(CEO).then(m => m.intakes);
    expect(intakes).toHaveLength(1);
  });

  it("실시간 수집과 같은 건이면 중복으로 걸린다", async () => {
    const s = svc();
    await s.collectSlackMessage(
      { channel: "C_EXEC", ts: "3000.1", text: request(9), user: "U1" },
      CEO
    );
    const slack = fakeSlack({
      C_EXEC: [
        page([{ type: "message", ts: "3000.1", text: request(9), user: "U1" }]),
      ],
    });
    const result = await s.backfillSlackHistory({ days: 30 }, CEO, slack);
    expect(result.totals.duplicate).toBe(1);
    expect(result.totals.collected).toBe(0);
  });

  it("잡담은 검수함에 넣지 않는다", async () => {
    const s = svc();
    const slack = fakeSlack({
      C_EXEC: [
        page([
          {
            type: "message",
            ts: "4000.1",
            text: "오늘 점심 뭐 드세요?",
            user: "U1",
          },
          { type: "message", ts: "4000.2", text: request(1), user: "U1" },
        ]),
      ],
    });
    const result = await s.backfillSlackHistory({ days: 30 }, CEO, slack);
    expect(result.totals.ignored).toBe(1);
    expect(result.totals.collected).toBe(1);
  });

  it("무시 채널은 백필에서도 제외된다 — 허용 판정이 한 벌이다", async () => {
    process.env.SLACK_IGNORE_CHANNELS = "C_PAY";
    const s = svc();
    const slack = fakeSlack({
      C_EXEC: [
        page([{ type: "message", ts: "5000.1", text: request(1), user: "U1" }]),
      ],
      C_PAY: [
        page([{ type: "message", ts: "5000.2", text: request(2), user: "U2" }]),
      ],
    });
    const result = await s.backfillSlackHistory({ days: 30 }, CEO, slack);

    expect(result.channels.map(c => c.channel)).toEqual(["C_EXEC"]);
    expect(result.skippedChannels).toBe(1);
    expect(result.totals.collected).toBe(1);
  });

  it("SLACK_EXPENSE_CHANNELS 가 명시 목록이면 채널을 슬랙에 묻지 않는다", async () => {
    // users.conversations 는 channels:read 를 더 요구한다. 권한을 붙이기
    // 전이라도 환경변수에 적어 두면 백필이 돌아가야 한다.
    process.env.SLACK_EXPENSE_CHANNELS = "C_EXEC";
    const s = svc();
    let asked = false;
    const result = await s.backfillSlackHistory({ days: 30 }, CEO, {
      listChannels: async () => {
        asked = true;
        return { error: "missing_scope" };
      },
      fetchPage: async () =>
        page([{ type: "message", ts: "9000.1", text: request(1), user: "U1" }]),
    });

    expect(asked).toBe(false);
    expect(result.totals.collected).toBe(1);
    expect(result.channels[0].channel).toBe("C_EXEC");
  });

  it("SLACK_EXPENSE_CHANNELS 가 비어 있으면 아무 것도 가져오지 않는다 — 기본값은 닫힘", async () => {
    delete process.env.SLACK_EXPENSE_CHANNELS;
    const s = svc();
    const slack = fakeSlack({
      C_EXEC: [
        page([{ type: "message", ts: "6000.1", text: request(1), user: "U1" }]),
      ],
    });
    const result = await s.backfillSlackHistory({ days: 30 }, CEO, slack);
    expect(result.channels).toHaveLength(0);
    expect(result.totals.collected).toBe(0);
  });

  it("커서를 따라 다음 페이지까지 간다", async () => {
    const s = svc();
    const slack = fakeSlack({
      C_EXEC: [
        page(
          [{ type: "message", ts: "7000.1", text: request(1), user: "U1" }],
          "CUR1"
        ),
        page([{ type: "message", ts: "7000.2", text: request(2), user: "U1" }]),
      ],
    });
    const result = await s.backfillSlackHistory({ days: 30 }, CEO, slack);
    expect(result.totals.collected).toBe(2);
    expect(result.remaining).toBe(false);
    expect(slack.calls[1].cursor).toBe("CUR1");
  });

  it("넘겨준 커서에서 이어서 시작한다", async () => {
    const s = svc();
    const slack = fakeSlack({ C_EXEC: [page([])] });
    await s.backfillSlackHistory(
      { days: 30, cursors: { C_EXEC: "RESUME" } },
      CEO,
      slack
    );
    expect(slack.calls[0].cursor).toBe("RESUME");
  });
});

describe("§11.1 백필 — 멈춰야 할 때 멈춘다", () => {
  it("많은 페이지가 남은 채널보다 미시작 채널을 먼저 조회한다", async () => {
    const slack = fakeSlack({ C_EXEC: [page([])], C_PAY: [page([])] });
    await svc().backfillSlackHistory(
      { days: 30, cursors: { C_EXEC: "NEXT", C_PAY: "" } },
      CEO,
      slack
    );
    expect(slack.calls.map(call => call.channel)).toEqual(["C_PAY", "C_EXEC"]);
  });

  it("완료한 채널은 재조회하지 않고 아직 시작하지 않은 채널부터 재개한다", async () => {
    const s = svc();
    let clock = 0;
    const firstCalls: string[] = [];
    const first = await s.backfillSlackHistory(
      { days: 30, budgetMs: 1_000 },
      CEO,
      {
        listChannels: async () => ({ channels: CHANNELS }),
        fetchPage: async ({ channel }) => {
          firstCalls.push(channel);
          clock += 2_000;
          return page([]);
        },
        now: () => clock,
      }
    );
    expect(firstCalls).toEqual(["C_EXEC"]);
    expect(first.cursors).toEqual({ C_PAY: "" });
    const next = fakeSlack({ C_PAY: [page([])] });
    const result = await s.backfillSlackHistory(
      { days: 30, cursors: first.cursors },
      CEO,
      next
    );
    expect(next.calls).toEqual([{ channel: "C_PAY", cursor: null }]);
    expect(result.remaining).toBe(false);
  });

  it("429 를 받으면 기다리지 않고 커서를 돌려주고 멈춘다", async () => {
    const s = svc();
    const slack = {
      listChannels: async () => ({ channels: [CHANNELS[0]] }),
      fetchPage: async () => ({ error: "ratelimited", retryAfterSec: 42 }),
    };
    const result = await s.backfillSlackHistory({ days: 30 }, CEO, slack);

    expect(result.stopped).toBe("ratelimited");
    expect(result.retryAfterSec).toBe(42);
    expect(result.note).toContain("42초");
    expect(result.cursors).toEqual({ C_EXEC: "" });
  });

  it("시간 예산을 넘기면 커서를 남기고 멈춘다", async () => {
    const s = svc();
    let clock = 0;
    const slack = {
      listChannels: async () => ({ channels: [CHANNELS[0]] }),
      // 페이지마다 커서가 계속 나온다 — 예산이 없으면 끝나지 않는다
      fetchPage: async () => {
        clock += 5_000;
        return page([], "NEXT");
      },
      now: () => clock,
    };
    const result = await s.backfillSlackHistory(
      { days: 30, budgetMs: 1_000 },
      CEO,
      slack
    );

    expect(result.stopped).toBe("budget");
    expect(result.remaining).toBe(true);
    expect(result.cursors.C_EXEC).toBe("NEXT");
  });

  it("한 채널의 권한 오류가 다른 채널을 막지 않는다", async () => {
    const s = svc();
    const slack = {
      listChannels: async () => ({ channels: CHANNELS }),
      fetchPage: async (args: { channel: string }) =>
        args.channel === "C_EXEC"
          ? { error: "not_in_channel" }
          : page([
              { type: "message", ts: "8000.1", text: request(1), user: "U2" },
            ]),
    };
    const result = await s.backfillSlackHistory({ days: 30 }, CEO, slack);

    expect(result.channels[0].error).toContain("/invite");
    expect(result.channels[1].collected).toBe(1);
    expect(result.stopped).toBeNull();
  });

  it("권한이 없으면 무엇을 추가해야 하는지 알려 준다", async () => {
    const s = svc();
    const slack = {
      listChannels: async () => ({ error: "missing_scope" }),
      fetchPage: async () => page([]),
    };
    await expect(
      s.backfillSlackHistory({ days: 30 }, CEO, slack)
    ).rejects.toThrow(/channels:history/);
  });

  it("토큰이 없으면 실행되지 않는다", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const s = svc();
    await expect(s.backfillSlackHistory({ days: 30 }, CEO)).rejects.toThrow(
      /SLACK_BOT_TOKEN/
    );
  });

  it("재무는 실행할 수 없다 — 원장 앞단을 통째로 채우는 작업이다", async () => {
    const s = svc();
    const slack = fakeSlack({ C_EXEC: [page([])] });
    await expect(
      s.backfillSlackHistory({ days: 30 }, CFO, slack)
    ).rejects.toThrow(/대표만/);
  });
});

describe("isCollectableMessage — 사람이 쓴 글만 본다", () => {
  it("참여 알림·봇 글·파일 공유는 건너뛴다", () => {
    expect(
      isCollectableMessage({
        type: "message",
        subtype: "channel_join",
        ts: "1",
        text: "x",
      })
    ).toBe(false);
    expect(
      isCollectableMessage({
        type: "message",
        bot_id: "B1",
        ts: "1",
        text: "x",
      })
    ).toBe(false);
    expect(
      isCollectableMessage({
        type: "message",
        subtype: "file_share",
        ts: "1",
        text: "x",
      })
    ).toBe(false);
  });

  it("본문이나 ts 가 없으면 수집하지 않는다", () => {
    expect(isCollectableMessage({ type: "message", ts: "1" })).toBe(false);
    expect(isCollectableMessage({ type: "message", text: "x" })).toBe(false);
  });

  it("사람이 쓴 평범한 메시지는 수집한다", () => {
    expect(
      isCollectableMessage({ type: "message", ts: "1", text: "x", user: "U1" })
    ).toBe(true);
  });
});

describe("§11.1 백필 — 안 쓰는 채널을 표시한다 (30일 규칙)", () => {
  const NOW = Date.UTC(2026, 8, 12); // 2026-09-12
  const tsDaysAgo = (days: number) =>
    String(Math.floor(NOW / 1000) - days * 86_400);

  function at(days: number, n: number) {
    return {
      type: "message",
      ts: `${tsDaysAgo(days)}.${n}`,
      text: request(n),
      user: "U1",
    };
  }

  it("30일 안에 글이 있으면 쓰는 채널이다", async () => {
    const s = svc();
    const result = await s.backfillSlackHistory({ days: 365 }, CEO, {
      listChannels: async () => ({ channels: [CHANNELS[0]] }),
      fetchPage: async () => page([at(5, 1)]),
      now: () => NOW,
    });
    expect(result.channels[0].dormant).toBe(false);
    expect(result.dormantChannels).toEqual([]);
  });

  it("마지막 글이 30일보다 오래됐으면 안 쓰는 채널이다", async () => {
    const s = svc();
    const result = await s.backfillSlackHistory({ days: 365 }, CEO, {
      listChannels: async () => ({ channels: [CHANNELS[0]] }),
      fetchPage: async () => page([at(200, 1)]),
      now: () => NOW,
    });
    expect(result.channels[0].dormant).toBe(true);
    expect(result.dormantChannels).toEqual(["C_EXEC"]);
    expect(result.channels[0].lastMessageAt).toBe("2026-02-24");
  });

  it("글이 하나도 없으면 안 쓰는 채널이다", async () => {
    const s = svc();
    const result = await s.backfillSlackHistory({ days: 365 }, CEO, {
      listChannels: async () => ({ channels: [CHANNELS[0]] }),
      fetchPage: async () => page([]),
      now: () => NOW,
    });
    expect(result.channels[0].dormant).toBe(true);
  });

  it("안 쓰는 채널이라고 건너뛰지는 않는다 — 과거를 긁는 것이 백필의 목적이다", async () => {
    const s = svc();
    const result = await s.backfillSlackHistory({ days: 365 }, CEO, {
      listChannels: async () => ({ channels: [CHANNELS[0]] }),
      fetchPage: async () => page([at(200, 1)]),
      now: () => NOW,
    });
    expect(result.channels[0].dormant).toBe(true);
    expect(result.totals.collected).toBe(1);
  });

  it("오류가 난 채널은 안 쓰는 채널로 단정하지 않는다", async () => {
    const s = svc();
    const result = await s.backfillSlackHistory({ days: 365 }, CEO, {
      listChannels: async () => ({ channels: [CHANNELS[0]] }),
      fetchPage: async () => ({ error: "not_in_channel" }),
      now: () => NOW,
    });
    // 못 읽은 것과 글이 없는 것은 다르다
    expect(result.channels[0].dormant).toBe(false);
    expect(result.channels[0].error).toContain("/invite");
  });
});
