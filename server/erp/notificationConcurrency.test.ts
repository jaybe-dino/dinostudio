/**
 * QA-004 — 같은 알림이 동시에 두 번 나갔다.
 *
 * `notifications()` 는 저장된 알림을 **읽고 → 보내고 → 저장**했다. 세 동작
 * 사이에 선점이 없으므로 화면 조회와 크론이 같은 순간에 겹치면 둘 다
 * 「아직 안 보냈다」를 보고 둘 다 보낸다. 알림 3건이면 슬랙 호출이 6번이다.
 *
 * 화면과 크론이 **같은 함수**를 부르므로 이것은 가정이 아니라 매시간 일어날
 * 수 있는 일이다.
 *
 * 프로세스 안의 잠금으로는 못 막는다 — 운영은 서버리스라 인스턴스가 여럿이다.
 * 선점은 **저장소 한 문장** 안에서 일어나야 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";
import * as slack from "../integrations/slack.js";

const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };

type PostSpy = {
  mockResolvedValue: (v: { sent: boolean; error?: string }) => void;
  mockImplementation: (fn: () => Promise<{ sent: boolean }>) => void;
  mock: { calls: unknown[][] };
};
let post: PostSpy;

beforeEach(() => {
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_NOTIFY_CHANNEL = "C_QA_SYNTHETIC";
  post = vi.spyOn(slack, "postSlackMessage") as unknown as PostSpy;
});

afterEach(() => {
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_NOTIFY_CHANNEL;
  vi.restoreAllMocks();
});

const svc = () => new LedgerService(new InMemoryLedgerStore());

describe("QA-004 동시 조회가 같은 알림을 두 번 보내지 않는다", () => {
  it("**동시에 두 번 불러도 슬랙 호출은 알림 수만큼이다**", async () => {
    post.mockResolvedValue({ sent: true });
    const s = svc();

    const [a, b] = await Promise.all([
      s.notifications(CFO),
      s.notifications(CFO),
    ]);

    const bodies = new Set(post.mock.calls.map(c => String(c[1])));
    expect(bodies.size).toBeGreaterThan(0);
    // 같은 본문이 두 번 나가면 안 된다
    expect(post.mock.calls.length).toBe(bodies.size);

    // 양쪽 응답 모두 보낸 것으로 보여야 한다 — 진 쪽이 「안 갔다」로 보이면
    // 사람이 다시 누른다
    expect(a.undelivered).toBe(0);
    expect(b.undelivered).toBe(0);
    // 진 쪽에는 「보내는 중」으로 보일 수 있다 — 그건 실패가 아니다
    const settled = (r: typeof a) =>
      r.delivered.every(n => n.sentAt != null || n.leaseUntil != null);
    expect(settled(a)).toBe(true);
    expect(settled(b)).toBe(true);

    // 한 번 더 부르면 전부 「갔다」로 정리된다
    const third = await s.notifications(CFO);
    expect(third.delivered.every(n => n.sentAt != null)).toBe(true);
    expect(third.sending).toBe(0);
  });

  it("발송이 느려도 마찬가지다 — 느릴수록 겹칠 틈이 넓다", async () => {
    let inflight = 0;
    let maxInflight = 0;
    post.mockImplementation(async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise(r => setTimeout(r, 5));
      inflight -= 1;
      return { sent: true };
    });
    const s = svc();

    await Promise.all([
      s.notifications(CFO),
      s.notifications(CFO),
      s.notifications(CFO),
    ]);

    const bodies = new Set(post.mock.calls.map(c => String(c[1])));
    expect(post.mock.calls.length).toBe(bodies.size);
  });

  it("**성공한 상태를 덮어쓰지 않는다**", async () => {
    post.mockResolvedValue({ sent: true });
    const s = svc();
    const first = await s.notifications(CFO);
    const sentAt = first.delivered[0].sentAt;
    expect(sentAt).not.toBeNull();

    // 그 다음에 실패가 나더라도 이미 간 것은 간 것이다
    post.mockResolvedValue({ sent: false, error: "channel_not_found" });
    const second = await s.notifications(CFO);
    expect(
      second.delivered.find(n => n.id === first.delivered[0].id)?.sentAt
    ).toBe(sentAt);
    expect(second.undelivered).toBe(0);
  });

  it("실패한 알림은 **다음 번에 다시 시도된다** — 선점이 재시도를 막으면 안 된다", async () => {
    post.mockResolvedValue({ sent: false, error: "channel_not_found" });
    const s = svc();
    const first = await s.notifications(CFO);
    const attempts = post.mock.calls.length;
    expect(first.undelivered).toBeGreaterThan(0);

    const second = await s.notifications(CFO);
    expect(post.mock.calls.length).toBeGreaterThan(attempts);
    expect(second.undelivered).toBeGreaterThan(0);
  });

  it("정해진 횟수를 넘기면 그만둔다 — 벽에 계속 부딪히지 않는다", async () => {
    post.mockResolvedValue({ sent: false, error: "channel_not_found" });
    const s = svc();
    for (let i = 0; i < 8; i += 1) await s.notifications(CFO);
    const calls = post.mock.calls.length;
    await s.notifications(CFO);
    expect(post.mock.calls.length).toBe(calls);
    const last = await s.notifications(CFO);
    expect(last.giveUp).toBeGreaterThan(0);
  });
});

describe("선점은 임대다 — 죽은 프로세스가 알림을 영영 잠그지 않는다", () => {
  it("임대가 살아 있는 동안에는 다른 쪽이 못 집는다", async () => {
    const store = new InMemoryLedgerStore();
    const n = {
      id: "qa-004-lease",
      ruleId: "R1",
      title: "t",
      body: "b",
      screen: null,
      sentAt: null,
      sendAttempts: 0,
      lastError: null,
      lastAttemptAt: null,
      leaseUntil: null,
      readAt: null,
      createdAt: "2026-09-20T00:00:00.000Z",
    };
    const opts = {
      now: "2026-09-20T00:00:00.000Z",
      leaseUntil: "2026-09-20T00:02:00.000Z",
      maxAttempts: 5,
    };
    expect((await store.claimNotification(n, opts)).claimed).toBe(true);
    expect((await store.claimNotification(n, opts)).claimed).toBe(false);
  });

  it("**임대가 지나면 다시 집을 수 있다** — 보내다 죽은 건이 갇히지 않는다", async () => {
    const store = new InMemoryLedgerStore();
    const n = {
      id: "qa-004-expire",
      ruleId: "R1",
      title: "t",
      body: "b",
      screen: null,
      sentAt: null,
      sendAttempts: 0,
      lastError: null,
      lastAttemptAt: null,
      leaseUntil: null,
      readAt: null,
      createdAt: "2026-09-20T00:00:00.000Z",
    };
    await store.claimNotification(n, {
      now: "2026-09-20T00:00:00.000Z",
      leaseUntil: "2026-09-20T00:02:00.000Z",
      maxAttempts: 5,
    });
    const later = await store.claimNotification(n, {
      now: "2026-09-20T00:05:00.000Z",
      leaseUntil: "2026-09-20T00:07:00.000Z",
      maxAttempts: 5,
    });
    expect(later.claimed).toBe(true);
    expect(later.current.sendAttempts).toBe(2);
  });

  it("이미 보낸 건은 임대가 풀려도 다시 안 집는다", async () => {
    const store = new InMemoryLedgerStore();
    const n = {
      id: "qa-004-sent",
      ruleId: "R1",
      title: "t",
      body: "b",
      screen: null,
      sentAt: null,
      sendAttempts: 0,
      lastError: null,
      lastAttemptAt: null,
      leaseUntil: null,
      readAt: null,
      createdAt: "2026-09-20T00:00:00.000Z",
    };
    await store.claimNotification(n, {
      now: "2026-09-20T00:00:00.000Z",
      leaseUntil: "2026-09-20T00:02:00.000Z",
      maxAttempts: 5,
    });
    await store.releaseNotification(n.id, {
      sentAt: "2026-09-20T00:00:01.000Z",
      lastError: null,
    });
    const again = await store.claimNotification(n, {
      now: "2026-09-20T09:00:00.000Z",
      leaseUntil: "2026-09-20T09:02:00.000Z",
      maxAttempts: 5,
    });
    expect(again.claimed).toBe(false);
    expect(again.current.sentAt).toBe("2026-09-20T00:00:01.000Z");
  });

  it("**늦게 온 실패가 먼저 온 성공을 지우지 않는다**", async () => {
    const store = new InMemoryLedgerStore();
    const n = {
      id: "qa-004-race-release",
      ruleId: "R1",
      title: "t",
      body: "b",
      screen: null,
      sentAt: null,
      sendAttempts: 0,
      lastError: null,
      lastAttemptAt: null,
      leaseUntil: null,
      readAt: null,
      createdAt: "2026-09-20T00:00:00.000Z",
    };
    await store.claimNotification(n, {
      now: "2026-09-20T00:00:00.000Z",
      leaseUntil: "2026-09-20T00:02:00.000Z",
      maxAttempts: 5,
    });
    await store.releaseNotification(n.id, {
      sentAt: "2026-09-20T00:00:01.000Z",
      lastError: null,
    });
    const after = await store.releaseNotification(n.id, {
      sentAt: null,
      lastError: "channel_not_found",
    });
    expect(after.sentAt).toBe("2026-09-20T00:00:01.000Z");
    expect(after.lastError).toBeNull();
  });
});
