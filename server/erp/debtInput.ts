import { z } from "zod";

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const debtInput = z.object({
  id: z.string().trim().min(1).max(36),
  code: z.string().trim().min(1).max(32),
  creditor: z.string().trim().min(1).max(200),
  principal: money.nullable(),
  rate: z.number().min(0).max(100).multipleOf(0.0001).nullable(),
  maturityDate: z.iso.date().nullable(),
  repayType: z.string().trim().max(60).nullable(),
  isRelatedParty: z.boolean(),
  monthlyInterest: money.nullable(),
  term: z.enum(["단기", "장기"]),
  docUrl: z.url({ protocol: /^https?$/ }).nullable(),
});

export const debtScheduleInput = z
  .object({
    id: z.string().trim().min(1).max(36),
    debtId: z.string().trim().min(1).max(36),
    dueDate: z.iso.date(),
    principal: money,
    interest: money,
  })
  .refine(
    row => row.principal > 0 || row.interest > 0,
    "원금 또는 이자를 입력하십시오"
  );
