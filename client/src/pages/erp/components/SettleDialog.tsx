/**
 * 실제 입출금 확인 — **승인과 다른 동작이다.**
 *
 * 이 화면이 하는 일은 「이체를 실행」하는 것이 아니라 **이미 통장에서 움직인
 * 것을 기록**하는 것이다. 그 구분이 흐려지면 사람이 여기서 돈이 나갈 거라고
 * 생각하고 누르게 된다 — 문구가 계속 그 말을 한다.
 *
 * 부분 지급을 기본으로 지원한다. 절반만 나간 건을 전액 확인해 버리면 남은
 * 절반이 집행대기에서 사라져 그대로 연체된다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { won } from "../format";
import { Note } from "./Bits";

export function SettleDialog({
  code,
  onClose,
  onDone,
}: {
  code: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const entry = trpc.erp.entries.get.useQuery({ code });
  const view = trpc.erp.entries.settlements.useQuery({ code });
  const utils = trpc.useUtils();

  const remaining = view.data?.summary.remaining ?? null;
  const [amount, setAmount] = useState<string>("");
  const [settledOn, setSettledOn] = useState<string>("");
  const [bankRef, setBankRef] = useState("");
  const [note, setNote] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settle = trpc.erp.entries.settle.useMutation({
    onSuccess: async () => {
      await utils.erp.invalidate();
      onDone();
    },
    onError: e => {
      setError(e.message);
      // 「같은 날 같은 금액」은 되물으면 통과시킬 수 있는 종류다
      if (e.message.includes("이미 확인돼 있습니다")) setAllowDuplicate(true);
    },
  });

  const voidOne = trpc.erp.entries.voidSettlement.useMutation({
    onSuccess: async () => {
      await utils.erp.invalidate();
      await view.refetch();
    },
    onError: e => setError(e.message),
  });

  // 비워 두면 남은 금액 전액. 대부분은 그게 맞고, 부분일 때만 고쳐 넣는다
  const effective = amount.trim()
    ? Number(amount.replace(/[^\d]/g, ""))
    : (remaining ?? 0);

  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal">
        <h3 style={{ marginTop: 0 }}>입출금 확인 · {code}</h3>
        <Note>
          <b>이미 통장에서 움직인 것을 기록합니다.</b> 이 버튼이 이체를 실행하지
          않습니다. 통장·카드 내역을 보고 누르십시오.
        </Note>

        {entry.data ? (
          <p className="s" style={{ margin: "10px 0" }}>
            {entry.data.entry.title} · 건 금액{" "}
            {entry.data.entry.amount == null
              ? "판정 대기"
              : won(entry.data.entry.amount)}
            {view.data && view.data.summary.settled > 0 ? (
              <>
                {" "}
                · 이미 확인 {won(view.data.summary.settled)} ·{" "}
                <b>남은 금액 {won(remaining ?? 0)}</b>
              </>
            ) : null}
          </p>
        ) : null}

        <div className="filters" style={{ marginTop: 8 }}>
          <label className="field">
            <span>실제 입출금일</span>
            <input
              id="settle-on"
              type="date"
              value={settledOn}
              onChange={e => setSettledOn(e.target.value)}
            />
          </label>
          <label className="field">
            <span>금액 (비우면 남은 금액 전액)</span>
            <input
              id="settle-amount"
              inputMode="numeric"
              placeholder={remaining == null ? "" : String(remaining)}
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          </label>
          <label className="field" style={{ flex: "1 1 240px" }}>
            <span>은행 거래번호 (있으면)</span>
            <input
              id="settle-ref"
              value={bankRef}
              onChange={e => setBankRef(e.target.value)}
              placeholder="같은 출금을 두 번 잡지 않게 해 줍니다"
            />
          </label>
          <label className="field" style={{ flex: "1 1 240px" }}>
            <span>메모</span>
            <input
              id="settle-note"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </label>
        </div>

        {allowDuplicate ? (
          <label
            className="s"
            style={{ display: "block", marginTop: 8 }}
            htmlFor="settle-dup"
          >
            <input
              id="settle-dup"
              type="checkbox"
              checked={allowDuplicate}
              onChange={e => setAllowDuplicate(e.target.checked)}
            />{" "}
            같은 날 같은 금액을 <b>정말 두 번</b> 보냈습니다
          </label>
        ) : null}

        {error ? (
          <div style={{ marginTop: 10 }}>
            <Note tone="warn">{error}</Note>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn pri"
            disabled={
              settle.isPending ||
              !settledOn ||
              effective <= 0 ||
              entry.data == null
            }
            onClick={() => {
              setError(null);
              settle.mutate({
                code,
                version: entry.data!.entry.version,
                settledOn,
                amount: effective,
                bankRef: bankRef.trim() || null,
                note: note.trim() || null,
                allowDuplicate,
              });
            }}
          >
            {settle.isPending ? "기록하는 중…" : "확인 기록"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
        </div>

        {view.data && view.data.rows.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <div className="s" style={{ marginBottom: 6 }}>
              확인 이력 — 취소해도 줄은 남습니다 (원칙 9)
            </div>
            <table>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th className="n">금액</th>
                  <th>거래번호</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {view.data.rows.map(row => (
                  <tr key={row.id}>
                    <td className="nw">{row.settledOn}</td>
                    <td className="n">{won(row.amount)}</td>
                    <td className="s">{row.bankRef ?? "—"}</td>
                    <td className="nw">
                      {row.voidedAt ? (
                        <span className="s">취소됨 · {row.voidReason}</span>
                      ) : (
                        <button
                          type="button"
                          className="btn"
                          disabled={voidOne.isPending}
                          onClick={() => {
                            const reason = window.prompt(
                              "취소 사유를 적으십시오 — 잔액이 왜 바뀌었는지 남아야 합니다"
                            );
                            if (!reason?.trim()) return;
                            setError(null);
                            voidOne.mutate({
                              settlementId: row.id,
                              reason: reason.trim(),
                            });
                          }}
                        >
                          취소
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
