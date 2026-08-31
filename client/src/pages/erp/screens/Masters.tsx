/**
 * 계약 원장 · 거래처 마스터 · 프로젝트 원장 — 입금예정일·귀속의 근거 마스터.
 * 계약이 등록되면 §9.3의 입금예정일이 손 대지 않아도 자동으로 산출된다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
import { DataTable, type Column } from "../components/DataTable";
import { matchesQuery, useErpUi } from "../context";
import { won } from "../format";

type Kind = "contract" | "party" | "project";

const TITLES: Record<Kind, { title: string; blurb: string }> = {
  contract: {
    title: "계약 원장",
    blurb:
      "입금예정일 산출의 근거입니다. 결제조건(계산서 발행 후 N일)이 등록되면 채권 화면의 입금예정일과 D-day가 자동으로 채워집니다.",
  },
  party: {
    title: "거래처 마스터",
    blurb:
      "슬랙 지출요청의 기업명이 여기에 매칭됩니다. 매칭되지 않으면 수집 검수함에 신규 후보로 남습니다. vat_mode가 사업부별 VAT 표기 차이를 흡수합니다 (B3).",
  },
  project: {
    title: "프로젝트 원장",
    blurb:
      "프로젝트 마진의 귀속 단위입니다. 귀속이 비면 사업부 손익과 프로젝트 마진에서 그 건이 빠집니다.",
  },
};

export function MastersScreen({ kind }: { kind: Kind }) {
  const { query } = useErpUi();
  const utils = trpc.useUtils();
  const masters = trpc.erp.masters.useQuery();
  const ar = trpc.erp.ar.useQuery();
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const upsert = trpc.erp.upsertMaster.useMutation({
    onSuccess: async () => {
      setMessage("저장했습니다.");
      setDraft({});
      await Promise.all([
        utils.erp.masters.invalidate(),
        utils.erp.ar.invalidate(),
      ]);
    },
    onError: e => setMessage(e.message),
  });

  const { title, blurb } = TITLES[kind];

  if (kind === "party") {
    type Row = NonNullable<typeof masters.data>["parties"][number];
    const rows = (masters.data?.parties ?? []).filter(p =>
      matchesQuery(query, p.name, p.bizNo)
    );
    const columns: Column<Row>[] = [
      {
        key: "id",
        header: "코드",
        sortValue: p => p.id,
        render: p => <span style={{ fontFamily: "var(--mono)" }}>{p.id}</span>,
      },
      {
        key: "name",
        header: "거래처",
        sortValue: p => p.name,
        render: p => p.name,
        wrap: true,
      },
      {
        key: "biz",
        header: "사업자번호",
        sortValue: p => p.bizNo ?? "",
        render: p => p.bizNo ?? <span className="s">미등록</span>,
      },
      {
        key: "vat",
        header: "VAT 표기",
        sortValue: p => p.vatMode ?? "",
        render: p => p.vatMode ?? <span className="s">미확정 (B3)</span>,
      },
      {
        key: "bank",
        header: "입금계좌",
        sortValue: p => p.bankAccount ?? "",
        render: p => p.bankAccount ?? <span className="s">미등록</span>,
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
            label="거래처"
            value={`${masters.data?.parties.length ?? 0}곳`}
            note="원장·채권에서 참조"
          />
          <Tile
            label="VAT 표기 미확정"
            value={`${(masters.data?.parties ?? []).filter(p => !p.vatMode).length}곳`}
            note="IP는 (vat별도), 네트워크는 (VAT 포함) — 전사 기준 미결 (B3)"
            tone="warn"
          />
        </div>
        <Card title="거래처" meta={`${rows.length}곳`} body={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={p => p.id}
            initialSort={{ key: "name", dir: "asc" }}
          />
        </Card>
      </>
    );
  }

  if (kind === "project") {
    type Row = NonNullable<typeof masters.data>["projects"][number];
    const rows = (masters.data?.projects ?? []).filter(p =>
      matchesQuery(query, p.code, p.name)
    );
    const columns: Column<Row>[] = [
      {
        key: "code",
        header: "코드",
        sortValue: p => p.code,
        render: p => (
          <span style={{ fontFamily: "var(--mono)" }}>{p.code}</span>
        ),
      },
      {
        key: "name",
        header: "프로젝트",
        sortValue: p => p.name,
        render: p => p.name,
        wrap: true,
      },
      {
        key: "bu",
        header: "사업부",
        sortValue: p => p.buCode ?? "",
        render: p => p.buCode ?? "미지정",
      },
      {
        key: "status",
        header: "상태",
        sortValue: p => p.status,
        render: p => p.status,
      },
      {
        key: "budget",
        header: "예산",
        numeric: true,
        sortValue: p => p.budget,
        render: p => won(p.budget) ?? <span className="s">미등록</span>,
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
        <Note tone="warn">
          귀속 미지정 건이 남아 있는 한 사업부 손익과 프로젝트 마진은 그만큼
          비어 있습니다. 프로젝트를 먼저 등록하고 원장에서 귀속을 채우십시오.
        </Note>
        <Card title="프로젝트" meta={`${rows.length}건`} body={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={p => p.id}
            initialSort={{ key: "code", dir: "asc" }}
          />
        </Card>
      </>
    );
  }

  // 계약 원장 — 등록이 곧 §9.3 입금예정일 자동 산출로 이어진다
  type Row = NonNullable<typeof masters.data>["contracts"][number];
  const rows = (masters.data?.contracts ?? []).filter(c =>
    matchesQuery(query, c.code, c.paymentTermsText)
  );
  const columns: Column<Row>[] = [
    {
      key: "code",
      header: "코드",
      sortValue: c => c.code,
      render: c => <span style={{ fontFamily: "var(--mono)" }}>{c.code}</span>,
    },
    {
      key: "party",
      header: "거래처",
      sortValue: c => c.partyId ?? "",
      render: c =>
        masters.data?.parties.find(p => p.id === c.partyId)?.name ?? (
          <span className="s">미지정</span>
        ),
    },
    {
      key: "project",
      header: "프로젝트",
      sortValue: c => c.projectId ?? "",
      render: c => c.projectId ?? <span className="s">미지정</span>,
    },
    {
      key: "amount",
      header: "계약금액",
      numeric: true,
      sortValue: c => c.amountTotal,
      render: c => won(c.amountTotal) ?? <span className="s">미등록</span>,
    },
    {
      key: "terms",
      header: "결제조건",
      sortValue: c => c.paymentTermsDays,
      render: c =>
        c.paymentTermsDays == null ? (
          <span className="s">미확인 — 입금예정일 산출 불가</span>
        ) : (
          `계산서 발행 후 ${c.paymentTermsDays}일`
        ),
    },
    {
      key: "agency",
      header: "중개",
      sortValue: c => (c.isAgency ? 1 : 0),
      render: c => (c.isAgency ? "중개" : "직접"),
    },
  ];

  const needContract = (ar.data?.receivables ?? []).filter(
    l => l.dueDateBlockedBy === "계약 미등록"
  );

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
          label="등록된 계약"
          value={`${masters.data?.contracts.length ?? 0}건`}
          note="2차 선행 조건"
          tone={masters.data?.contracts.length ? undefined : "alert"}
        />
        <Tile
          label="계약이 없어 막힌 채권"
          value={`${needContract.length}건`}
          note="입금예정일 자동 산출 불가"
          tone={needContract.length ? "alert" : "ok"}
        />
      </div>

      {needContract.length > 0 ? (
        <Note tone="alert">
          {needContract
            .map(l => `${l.partyName} (${won(l.entry.amount)})`)
            .join(" · ")}{" "}
          — 계약을 등록하면 입금예정일과 D-day가 자동으로 채워집니다.
        </Note>
      ) : null}
      {message ? <Note>{message}</Note> : null}

      <Card title="계약 등록">
        <div className="filters">
          <label className="field">
            <span>계약 코드</span>
            <input
              placeholder="CT-260827-01"
              value={draft.code ?? ""}
              onChange={e => setDraft(d => ({ ...d, code: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>거래처</span>
            <select
              value={draft.partyId ?? ""}
              onChange={e => setDraft(d => ({ ...d, partyId: e.target.value }))}
            >
              <option value="">선택</option>
              {(masters.data?.parties ?? []).map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>프로젝트</span>
            <select
              value={draft.projectId ?? ""}
              onChange={e =>
                setDraft(d => ({ ...d, projectId: e.target.value }))
              }
            >
              <option value="">미지정</option>
              {(masters.data?.projects ?? []).map(p => (
                <option key={p.id} value={p.id}>
                  {p.code} {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>계약금액 (원)</span>
            <input
              inputMode="numeric"
              value={draft.amountTotal ?? ""}
              onChange={e =>
                setDraft(d => ({ ...d, amountTotal: e.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>결제조건 (계산서 발행 후 N일)</span>
            <input
              inputMode="numeric"
              value={draft.paymentTermsDays ?? ""}
              onChange={e =>
                setDraft(d => ({ ...d, paymentTermsDays: e.target.value }))
              }
            />
          </label>
          <label className="field" style={{ flex: "1 1 200px" }}>
            <span>드라이브 링크</span>
            <input
              value={draft.driveUrl ?? ""}
              onChange={e =>
                setDraft(d => ({ ...d, driveUrl: e.target.value }))
              }
            />
          </label>
          <button
            type="button"
            className="btn"
            data-variant="primary"
            disabled={!draft.code || upsert.isPending}
            onClick={() =>
              upsert.mutate({
                kind: "contract",
                payload: {
                  id: draft.code,
                  code: draft.code,
                  partyId: draft.partyId || null,
                  projectId: draft.projectId || null,
                  amountTotal: draft.amountTotal
                    ? Number(draft.amountTotal.replace(/[^0-9]/g, ""))
                    : null,
                  installments: [],
                  paymentTermsDays: draft.paymentTermsDays
                    ? Number(draft.paymentTermsDays)
                    : null,
                  paymentTermsText: draft.paymentTermsDays
                    ? `계산서 발행 후 ${draft.paymentTermsDays}일`
                    : null,
                  driveUrl: draft.driveUrl || null,
                  isAgency: false,
                } as never,
              })
            }
          >
            계약 등록
          </button>
        </div>
      </Card>

      <Card title="계약" meta={`${rows.length}건`} body={false}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={c => c.id}
          initialSort={{ key: "code", dir: "asc" }}
          empty="등록된 계약이 없습니다 — 2차의 선행 조건입니다"
        />
      </Card>
    </>
  );
}
