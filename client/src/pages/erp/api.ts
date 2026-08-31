/** tRPC 응답 타입 — 화면이 서버 계약을 그대로 따라가도록 라우터에서 추론한다. */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

export type ErpOutputs = inferRouterOutputs<AppRouter>["erp"];
