import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { systemRouter } from "./_core/systemRouter.js";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc.js";
import { createContact, listContacts } from "./db.js";
import { notifyOwner } from "./_core/notification.js";

export const appRouter = router({
  system: systemRouter,
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
        await createContact({
          name: input.name,
          company: input.company,
          solution: input.solution ?? null,
          message: input.message ?? null,
        });
        try {
          await notifyOwner({
            title: `[디노스튜디오] 새 파트너십 문의: ${input.company}`,
            content: `이름: ${input.name}\n회사: ${input.company}\n솔루션: ${input.solution ?? "-"}\n내용: ${input.message ?? "-"}`,
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
