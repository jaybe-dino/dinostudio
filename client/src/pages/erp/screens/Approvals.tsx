/**
 * 승인 대기 — 일괄 검토 · 예약런웨이 · 자금 소요 계산.
 * 승인 대기는 「아직 안 나갔지만 나갈 예정인 돈」이고, 예약런웨이에만 반영된다 (§7.3).
 */
import { accountLabel } from "@shared/erp";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Money, Note, PriorityChip, Tile } from "../components/Bits";
import { DataTable, type Column } from "../components/DataTable";
import { matchesQuery, useErpUi } from "../context";
import { shortDate, signedWon, won } from "../format";

export function ApprovalsScreen() {
  const { openEntry, query } = useErpUi();
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const list = trpc.erp.entries.list.useQuery({ status: ["pending"] });
  const position = trpc.erp.views.cashPosition.useQuery({
    includeUndecided: true,
  });

  const bulk = trpc.erp.approvals.bulk.useMutation({
    onSuccess: async res => {
      setResult(
        res.failed === 0
          ? `${res.ok}건 처리 완료`
          : `${res.ok}건 처리 · ${res.failed}건 실패 — ${res.results
              .filter(r => !r.ok)
              .map(r => `${r.code}: ${r.error}`)
              .join(" / ")}`
      );
      setSelected({});
      await Promise.all([
        utils.erp.entries.invalidate(),
        utils.erp.views.invalidate(),
      ]);
    },
    onError: e => setResult(e.message),
  });

  const rows = useMemo(
    () =>
      (list.data?.entries ?? []).filter(e =>
        matchesQuery(query, e.code, e.title, e.noteRaw)
      ),
    [list.data, query]
  );
  const codes = Object.entries(selected)
    .filter(([, on]) => on)
    .map(([code]) => code);

  const pendingTotal = rows.reduce((acc, e) => acc + (e.amount ?? 0), 0);
  const cashOnHand = position.data?.cashOnHand ?? null;
  const reservedBalance = cashOnHand == null ? null : cashOnHand - pendingTotal;

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: "pick",
      header: "선택",
      render: entry => (
        <input
          type="checkbox"
          checked={selected[entry.code] ?? false}
          onChange={() =>
            setSelected(prev => ({ ...prev, [entry.code]: !prev[entry.code] }))
          }
        />
      ),
    },
    {
      key: "code",
      header: "집행원장",
      sortValue: e => e.code,
      render: entry => (
        <button className="erp-code" onClick={() => openEntry(entry.code)}>
          {entry.code}
        </button>
      ),
    },
    {
      key: "title",
      header: "항목",
      sortValue: e => e.title,
      render: e => e.title || "(항목명 없음)",
      wrap: true,
    },
    {
      key: "account",
      header: "계정과목",
      sortValue: e => e.accountCode ?? "",
      render: e => accountLabel(e.accountCode),
    },
    {
      key: "nature",
      header: "원가성격",
      sortValue: e => e.nature ?? "",
      render: e => e.nature ?? "미지정",
    },
    {
      key: "priority",
      header: "우선",
      sortValue: e => e.priorityOverride ?? e.priority ?? "ZZ",
      render: e => (
        <PriorityChip
          priority={e.priorityOverride ?? e.priority}
          overridden={e.priorityOverride != null}
        />
      ),
    },
    {
      key: "amount",
      header: "금액",
      numeric: true,
      sortValue: e => e.amount,
      render: e => (
        <Money
          value={e.amount}
          reason={e.undecidedReason ?? "금액 미확정 (B1)"}
        />
      ),
    },
    {
      key: "date",
      header: "예정일",
      sortValue: e => e.cashDate ?? "",
      render: e => shortDate(e.cashDate),
    },
    {
      key: "evidence",
      header: "증빙",
      sortValue: e => (e.hasEvidence ? 1 : 0),
      render: e =>
        e.hasEvidence ? (
          "있음"
        ) : (
          <span style={{ color: "var(--alert)" }}>없음</span>
        ),
    },
  ];

  return (
    <div className="erp-page">
      <header>
        <h1>승인 대기</h1>
        <p>
          예정되거나 밀린, 앞으로 나갈 돈 전부입니다. 승인 대기는 현금흐름
          계·손익·전표에 들어가지 않고 예약런웨이에만 반영됩니다.
        </p>
      </header>

      <div className="erp-tiles">
        <Tile
          label="승인 대기"
          value={won(pendingTotal) ?? "—"}
          note={`${rows.length}건`}
          tone="warn"
        />
        <Tile
          label="보유 현금"
          value={won(cashOnHand) ?? "계산 불가"}
          note="계좌 대사 기준"
          tone={cashOnHand == null ? "null" : undefined}
        />
        <Tile
          label="예약 후 잔액"
          value={signedWon(reservedBalance) ?? "계산 불가"}
          note="이것이 실제로 쓸 수 있는 돈"
          tone={
            reservedBalance == null
              ? "null"
              : reservedBalance < 0
                ? "alert"
                : "ok"
          }
        />
        <Tile
          label="예약런웨이"
          value="계산 불가"
          note="분모 없음 — B1 급여 실액 · 마감된 월 0개"
          tone="null"
        />
      </div>

      <div className="erp-filters">
        <button
          type="button"
          className="erp-btn"
          onClick={() =>
            setSelected(Object.fromEntries(rows.map(r => [r.code, true])))
          }
        >
          전체 선택
        </button>
        <button
          type="button"
          className="erp-btn"
          onClick={() => setSelected({})}
        >
          선택 해제
        </button>
        <label className="erp-field" style={{ flex: "1 1 220px" }}>
          <span>반려 사유 (반려 시 필수)</span>
          <input value={reason} onChange={e => setReason(e.target.value)} />
        </label>
        <button
          type="button"
          className="erp-btn"
          data-variant="primary"
          disabled={codes.length === 0 || bulk.isPending}
          onClick={() => bulk.mutate({ codes, decision: "approve" })}
        >
          선택 {codes.length}건 승인
        </button>
        <button
          type="button"
          className="erp-btn"
          disabled={codes.length === 0 || !reason.trim() || bulk.isPending}
          onClick={() => bulk.mutate({ codes, decision: "reject", reason })}
        >
          선택 반려
        </button>
      </div>

      {result ? (
        <Note tone={result.includes("실패") ? "warn" : undefined}>
          {result}
        </Note>
      ) : null}
      {list.error ? <Note tone="alert">{list.error.message}</Note> : null}

      <Card
        title="승인 대기 목록"
        meta={`${rows.length}건 · 합계 ${won(pendingTotal)}`}
        body={false}
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={e => e.code}
          initialSort={{ key: "date", dir: "asc" }}
          footer={
            <tr>
              <td colSpan={6}>합계</td>
              <td className="num">{won(pendingTotal)}</td>
              <td colSpan={2} />
            </tr>
          }
        />
      </Card>

      <Card title="자금 소요 계산" meta="승인 대기까지 합친 실제 여력">
        <div className="erp-scroll">
          <table className="erp-table">
            <thead>
              <tr>
                <th>단계</th>
                <th>내용</th>
                <th className="num">금액</th>
                <th>확정도</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>보유 현금</td>
                <td>집행원장 기준 확정 잔액</td>
                <td className="num">{won(cashOnHand) ?? "계산 불가"}</td>
                <td>
                  {position.data?.cashOnHandIsProvisional ? "임시" : "확정"}
                </td>
              </tr>
              <tr>
                <td>− 승인 대기</td>
                <td>
                  금액이 확정된 지출 {rows.filter(r => r.amount != null).length}
                  건
                </td>
                <td className="num">{won(pendingTotal)}</td>
                <td>확정</td>
              </tr>
              <tr>
                <td>= 예약 후 잔액</td>
                <td>이것이 실제 쓸 수 있는 돈</td>
                <td className="num">
                  {signedWon(reservedBalance) ?? "계산 불가"}
                </td>
                <td>
                  {reservedBalance == null
                    ? "계산 불가"
                    : reservedBalance < 0
                      ? "부족"
                      : "여유"}
                </td>
              </tr>
              <tr>
                <td>+ 2주 번레이트</td>
                <td>운영을 2주 더 하려면</td>
                <td className="num erp-null">계산 불가</td>
                <td>B1 급여 실액 · 마감된 월 0개</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="erp-null" style={{ marginTop: 8 }}>
          번레이트는 마감된 월의 실측 운영비로만 만듭니다. 추정 분모로 런웨이를
          만들지 않습니다.
        </p>
      </Card>
    </div>
  );
}
