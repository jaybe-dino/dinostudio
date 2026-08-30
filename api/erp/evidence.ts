/**
 * GET /api/erp/evidence?key= — 증빙 파일 열람.
 *
 * 버킷을 공개하지 않는다. 로그인한 사용자에게만 짧은 수명의 서명 URL로 넘긴다 —
 * §14가 "외부 공유 링크 기능을 만들지 않습니다"라고 못박고 있다.
 */
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  SESSION_COOKIE,
  parseCookies,
  verifySessionToken,
} from "../../server/auth/session.js";
import { resolveErpRole } from "../../server/erp/index.js";
import { storageConfigured } from "../../server/erp/attachments.js";

export async function GET(req: Request): Promise<Response> {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  const session = token ? await verifySessionToken(token) : null;
  if (!session) return new Response("로그인이 필요합니다", { status: 401 });
  if (!resolveErpRole(session.email))
    return new Response("역할이 지정되지 않았습니다", { status: 403 });

  const key = new URL(req.url).searchParams.get("key");
  if (!key || !key.startsWith("erp/evidence/"))
    return new Response("잘못된 요청", { status: 400 });
  if (!storageConfigured())
    return new Response("스토리지가 설정되지 않았습니다", { status: 503 });

  const client = new S3Client({
    region: process.env.ERP_S3_REGION,
    ...(process.env.ERP_S3_ENDPOINT
      ? { endpoint: process.env.ERP_S3_ENDPOINT, forcePathStyle: true }
      : {}),
    credentials: {
      accessKeyId: process.env.ERP_S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.ERP_S3_SECRET_ACCESS_KEY ?? "",
    },
  });

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: process.env.ERP_S3_BUCKET, Key: key }),
    { expiresIn: 120 }
  );
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}
