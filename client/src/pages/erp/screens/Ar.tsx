/**
 * 채권 관리 (§9.3) — 미수는 계산서 발행분만이다 (원칙 4).
 * 발행 전은 채권이 아니라 별도 목록이고 DSO에도 들어가지 않는다.
 */
import { trpc } from "@/lib/trpc";
import { Card, Money, Note, Tile } from "../components/Bits";
import { DataTable, type Column } from "../components/DataTable";
import { matchesQuery, useErpUi } from "../context";
import { shortDate, won } from "../format";

import type { ErpOutputs } from "../api";

type Line = ErpOutputs["ar"]["receivables"][number];

export function ArScreen() {
  const { openEntry, query } = useErpUi();
  const ar = trpc.erp.ar.useQuery();

  const columns = (showDday: boolean): Column<Line>[] => [
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
      key: "party",
      header: "거래처",
      sortValue: l => l.partyName,
      render: l => l.partyName,
      wrap: true,
    },
    {
      key: "title",
      header: "건",
      sortValue: l => l.entry.title,
      render: l => l.entry.title,
      wrap: true,
    },
    {
      key: "amount",
      header: "금액",
      numeric: true,
      sortValue: l => l.entry.amount,
      render: l => (
        <Money value={l.entry.amount} reason={l.entry.undecidedReason} />
      ),
    },
    {
      key: "invoice",
      header: "계산서",
      sortValue: l => (l.entry.invoiceIssued ? 1 : 0),
      render: l =>
        l.entry.invoiceIssued ? (
          <span className="chip g">
            발행 완료{l.entry.invoiceNo ? ` · ${l.entry.invoiceNo}` : ""}
          </span>
        ) : (
          <span className="chip w">발행 전</span>
        ),
    },
    {
      key: "due",
      header: "입금예정일",
      sortValue: l => l.dueDate ?? "",
      render: l =>
        l.dueDate ? (
          shortDate(l.dueDate)
        ) : (
          <span className="s">{l.dueDateBlockedBy ?? "산출 불가"}</span>
        ),
    },
    ...(showDday
      ? ([
          {
            key: "dday",
            header: "D-day",
            numeric: true,
            sortValue: l => l.dDay,
            render: l =>
              l.dDay == null ? (
                <span className="s">—</span>
              ) : (
                <span
                  style={{ color: l.dDay > 0 ? "var(--alert)" : undefined }}
                >
                  {l.dDay > 0 ? `+${l.dDay}일` : `${-l.dDay}일 남음`}
                </span>
              ),
          },
        ] as Column<Line>[])
      : []),
    {
      key: "note",
      header: "메모",
      sortValue: l => l.entry.noteRaw ?? "",
      render: l => l.entry.noteRaw,
      wrap: true,
    },
  ];

  const filter = (lines: Line[]) =>
    lines.filter(l =>
      matchesQuery(query, l.entry.code, l.partyName, l.entry.title)
    );

  return (
    <>
      <div className="ph">
        <div>
          <h1>채권 관리</h1>
          <div className="desc">
            미수는 계산서가 발행된 미입금 건만입니다. 발행 전은 회수 문제가
            아니라 계약 마무리·검수 문제이므로 목록을 나눕니다 — 하나로 합치면
            독촉 메일을 잘못 보내고, 정작 확정서를 안 받은 건은 아무도 챙기지
            않습니다.
          </div>
        </div>
      </div>

      <div className="kpis">
        <Tile
          label="미수 (발행분)"
          value={won(ar.data?.receivableTotal ?? null) ?? "—"}
          note={`${ar.data?.receivables.length ?? 0}건`}
        />
        <Tile
          label="연체"
          value={`${ar.data?.overdue.length ?? 0}건`}
          note={
            won(
              ar.data?.overdue.reduce((a, l) => a + (l.entry.amount ?? 0), 0) ??
                0
            ) ?? ""
          }
          tone={ar.data && ar.data.overdue.length > 0 ? "alert" : undefined}
        />
        <Tile
          label="발행 대기"
          value={won(ar.data?.pendingIssueTotal ?? null) ?? "—"}
          note={`채권 아님 · DSO 제외 · 판별 불가 ${ar.data?.pendingIssueUndecided ?? 0}건`}
          tone="warn"
        />
        <Tile
          label="DSO"
          value={ar.data?.dso == null ? "계산 불가" : `${ar.data.dso}일`}
          note={
            ar.data
              ? `계산서 발행일이 있는 ${ar.data.dsoBasis.n}건 / 미수 ${ar.data.dsoBasis.of}건만 반영`
              : ""
          }
          tone={ar.data?.dso == null ? "null" : undefined}
        />
      </div>

      {(ar.data?.blockers ?? []).length > 0 ? (
        <Note tone="warn">
          입금예정일 산출 불가 — {ar.data!.blockers.join(" · ")}. 손으로 넣지
          않고 계약을 등록하면 자동 산출됩니다.
        </Note>
      ) : null}
      {ar.data && ar.data.dso == null ? (
        <Note tone="warn">{ar.data.dsoNullReason}</Note>
      ) : null}

      <Card
        title="미수 — 계산서 발행분"
        meta={`${ar.data?.receivables.length ?? 0}건`}
        body={false}
      >
        <DataTable
          columns={columns(true)}
          rows={filter(ar.data?.receivables ?? [])}
          rowKey={l => l.entry.code}
          initialSort={{ key: "dday", dir: "desc" }}
          footer={
            <tr>
              <td colSpan={3}>미수 합계 (발행분 기준)</td>
              <td className="n">{won(ar.data?.receivableTotal ?? 0)}</td>
              <td colSpan={4} />
            </tr>
          }
        />
      </Card>

      <Card
        title="채권 연령분석"
        meta={`구간 ${(ar.data?.aging.buckets ?? []).join(" · ")}일`}
        body={false}
      >
        <table>
          <thead>
            <tr>
              <th>경과 구간</th>
              <th className="n">건수</th>
              <th className="n">금액</th>
              <th className="n">비중</th>
            </tr>
          </thead>
          <tbody>
            {(ar.data?.aging.rows ?? []).map((row, i, rows) => (
              <tr key={row.label}>
                <td className="k">
                  {row.label}
                  {i === rows.length - 1 && row.amount > 0 ? (
                    <span className="tag a">회수 위험</span>
                  ) : null}
                </td>
                <td className="n">{row.count}건</td>
                <td className="n">{won(row.amount)}</td>
                <td className="n">
                  {row.share == null
                    ? "—"
                    : `${Math.round(row.share * 1000) / 10}%`}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="k">구간 반영 합계</td>
              <td className="n">
                {(ar.data?.aging.rows ?? []).reduce((s, r) => s + r.count, 0)}건
              </td>
              <td className="n">{won(ar.data?.aging.total ?? 0)}</td>
              <td className="n" />
            </tr>
          </tfoot>
        </table>
      </Card>

      {(ar.data?.aging.unknown ?? 0) > 0 ? (
        <Note tone="warn">
          경과일을 모르는 미수 {ar.data!.aging.unknown}건은 어느 구간에도 넣지
          않았습니다 — 계산서 발행일이 없으면 며칠 지났는지 알 수 없고, 임의로
          넣으면 그 칸의 숫자가 거짓이 됩니다.
        </Note>
      ) : null}

      <Note>
        연령 구간은 업종마다 다릅니다. 기준값 화면의{" "}
        <code>ar_aging_buckets</code> 에 <code>[15, 30, 60]</code> 처럼 넣으면 그
        구간으로 다시 나눕니다 — 30·60·90 은 기본값일 뿐입니다.
      </Note>

      <Card
        title="발행 대기 — 채권 아님"
        meta={`${ar.data?.pendingIssue.length ?? 0}건`}
        body={false}
      >
        <DataTable
          columns={columns(false)}
          rows={filter(ar.data?.pendingIssue ?? [])}
          rowKey={l => l.entry.code}
          footer={
            <tr>
              <td colSpan={3}>발행 대기 합계 (판별 가능분)</td>
              <td className="n">{won(ar.data?.pendingIssueTotal ?? 0)}</td>
              <td colSpan={3} />
            </tr>
          }
        />
      </Card>

      <Card title="발행 누락 감지 규칙">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>납품 확인 후 3영업일 내 계산서 미발행 → 담당자 알림</li>
          <li>7영업일 초과 → 재무 + 대표 에스컬레이션</li>
          <li>계약 금액과 발행 금액이 다르면 차액 사유 필수</li>
          <li>구두 합의만 있는 건은 확정서 수령이 발행 조건. 예외 없음</li>
          <li>월 마감 시 발행 대기 잔량을 매출 인식 시점 검토 대상으로 넘김</li>
        </ul>
      </Card>
    </>
  );
}
