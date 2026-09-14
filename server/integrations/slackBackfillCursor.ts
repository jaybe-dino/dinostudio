interface Position {
  page: string | null;
  index: number;
  latest?: string;
}

const PREFIX = "erp-page-v1:";

export function encodeBackfillCursor(position: Position): string {
  return PREFIX + Buffer.from(JSON.stringify(position)).toString("base64url");
}

export function decodeBackfillCursor(cursor: string | null): Position {
  if (!cursor?.startsWith(PREFIX)) return { page: cursor, index: 0 };
  const value = JSON.parse(
    Buffer.from(cursor.slice(PREFIX.length), "base64url").toString()
  );
  if (
    !value ||
    (value.page !== null && typeof value.page !== "string") ||
    !Number.isSafeInteger(value.index) ||
    value.index < 0 ||
    typeof value.latest !== "string" ||
    !/^\d+(\.\d+)?$/.test(value.latest)
  )
    throw new Error(
      "수집 진행 위치가 올바르지 않습니다. 처음부터 다시 가져오십시오."
    );
  return value;
}
