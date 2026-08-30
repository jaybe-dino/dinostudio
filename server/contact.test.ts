/**
 * 파트너십 문의 — 인프라가 없어도 문의를 잃지 않는다.
 *
 * Vercel 함수를 경영관리 시스템 전체를 서빙하도록 바꾸면서, 예전 스텁이 갖고 있던
 * "DB가 없어도 로그·웹훅으로 남긴다"는 성질이 빠졌었다. 마케팅 사이트의 문의 폼이
 * DATABASE_URL 없이 500을 내던 회귀를 이 테스트로 막는다.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { appRouter } from "./routers";

const input = {
  name: "홍길동",
  company: "가나다",
  solution: "IP",
  message: "문의합니다",
};

function caller() {
  return appRouter.createCaller({
    req: { ip: null, headers: {} } as never,
    res: {} as never,
    user: null,
  });
}

describe("파트너십 문의", () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalWebhook = process.env.CONTACT_WEBHOOK_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.CONTACT_WEBHOOK_URL;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalUrl) process.env.DATABASE_URL = originalUrl;
    if (originalWebhook) process.env.CONTACT_WEBHOOK_URL = originalWebhook;
  });

  it("DB가 없어도 방문자에게 오류를 보여주지 않는다", async () => {
    await expect(caller().contact.submit(input)).resolves.toEqual({
      success: true,
    });
  });

  it("DB가 없으면 로그에는 반드시 남는다", async () => {
    await caller().contact.submit(input);
    const logged = (console.log as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(logged.some(call => String(call[0]).includes("파트너십 문의"))).toBe(
      true
    );
  });

  it("웹훅이 설정돼 있으면 전달한다", async () => {
    process.env.CONTACT_WEBHOOK_URL = "https://example.com/hook";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    await caller().contact.submit(input);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("웹훅이 죽어 있어도 문의는 성공한다", async () => {
    process.env.CONTACT_WEBHOOK_URL = "https://example.com/hook";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    await expect(caller().contact.submit(input)).resolves.toEqual({
      success: true,
    });
  });
});
