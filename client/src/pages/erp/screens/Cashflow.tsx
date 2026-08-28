/**
 * 현금흐름표 (§9.1) — 첫 진입 화면.
 * 데이터 표가 최상단, 설명 카드는 하단. 기본 단위는 월별.
 * 승인 대기는 블록마다 분리된 패널에서 그 자리에서 승인한다 (원칙 13).
 */
import { accountLabel, type CashflowUnit } from "@shared/erp";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Money, Note, PriorityChip, Tile } from "../components/Bits";
import { useErpUi, matchesQuery } from "../context";
import { blockLabel, nullReasonText, shortDate, won } from "../format";

const UNITS: { key: CashflowUnit; label: string }[] = [
  { key: "day", label: "일별" },
  { key: "month", label: "월별" },
  { key: "year", label: "연별" },
];

const PAGE = 3;

export function CashflowScreen() {
  const { openEntry, query } = useErpUi();
  const utils = trpc.useUtils();
  const [unit, setUnit] = useState<CashflowUnit>("month");
  const [visible, setVisible] = useState(PAGE);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const cashflow = trpc.erp.views.cashflow.useQuery({ unit });
  const bulk = trpc.erp.approvals.bulk.useMutation({
    onSuccess: async result => {
      setError(
        result.failed > 0
          ? `${result.failed}건 실패 — ${result.results.find(r => !r.ok)?.error}`
          : null
      );
      await Promise.all([
        utils.erp.views.invalidate(),
        utils.erp.entries.invalidate(),
      ]);
    },
    onError: e => setError(e.message),
  });
  const approve = trpc.erp.entries.approve.useMutation({
    onSuccess: async () => {
      setError(null);
      await Promise.all([
        utils.erp.views.invalidate(),
        utils.erp.entries.invalidate(),
      ]);
    },
    onError: e => setError(e.message),
  });

  // 최신순으로 3블록씩 — 스크롤 끝에서 더 불러온다 (§9.1 무한 스크롤)
  const blocks = useMemo(
    () => (cashflow.data ? [...cashflow.data.blocks].reverse() : []),
    [cashflow.data]
  );
  const shown = blocks.slice(0, visible);

  return (
    <div className="erp-page">
      <header>
        <h1>현금흐름표</h1>
        <p>
          집행원장을 발생일로 접은 뷰입니다. 별도 테이블에 저장하지 않고 매번
          원장에서 계산합니다 — 화면마다 숫자가 다를 수 없습니다.
        </p>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        {UNITS.map(u => (
          <button
            key={u.key}
            type="button"
            className="erp-btn"
            aria-pressed={unit === u.key}
            onClick={() => {
              setUnit(u.key);
              setVisible(PAGE);
            }}
          >
            {u.label}
          </button>
        ))}
        <button type="button" className="erp-btn" onClick={() => setOpen({})}>
          전체 접기
        </button>
        <button
          type="button"
          className="erp-btn"
          onClick={() =>
            setOpen(Object.fromEntries(shown.map(b => [b.key, true])))
          }
        >
          전체 펼치기
        </button>
        {cashflow.data ? (
          <span className="erp-chip" data-tone="alert">
            판정 대기 {cashflow.data.excludedUndecided.n}건 제외 중
          </span>
        ) : null}
      </div>

      {error ? <Note tone="alert">{error}</Note> : null}
      {cashflow.error ? (
        <Note tone="alert">{cashflow.error.message}</Note>
      ) : null}

      <section className="erp-card">
        {cashflow.isLoading ? (
          <div className="erp-card-body erp-null">불러오는 중…</div>
        ) : null}
        {shown.map(block => {
          const expanded = open[block.key] ?? false;
          const rows = block.outEntries
            .concat(block.inEntries)
            .filter(e => matchesQuery(query, e.code, e.title, e.noteRaw));
          return (
            <div className="erp-block" key={block.key}>
              <div
                className="erp-block-head"
                onClick={() =>
                  setOpen(prev => ({ ...prev, [block.key]: !expanded }))
                }
              >
                <strong>
                  {expanded ? "▾" : "▸"} {blockLabel(block.key)}
                  {block.isMigrated ? (
                    <span
                      className="erp-chip"
                      data-tone="info"
                      style={{ marginLeft: 8 }}
                    >
                      이관 구간 · 건별 명세 없음
                    </span>
                  ) : null}
                </strong>
                <div className="erp-block-figures">
                  <span>
                    시작 <b>{won(block.open) ?? "계산 불가"}</b>
                  </span>
                  <span>
                    지출 <b>{won(block.outSum)}</b>
                  </span>
                  <span>
                    입금 <b>{won(block.inSum)}</b>
                  </span>
                  <span>
                    종료{" "}
                    <b
                      style={{
                        color: block.close == null ? "var(--muted)" : undefined,
                      }}
                    >
                      {won(block.close) ?? "계산 불가"}
                    </b>
                  </span>
                </div>
              </div>

              {expanded ? (
                <>
                  {block.close == null ? (
                    <div style={{ padding: "8px 14px" }}>
                      <Note tone="warn">
                        {nullReasonText(block.nullReason)} —{" "}
                        {block.undecided.length > 0
                          ? block.undecided
                              .map(u => `${u.code} (${u.reason})`)
                              .join(" · ")
                          : "이전 일자에서 승계"}
                        . 잔액을 억지로 잇기 위해 판정 대기 건을 0으로 처리하지
                        않습니다.
                      </Note>
                    </div>
                  ) : null}

                  <div className="erp-split">
                    <SideTable
                      title="지출"
                      entries={rows.filter(e => e.direction === "out")}
                      onOpen={openEntry}
                    />
                    <SideTable
                      title="입금"
                      entries={rows.filter(e => e.direction === "in")}
                      onOpen={openEntry}
                    />
                  </div>

                  {block.pendingEntries.length > 0 ? (
                    <div className="erp-pending-panel">
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 14px",
                        }}
                      >
                        <strong style={{ color: "var(--warn)" }}>
                          승인 대기 {block.pendingEntries.length}건 · 합계{" "}
                          {won(
                            block.pendingEntries.reduce(
                              (a, e) => a + (e.amount ?? 0),
                              0
                            )
                          )}
                        </strong>
                        <button
                          type="button"
                          className="erp-btn"
                          disabled={bulk.isPending}
                          onClick={() =>
                            bulk.mutate({
                              codes: block.pendingEntries.map(e => e.code),
                              decision: "approve",
                            })
                          }
                        >
                          이 기간 전체 승인
                        </button>
                      </div>
                      <div className="erp-scroll">
                        <table className="erp-table">
                          <thead>
                            <tr>
                              <th>집행원장</th>
                              <th>항목</th>
                              <th>계정과목</th>
                              <th>우선</th>
                              <th className="num">금액</th>
                              <th>처리</th>
                            </tr>
                          </thead>
                          <tbody>
                            {block.pendingEntries.map(entry => (
                              <tr key={entry.code}>
                                <td>
                                  <button
                                    className="erp-code"
                                    onClick={() => openEntry(entry.code)}
                                  >
                                    {entry.code}
                                  </button>
                                </td>
                                <td className="wrap">
                                  {entry.title || "(항목명 없음)"}
                                </td>
                                <td>{accountLabel(entry.accountCode)}</td>
                                <td>
                                  <PriorityChip
                                    priority={
                                      entry.priorityOverride ?? entry.priority
                                    }
                                    overridden={entry.priorityOverride != null}
                                  />
                                </td>
                                <td className="num">
                                  <Money
                                    value={entry.amount}
                                    reason={entry.undecidedReason}
                                  />
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="erp-btn"
                                    disabled={
                                      approve.isPending || entry.amount == null
                                    }
                                    title={
                                      entry.amount == null
                                        ? "금액이 확정되지 않은 건은 승인할 수 없습니다"
                                        : undefined
                                    }
                                    onClick={() =>
                                      approve.mutate({
                                        code: entry.code,
                                        version: entry.version,
                                      })
                                    }
                                  >
                                    승인
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </section>

      {visible < blocks.length ? (
        <button
          type="button"
          className="erp-btn"
          onClick={() => setVisible(v => v + PAGE)}
        >
          이전 {PAGE}블록 더 보기 ({blocks.length - visible}블록 남음)
        </button>
      ) : null}

      <div className="erp-tiles">
        <Tile
          label="확정만 계에 들어갑니다"
          value="원칙 7"
          note="시스템이 가져온 것도 사람이 승인해야 합계에 들어갑니다"
        />
        <Tile
          label="모르면 계산 불가"
          value="원칙 8"
          note="추정치로 메우지 않고 무엇이 필요한지만 답합니다"
        />
        <Tile
          label="원장은 하나"
          value="원칙 12"
          note="어느 화면에서 입력해도 같은 원장에 적재됩니다"
        />
      </div>

      <Card title="미확정 승계는 버그가 아니라 요구사항입니다">
        <p style={{ margin: 0 }}>
          판정 대기가 하나라도 남은 날부터 종료 잔액을 확정하지 않고 이후 일자로
          미확정을 승계합니다. 금액·단위·항목명이 확정되면 그 날부터 다시
          이어집니다.
        </p>
      </Card>
    </div>
  );
}

function SideTable({
  title,
  entries,
  onOpen,
}: {
  title: string;
  entries: {
    code: string;
    title: string;
    noteRaw: string | null;
    amount: number | null;
    cashDate: string | null;
    accountCode: string | null;
    undecidedReason: string | null;
  }[];
  onOpen: (code: string) => void;
}) {
  return (
    <div style={{ background: "var(--surface)" }}>
      <div
        style={{ padding: "8px 14px", color: "var(--muted)", fontSize: 11.5 }}
      >
        {title} · {entries.length}건
      </div>
      <div className="erp-scroll">
        <table className="erp-table">
          <thead>
            <tr>
              <th>집행원장</th>
              <th>일자</th>
              <th>항목 · 적요 원문</th>
              <th>계정</th>
              <th className="num">금액</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ color: "var(--muted)" }}>
                  해당 건 없음
                </td>
              </tr>
            ) : (
              entries.map(entry => (
                <tr key={entry.code}>
                  <td>
                    <button
                      className="erp-code"
                      onClick={() => onOpen(entry.code)}
                    >
                      {entry.code}
                    </button>
                  </td>
                  <td>{shortDate(entry.cashDate)}</td>
                  <td className="wrap">
                    {entry.title || "(항목명 없음)"}
                    {entry.noteRaw ? (
                      <span className="erp-null"> · {entry.noteRaw}</span>
                    ) : null}
                  </td>
                  <td>{accountLabel(entry.accountCode)}</td>
                  <td className="num">
                    <Money
                      value={entry.amount}
                      reason={entry.undecidedReason}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
