/**
 * 지출·수입 직접 추가 — 어느 화면에서 넣어도 같은 원장에 들어간다 (원칙 12).
 * 추가된 건은 승인 대기로 들어가고, 승인해야 합계에 반영된다 (원칙 7).
 * 중복 의심은 경고 후 강행할 수 있고 강행 사유가 감사로그에 남는다 (§13.2).
 */
import type { Direction, Nature, PayMethod } from "@shared/erp";
import { defaultPriorityOf, kstToday } from "@shared/erp";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Note, PriorityChip } from "./Bits";

const NATURES: Nature[] = [
  "통과원가",
  "직접원가",
  "공통배부",
  "해당없음",
  "손익아님",
  "미지정",
];
const PAY_METHODS: PayMethod[] = ["계좌", "법인카드", "개인카드선결제", "현금"];
const BUS = ["IP", "NET", "COM", "GLV", "CMN"] as const;

// §14 — 일자 경계는 00:00 KST
const today = () => kstToday();

interface Draft {
  direction: Direction;
  title: string;
  amount: string;
  cashDate: string;
  accountCode: string;
  nature: Nature;
  buCode: string;
  projectId: string;
  payMethod: PayMethod;
  hasEvidence: boolean;
  noteRaw: string;
}

const EMPTY: Draft = {
  direction: "out",
  title: "",
  amount: "",
  cashDate: today(),
  accountCode: "",
  nature: "미지정",
  buCode: "",
  projectId: "",
  payMethod: "계좌",
  hasEvidence: false,
  noteRaw: "",
};

export function EntryForm({ direction }: { direction?: Direction }) {
  const utils = trpc.useUtils();
  const accounts = trpc.erp.accounts.useQuery();
  const [draft, setDraft] = useState<Draft>({
    ...EMPTY,
    direction: direction ?? "out",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const create = trpc.erp.entries.create.useMutation({
    onSuccess: async result => {
      setMessage(
        `${result.entry.code} 추가됨 — 승인 대기 상태입니다. 승인해야 합계에 들어갑니다.`
      );
      setDuplicateWarning(null);
      setOverrideReason("");
      setDraft({
        ...EMPTY,
        direction: draft.direction,
        cashDate: draft.cashDate,
      });
      await Promise.all([
        utils.erp.entries.invalidate(),
        utils.erp.views.invalidate(),
      ]);
    },
    onError: error => {
      setMessage(null);
      // §10.3 duplicate_suspected — 경고 후 강행 가능
      if (
        error.message.includes("7일 이내") ||
        error.message.includes("중복 수집")
      ) {
        setDuplicateWarning(error.message);
      } else {
        setMessage(error.message);
      }
    },
  });

  const amountValue = draft.amount.replace(/[^0-9-]/g, "");
  const parsedAmount = amountValue === "" ? null : Number(amountValue);
  const autoPriority =
    draft.direction === "in"
      ? null
      : defaultPriorityOf(draft.accountCode || null);

  const submit = () => {
    create.mutate({
      direction: draft.direction,
      title: draft.title,
      // 금액을 비우면 판정 대기로 들어간다 — 추정치로 메우지 않는다 (원칙 8)
      amount: parsedAmount,
      cashDate: draft.cashDate,
      accountCode: draft.accountCode || null,
      nature: draft.nature,
      buCode: (draft.buCode || null) as never,
      projectId: draft.projectId || null,
      payMethod: draft.payMethod,
      hasEvidence: draft.hasEvidence,
      noteRaw: draft.noteRaw || null,
      duplicateOverrideReason: overrideReason.trim() || undefined,
    });
  };

  return (
    <div>
      <div className="filters">
        {!direction ? (
          <label className="field">
            <span>방향</span>
            <select
              value={draft.direction}
              onChange={e =>
                setDraft(d => ({
                  ...d,
                  direction: e.target.value as Direction,
                }))
              }
            >
              <option value="out">지출</option>
              <option value="in">수입</option>
            </select>
          </label>
        ) : null}
        <label className="field" style={{ flex: "1 1 200px" }}>
          <span>항목 (비우면 판정 대기)</span>
          <input
            value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>계정과목</span>
          <select
            value={draft.accountCode}
            onChange={e =>
              setDraft(d => ({ ...d, accountCode: e.target.value }))
            }
          >
            <option value="">미지정</option>
            {(accounts.data ?? []).map(a => (
              <option key={a.code} value={a.code}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>원가성격</span>
          <select
            value={draft.nature}
            onChange={e =>
              setDraft(d => ({ ...d, nature: e.target.value as Nature }))
            }
          >
            {NATURES.map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>금액 (원 · 비우면 판정 대기)</span>
          <input
            inputMode="numeric"
            value={draft.amount}
            onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>입출금일</span>
          <input
            type="date"
            value={draft.cashDate}
            onChange={e => setDraft(d => ({ ...d, cashDate: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>사업부</span>
          <select
            value={draft.buCode}
            onChange={e => setDraft(d => ({ ...d, buCode: e.target.value }))}
          >
            <option value="">미지정</option>
            {BUS.map(b => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>프로젝트</span>
          <input
            placeholder="PRJ-0132"
            value={draft.projectId}
            onChange={e => setDraft(d => ({ ...d, projectId: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>수단</span>
          <select
            value={draft.payMethod}
            onChange={e =>
              setDraft(d => ({ ...d, payMethod: e.target.value as PayMethod }))
            }
          >
            {PAY_METHODS.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>증빙</span>
          <select
            value={draft.hasEvidence ? "y" : "n"}
            onChange={e =>
              setDraft(d => ({ ...d, hasEvidence: e.target.value === "y" }))
            }
          >
            <option value="n">없음</option>
            <option value="y">있음</option>
          </select>
        </label>
        <label className="field" style={{ flex: "1 1 180px" }}>
          <span>적요 원문</span>
          <input
            value={draft.noteRaw}
            onChange={e => setDraft(d => ({ ...d, noteRaw: e.target.value }))}
          />
        </label>
        <div className="field">
          <span>자동 우선순위</span>
          <div style={{ paddingTop: 4 }}>
            <PriorityChip priority={autoPriority} />
          </div>
        </div>
        <button
          type="button"
          className="btn pri"
          disabled={create.isPending || !draft.cashDate}
          onClick={submit}
        >
          원장에 추가
        </button>
      </div>

      {duplicateWarning ? (
        <div style={{ marginTop: 10 }}>
          <Note tone="warn">{duplicateWarning}</Note>
          <div className="filters" style={{ marginTop: 6 }}>
            <label className="field" style={{ flex: "1 1 260px" }}>
              <span>강행 사유 (감사로그에 남습니다)</span>
              <input
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={!overrideReason.trim() || create.isPending}
              onClick={submit}
            >
              확인했습니다 · 그대로 추가
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setDuplicateWarning(null)}
            >
              취소
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <div style={{ marginTop: 10 }}>
          <Note>{message}</Note>
        </div>
      ) : null}

      <p className="s" style={{ marginTop: 8 }}>
        증빙이 없는 건은 승인해도 확정되지 않습니다. 계정을 비우면 전표가
        생성되지 않아 손익·재무제표에서 빠집니다.
      </p>
    </div>
  );
}
