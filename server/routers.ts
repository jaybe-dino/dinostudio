import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { systemRouter } from "./_core/systemRouter.js";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc.js";
import { createContact, listContacts } from "./db.js";
import { notifyOwner } from "./_core/notification.js";
import { erpRouter } from "./erp/router.js";

export const appRouter = router({
  system: systemRouter,
  /** 경영관리 시스템 1차 오픈 (개발 사양서 §10.1) */
  erp: erpRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  contact: router({
    submit: publicProcedure
      .input(
        z.object({
          name: z.string().min(1).max(100),
          company: z.string().min(1).max(200),
          solution: z.string().optional(),
          message: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const summary = `이름: ${input.name}\n회사: ${input.company}\n솔루션: ${input.solution ?? "-"}\n내용: ${input.message ?? "-"}`;

        // 문의는 어떤 경우에도 잃지 않는다 — DB가 없어도 로그에는 남는다.
        console.log("[Contact] 새 파트너십 문의:", JSON.stringify(input));

        try {
          await createContact({
            name: input.name,
            company: input.company,
            solution: input.solution ?? null,
            message: input.message ?? null,
          });
        } catch (e) {
          // 저장 실패로 방문자에게 오류를 보여주지 않는다. 로그와 웹훅으로 남는다.
          console.error("[Contact] DB 저장 실패:", e);
        }

        const webhook = process.env.CONTACT_WEBHOOK_URL;
        if (webhook) {
          try {
            await fetch(webhook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: `[디노스튜디오] 새 파트너십 문의\n${summary}`,
                ...input,
              }),
            });
          } catch (e) {
            console.warn("[Contact] 웹훅 전달 실패:", e);
          }
        }

        try {
          await notifyOwner({
            title: `[디노스튜디오] 새 파트너십 문의: ${input.company}`,
            content: summary,
          });
        } catch (e) {
          console.warn("[Notify] Failed to send notification:", e);
        }
        return { success: true };
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") return [];
      return listContacts();
    }),
  }),
});

export type AppRouter = typeof appRouter;
