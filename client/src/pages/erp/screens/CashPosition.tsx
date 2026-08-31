/**
 * 현금 현황 (§9.2) — 부족액 3종 · 우선순위 override · 판정 대기 포함 토글.
 * 데이터 표가 최상단, 설명 카드는 하단 (개발 피드백 2-1).
 */
import { PRIORITIES, accountLabel, type Priority } from "@shared/erp";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Card,
  Money,
  Note,
  PriorityChip,
  StatusChip,
  Tile,
} from "../components/Bits";
import { EntryForm } from "../components/EntryForm";
import { ExportModal } from "../components/ExportModal";
import { DataTable, type Column } from "../components/DataTable";
import { matchesQuery, useErpUi } from "../context";
import { shortDate, shortfallTone, signedWon, won } from "../format";

type SimOverride = { code: string; priority: Priority; reason: string };

export function CashPositionScreen() {
  const { openEntry, query } = useErpUi();
  const [includeUndecided, setIncludeUndecided] = useState(true);
  const [overrides, setOverrides] = useState<SimOverride[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [draft, setDraft] = useState<{
    code: string;
    priority: Priority;
    reason: string;
  }>({
    code: "",
    priority: "P1",
    reason: "",
  });

  const live = trpc.erp.views.cashPosition.useQuery({ includeUndecided });
  const simulate = trpc.erp.views.simulate.useMutation();

  // 시뮬레이션 결과가 있으면 그것을 보여준다 — 저장하지 않는다 (§10.1)
  const data =
    overrides.length > 0 && simulate.data ? simulate.data : live.data;
  const simulating = overrides.length > 0;

  const runSimulation = (next: SimOverride[]) => {
    setOverrides(next);
    if (next.length === 0) return;
    simulate.mutate({ includeUndecided, overrides: next });
  };

  const lines = useMemo(
    () =>
      (data?.lines ?? []).filter(l =>
        matchesQuery(query, l.entry.code, l.entry.title, l.entry.noteRaw)
      ),
    [data, query]
  );

  const columns: Column<(typeof lines)[number]>[] = [
    {
      key: "code",
      header: "집행원장",
      sortValue: l => l.entry.code,
      render: l => (
        <button className="m" onClick={() => openEntry(l.entry.code)}>
          {l.entry.code}
        </button>
      ),
    },
    {
      key: "priority",
      header: "우선",
      sortValue: l => l.priorityEff ?? "ZZ",
      render: l => (
        <PriorityChip
          priority={l.priorityEff}
          overridden={l.entry.priorityOverride != null}
        />
      ),
    },
    {
      key: "title",
      header: "항목",
      sortValue: l => l.entry.title,
      render: l => l.entry.title || "(항목명 없음)",
      wrap: true,
    },
    {
      key: "account",
      header: "계정과목",
      sortValue: l => l.entry.accountCode ?? "",
      render: l => accountLabel(l.entry.accountCode),
    },
    {
      key: "status",
      header: "상태",
      sortValue: l => l.entry.status,
      render: l => <StatusChip status={l.entry.status} />,
    },
    {
      key: "amount",
      header: "필요액",
      numeric: true,
      sortValue: l => l.amountUsed,
      render: l => (
        <>
          <Money value={l.amountUsed} reason={l.entry.undecidedReason} />
          {l.isCandidate ? <span className="s"> 후보</span> : null}
        </>
      ),
    },
    {
      key: "date",
      header: "예정일",
      sortValue: l => l.entry.cashDate ?? "",
      render: l => shortDate(l.entry.cashDate),
    },
    {
      key: "pay",
      header: "수단",
      sortValue: l => l.entry.payMethod ?? "",
      render: l => l.entry.payMethod ?? "—",
    },
    {
      key: "evidence",
      header: "증빙",
      sortValue: l => (l.entry.hasEvidence ? 1 : 0),
      render: l =>
        l.entry.hasEvidence ? (
          "있음"
        ) : (
          <span style={{ color: "var(--alert)" }}>없음</span>
        ),
    },
  ];

  return (
    <>
      <div className="ph">
        <div>
          <h1>현금 현황</h1>
          <div className="desc">
            집행원장을 지급 우선순위로 접은 뷰입니다. 카드 한도는 현금이
            아니므로 보유현금에서 제외합니다.
          </div>
        </div>
      </div>

      <div className="kpis">
        <Tile
          label="보유현금"
          value={won(data?.cashOnHand ?? null) ?? "계산 불가"}
          note={
            data?.cashOnHandIsProvisional
              ? "임시값 — 계좌 대사 전"
              : "대사 완료"
          }
          tone={data?.cashOnHand == null ? "null" : undefined}
        />
        {(data?.tiers ?? []).map(tier => (
          <Tile
            key={tier.level}
            label={`${tier.label} 부족액`}
            value={signedWon(tier.shortfall) ?? "계산 불가"}
            note={`필요 ${won(tier.required)}`}
            tone={shortfallTone(tier.shortfall)}
          />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          className="btn"
          aria-pressed={includeUndecided}
          onClick={() => {
            const next = !includeUndecided;
            setIncludeUndecided(next);
            if (overrides.length > 0)
              simulate.mutate({ includeUndecided: next, overrides });
          }}
        >
          판정 대기 포함 {includeUndecided ? "ON" : "OFF"}
        </button>
        {simulating ? (
          <>
            <span className="chip">
              시뮬레이션 {overrides.length}건 — 저장되지 않습니다
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => runSimulation([])}
            >
              초기화
            </button>
          </>
        ) : null}
      </div>

      {(data?.warnings ?? []).map(warning => (
        <Note key={warning} tone={warning.includes("작게") ? "alert" : "warn"}>
          {warning}
        </Note>
      ))}
      {live.error ? <Note tone="alert">{live.error.message}</Note> : null}
      {simulate.error ? (
        <Note tone="alert">{simulate.error.message}</Note>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className="btn"
          aria-pressed={showForm}
          onClick={() => setShowForm(v => !v)}
        >
          {showForm ? "입력 닫기" : "지출 항목 직접 추가"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setShowExport(true)}
        >
          내보내기
        </button>
      </div>

      {showForm ? (
        <Card
          title="지출 항목 직접 추가"
          meta="추가된 건은 승인해야 지급 목록에 들어갑니다"
        >
          <EntryForm direction="out" />
        </Card>
      ) : null}

      <Card title="지급 소요 목록" meta={`${lines.length}건`} body={false}>
        <DataTable
          columns={columns}
          rows={lines}
          rowKey={l => l.entry.code}
          initialSort={{ key: "priority", dir: "asc" }}
          footer={
            <tr>
              <td colSpan={5}>표시된 소요 합계 (P3 · 미지정 포함)</td>
              <td className="n">
                {won(lines.reduce((a, l) => a + (l.amountUsed ?? 0), 0))}
              </td>
              <td colSpan={3} />
            </tr>
          }
        />
      </Card>

      <Card
        title="우선순위 자동 판정"
        meta="계정 → 등급. 사람이 올릴 수 있고 사유가 남습니다"
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          {PRIORITIES.map(p => (
            <div key={p}>
              <PriorityChip priority={p} />{" "}
              <b style={{ fontFamily: "var(--mono)" }}>
                {won(data?.byPriority?.[p] ?? 0)}
              </b>
            </div>
          ))}
        </div>

        <div className="filters" style={{ marginTop: 12 }}>
          <label className="field">
            <span>집행원장 코드</span>
            <input
              value={draft.code}
              placeholder="EX-260827-07"
              onChange={e =>
                setDraft(d => ({ ...d, code: e.target.value.trim() }))
              }
            />
          </label>
          <label className="field">
            <span>올릴 등급</span>
            <select
              value={draft.priority}
              onChange={e =>
                setDraft(d => ({ ...d, priority: e.target.value as Priority }))
              }
            >
              {PRIORITIES.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: "1 1 220px" }}>
            <span>사유 (필수)</span>
            <input
              value={draft.reason}
              onChange={e => setDraft(d => ({ ...d, reason: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={!draft.code || !draft.reason.trim() || simulate.isPending}
            onClick={() => {
              runSimulation([
                ...overrides.filter(o => o.code !== draft.code),
                { ...draft },
              ]);
              setDraft({ code: "", priority: "P1", reason: "" });
            }}
          >
            부족액 재계산
          </button>
        </div>
        <p className="s" style={{ marginTop: 6 }}>
          여기서 바꾼 등급은 화면에서만 반영됩니다. 원장에 남기려면 코드를 눌러
          상세에서 저장하십시오.
        </p>
      </Card>

      {data && data.excludedUndecided.n > 0 ? (
        <Card
          title="금액을 알 수 없어 제외된 건"
          meta={`${data.excludedUndecided.n}건`}
        >
          <p style={{ margin: 0 }}>
            {data.excludedUndecided.codes.join(" · ")} — 단위·항목이 확정되기
            전까지 추정치로 메우지 않습니다.
          </p>
        </Card>
      ) : null}
    </>
  );
}
