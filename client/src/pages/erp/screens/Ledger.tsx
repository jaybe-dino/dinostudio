/**
 * 집행원장 (전체) · 지출 원장 · 수입 원장 — 같은 원본에서 방향 + 상태로 걸러낸 것뿐이다.
 * 어느 화면에서 입력해도 같은 원장에 들어가고 중복은 없다 (원칙 12).
 */
import {
  ENTRY_STATUSES,
  PRIORITIES,
  STATUS_RULES,
  accountLabel,
  classifyUndecided,
  type Direction,
  type EntryStatus,
} from "@shared/erp";
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
import { shortDate, won } from "../format";

const NATURES = [
  "통과원가",
  "직접원가",
  "공통배부",
  "해당없음",
  "손익아님",
  "미지정",
] as const;
const BUS = ["IP", "NET", "COM", "GLV", "CMN"] as const;

export function LedgerScreen({
  direction,
  title,
  blurb,
}: {
  direction?: Direction;
  title: string;
  blurb: string;
}) {
  const { openEntry, query } = useErpUi();
  const [status, setStatus] = useState<EntryStatus | "">("");
  const [account, setAccount] = useState("");
  const [nature, setNature] = useState("");
  const [bu, setBu] = useState("");
  const [priority, setPriority] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const accounts = trpc.erp.accounts.useQuery();
  const list = trpc.erp.entries.list.useQuery({
    direction,
    status: status ? [status] : undefined,
    account: account || undefined,
    nature: nature || undefined,
    bu: bu || undefined,
    priority: priority || undefined,
    from: from || undefined,
    to: to || undefined,
  });

  const rows = useMemo(
    () =>
      (list.data?.entries ?? []).filter(e =>
        matchesQuery(query, e.code, e.title, e.noteRaw, e.accountCode)
      ),
    [list.data, query]
  );

  /*
   * 판정 대기를 「무엇이 없어서 막혔나」로 묶는다.
   * 8건을 한 줄씩 읽고 사유 문장을 해석하게 하는 대신, 종류와 해야 할 일을
   * 앞에 세운다 — 금액이 없는 건과 내용이 없는 건은 사람이 할 일이 다르다.
   */
  const undecidedGroups = useMemo(() => {
    const pending = (list.data?.entries ?? []).filter(
      e => e.status === "undecided"
    );
    const byKind = new Map<
      string,
      { kind: string; todo: string; entries: typeof pending }
    >();
    for (const entry of pending) {
      const { kind, todo } = classifyUndecided(entry);
      const found = byKind.get(kind);
      if (found) found.entries.push(entry);
      else byKind.set(kind, { kind, todo, entries: [entry] });
    }
    // 많은 것부터 — 한 종류를 처리하면 여러 건이 같이 풀린다
    return Array.from(byKind.values()).sort(
      (a, b) => b.entries.length - a.entries.length
    );
  }, [list.data]);
  const undecidedCount = undecidedGroups.reduce(
    (sum, g) => sum + g.entries.length,
    0
  );

  const totals = direction === "in" ? list.data?.in : list.data?.out;
  const filtersActive = Boolean(
    status || account || nature || bu || priority || from || to
  );

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: "code",
      header: "집행원장",
      sortValue: e => e.code,
      render: e => (
        <button className="m" onClick={() => openEntry(e.code)}>
          {e.code}
        </button>
      ),
    },
    {
      key: "cash",
      header: "입출금일",
      sortValue: e => e.cashDate ?? "",
      render: e => shortDate(e.cashDate),
    },
    {
      key: "status",
      header: "상태",
      sortValue: e => STATUS_RULES[e.status].label,
      render: e => <StatusChip status={e.status} />,
    },
    {
      key: "title",
      header: "항목 · 적요 원문",
      sortValue: e => e.title,
      wrap: true,
      render: e => (
        <>
          {e.title || "(항목명 없음)"}
          {e.noteRaw ? <span className="s"> · {e.noteRaw}</span> : null}
        </>
      ),
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
      key: "attribution",
      header: "귀속",
      sortValue: e => `${e.buCode ?? "ZZ"}${e.projectId ?? ""}`,
      render: e => (
        <>
          {e.buCode ?? <span className="s">미지정</span>}
          {e.projectId ? (
            ` · ${e.projectId}`
          ) : (
            <span className="s"> · 프로젝트 미지정</span>
          )}
        </>
      ),
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
        <>
          <Money value={e.amount} reason={e.undecidedReason ?? e.maskReason} />
          {e.masked ? <span className="s"> 마스킹</span> : null}
        </>
      ),
    },
  ];

  return (
    <>
      <div className="ph">
        <div>
          <h1>{title}</h1>
          <div className="desc">{blurb}</div>
        </div>
      </div>

      <div className="kpis">
        <Tile
          label="확정 합계"
          value={won(totals?.sum ?? 0) ?? "—"}
          note={`${totals?.count ?? 0}건 · 확정만 계에 들어갑니다`}
          tone="ok"
        />
        <Tile
          label="승인 대기 제외"
          value={won(totals?.excluded.pending.amount ?? null) ?? "계산 불가"}
          note={`${totals?.excluded.pending.n ?? 0}건 — 예약런웨이에만 반영`}
          tone="warn"
        />
        <Tile
          label="판정 대기 제외"
          value="계산 불가"
          note={`${totals?.excluded.undecided.n ?? 0}건 — 금액 미확정`}
          tone="null"
        />
        <Tile
          label="표시 중"
          value={`${rows.length}건`}
          note={filtersActive ? "필터 적용됨" : "필터 없음"}
        />
      </div>

      {undecidedGroups.length > 0 ? (
        <Card
          title="판정 대기 — 무엇이 없어서 막혔나"
          meta={`${undecidedCount}건 · 종류별로 묶었습니다`}
          body={false}
        >
          <table>
            <thead>
              <tr>
                <th>막힌 이유</th>
                <th className="n">건수</th>
                <th>해야 할 일</th>
                <th>해당 건</th>
              </tr>
            </thead>
            <tbody>
              {undecidedGroups.map(group => (
                <tr key={group.kind}>
                  <td>
                    <span className="chip a">{group.kind}</span>
                  </td>
                  <td className="n">{group.entries.length}건</td>
                  <td className="wrap">{group.todo}</td>
                  <td className="wrap">
                    {group.entries.map(entry => (
                      <button
                        key={entry.code}
                        className="m"
                        style={{ marginRight: 6 }}
                        onClick={() => openEntry(entry.code)}
                      >
                        {entry.code}
                        {entry.amount != null ? ` (${won(entry.amount)})` : ""}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className="btn"
          aria-pressed={showForm}
          onClick={() => setShowForm(v => !v)}
        >
          {showForm ? "입력 닫기" : "원장에 직접 추가"}
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
        <Card title="직접 추가" meta="어느 화면에서 넣어도 같은 원장입니다">
          <EntryForm direction={direction} />
        </Card>
      ) : null}

      <Card title="필터 10종">
        <div className="filters">
          <label className="field">
            <span>상태</span>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as EntryStatus | "")}
            >
              <option value="">전체</option>
              {ENTRY_STATUSES.map(s => (
                <option key={s} value={s}>
                  {STATUS_RULES[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>계정과목</span>
            <select value={account} onChange={e => setAccount(e.target.value)}>
              <option value="">전체</option>
              {(accounts.data ?? []).map(a => (
                <option key={a.code} value={a.code}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>원가성격</span>
            <select value={nature} onChange={e => setNature(e.target.value)}>
              <option value="">전체</option>
              {NATURES.map(n => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>사업부</span>
            <select value={bu} onChange={e => setBu(e.target.value)}>
              <option value="">전체</option>
              {BUS.map(b => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>우선순위</span>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value)}
            >
              <option value="">전체</option>
              {PRIORITIES.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>시작일</span>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </label>
          <label className="field">
            <span>종료일</span>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setStatus("");
              setAccount("");
              setNature("");
              setBu("");
              setPriority("");
              setFrom("");
              setTo("");
            }}
          >
            필터 초기화
          </button>
        </div>
      </Card>

      {list.error ? <Note tone="alert">{list.error.message}</Note> : null}
      {list.data && list.data.payrollTotal > 0 ? (
        <Note tone="warn">
          인건비 총액 {won(list.data.payrollTotal)} (적요칸 후보 금액 포함) —
          개인별 금액은 어느 화면에도 표시하지 않습니다.
        </Note>
      ) : null}

      <Card title="원장" meta={`${rows.length}건`} body={false}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={e => e.code}
          initialSort={{ key: "cash", dir: "asc" }}
          footer={
            <tr>
              <td colSpan={8}>확정 합계</td>
              <td className="n">{won(totals?.sum ?? 0)}</td>
            </tr>
          }
        />
      </Card>

      {showExport ? (
        <ExportModal
          title={title}
          onClose={() => setShowExport(false)}
          rows={[
            [
              "집행원장",
              "입출금일",
              "상태",
              "항목",
              "적요 원문",
              "계정",
              "원가성격",
              "사업부",
              "프로젝트",
              "우선",
              "금액",
            ],
            ...rows.map(e => [
              e.code,
              e.cashDate,
              STATUS_RULES[e.status].label,
              e.title,
              e.noteRaw,
              e.accountCode,
              e.nature,
              e.buCode,
              e.projectId,
              e.priorityOverride ?? e.priority,
              e.amount,
            ]),
          ]}
        />
      ) : null}

      <Card title="원장 하나에서 갈라지는 화면">
        <p style={{ margin: 0 }}>
          현금흐름표는 발생일로, 현금 현황은 지급 우선순위로, 전표·분개장은
          계정과목으로, 사업부 손익은 귀속으로 이 원장을 접은 것입니다. 파생
          뷰는 저장하지 않으므로 두 화면의 숫자가 어긋날 수 없습니다.
        </p>
      </Card>
    </>
  );
}
