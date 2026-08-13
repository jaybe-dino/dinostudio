/**
 * Vercel Serverless Function backing the site's tRPC API (/api/trpc/*).
 *
 * Self-contained on purpose: the original Express/Manus server (server/) needs a
 * long-running process, MySQL, and Manus platform APIs, none of which exist on
 * Vercel by default. This handler covers everything the client actually calls:
 *   - contact.submit  → stores the inquiry (MySQL if DATABASE_URL is set,
 *                       always logged; optional webhook via CONTACT_WEBHOOK_URL)
 *   - auth.me         → anonymous visitor (null)
 *   - auth.logout     → no-op success
 */
import { initTRPC } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { z } from "zod";

const t = initTRPC.create({ transformer: superjson });

const contactInput = z.object({
  name: z.string().min(1).max(100),
  company: z.string().min(1).max(200),
  solution: z.string().optional(),
  message: z.string().optional(),
});

type ContactInput = z.infer<typeof contactInput>;

async function saveToDatabase(input: ContactInput): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection(url);
  try {
    await conn.execute(
      `CREATE TABLE IF NOT EXISTS contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        company VARCHAR(200) NOT NULL,
        solution VARCHAR(100),
        message TEXT,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await conn.execute(
      "INSERT INTO contacts (name, company, solution, message) VALUES (?, ?, ?, ?)",
      [input.name, input.company, input.solution ?? null, input.message ?? null]
    );
    return true;
  } finally {
    await conn.end();
  }
}

async function forwardToWebhook(input: ContactInput): Promise<void> {
  const webhook = process.env.CONTACT_WEBHOOK_URL;
  if (!webhook) return;
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `[디노스튜디오] 새 파트너십 문의\n이름: ${input.name}\n회사: ${input.company}\n솔루션: ${input.solution ?? "-"}\n내용: ${input.message ?? "-"}`,
      ...input,
    }),
  });
}

const appRouter = t.router({
  auth: t.router({
    me: t.procedure.query(() => null),
    logout: t.procedure.mutation(() => ({ success: true }) as const),
  }),
  contact: t.router({
    submit: t.procedure.input(contactInput).mutation(async ({ input }) => {
      // Always visible in Vercel function logs even without a database.
      console.log("[Contact] New inquiry:", JSON.stringify(input));
      try {
        await saveToDatabase(input);
      } catch (e) {
        console.error("[Contact] DB save failed:", e);
      }
      try {
        await forwardToWebhook(input);
      } catch (e) {
        console.error("[Contact] Webhook failed:", e);
      }
      return { success: true };
    }),
  }),
});

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => ({}),
  });

export { handler as GET, handler as POST };
