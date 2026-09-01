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
  /** 입출금 계좌 — 계좌별 잔액·대사의 단위 (docs/erp-qa.md C5) */
  bankAccount: string;
  /** 외화 (A8) — 환율이 없으면 금액을 만들지 않는다 */
  currency: string;
  amountForeign: string;
  fxRate: string;
  /** 원천징수 (A2) */
  incomeType: string;
  withheldAmount: string;
  /** 4대보험 분리 (B6) */
  employeeInsurance: string;
  employerInsurance: string;
  /** 차입 상환의 원금 몫 (C3) */
  principalAmount: string;
  /** 이연 개월 수 (A7) */
  deferralMonths: string;
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
  bankAccount: "",
  currency: "KRW",
  amountForeign: "",
  fxRate: "",
  incomeType: "",
  withheldAmount: "",
  employeeInsurance: "",
  employerInsurance: "",
  principalAmount: "",
  deferralMonths: "",
};

/** 급여 계정 — 4대보험 분리 칸을 여기서만 띄운다 (B6) */
const PAYROLL_ACCOUNTS = ["6110", "6120"];
/** 차입 상환 계정 — 원금 몫 칸을 여기서만 띄운다 (C3) */
const DEBT_ACCOUNTS = ["2210", "2310"];

export function EntryForm({ direction }: { direction?: Direction }) {
  const utils = trpc.useUtils();
  const accounts = trpc.erp.accounts.useQuery();
  const [draft, setDraft] = useState<Draft>({
    ...EMPTY,
    direction: direction ?? "out",
  });
  const [detail, setDetail] = useState(false);
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

  /** 빈 칸은 보내지 않는다 — 0 과 「모른다」는 다르다 (원칙 8) */
  const num = (text: string): number | null => {
    const cleaned = text.replace(/[^0-9.-]/g, "");
    return cleaned === "" ? null : Number(cleaned);
  };

  const foreign = draft.currency !== "KRW";
  const payroll = PAYROLL_ACCOUNTS.includes(draft.accountCode);
  const debtRepayment = DEBT_ACCOUNTS.includes(draft.accountCode);

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
      bankAccount: draft.bankAccount || null,
      // 외화는 서버가 환산한다 — 환율이 없으면 금액을 만들지 않는다 (A8)
      currency: foreign ? draft.currency : null,
      amountForeign: foreign ? num(draft.amountForeign) : null,
      fxRate: foreign ? num(draft.fxRate) : null,
      incomeType: (draft.incomeType || null) as never,
      withheldAmount: num(draft.withheldAmount),
      employeeInsurance: payroll ? num(draft.employeeInsurance) : null,
      employerInsurance: payroll ? num(draft.employerInsurance) : null,
      principalAmount: debtRepayment ? num(draft.principalAmount) : null,
      deferralMonths: num(draft.deferralMonths),
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
          className="btn"
          aria-pressed={detail}
          onClick={() => setDetail(v => !v)}
        >
          {detail ? "상세 닫기" : "상세 (계좌 · 외화 · 원천징수)"}
        </button>
        <button
          type="button"
          className="btn pri"
          disabled={create.isPending || !draft.cashDate}
          onClick={submit}
        >
          원장에 추가
        </button>
      </div>

      {detail ? (
        <div className="filters" style={{ marginTop: 8 }}>
          <label className="field">
            <span>입출금 계좌</span>
            <input
              placeholder="1110-01"
              value={draft.bankAccount}
              onChange={e =>
                setDraft(d => ({ ...d, bankAccount: e.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>통화</span>
            <select
              value={draft.currency}
              onChange={e =>
                setDraft(d => ({ ...d, currency: e.target.value }))
              }
            >
              {["KRW", "USD", "EUR", "JPY", "CNY"].map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {foreign ? (
            <>
              <label className="field">
                <span>외화 금액</span>
                <input
                  inputMode="numeric"
                  value={draft.amountForeign}
                  onChange={e =>
                    setDraft(d => ({ ...d, amountForeign: e.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>환율 (1 {draft.currency} 당 원)</span>
                <input
                  inputMode="decimal"
                  value={draft.fxRate}
                  onChange={e =>
                    setDraft(d => ({ ...d, fxRate: e.target.value }))
                  }
                />
              </label>
            </>
          ) : null}
          <label className="field">
            <span>소득구분 (원천징수)</span>
            <select
              value={draft.incomeType}
              onChange={e =>
                setDraft(d => ({ ...d, incomeType: e.target.value }))
              }
            >
              <option value="">해당 없음</option>
              <option value="사업소득">사업소득 3.3%</option>
              <option value="기타소득">기타소득 8.8%</option>
              <option value="근로소득">근로소득 (실액 입력)</option>
            </select>
          </label>
          {draft.incomeType === "근로소득" || payroll ? (
            <label className="field">
              <span>원천징수액 (실액)</span>
              <input
                inputMode="numeric"
                value={draft.withheldAmount}
                onChange={e =>
                  setDraft(d => ({ ...d, withheldAmount: e.target.value }))
                }
              />
            </label>
          ) : null}
          {payroll ? (
            <>
              <label className="field">
                <span>4대보험 근로자 부담분</span>
                <input
                  inputMode="numeric"
                  value={draft.employeeInsurance}
                  onChange={e =>
                    setDraft(d => ({ ...d, employeeInsurance: e.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>4대보험 사업주 부담분</span>
                <input
                  inputMode="numeric"
                  value={draft.employerInsurance}
                  onChange={e =>
                    setDraft(d => ({ ...d, employerInsurance: e.target.value }))
                  }
                />
              </label>
            </>
          ) : null}
          <label className="field">
            <span>이연 개월 (연간 결제)</span>
            <input
              inputMode="numeric"
              placeholder="12"
              value={draft.deferralMonths}
              onChange={e =>
                setDraft(d => ({ ...d, deferralMonths: e.target.value }))
              }
            />
          </label>
          {debtRepayment ? (
            <label className="field">
              <span>원금 몫 (나머지는 이자)</span>
              <input
                inputMode="numeric"
                value={draft.principalAmount}
                onChange={e =>
                  setDraft(d => ({ ...d, principalAmount: e.target.value }))
                }
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {detail ? (
        <p className="s" style={{ marginTop: 6 }}>
          {foreign
            ? "환율을 비우면 금액을 만들지 않고 판정 대기로 들어갑니다 — 임의 환율로 원장에 넣지 않습니다."
            : payroll
              ? "급여는 급여·사업주부담·예수금 3분할 전표로 생성됩니다. 금액은 통장에서 나간 실지급액을 넣습니다."
              : "여기 값들은 전표를 어떻게 나눌지 정합니다 — 비워 두면 나누지 않습니다."}
        </p>
      ) : null}

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
