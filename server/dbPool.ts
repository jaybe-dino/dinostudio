/**
 * PostgreSQL 연결 — Neon 서버리스 드라이버 (사양서 §15).
 *
 * Neon 은 HTTP 로 질의한다. 그래서 Vercel 이 요청량에 따라 람다를 여러 개 띄워도
 * DB 쪽 연결 슬롯을 잡아 두지 않는다 — MySQL 풀에서 쓰던
 * connectionLimit · idleTimeout 같은 조정이 아예 필요 없다.
 *
 * 대신 HTTP 드라이버는 트랜잭션을 한 요청 안에서만 쓸 수 있다. 이 레포는
 * 물리 삭제가 없고(원칙 9) 쓰기가 단건 upsert 라 지금은 문제가 없지만,
 * 여러 문장을 한 트랜잭션으로 묶어야 하는 작업이 생기면 websocket 드라이버
 * (`drizzle-orm/neon-serverless`)로 바꿔야 한다.
 *
 * 금액은 BIGINT(정수 원)다. Postgres 는 bigint 를 문자열로 돌려주므로 drizzle 의
 * `mode: "number"` 로 숫자로 받는다 — 원화 금액은 2^53 을 넘지 않는다
 * (9,007조 원). 넘을 일이 생기면 그때는 문자열로 받아야 한다.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

export function createDb(url: string) {
  return drizzle(neon(url));
}
