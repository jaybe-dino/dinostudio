/**
 * 알림 전달 — **알림함에 떠 있는 것과 도착지에 도달한 것은 다르다.**
 *
 * 고친 버그: 중복 방지가 「이미 적재된 알림이면 건너뛴다」였다. 그래서 슬랙
 * 발송이 실패한 알림은 `sentAt` 이 빈 채로 저장되고, 다음 번에는 **존재한다는
 * 이유로** 건너뛰어 영영 다시 시도되지 않았다. 알림함에는 떠 있으니 화면상
 * 으로는 멀쩡해 보인다 — 안 간 줄을 아무도 모른다.
 *
 * 그래서 이 파일은 **안 간 것을 안 갔다고 하는지**를 본다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";
import * as slack from "../integrations/slack.js";

const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };

type PostSpy = {
  mockResolvedValue: (v: { sent: boolean; error?: string }) => void;
  mock: { calls: unknown[][] };
};
let post: PostSpy;

beforeEach(() => {
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_NOTIFY_CHANNEL = "C_NOTIFY";
  post = vi.spyOn(slack, "postSlackMessage") as unknown as PostSpy;
});

afterEach(() => {
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_NOTIFY_CHANNEL;
  vi.restoreAllMocks();
});

function svc() {
  return new LedgerService(new InMemoryLedgerStore());
}

describe("보낸 것만 보냈다고 한다", () => {
  it("성공하면 sentAt 이 서고 다시 보내지 않는다", async () => {
    post.mockResolvedValue({ sent: true });
    const s = svc();
    const first = await s.notifications(CFO);
    const sentCount = post.mock.calls.length;
    expect(sentCount).toBeGreaterThan(0);
    expect(first.delivered.every(n => n.sentAt != null)).toBe(true);
    expect(first.undelivered).toBe(0);

    // 두 번째 호출에서는 같은 알림을 다시 보내지 않는다 (중복 방지)
    await s.notifications(CFO);
    expect(post.mock.calls.length).toBe(sentCount);
  });

  it("**실패하면 sentAt 이 안 서고 안 갔다고 센다**", async () => {
    post.mockResolvedValue({ sent: false, error: "channel_not_found" });
    const s = svc();
    const result = await s.notifications(CFO);
    expect(result.undelivered).toBeGreaterThan(0);
    expect(result.lastError).toContain("channel_not_found");
    expect(result.delivered.some(n => n.sentAt != null)).toBe(false);
  });

  it("**실패한 알림은 다음 번에 다시 시도한다** — 이게 없어서 영영 안 갔다", async () => {
    post.mockResolvedValue({ sent: false, error: "일시 오류" });
    const s = svc();
    await s.notifications(CFO);
    const afterFirst = post.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await s.notifications(CFO);
    // 다시 시도했어야 한다 — 예전에는 여기서 호출 수가 그대로였다
    expect(post.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("다시 시도해서 성공하면 그때 sentAt 이 선다", async () => {
    post.mockResolvedValue({ sent: false, error: "일시 오류" });
    const s = svc();
    const failed = await s.notifications(CFO);
    expect(failed.undelivered).toBeGreaterThan(0);

    post.mockResolvedValue({ sent: true });
    const ok = await s.notifications(CFO);
    expect(ok.undelivered).toBe(0);
    expect(ok.delivered.some(n => n.sentAt != null)).toBe(true);
  });
});

describe("무한히 두드리지 않는다", () => {
  it(`${LedgerService.NOTIFY_MAX_ATTEMPTS}번 실패하면 포기하고 그 사실을 남긴다`, async () => {
    post.mockResolvedValue({ sent: false, error: "channel_not_found" });
    const s = svc();
    for (let i = 0; i < LedgerService.NOTIFY_MAX_ATTEMPTS + 2; i += 1)
      await s.notifications(CFO);

    const result = await s.notifications(CFO);
    expect(result.giveUp).toBeGreaterThan(0);
    // 포기했어도 **성공으로 세지 않는다**
    expect(result.undelivered).toBeGreaterThan(0);
    expect(result.lastError).toContain("channel_not_found");
  });

  it("시도 횟수가 실제로 한계에서 멈춘다", async () => {
    post.mockResolvedValue({ sent: false, error: "x" });
    const s = svc();
    for (let i = 0; i < LedgerService.NOTIFY_MAX_ATTEMPTS + 3; i += 1)
      await s.notifications(CFO);
    const result = await s.notifications(CFO);
    const worst = Math.max(...result.delivered.map(n => n.sendAttempts));
    expect(worst).toBe(LedgerService.NOTIFY_MAX_ATTEMPTS);
  });
});

describe("도착지가 없을 때", () => {
  it("알림함에는 쌓이되 **시도한 것으로 세지 않는다**", async () => {
    delete process.env.SLACK_NOTIFY_CHANNEL;
    const s = svc();
    const result = await s.notifications(CFO);
    expect(result.destination).toBeNull();
    expect(post.mock.calls.length).toBe(0);
    expect(result.delivered.length).toBeGreaterThan(0);
    // 보내려고 한 적이 없으므로 「안 갔다」가 아니다 — 갈 곳이 없었다
    expect(result.undelivered).toBe(0);
    expect(result.delivered.every(n => n.sendAttempts === 0)).toBe(true);
  });
});
