/**
 * 증빙 (§6.3 attachment · §13.2)
 *
 * "증빙이 없는 건은 보류까지만 가능하고 확정되지 않습니다" — 그 규칙이 실제로 작동하려면
 * 증빙을 **올릴 수 있어야** 한다. 두 경로를 함께 받는다.
 *   · 파일 업로드 — S3 호환 스토리지에 presigned PUT으로 올린다
 *   · 링크 등록 — 드라이브 계약서처럼 원본이 밖에 있는 것 (§11.2)
 *
 * 스토리지가 설정되지 않은 환경에서는 링크 등록만 열어 둔다. 파일을 받을 수 없는데
 * 받은 것처럼 보이면 증빙 규칙이 명예 규정이 된다.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const ATTACHMENT_KINDS = ["계산서", "영수증", "계약서", "이체확인증", "기타"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** §14 — 증빙은 스캔본이라 크지 않다. 20MB를 넘으면 원본 링크를 쓰게 한다. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/webp",
]);

export function storageConfigured(): boolean {
  return Boolean(
    process.env.ERP_S3_BUCKET &&
      process.env.ERP_S3_REGION &&
      process.env.ERP_S3_ACCESS_KEY_ID &&
      process.env.ERP_S3_SECRET_ACCESS_KEY
  );
}

let client: S3Client | null = null;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.ERP_S3_REGION,
      ...(process.env.ERP_S3_ENDPOINT ? { endpoint: process.env.ERP_S3_ENDPOINT, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: process.env.ERP_S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.ERP_S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return client;
}

export interface UploadTicket {
  /** 브라우저가 PUT으로 파일을 올릴 주소 */
  uploadUrl: string;
  /** 원장에 저장할 열람 키 */
  key: string;
  expiresInSeconds: number;
}

export function validateUpload(fileName: string, contentType: string, sizeBytes: number): string | null {
  if (!fileName.trim()) return "파일명이 없습니다";
  if (sizeBytes <= 0) return "빈 파일입니다";
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return `파일이 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB를 넘습니다 — 원본 링크로 등록하십시오`;
  }
  if (!ALLOWED_TYPES.has(contentType)) {
    return `${contentType} 형식은 증빙으로 받지 않습니다 (PDF · PNG · JPEG · HEIC · WEBP)`;
  }
  return null;
}

/** 파일명을 그대로 키로 쓰지 않는다 — 경로 조작과 한글 인코딩 문제를 피한다 */
export function storageKey(entryCode: string, fileName: string, id: string): string {
  const ext = /\.([a-z0-9]{1,6})$/i.exec(fileName)?.[1]?.toLowerCase() ?? "bin";
  return `erp/evidence/${entryCode}/${id}.${ext}`;
}

export async function createUploadTicket(
  entryCode: string,
  fileName: string,
  contentType: string,
  id: string
): Promise<UploadTicket> {
  const key = storageKey(entryCode, fileName, id);
  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: process.env.ERP_S3_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 600 }
  );
  return { uploadUrl, key, expiresInSeconds: 600 };
}

/** 열람은 서버를 거쳐서만 — 버킷을 공개하지 않는다 (§14 외부 공유 링크 금지) */
export function viewPath(key: string): string {
  return `/api/erp/evidence?key=${encodeURIComponent(key)}`;
}
