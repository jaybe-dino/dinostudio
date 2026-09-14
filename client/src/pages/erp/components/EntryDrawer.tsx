/**
 * 집행원장 코드 상세 — 전 화면에서 코드를 누르면 열린다.
 * 적요 원문 · 3축 · 연결 · 이력 · 확인/반려/보류 · 우선순위 상향까지 여기서 끝낸다.
 * 삭제는 없다 — 취소 전표(-C) 상계만 안내한다 (원칙 9).
 */
import { PRIORITIES, accountLabel, type Priority } from "@shared/erp";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { shortDate } from "../format";
import { Money, PriorityChip, StatusChip } from "./Bits";
import { Evidence } from "./Evidence";

export function EntryDrawer({
  code,
  onClose,
}: {
  code: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const detail = trpc.erp.entries.get.useQuery({ code });
  const me = trpc.erp.me.useQuery();
  const [amountText, setAmountText] = useState("");
  const [amountReason, setAmountReason] = useState("");
  const [savedNote, setSavedNote] = useState<string | null>(null);
  useEffect(() => {
    setAmountText("");
    setAmountReason("");
    setSavedNote(null);
  }, [code]);
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    setReason("");
    await Promise.all([
      utils.erp.entries.invalidate(),
      utils.erp.views.invalidate(),
      utils.erp.audit.invalidate(),
    ]);
  };
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "처리에 실패했습니다");

  const approve = trpc.erp.entries.approve.useMutation({
    onSuccess: refresh,
    onError: fail,
  });
  const reject = trpc.erp.entries.reject.useMutation({
    onSuccess: refresh,
    onError: fail,
  });
  const hold = trpc.erp.entries.hold.useMutation({
    onSuccess: refresh,
    onError: fail,
  });
  const cancel = trpc.erp.entries.cancel.useMutation({
    onSuccess: refresh,
    onError: fail,
  });
  const setPriorityOverride = trpc.erp.entries.setPriority.useMutation({
    onSuccess: refresh,
    onError: fail,
  });

  const patch = trpc.erp.entries.patch.useMutation({
    onSuccess: async () => {
      await refresh();
      setAmountText("");
      setAmountReason("");
      setSavedNote(
        "금액을 저장했습니다. 승인 대기 상태에서 증빙과 계정과목을 확인하십시오."
      );
    },
    onError: fail,
  });

  const busy =
    patch.isPending ||
    approve.isPending ||
    reject.isPending ||
    hold.isPending ||
    cancel.isPending ||
    setPriorityOverride.isPending;
  const entry = detail.data?.entry;

  return (
    <>
      {/* 조건부 렌더이므로 프로토타입의 .on 을 항상 붙인다 (기본이 숨김) */}
      <div className="scrim on" onClick={onClose} />
      <aside className="drawer on" role="dialog" aria-label={`${code} 상세`}>
        <div className="drawer-h">
          <b className="m">{code}</b>
          <button
            type="button"
            className="ico x"
            onClick={onClose}
            aria-label="닫기"
            style={{ marginLeft: "auto" }}
          >
            ×
          </button>
        </div>

        <div className="drawer-b">
          {detail.isLoading ? <p className="s">불러오는 중…</p> : null}
          {detail.error ? (
            <div className="alertbox">{detail.error.message}</div>
          ) : null}

          {entry ? (
            <>
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>
                  {entry.title || "(항목명 없음)"}
                </h3>
                <StatusChip status={entry.status} />{" "}
                <PriorityChip
                  priority={detail.data!.priorityEff}
                  overridden={entry.priorityOverride != null}
                />
                {entry.masked ? (
                  <span className="chip n" style={{ marginLeft: 6 }}>
                    마스킹
                  </span>
                ) : null}
              </div>

              {entry.masked && entry.maskReason ? (
                <p className="note">{entry.maskReason}</p>
              ) : null}
              {entry.undecidedReason ? (
                <p className="alertbox">
                  판정 대기 사유 — {entry.undecidedReason}
                </p>
              ) : null}

              <dl className="f2">
                <dt>금액</dt>
                <dd>
                  <Money value={entry.amount} reason={entry.undecidedReason} />
                  {entry.amount == null && entry.amountCandidate != null ? (
                    <span className="s">
                      {" "}
                      · 적요칸 후보{" "}
                      {entry.amountCandidate.toLocaleString("ko-KR")}
                    </span>
                  ) : null}
                </dd>
                <dt>적요 원문</dt>
                <dd>{entry.noteRaw ?? <span className="s">—</span>}</dd>
                <dt>입출금일</dt>
                <dd>{entry.cashDate ?? "—"}</dd>
                <dt>손익 귀속일</dt>
                <dd>{entry.accrualDate ?? "—"}</dd>
                <dt>계정과목</dt>
                <dd>{accountLabel(entry.accountCode)}</dd>
                <dt>원가성격</dt>
                <dd>{entry.nature ?? "미지정"}</dd>
                <dt>귀속</dt>
                <dd>
                  {entry.buCode ?? "미지정"} ·{" "}
                  {entry.projectId ?? "프로젝트 미지정"}
                </dd>
                <dt>결제수단</dt>
                <dd>{entry.payMethod ?? "—"}</dd>
                <dt>증빙</dt>
                <dd>
                  {entry.hasEvidence ? (
                    "있음"
                  ) : (
                    <span style={{ color: "var(--alert)" }}>없음</span>
                  )}
                </dd>
                <dt>수집 경로</dt>
                <dd>
                  {entry.source}
                  {entry.sourceRef ? ` · ${entry.sourceRef}` : ""}
                </dd>
                <dt>버전</dt>
                <dd>v{entry.version}</dd>
              </dl>

              {!entry.masked &&
              ["대표", "재무"].includes(me.data?.role ?? "") &&
              (entry.status === "undecided" || entry.status === "pending") ? (
                <form
                  onSubmit={event => {
                    event.preventDefault();
                    const cleaned = amountText.replace(/,/g, "").trim();
                    const amount = Number(cleaned);
                    if (
                      !/^\d+$/.test(cleaned) ||
                      !Number.isSafeInteger(amount) ||
                      amount <= 0
                    ) {
                      setError("원 단위의 0보다 큰 정수를 입력하십시오.");
                      return;
                    }
                    if (!amountReason.trim()) {
                      setError("금액을 확인한 근거를 입력하십시오.");
                      return;
                    }
                    patch.mutate({
                      code,
                      version: entry.version,
                      patch: { amount },
                      reason: amountReason.trim(),
                    });
                  }}
                >
                  <h4>금액 보완</h4>
                  <p className="s">
                    원문·증빙에서 확인한 원 단위 금액을 입력합니다. 저장 후에도
                    승인은 별도로 필요합니다.
                  </p>
                  <label className="field">
                    <span>확인한 금액 (원)</span>
                    <input
                      inputMode="numeric"
                      value={amountText}
                      onChange={e => setAmountText(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label className="field">
                    <span>금액 확인 근거</span>
                    <textarea
                      rows={2}
                      value={amountReason}
                      onChange={e => setAmountReason(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn pri"
                    disabled={
                      busy || !amountText.trim() || !amountReason.trim()
                    }
                  >
                    금액 저장
                  </button>
                  {savedNote ? (
                    <p role="status" className="note">
                      {savedNote}
                    </p>
                  ) : null}
                </form>
              ) : null}

              {detail.data!.duplicates.length > 0 ? (
                <p className="note">
                  중복 의심 —{" "}
                  {detail
                    .data!.duplicates.map(
                      d => `${d.code} (${d.daysApart}일 차)`
                    )
                    .join(" · ")}
                </p>
              ) : null}

              {detail.data!.related.length > 0 ? (
                <p className="note">
                  연결 —{" "}
                  {detail
                    .data!.related.map(r => `${r.code} (${r.status})`)
                    .join(" · ")}
                </p>
              ) : null}

              <div>
                <h4
                  style={{
                    margin: "0 0 6px",
                    fontSize: 12.5,
                    color: "var(--muted)",
                  }}
                >
                  처리
                </h4>
                <label className="field">
                  <span>사유 (반려·보류·취소·등급 상향에 필수)</span>
                  <textarea
                    rows={2}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                  />
                </label>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginTop: 8,
                  }}
                >
                  <button
                    type="button"
                    className="btn pri"
                    disabled={busy || entry.status !== "pending"}
                    onClick={() =>
                      approve.mutate({ code, version: entry.version })
                    }
                  >
                    승인 · 확정
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      reject.mutate({ code, version: entry.version, reason })
                    }
                  >
                    반려
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      hold.mutate({ code, version: entry.version, reason })
                    }
                  >
                    보류
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={
                      busy || !reason.trim() || entry.status !== "confirmed"
                    }
                    onClick={() =>
                      cancel.mutate({ code, version: entry.version, reason })
                    }
                    title="물리 삭제는 없습니다 — 취소 전표(-C)로 상계합니다"
                  >
                    취소 전표 생성
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    alignItems: "flex-end",
                    marginTop: 10,
                  }}
                >
                  <label className="field">
                    <span>우선순위 상향</span>
                    <select
                      value={priority}
                      onChange={e =>
                        setPriority(e.target.value as Priority | "")
                      }
                    >
                      <option value="">계정 기본값 사용</option>
                      {PRIORITIES.map(p => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || (priority !== "" && !reason.trim())}
                    onClick={() =>
                      setPriorityOverride.mutate({
                        code,
                        version: entry.version,
                        priority: priority === "" ? null : priority,
                        reason: priority === "" ? null : reason,
                      })
                    }
                  >
                    등급 저장
                  </button>
                </div>
                <p className="s" style={{ marginTop: 6 }}>
                  계정 기본값은 지우지 않고 override만 덮어씁니다. 등급을 올리면
                  사유가 원장에 남습니다.
                </p>
              </div>

              {error ? <p className="alertbox">{error}</p> : null}

              <Evidence code={code} onChanged={refresh} />

              <div>
                <h4
                  style={{
                    margin: "0 0 6px",
                    fontSize: 12.5,
                    color: "var(--muted)",
                  }}
                >
                  이력
                </h4>
                {detail.data!.revisions.length === 0 &&
                detail.data!.approvals.length === 0 ? (
                  <p className="s">기록 없음</p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {detail.data!.approvals.map(a => (
                      <li key={a.id}>
                        {shortDate(a.at.slice(0, 10))} · {a.approverRole}{" "}
                        {a.decision}
                        {a.reason ? ` — ${a.reason}` : ""}
                      </li>
                    ))}
                    {detail.data!.revisions.map(r => (
                      <li key={r.id}>
                        v{r.version} 수정 · {r.actor}
                        {r.reason ? ` — ${r.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h4
                  style={{
                    margin: "0 0 6px",
                    fontSize: 12.5,
                    color: "var(--muted)",
                  }}
                >
                  전표
                </h4>
                {detail.data!.journals.length === 0 ? (
                  <p className="s">
                    {entry.status !== "confirmed"
                      ? "확정 전에는 전표가 생성되지 않습니다"
                      : entry.accountCode == null
                        ? "계정과목이 없어 전표를 생성할 수 없습니다"
                        : "이관 시점에 확정된 건이라 자동 전표가 없습니다 — 이후 확정 건은 확정 순간 생성됩니다"}
                  </p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {detail.data!.journals.flatMap(j =>
                      j.lines.map(line => (
                        <li key={line.id}>
                          {accountLabel(line.accountCode)} · 차변{" "}
                          {line.debit.toLocaleString("ko-KR")} / 대변{" "}
                          {line.credit.toLocaleString("ko-KR")}
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}
