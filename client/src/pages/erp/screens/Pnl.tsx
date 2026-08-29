/**
 * 사업부 손익 · 프로젝트 마진 · 비용 구조 (§9.7)
 * 두 계단의 영업이익이 다르면 배부 로직이 틀린 것이다 — 화면에서도 그 차이를 숨기지 않는다.
 */
import { accountLabel } from "@shared/erp";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
import { DataTable, type Column } from "../components/DataTable";
import { matchesQuery, useErpUi } from "../context";
import { signedWon, won } from "../format";
import type { ErpOutputs } from "../api";

type Segment = ErpOutputs["pnl"]["byBu"][number];

export function PnlScreen({ variant }: { variant: "bu" | "project" | "cost" }) {
  const { query, openEntry } = useErpUi();
  const pnl = trpc.erp.pnl.useQuery({});
  const runway = trpc.erp.runway.useQuery();
  const ledger = trpc.erp.entries.list.useQuery({ direction: "out" });

  const total = pnl.data?.total;
  const segments =
    (variant === "project" ? pnl.data?.byProject : pnl.data?.byBu) ?? [];

  const segmentColumns: Column<Segment>[] = [
    {
      key: "key",
      header: variant === "project" ? "프로젝트" : "사업부",
      sortValue: s => s.label,
      render: s => s.label,
    },
    {
      key: "net",
      header: "순매출",
      numeric: true,
      sortValue: s => s.netRevenue,
      render: s => won(s.netRevenue),
    },
    {
      key: "direct",
      header: "직접원가",
      numeric: true,
      sortValue: s => s.directCost,
      render: s => won(s.directCost),
    },
    {
      key: "contrib",
      header: "기여이익",
      numeric: true,
      sortValue: s => s.contributionProfit,
      render: s => (
        <span
          style={{
            color: s.contributionProfit < 0 ? "var(--alert)" : undefined,
          }}
        >
          {signedWon(s.contributionProfit)}
        </span>
      ),
    },
    {
      key: "common",
      header: "공통배부",
      numeric: true,
      sortValue: s => s.commonAllocated,
      render: s => won(s.commonAllocated),
    },
    {
      key: "op",
      header: "영업이익",
      numeric: true,
      sortValue: s => s.operatingProfit,
      render: s => (
        <span
          style={{ color: s.operatingProfit < 0 ? "var(--alert)" : undefined }}
        >
          {signedWon(s.operatingProfit)}
        </span>
      ),
    },
    {
      key: "n",
      header: "건수",
      numeric: true,
      sortValue: s => s.entryCount,
      render: s => s.entryCount,
    },
  ];

  if (variant === "cost") {
    const opex = runway.data?.opex;
    const byAccount = new Map<string, { amount: number; count: number }>();
    for (const entry of ledger.data?.entries ?? []) {
      if (
        entry.status !== "confirmed" ||
        entry.amount == null ||
        !entry.accountCode
      )
        continue;
      const acc = byAccount.get(entry.accountCode) ?? { amount: 0, count: 0 };
      acc.amount += entry.amount;
      acc.count += 1;
      byAccount.set(entry.accountCode, acc);
    }
    const rows = Array.from(byAccount.entries())
      .map(([code, v]) => ({ code, ...v }))
      .filter(r => matchesQuery(query, r.code, accountLabel(r.code)))
      .sort((a, b) => b.amount - a.amount);
    const grand = rows.reduce((a, r) => a + r.amount, 0);

    return (
      <div className="erp-page">
        <header>
          <h1>비용 구조</h1>
          <p>
            고정비 / 변동비 구분은 번레이트 계산에서 뺐습니다. 절감 판단용 보조
            태그(계약 고정 / 정기 재량 / 수시)로만 남기고, 번레이트는 마감된
            월의 실측 운영비로만 만듭니다.
          </p>
        </header>

        <div className="erp-tiles">
          <Tile
            label="확정 운영비"
            value={won(opex?.opex.amount ?? null) ?? "—"}
            note={`${opex?.opex.count ?? 0}건 · 회사가 실제로 소진`}
          />
          <Tile
            label="통과원가"
            value={won(opex?.passThrough.amount ?? null) ?? "—"}
            note={`${opex?.passThrough.count ?? 0}건 · 받아야 나감 · 운영비 아님`}
            tone="info"
          />
          <Tile
            label="재무·투자·부가세"
            value={won(opex?.nonOperating.amount ?? null) ?? "—"}
            note={`${opex?.nonOperating.count ?? 0}건 · 운영비 아님`}
            tone="info"
          />
          <Tile
            label="판정 대기"
            value="계산 불가"
            note={`${opex?.undecided.count ?? 0}건 · 금액 미확정`}
            tone="null"
          />
        </div>

        <Note tone="warn">
          운영비 = 총지출 − (통과원가 + 차입 원금 + 부가세 + 자산 취득). 이
          정의가 그대로 월 번레이트이고 런웨이의 분모입니다. 고정비 54,647,500 +
          변동비 18,441,290 = 73,088,790 같은 추정 분모는 전부 폐기했습니다.
        </Note>

        <Card
          title="계정별 확정 지출"
          meta={`${rows.length}개 계정`}
          body={false}
        >
          <div className="erp-scroll">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>계정과목</th>
                  <th className="num">금액</th>
                  <th className="num">건수</th>
                  <th className="num">비중</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.code}>
                    <td>{accountLabel(row.code)}</td>
                    <td className="num">{won(row.amount)}</td>
                    <td className="num">{row.count}</td>
                    <td className="num">
                      {grand > 0
                        ? `${Math.round((row.amount / grand) * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>합계</td>
                  <td className="num">{won(grand)}</td>
                  <td className="num">
                    {rows.reduce((a, r) => a + r.count, 0)}
                  </td>
                  <td className="num">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card title="운영비에 들어간 건" meta={`${opex?.opex.count ?? 0}건`}>
          <p style={{ margin: 0 }}>
            {(opex?.opex.codes ?? []).map(code => (
              <button
                key={code}
                className="erp-code"
                style={{ marginRight: 4 }}
                onClick={() => openEntry(code)}
              >
                {code}
              </button>
            ))}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="erp-page">
      <header>
        <h1>{variant === "project" ? "프로젝트 마진" : "사업부 손익"}</h1>
        <p>
          회계 계단(세무·감사용)과 관리 계단(사업 판단용)을 함께 냅니다. 두
          계단의 영업이익은 반드시 일치해야 하고, 다르면 배부 로직이 틀린
          것입니다.
        </p>
      </header>

      <div className="erp-tiles">
        <Tile
          label="순매출"
          value={won(total?.management.netRevenue ?? null) ?? "—"}
          note="총매출 − 통과원가"
        />
        <Tile
          label="기여이익"
          value={signedWon(total?.management.contributionProfit ?? null) ?? "—"}
          note="순매출 − 직접원가 · 관리 계단 전용"
          tone={
            (total?.management.contributionProfit ?? 0) < 0 ? "alert" : "ok"
          }
        />
        <Tile
          label="영업이익"
          value={signedWon(total?.accounting.operatingProfit ?? null) ?? "—"}
          note="회계 계단"
          tone={(total?.accounting.operatingProfit ?? 0) < 0 ? "alert" : "ok"}
        />
        <Tile
          label="두 계단 차이"
          value={signedWon(total?.operatingProfitGap ?? 0) ?? "—"}
          note={
            total?.operatingProfitGap === 0
              ? "일치 — 배부 로직 정상"
              : "불일치 — 배부 로직 오류"
          }
          tone={total?.operatingProfitGap === 0 ? "ok" : "alert"}
        />
      </div>

      {(total?.blockers ?? []).map(b => (
        <Note key={b} tone="warn">
          {b}
        </Note>
      ))}

      <div
        className="erp-split"
        style={{
          border: "1px solid var(--rule)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <Card title="회계 계단" meta="세무·감사용">
          <table className="erp-table">
            <tbody>
              <Row label="매출" amount={total?.accounting.revenue} />
              <Row label="− 매출원가" amount={total?.accounting.cogs} />
              <Row
                label="= 매출총이익"
                amount={total?.accounting.grossProfit}
                emphasis
              />
              <Row label="− 판매비와관리비" amount={total?.accounting.sga} />
              <Row
                label="= 영업이익"
                amount={total?.accounting.operatingProfit}
                emphasis
              />
              <Row
                label="± 영업외손익"
                amount={total?.accounting.nonOperating}
              />
              <Row
                label="= 법인세차감전순이익"
                amount={total?.accounting.pretaxProfit}
                emphasis
              />
            </tbody>
          </table>
        </Card>
        <Card title="관리 계단" meta="사업 판단용 · GMV는 제외">
          <table className="erp-table">
            <tbody>
              <Row label="총매출" amount={total?.management.grossRevenue} />
              <Row label="− 통과원가" amount={total?.management.passThrough} />
              <Row
                label="= 순매출"
                amount={total?.management.netRevenue}
                emphasis
              />
              <Row label="− 직접원가" amount={total?.management.directCost} />
              <Row
                label="= 기여이익"
                amount={total?.management.contributionProfit}
                emphasis
              />
              <Row
                label="− 공통배부"
                amount={total?.management.commonAllocated}
              />
              <Row
                label="= 영업이익"
                amount={total?.management.operatingProfit}
                emphasis
              />
            </tbody>
          </table>
        </Card>
      </div>

      <Card
        title={variant === "project" ? "프로젝트별" : "사업부별"}
        meta={`${segments.length}개`}
        body={false}
      >
        <DataTable
          columns={segmentColumns}
          rows={segments.filter(s => matchesQuery(query, s.label))}
          rowKey={s => s.key}
          initialSort={{ key: "contrib", dir: "desc" }}
        />
      </Card>
    </div>
  );
}

function Row({
  label,
  amount,
  emphasis,
}: {
  label: string;
  amount: number | null | undefined;
  emphasis?: boolean;
}) {
  return (
    <tr
      style={
        emphasis
          ? { background: "var(--surface-2)", fontWeight: 600 }
          : undefined
      }
    >
      <td>{label}</td>
      <td className="num">
        {won(amount ?? 0) ?? <span className="erp-null">계산 불가</span>}
      </td>
    </tr>
  );
}
