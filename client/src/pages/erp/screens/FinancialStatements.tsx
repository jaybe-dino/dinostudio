/**
 * 재무제표 5종 (§9.8) — 전부 전표(journal_line) 누계에서 생성한다.
 * 기초 재무상태표가 없으면 차액을 「기초 미설정」 행으로 그대로 노출한다 (B6).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile, chipClass } from "../components/Bits";
import { signedWon, won } from "../format";
import type { ErpOutputs } from "../api";

type Rows = ErpOutputs["financialStatements"]["balanceSheet"];

const KINDS = [
  { key: "bs", label: "재무상태표" },
  { key: "pl", label: "손익계산서" },
  { key: "cf", label: "현금흐름표" },
  { key: "ce", label: "자본변동표" },
  { key: "notes", label: "주석" },
] as const;

export function FinancialStatementsScreen() {
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("bs");
  const [ym, setYm] = useState<string>("");
  const fs = trpc.erp.financialStatements.useQuery({ ym: ym || null });

  const rows: Rows =
    kind === "bs"
      ? (fs.data?.balanceSheet ?? [])
      : kind === "pl"
        ? (fs.data?.incomeStatement ?? [])
        : kind === "cf"
          ? (fs.data?.cashflowStatement ?? [])
          : kind === "ce"
            ? (fs.data?.equityStatement ?? [])
            : [];

  return (
    <>
      <div className="ph">
        <div>
          <h1>재무제표 5종</h1>
          <div className="desc">
            재무상태표 · 손익계산서 · 현금흐름표 · 자본변동표 · 주석. 전부 전표
            누계에서 생성되고 화면용 별도 집계 테이블을 두지 않습니다.
            현금흐름표는 직접법이며 §8.3의 3구간 자동 판정을 그대로 씁니다.
          </div>
        </div>
      </div>

      {fs.data?.basis ? (
        <div className="note">
          <b>보고서마다 날짜 축이 다릅니다.</b> 손익계산서는{" "}
          <b>{fs.data.basis.incomeStatement}</b>, 현금흐름표는{" "}
          <b>{fs.data.basis.cashflowStatement}</b>, 재무상태표는{" "}
          <b>{fs.data.basis.balanceSheet}</b> 기준입니다. 같은 달의 손익과
          현금이 다른 것은 정상이고, 다른 이유가 이것입니다.
        </div>
      ) : null}

      <div className="filters">
        {KINDS.map(k => (
          <button
            key={k.key}
            type="button"
            className="btn"
            aria-pressed={kind === k.key}
            onClick={() => setKind(k.key)}
          >
            {k.label}
          </button>
        ))}
        <label className="field">
          <span>기간 — 비우면 전체 누계</span>
          <input
            placeholder="2026-08"
            value={ym}
            onChange={e => setYm(e.target.value)}
          />
        </label>
        <span className={chipClass(fs.data?.status === "확정" ? "ok" : "warn")}>
          {fs.data?.status ?? "—"}
        </span>
      </div>

      {(fs.data?.blockers ?? []).map(b => (
        <Note key={b} tone="alert">
          {b}
        </Note>
      ))}

      {kind === "notes" ? (
        <Card title="주석">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {(fs.data?.notes ?? []).map(note => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card
          title={KINDS.find(k => k.key === kind)!.label}
          meta={ym || "전체 기간"}
          body={false}
        >
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>항목</th>
                  <th className="n">금액</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={`${row.label}-${index}`}
                    style={
                      row.emphasis
                        ? { background: "var(--surface-2)", fontWeight: 600 }
                        : undefined
                    }
                  >
                    <td>{row.label}</td>
                    <td className="n">
                      {row.amount == null ? (
                        <span className="s">계산 불가</span>
                      ) : (
                        signedWon(row.amount)
                      )}
                    </td>
                    <td className="wrap s">{row.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="kpis">
        <Tile
          label="가결산 / 확정"
          value={fs.data?.status ?? "—"}
          note="마감된 기간만 확정 표기"
          tone={fs.data?.status === "확정" ? "ok" : "warn"}
        />
        <Tile
          label="기초 재무상태표"
          value="미설정"
          note="자본·이월 잔액 — 시산표 불일치의 원인 (B6)"
          tone="null"
        />
        <Tile
          label="차액 처리"
          value="그대로 노출"
          note="조정 전표로 메우지 않습니다"
        />
      </div>
    </>
  );
}
