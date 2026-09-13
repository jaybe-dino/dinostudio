/**
 * 슬랙에 붙은 파일 — 내려받기.
 *
 * 계약서 PDF, 견적서, 캡처 이미지가 메시지에 붙어 온다. **본문만 읽으면
 * 그것들이 통째로 사라진다.**
 *
 * 지키는 것
 *   · 파일 내용은 봇 토큰으로만 받는다 (`files:read` 권한 필요). 공개 URL 이
 *     아니다 — 토큰 없이 받으면 로그인 HTML 이 온다
 *   · **크기 상한을 둔다.** 서버리스 함수의 메모리와 시간이 유한하고, 모델에
 *     보낼 수 있는 크기도 유한하다. 넘치면 받지 않고 그렇다고 적는다
 *   · 못 받아도 **메타데이터는 남긴다** — 파일 이름만으로도 거래처·날짜·문서
 *     종류를 알 수 있다
 */

export interface SlackFileMeta {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private_download?: string;
  url_private?: string;
  permalink?: string;
}

/** 모델에 보낼 수 있는 상한. base64 로 늘어나는 것까지 감안한 값이다 */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** 지금 읽을 수 있는 것 — 그 밖은 이름만 남긴다 */
export const READABLE = {
  text: [
    "text/plain",
    "text/csv",
    "text/markdown",
    "application/json",
    "text/tab-separated-values",
  ],
  pdf: ["application/pdf"],
  image: ["image/png", "image/jpeg", "image/gif", "image/webp"],
} as const;

export type FileClass = "text" | "pdf" | "image" | "unsupported";

export function classifyFile(file: SlackFileMeta): FileClass {
  const mime = (file.mimetype ?? "").toLowerCase();
  if ((READABLE.text as readonly string[]).includes(mime)) return "text";
  if ((READABLE.pdf as readonly string[]).includes(mime)) return "pdf";
  if ((READABLE.image as readonly string[]).includes(mime)) return "image";
  // 마임타입이 비어 오는 경우가 있어 확장자도 본다
  const type = (file.filetype ?? "").toLowerCase();
  if (type === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(type)) return "image";
  if (["text", "csv", "markdown", "json", "tsv"].includes(type)) return "text";
  return "unsupported";
}

export interface DownloadedFile {
  bytes: Uint8Array;
  mimetype: string;
}

export type DownloadFailure = { error: string };

/**
 * 파일 내용을 받아 온다.
 *
 * 슬랙의 `url_private_download` 는 **봇 토큰이 있어야** 실제 파일을 준다.
 * 토큰이 없거나 권한이 없으면 로그인 페이지 HTML 이 200 으로 오므로,
 * 받은 것이 정말 그 파일인지 Content-Type 으로 한 번 더 본다.
 */
export async function downloadSlackFile(
  file: SlackFileMeta,
  token: string,
  doFetch: typeof fetch = fetch
): Promise<DownloadedFile | DownloadFailure> {
  const url = file.url_private_download ?? file.url_private;
  if (!url) return { error: "내려받을 주소가 없습니다" };
  if (file.size != null && file.size > MAX_FILE_BYTES)
    return {
      error: `파일이 큽니다 (${Math.round(file.size / 1024 / 1024)}MB) — ${MAX_FILE_BYTES / 1024 / 1024}MB 까지만 읽습니다`,
    };

  let response: Response;
  try {
    response = await doFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "내려받지 못했습니다",
    };
  }

  if (!response.ok)
    return { error: `내려받지 못했습니다 (HTTP ${response.status})` };

  const contentType = (
    response.headers.get("content-type") ?? ""
  ).toLowerCase();
  if (contentType.includes("text/html"))
    return {
      error:
        "슬랙이 파일 대신 로그인 페이지를 돌려줬습니다 — 앱에 files:read 권한을 추가하고 재설치하십시오",
    };

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_FILE_BYTES)
    return {
      error: `파일이 큽니다 (${Math.round(buffer.byteLength / 1024 / 1024)}MB)`,
    };

  return {
    bytes: new Uint8Array(buffer),
    mimetype:
      file.mimetype ?? contentType.split(";")[0] ?? "application/octet-stream",
  };
}
