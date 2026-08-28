/**
 * 계정과목 체계 (§8) — 계정 하나를 정하면 나머지 세 가지가 자동으로 정해진다.
 * 사람은 계정만 고른다.
 */
import { autoPriority, type Account } from "@shared/erp";
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Note, PriorityChip } from "../components/Bits";
import { DataTable, type Column } from "../components/DataTable";
import { matchesQuery, useErpUi } from "../context";

export function AccountsScreen() {
  const { query } = useErpUi();
  const accounts = trpc.erp.accounts.useQuery();

  const rows = useMemo(
    () =>
      (accounts.data ?? []).filter(a =>
        matchesQuery(query, a.code, a.name, a.type)
      ),
    [accounts.data, query]
  );

  const columns: Column<Account>[] = [
    {
      key: "code",
      header: "코드",
      sortValue: a => a.code,
      render: a => <span style={{ fontFamily: "var(--mono)" }}>{a.code}</span>,
    },
    {
      key: "name",
      header: "계정과목",
      sortValue: a => a.name,
      render: a => a.name,
      wrap: true,
    },
    {
      key: "type",
      header: "대분류",
      sortValue: a => a.type,
      render: a => a.type,
    },
    {
      key: "cf",
      header: "CF 구간",
      sortValue: a => a.cfSection,
      render: a => (
        <span
          className="erp-chip"
          data-tone={
            a.cfSection === "영업"
              ? "ok"
              : a.cfSection === "재무"
                ? "info"
                : undefined
          }
        >
          {a.cfSection}
        </span>
      ),
    },
    {
      key: "opex",
      header: "운영비",
      sortValue: a => (a.isOpex ? 1 : 0),
      render: a =>
        a.isOpex ? (
          <span className="erp-chip" data-tone="warn">
            포함
          </span>
        ) : (
          <span className="erp-chip">제외</span>
        ),
    },
    {
      key: "priority",
      header: "기본 우선순위",
      sortValue: a => a.defaultPriority ?? "ZZ",
      render: a => <PriorityChip priority={a.defaultPriority} />,
    },
    {
      key: "fn",
      header: "§8.2 함수값",
      sortValue: a => autoPriority(a.code),
      render: a => {
        const derived = autoPriority(a.code);
        const diverges =
          a.defaultPriority != null && a.defaultPriority !== derived;
        return (
          <span
            className={diverges ? undefined : "erp-null"}
            style={diverges ? { color: "var(--warn)" } : undefined}
          >
            {derived}
            {diverges ? " ≠ 마스터" : ""}
          </span>
        );
      },
    },
  ];

  const divergent = rows.filter(
    a => a.defaultPriority != null && a.defaultPriority !== autoPriority(a.code)
  );

  return (
    <div className="erp-page">
      <header>
        <h1>계정과목 체계</h1>
        <p>
          일반기업회계기준(K-GAAP). 계정과목 하나를 정하면 지급 우선순위 ·
          현금흐름 3구간 · 운영비 포함 여부가 자동으로 정해집니다.
        </p>
      </header>

      {divergent.length > 0 ? (
        <Note tone="warn">
          §8.1 마스터와 §8.2 함수가 갈리는 계정 {divergent.length}건 —{" "}
          {divergent.map(a => `${a.code} ${a.name}`).join(" · ")}. 실사용 값은
          마스터 컬럼을 씁니다 (§6.3).
        </Note>
      ) : null}

      <Card title="계정과목 마스터" meta={`${rows.length}개`} body={false}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={a => a.code}
          initialSort={{ key: "code", dir: "asc" }}
        />
      </Card>

      <div
        className="erp-split"
        style={{
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid var(--rule)",
        }}
      >
        <Card title="이자는 영업활동, 원금 상환만 재무활동">
          <p style={{ margin: 0 }}>
            원리금을 한 덩어리로 처리하면 영업활동이 실제보다 좋아 보입니다.
            8110 이자비용과 2210·2310 차입금은 반드시 다른 건으로 분리 입력해야
            합니다.
          </p>
        </Card>
        <Card title="고정비 / 변동비는 번레이트에 쓰지 않습니다">
          <p style={{ margin: 0 }}>
            운영비 = 총지출 − (통과원가 + 차입 원금 + 부가세 + 자산 취득).
            고정비·변동비는 절감 판단용 보조 태그로만 남깁니다.
          </p>
        </Card>
      </div>
    </div>
  );
}
