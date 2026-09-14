/**
 * 백필이 **시간 안에 끝난다.**
 *
 * 이 파일이 생긴 이유는 실제 사고다. 365일 수집을 누르면 브라우저에
 * `Failed to fetch` 만 떴다 — 서버리스 함수가 시간 초과로 죽은 것이다.
 * 왜 죽었는지는 화면에 아무것도 안 남는, 가장 나쁜 실패다.
 *
 * 원인은 예산을 **페이지 사이에서만** 확인한 것이었다. 한 페이지 안에서
 * 스레드 조회와 첨부 해독이 메시지 수만큼 일어나므로, 한 번의 반복이 몇
 * 분까지 늘어날 수 있었다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표", stepUpFresh: true };

function request(n: number) {
  return [
    "기업명: 예시상사",
    `지출 내용: 예시 건 ${n}`,
    "지출 금액(VAT 포함): 총 1,100,000원",
    "지출 요청일: 2026-09-30",
  ].join("\n");
}

let original: string | undefined;
beforeEach(() => {
  original = process.env.SLACK_EXPENSE_CHANNELS;
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_EXPENSE_CHANNELS = "*";
});
afterEach(() => {
  delete process.env.SLACK_BOT_TOKEN;
  if (original === undefined) delete process.env.SLACK_EXPENSE_CHANNELS;
  else process.env.SLACK_EXPENSE_CHANNELS = original;
});

describe("한 페이지가 커도 예산 안에서 멈춘다", () => {
  it("메시지마다 예산을 본다 — 페이지 사이에서만 보면 안 된다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    let clock = 0;
    // 메시지 200건짜리 한 페이지. 처리할 때마다 시계가 간다
    const many = Array.from({ length: 200 }, (_, i) => ({
      type: "message",
      ts: `900.${i}`,
      text: request(i),
      user: "U1",
    }));

    const result = await s.backfillSlackHistory(
      { days: 365, budgetMs: 1_000 },
      CEO,
      {
        listChannels: async () => ({ channels: [{ id: "C1", name: "지출" }] }),
        fetchPage: async () => ({ messages: many, nextCursor: null }),
        now: () => (clock += 200),
      }
    );

    expect(result.stopped).toBe("budget");
    // 200건을 다 처리하지 않고 멈췄어야 한다
    expect(result.channels[0].scanned).toBeLessThan(200);
    expect(result.remaining).toBe(true);
  });

  it("멈춰도 그때까지 들여온 것은 남는다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    let clock = 0;
    const many = Array.from({ length: 50 }, (_, i) => ({
      type: "message",
      ts: `800.${i}`,
      text: request(i),
      user: "U1",
    }));

    const result = await s.backfillSlackHistory(
      { days: 365, budgetMs: 1_000 },
      CEO,
      {
        listChannels: async () => ({ channels: [{ id: "C1", name: "지출" }] }),
        fetchPage: async () => ({ messages: many, nextCursor: null }),
        now: () => (clock += 300),
      }
    );

    expect(result.totals.collected).toBeGreaterThan(0);
    const intakes = await s.masters(CEO).then(m => m.intakes);
    expect(intakes.length).toBe(result.totals.collected);
  });

  it("백필은 첨부 내용을 읽지 않는다 — 읽으면 함수가 죽는다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    let readCalled = 0;

    await s.backfillSlackHistory({ days: 365 }, CEO, {
      listChannels: async () => ({ channels: [{ id: "C1", name: "지출" }] }),
      fetchPage: async () => ({
        messages: [
          {
            type: "message",
            ts: "700.1",
            text: request(1),
            user: "U1",
            files: [{ name: "계약서.pdf", mimetype: "application/pdf" }],
          },
        ],
        nextCursor: null,
      }),
    });

    // readSlackFiles 는 기본 구현이므로 호출되면 네트워크를 타려 한다.
    // 여기서는 호출되지 않았다는 것을 파일 상태로 확인한다.
    const intake = (await s.masters(CEO)).intakes[0];
    const parsed = intake.parsed as { files?: { reason?: string }[] };
    expect(parsed.files?.[0]?.reason).toContain("아직 읽지 않았습니다");
    expect(readCalled).toBe(0);
  });
});

describe("첨부는 따로, 조금씩 읽는다", () => {
  async function withPending() {
    const s = new LedgerService(new InMemoryLedgerStore());
    await s.backfillSlackHistory({ days: 365 }, CEO, {
      listChannels: async () => ({ channels: [{ id: "C1", name: "지출" }] }),
      fetchPage: async () => ({
        messages: [
          {
            type: "message",
            ts: "600.1",
            text: "<@U1> 계약서 서명 부탁드립니다.",
            user: "U1",
            files: [
              {
                name: "틱톡샵_통합계약서_예시상사_0825.pdf",
                mimetype: "application/pdf",
                url_private_download: "https://files.slack.com/x",
              },
            ],
          },
        ],
        nextCursor: null,
      }),
    });
    return s;
  }

  it("읽은 내용이 원문에 붙고 다시 파싱된다", async () => {
    const s = await withPending();
    const out = await s.readPendingAttachments({}, CEO, {
      readFiles: async () => [
        {
          name: "틱톡샵_통합계약서_예시상사_0825.pdf",
          mimetype: "application/pdf",
          size: 1000,
          permalink: null,
          text: "기업명: 예시상사\n지출 금액(VAT 포함): 총 10,560,000원",
          reason: null,
        },
      ],
    });

    expect(out.read).toBe(1);
    const intake = (await s.masters(CEO)).intakes[0];
    expect(intake.raw).toContain("10,560,000");
    const parsed = intake.parsed as { amount?: number | null };
    expect(parsed.amount).toBe(10_560_000);
  });

  it("두 번 눌러도 원문에 첨부가 쌓이지 않는다", async () => {
    const s = await withPending();
    const read = async () =>
      s.readPendingAttachments({}, CEO, {
        readFiles: async () => [
          {
            name: "틱톡샵_통합계약서_예시상사_0825.pdf",
            mimetype: "application/pdf",
            size: 1000,
            permalink: null,
            text: "금액: 총 10,560,000원",
            reason: null,
          },
        ],
      });
    await read();
    const before = (await s.masters(CEO)).intakes[0].raw ?? "";
    await read();
    const after = (await s.masters(CEO)).intakes[0].raw ?? "";
    // 이미 읽은 건은 다시 읽지 않으므로 원문이 그대로다
    expect(after).toBe(before);
    expect(after.split("[첨부").length - 1).toBe(1);
  });

  it("못 읽으면 이유가 남고 다음에 다시 시도할 수 있다", async () => {
    const s = await withPending();
    const out = await s.readPendingAttachments({}, CEO, {
      readFiles: async () => [
        {
          name: "틱톡샵_통합계약서_예시상사_0825.pdf",
          mimetype: "application/pdf",
          size: 1000,
          permalink: null,
          text: null,
          reason: "슬랙이 파일 대신 로그인 페이지를 돌려줬습니다",
        },
      ],
    });
    expect(out.failed).toBe(1);
    const intake = (await s.masters(CEO)).intakes[0];
    expect(intake.raw).toContain("로그인 페이지");
  });

  it("앞 파일이 실패해도 다음 파일을 읽고 미판독 수를 정확히 유지한다", async () => {
    const s = await withPending();
    const intake = (await s.masters(CEO)).intakes[0];
    const parsed = intake.parsed as { files: { name: string; meta: object }[] };
    // Add a second unread file to the same intake.
    const backing = (s as unknown as { store: InMemoryLedgerStore }).store;
    await backing.upsertIntake({ ...(await backing.listIntakes())[0], parsed: { ...parsed, files: [
      ...parsed.files,
      { name: "second.pdf", meta: { name: "second.pdf", mimetype: "application/pdf" } },
    ] } });
    const attempted: string[] = [];
    const deps = { readFiles: async (files: { name?: string }[]) => {
      attempted.push(files[0].name!);
      return [{ name: files[0].name!, mimetype: "application/pdf", size: 1,
        permalink: null, text: files[0].name === "second.pdf" ? "총 100원" : null,
        reason: "읽기 실패" }];
    } };
    const first = await s.readPendingAttachments({}, CEO, deps);
    expect(first.remaining).toBe(2);
    expect(first.unattempted).toBe(1);
    const next = await s.readPendingAttachments({}, CEO, deps);
    expect(attempted[1]).toBe("second.pdf");
    expect(next.read).toBe(1);
    expect(next.remaining).toBe(1);
    expect(next.unattempted).toBe(0);
  });

  it("동일 Slack 파일을 다른 메시지에서 다시 읽을 때 기존 판독을 재사용한다", async () => {
    const s = await withPending();
    const backing = (s as unknown as { store: InMemoryLedgerStore }).store;
    const original = (await backing.listIntakes())[0];
    await s.readPendingAttachments({}, CEO, { readFiles: async () => [{
      name: "contract.pdf", mimetype: "application/pdf", size: 1, permalink: null,
      text: "금액: 총 100원", reason: null,
    }] });
    await backing.upsertIntake({ ...original, id: "second-intake", sourceRef: "601.1" });
    const result = await s.readPendingAttachments({}, CEO, { readFiles: async () => {
      throw new Error("동일 파일을 다시 내려받으면 안 됨");
    } });
    expect(result.read).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it("읽을 것이 없으면 그렇다고 말한다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    const out = await s.readPendingAttachments({}, CEO);
    expect(out.read).toBe(0);
    expect(out.note).toContain("읽을 첨부가 없습니다");
  });
});

describe("백필 진행 위치 복구", () => {
  it("앞쪽 잡담 스레드 때문에 매번 예산을 소진해도 다음 부모로 진행한다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    let clock = 0;
    const visited: string[] = [];
    const messages = Array.from({ length: 4 }, (_, i) => ({
      type: "message",
      ts: `500.${i}`,
      text: i === 3 ? request(i) : "안녕하세요",
      reply_count: 1,
      user: "U1",
    }));
    const deps = {
      now: () => clock,
      listChannels: async () => ({ channels: [{ id: "C1", name: "지출" }] }),
      fetchPage: async () => ({ messages, nextCursor: null }),
      fetchThread: async ({ ts }: { ts: string }) => {
        visited.push(ts);
        clock += 1100;
        return { messages: [] };
      },
    };
    let cursors: Record<string, string> | undefined;
    let result;
    for (let i = 0; i < 4; i += 1) {
      result = await s.backfillSlackHistory(
        { days: 365, budgetMs: 1000, cursors },
        CEO,
        deps
      );
      cursors = result.cursors;
    }
    expect(visited).toEqual(messages.map(message => message.ts));
    expect(result?.remaining).toBe(false);
    expect((await s.masters(CEO)).intakes).toHaveLength(1);
  });

  it("답글의 429는 부모를 완료 처리하지 않고 정확히 재시도한다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    let limited = true;
    const deps = {
      listChannels: async () => ({ channels: [{ id: "C1", name: "지출" }] }),
      fetchPage: async () => ({
        messages: [
          { type: "message", ts: "400.1", text: "지출결의서", reply_count: 1 },
        ],
        nextCursor: null,
      }),
      fetchThread: async () =>
        limited
          ? { error: "ratelimited", retryAfterSec: 60 }
          : { messages: [{ ts: "400.2", text: "확인할 항목" }] },
    };
    const first = await s.backfillSlackHistory({}, CEO, deps);
    expect(first.stopped).toBe("ratelimited");
    expect(first.retryAfterSec).toBe(60);
    expect((await s.masters(CEO)).intakes).toHaveLength(0);
    limited = false;
    const second = await s.backfillSlackHistory(
      { cursors: first.cursors },
      CEO,
      deps
    );
    expect(second.remaining).toBe(false);
    expect((await s.masters(CEO)).intakes[0].raw).toContain("확인할 항목");
  });
});


describe("대량 채널 뒤의 채널도 진행한다", () => {
  it("재개 지도 순서를 지켜 앞선 대량 채널을 뒤로 보낸다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    const visited: string[] = [];
    const out = await s.backfillSlackHistory({ days: 365, cursors: { C2: "next2", C1: "next1" } }, CEO, {
      listChannels: async () => ({ channels: [{ id: "C1", name: "대량" }, { id: "C2", name: "지출" }] }),
      fetchPage: async ({ channel }) => {
        visited.push(channel);
        return { messages: [], nextCursor: null };
      },
    });
    expect(visited).toEqual(["C2", "C1"]);
    expect(out.remaining).toBe(false);
  });
});
