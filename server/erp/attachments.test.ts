/**
 * 첨부 파일도 자료다.
 *
 * 계약서 PDF 안에 금액과 기간이 들어 있고, 본문에는 「서명 부탁드립니다」 한
 * 줄뿐인 경우가 많다. 본문만 읽으면 그 내용이 통째로 사라진다.
 *
 * 그리고 **못 읽어도 버리지 않는다.** 파일 이름만으로도 거래처·날짜·문서
 * 종류를 알 수 있다.
 */
import { describe, expect, it } from "vitest";
import { dateFromName, readFileName } from "../../shared/erp/fileNames.js";
import { classifyFile, downloadSlackFile } from "../integrations/slackFiles.js";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표", stepUpFresh: true };

describe("파일 이름에서 뽑아내는 것", () => {
  const name = "틱톡샵_온보딩운영_통합계약서_예시브라이언_0825.pdf";

  it("문서 종류 — 긴 이름이 먼저다", () => {
    // 「통합계약서」가 「계약서」보다 먼저 걸려야 한다
    expect(readFileName(name, 2026).docType).toBe("통합계약서");
  });

  it("날짜 — 두 자리 표기는 넘겨받은 연도를 쓴다", () => {
    expect(readFileName(name, 2026).date).toBe("2026-08-25");
  });

  it("네 자리 연도가 있으면 그것을 쓴다", () => {
    expect(dateFromName("계약서_20260825_최종", 2000)).toBe("2026-08-25");
  });

  it("거래처 후보에서 사업·문서 이름은 뺀다", () => {
    const hints = readFileName(name, 2026);
    expect(hints.partyCandidates).toContain("예시브라이언");
    expect(hints.partyCandidates).not.toContain("틱톡샵");
    expect(hints.partyCandidates).not.toContain("통합계약서");
  });

  it("확장자를 뗀다", () => {
    expect(readFileName("견적서.pdf", 2026).base).toBe("견적서");
  });

  it("날짜가 없으면 null — 지어내지 않는다", () => {
    expect(readFileName("계약서_최종본.pdf", 2026).date).toBeNull();
  });
});

describe("무엇을 읽을 수 있는가", () => {
  it("PDF · 이미지 · 글자 파일", () => {
    expect(classifyFile({ mimetype: "application/pdf" })).toBe("pdf");
    expect(classifyFile({ mimetype: "image/png" })).toBe("image");
    expect(classifyFile({ mimetype: "text/csv" })).toBe("text");
  });

  it("마임타입이 비면 확장자로 본다", () => {
    expect(classifyFile({ filetype: "pdf" })).toBe("pdf");
  });

  it("모르는 형식은 이름만 남긴다", () => {
    expect(classifyFile({ mimetype: "application/zip" })).toBe("unsupported");
  });
});

describe("내려받기 — 조용히 실패하지 않는다", () => {
  const file = {
    name: "계약서.pdf",
    mimetype: "application/pdf",
    url_private_download: "https://files.slack.com/x",
  };

  it("슬랙이 로그인 페이지를 주면 그렇다고 말한다", async () => {
    // 토큰이나 권한이 없으면 슬랙은 200 으로 HTML 을 준다 — 조용히 깨지는 자리다
    const out = await downloadSlackFile(
      file,
      "xoxb",
      async () =>
        new Response("<html>login</html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
    );
    expect("error" in out && out.error).toContain("files:read");
  });

  it("큰 파일은 받지 않는다 — 서버리스 시간과 메모리가 유한하다", async () => {
    const out = await downloadSlackFile(
      { ...file, size: 50 * 1024 * 1024 },
      "xoxb",
      async () => new Response("")
    );
    expect("error" in out && out.error).toContain("큽니다");
  });

  it("주소가 없으면 그렇다고 말한다", async () => {
    const out = await downloadSlackFile({ name: "x.pdf" }, "xoxb");
    expect("error" in out && out.error).toContain("주소가 없습니다");
  });

  it("정상이면 바이트를 준다", async () => {
    const out = await downloadSlackFile(
      file,
      "xoxb",
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/pdf" },
        })
    );
    expect("bytes" in out && out.bytes.length).toBe(3);
  });
});

describe("첨부 내용이 본문과 함께 파싱된다", () => {
  /** 파일을 읽은 척하는 대역 — 테스트가 슬랙도 모델도 부르지 않는다 */
  const fakeRead =
    (text: string | null, reason: string | null = null) =>
    async () => [
      {
        name: "틱톡샵_통합계약서_예시상사_0825.pdf",
        mimetype: "application/pdf",
        size: 1000,
        permalink: null,
        text,
        reason,
      },
    ];

  it("본문에 없는 금액을 첨부에서 읽는다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    await s.collectSlackMessage(
      {
        channel: "C1",
        ts: "1.1",
        text: "<@U1> 부대표님, 계약서 서명 부탁드립니다.",
        user: "U1",
        files: [{ name: "계약서.pdf", mimetype: "application/pdf" }],
      },
      CEO,
      {
        readFiles: fakeRead(
          "기업명: 예시상사\n지출 금액(VAT 포함): 총 10,560,000원\n지출 요청일: 2026-09-30"
        ),
      }
    );

    const intake = (await s.masters(CEO)).intakes[0];
    const parsed = intake.parsed as { amount?: number | null };
    expect(parsed.amount).toBe(10_560_000);
  });

  it("못 읽은 파일은 이유가 원문에 남는다 — 조용히 사라지지 않는다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    await s.collectSlackMessage(
      {
        channel: "C1",
        ts: "2.1",
        text: "<@U1> 계약서 서명 부탁드립니다. 모두싸인 전자계약 올려놓았습니다.",
        user: "U1",
        files: [{ name: "계약서.pdf", mimetype: "application/pdf" }],
      },
      CEO,
      { readFiles: fakeRead(null, "ANTHROPIC_API_KEY 가 없어 읽지 못했습니다") }
    );

    const intake = (await s.masters(CEO)).intakes[0];
    expect(intake.raw).toContain("읽지 못함");
    expect(intake.raw).toContain("ANTHROPIC_API_KEY");
  });

  it("파일 이름에서 뽑은 힌트가 검수함에 남는다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    await s.collectSlackMessage(
      {
        channel: "C1",
        ts: "3.1",
        text: "<@U1> 계약서 서명 부탁드립니다.",
        user: "U1",
        files: [{ name: "계약서.pdf", mimetype: "application/pdf" }],
      },
      CEO,
      { readFiles: fakeRead(null, "형식을 읽지 못합니다") }
    );

    const intake = (await s.masters(CEO)).intakes[0];
    const parsed = intake.parsed as {
      files?: { hints?: { docType?: string | null } }[];
    };
    expect(parsed.files?.[0]?.hints?.docType).toBe("통합계약서");
  });

  it("첨부가 없으면 예전과 똑같이 돈다", async () => {
    const s = new LedgerService(new InMemoryLedgerStore());
    const out = await s.collectSlackMessage(
      {
        channel: "C1",
        ts: "4.1",
        text: "기업명: 예시\n지출 금액(VAT 포함): 총 100,000원\n지출 요청일: 2026-09-30",
        user: "U1",
      },
      CEO
    );
    expect(out.status).toBe("waiting");
  });
});
