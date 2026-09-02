import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: ["./drizzle/schema.ts", "./drizzle/erpSchema.ts"],
  out: "./drizzle",
  // 사양서 §15 의 권고안. Neon 이 PostgreSQL 이다
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
