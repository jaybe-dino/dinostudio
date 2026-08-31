/**
 * MySQL 연결 — 서버리스 기준으로 잡는다.
 *
 * `drizzle(url)`은 connectionLimit 기본값 10짜리 풀을 만든다. Vercel은 요청이 몰리면
 * 람다 인스턴스를 여러 개 띄우므로 인스턴스마다 10개씩 잡으면 DB의 최대 연결 수를 금방 넘긴다
 * (TiDB Serverless · RDS t4g.micro 모두 수십 개 수준). 인스턴스당 소수만 쓰고 놀면 닫는다.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

export const SERVERLESS_POOL_LIMIT = 2;

export function createPool(url: string) {
  return mysql.createPool({
    uri: url,
    connectionLimit: SERVERLESS_POOL_LIMIT,
    // 놀고 있는 연결을 오래 붙잡지 않는다 — 람다가 얼어붙은 동안 DB 쪽 슬롯을 낭비하지 않기 위해
    idleTimeout: 30_000,
    maxIdle: 1,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    // 회계 금액은 BIGINT다. 자바스크립트 안전 정수를 넘으면 문자열로 받아 반올림 손실을 막는다.
    supportBigNumbers: true,
    bigNumberStrings: false,
    timezone: "+09:00",
  });
}

export function createDb(url: string) {
  return drizzle(createPool(url));
}
