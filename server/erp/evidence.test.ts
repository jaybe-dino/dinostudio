/**
 * 증빙 (§13.2) · 사용자·역할 (§13.1 G13) · 알림 적재 (§12)
 *
 * "증빙이 없는 건은 보류까지만" 규칙은 증빙을 올릴 수 있어야 성립한다.
 */
import { describe, expect, it } from "vitest";
import { storageKey, validateUpload } from "./attachments";
import { LedgerService } from "./service";
import { InMemoryLedgerStore } from "./store";
import type { Actor } from "./service";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };
const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };
const STAFF: Actor = { id: "staff@dinostudio.kr", role: "담당자" };
const service = () => new LedgerService(new InMemoryLedgerStore());

describe("§13.2 증빙", () => {
  it("증빙이 없으면 확정되지 않는다", async () => {
    const svc = service();
    const { entry } = await svc.getEntry("EX-260901-01", CFO); // 증빙 없음
    await expect(svc.approve("EX-260901-01", entry.version, CEO)).rejects.toMatchObject({
      code: "evidence_required",
    });
  });

  it("링크를 등록하면 증빙이 붙고 확정이 가능해진다", async () => {
    const svc = service();
    const before = await svc.getEntry("EX-260901-01", CFO);
    expect(before.entry.hasEvidence).toBe(false);

    await svc.addEvidence(
      {
        code: "EX-260901-01",
        kind: "계약서",
        storage: "link",
        url: "https://drive.google.com/file/abc",
      },
      CFO
    );

    const after = await svc.getEntry("EX-260901-01", CFO);
    expect(after.entry.hasEvidence).toBe(true);
    const result = await svc.approve("EX-260901-01", after.entry.version, CEO);
    expect(result.entry.status).toBe("confirmed");
  });

  it("http(s)가 아닌 링크는 받지 않는다", async () => {
    const svc = service();
    await expect(
      svc.addEvidence(
        { code: "EX-260901-01", kind: "기타", storage: "link", url: "javascript:alert(1)" },
        CFO
      )
    ).rejects.toMatchObject({ code: "evidence_required" });
  });

  it("증빙 등록은 감사로그에 남는다", async () => {
    const svc = service();
    await svc.addEvidence(
      { code: "EX-260901-01", kind: "영수증", storage: "link", url: "https://example.com/a.pdf" },
      CFO
    );
    const audit = await svc.auditTrail({ table: "attachment" });
    expect(audit.some(log => log.action === "add")).toBe(true);
  });

  it("스토리지가 없으면 파일 업로드를 열어주지 않는다", async () => {
    const svc = service();
    await expect(
      svc.requestEvidenceUpload("EX-260901-01", "a.pdf", "application/pdf", 1000, CFO)
    ).rejects.toMatchObject({ code: "evidence_required" });
  });

  it("업로드 검증 — 크기 · 형식", () => {
    expect(validateUpload("a.pdf", "application/pdf", 1000)).toBeNull();
    expect(validateUpload("a.exe", "application/x-msdownload", 1000)).toContain("형식");
    expect(validateUpload("a.pdf", "application/pdf", 50 * 1024 * 1024)).toContain("MB");
    expect(validateUpload("", "application/pdf", 1000)).toContain("파일명");
  });

  it("파일명을 그대로 키로 쓰지 않는다 (경로 조작 방지)", () => {
    const key = storageKey("EX-260901-01", "../../etc/passwd.pdf", "abc-123");
    expect(key).toBe("erp/evidence/EX-260901-01/abc-123.pdf");
    expect(key).not.toContain("..");
  });
});

describe("§13.1 사용자 · 역할 (G13)", () => {
  it("역할 지정은 대표만 할 수 있다", async () => {
    const svc = service();
    const user = { id: "a@x.kr", email: "a@x.kr", name: "가", role: "재무" as const, active: true };
    await expect(svc.putAppUser(user, CFO)).rejects.toMatchObject({ code: "forbidden_field" });
    await expect(svc.putAppUser(user, CEO)).resolves.toMatchObject({ role: "재무" });
  });

  it("담당자는 사용자 목록을 볼 수 없다", async () => {
    const svc = service();
    await expect(svc.appUsers(STAFF)).rejects.toMatchObject({ code: "forbidden_field" });
  });

  it("배정은 감사로그에 남는다", async () => {
    const svc = service();
    await svc.putAppUser(
      { id: "b@x.kr", email: "b@x.kr", name: "나", role: "담당자", active: true },
      CEO
    );
    const audit = await svc.auditTrail({ table: "app_user" });
    expect(audit).toHaveLength(1);
  });
});

describe("§12 알림 적재", () => {
  it("알림함에 적재되고 읽음 표시가 유지된다", async () => {
    const svc = service();
    const first = await svc.notifications(CFO);
    expect(first.delivered.length).toBeGreaterThan(0);
    expect(first.unread).toBe(first.delivered.length);

    await svc.markNotificationRead(first.delivered[0].id, CFO);

    // 다시 계산해도 읽음 표시가 지워지지 않는다
    const second = await svc.notifications(CFO);
    expect(second.unread).toBe(first.unread - 1);
    expect(second.delivered.find(n => n.id === first.delivered[0].id)?.readAt).not.toBeNull();
  });

  it("도착지가 없으면 미발송이지만 알림함에는 남는다 (B7)", async () => {
    const svc = service();
    const result = await svc.notifications(CFO);
    expect(result.destination).toBeNull();
    expect(result.delivered.every(n => n.sentAt === null)).toBe(true);
  });
});

describe("§13.3 급여 · 부채는 조회도 감사로그에 남는다", () => {
  it("인건비 계정을 조회하면 read_sensitive가 기록된다", async () => {
    const svc = service();
    await svc.listEntries({ account: "6110" }, STAFF);
    const audit = await svc.auditTrail({ table: "entry" });
    expect(audit.some(log => log.action === "read_sensitive")).toBe(true);
  });

  it("민감 계정이 없는 조회는 기록하지 않는다", async () => {
    const svc = service();
    await svc.listEntries({ account: "6510" }, STAFF);
    const audit = await svc.auditTrail({ table: "entry" });
    expect(audit.some(log => log.action === "read_sensitive")).toBe(false);
  });
});

describe("§14 원장 목록 커서 페이징", () => {
  it("커서로 이어 받으면 중복도 누락도 없다", async () => {
    const svc = service();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i += 1) {
      const page = await svc.listEntries({}, CFO, { cursor, limit: 5 });
      seen.push(...page.page.map(e => e.code));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    const total = (await svc.listEntries({}, CFO)).total;
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
  });
});
