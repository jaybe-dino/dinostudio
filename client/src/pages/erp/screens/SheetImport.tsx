/**
 * 시트 이관 — 구글 시트를 계속 쓰다가 이 시스템으로 넘어오는 그 한 번을 위한 화면.
 *
 * 미리보기에서 무엇이 판정 대기로 떨어지는지 먼저 보여주고, 확인해야 적재합니다.
 * 적요칸 숫자를 금액으로 승격하지 않고 단위 불명은 후보로도 올리지 않습니다 (§5.2 · 원칙 8).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Money, Note, Tile } from "../components/Bits";
import { useErpUi } from "../context";
import { shortDate, won } from "../format";

export function SheetImportScreen() {
  const { goto } = useErpUi();
  const utils = trpc.useUtils();
  const [text, setText] = useState("");
  const [from, setFrom] = useState("2026-08-26");
  const [committed, setCommitted] = useState<string | null>(null);

  const preview = trpc.erp.sheetImport.preview.useMutation({
    onSuccess: () => setCommitted(null),
  });
  const commit = trpc.erp.sheetImport.commit.useMutation({
    onSuccess: async result => {
      setCommitted(
        `${result.inserted}건 적재 · ${result.skipped}건은 이미 있어 건너뜀`
      );
      await Promise.all([
        utils.erp.entries.invalidate(),
        utils.erp.views.invalidate(),
      ]);
    },
  });

  const result = commit.data ?? preview.data;

  return (
    <>
      <div className="ph">
        <div>
          <h1>시트 이관</h1>
          <div className="desc">
            구글 시트에서 표를 복사해 붙여 넣으면 §5.2 매핑대로 원장 건으로
            바꿉니다. 한 번만 쓰는 경로입니다 — 이관이 끝나면 시트는 읽기
            전용으로 동결하고, 이후 어떤 화면도 시트를 참조하지 않습니다.
          </div>
        </div>
      </div>

      <Note tone="warn">
        붙여 넣기 전에 시트 공유 범위를 <b>제한됨</b>으로 바꾸고 버전 기록을
        확인하십시오. 외부 편집 흔적이 있으면 이관 기준 시점을 그 이전으로
        잡아야 합니다.
      </Note>

      <Card
        title="붙여 넣기"
        meta="구글 시트에서 헤더 줄까지 함께 복사 (탭 구분)"
      >
        <div className="filters" style={{ marginBottom: 8 }}>
          <label className="field">
            <span>이 날짜부터만 들여오기</span>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={!text.trim() || preview.isPending}
            onClick={() => preview.mutate({ text, from: from || null })}
          >
            미리보기
          </button>
          <button
            type="button"
            className="btn"
            data-variant="primary"
            disabled={!preview.data || commit.isPending}
            onClick={() => commit.mutate({ text, from: from || null })}
            title={preview.data ? undefined : "먼저 미리보기로 확인하십시오"}
          >
            확인 · 원장에 적재
          </button>
        </div>
        <textarea
          rows={8}
          value={text}
          placeholder={
            "일자\t항목\t적요\t지출\t수입\t시작잔액\t종료잔액\n2026-08-26\t대출이자\t\t350,000\t\t18,000,000\t"
          }
          onChange={e => setText(e.target.value)}
          style={{
            width: "100%",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            padding: 10,
            font: "12px/1.6 var(--mono)",
            background: "var(--surface)",
            color: "var(--ink)",
          }}
        />
        <p className="s" style={{ marginTop: 6 }}>
          헤더는 일자 · 항목 · 적요 · 지출 · 수입 · 시작잔액 · 종료잔액을
          알아봅니다. 헤더가 없으면 이 순서로 읽습니다.
        </p>
      </Card>

      {preview.error ? <Note tone="alert">{preview.error.message}</Note> : null}
      {commit.error ? <Note tone="alert">{commit.error.message}</Note> : null}
      {committed ? (
        <Note>
          {committed} —{" "}
          <button type="button" className="btn" onClick={() => goto("ledger")}>
            집행원장에서 확인
          </button>
        </Note>
      ) : null}

      {result ? (
        <>
          <div className="kpis">
            <Tile
              label="읽은 행"
              value={`${result.summary.total}건`}
              note={`${result.rejected.length}건은 읽지 못함`}
            />
            <Tile
              label="바로 승인 대기로"
              value={`${result.summary.ready}건`}
              note="금액·항목이 확정된 건"
              tone="ok"
            />
            <Tile
              label="판정 대기"
              value={`${result.summary.undecided}건`}
              note="금액·단위·항목명 미확정"
              tone={result.summary.undecided ? "alert" : "ok"}
            />
            <Tile
              label="지출 합계"
              value={won(result.summary.outSum) ?? "—"}
              note={`수입 ${won(result.summary.inSum)}`}
            />
          </div>

          <Card
            title="이관될 건"
            meta={`${result.entries.length}건 · 아직 저장되지 않았습니다`}
            body={false}
          >
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>줄</th>
                    <th>코드</th>
                    <th>일자</th>
                    <th>항목 · 적요</th>
                    <th className="num">금액</th>
                    <th>상태</th>
                    <th>검수</th>
                  </tr>
                </thead>
                <tbody>
                  {result.entries.map(item => (
                    <tr key={item.entry.code}>
                      <td className="s">{item.sourceLine}</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                        {item.entry.code}
                      </td>
                      <td>{shortDate(item.entry.cashDate)}</td>
                      <td className="wrap">
                        {item.entry.title || "(항목명 없음)"}
                        {item.entry.noteRaw ? (
                          <span className="s"> · {item.entry.noteRaw}</span>
                        ) : null}
                      </td>
                      <td className="num">
                        <Money
                          value={item.entry.amount}
                          reason={item.entry.undecidedReason}
                        />
                        {item.entry.amountCandidate != null ? (
                          <span className="s">
                            {" "}
                            후보{" "}
                            {item.entry.amountCandidate.toLocaleString("ko-KR")}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className="chip"
                          data-tone={
                            item.entry.status === "pending" ? "warn" : "alert"
                          }
                        >
                          {item.entry.status === "pending"
                            ? "승인 대기"
                            : "판정 대기"}
                        </span>
                      </td>
                      <td className="wrap s">
                        {item.flags.join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {result.rejected.length > 0 ? (
            <Card
              title="읽지 못한 줄"
              meta={`${result.rejected.length}건`}
              body={false}
            >
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>줄</th>
                      <th>원문</th>
                      <th>사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rejected.map(row => (
                      <tr key={row.line}>
                        <td className="s">{row.line}</td>
                        <td className="wrap">{row.raw}</td>
                        <td>{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      <Card title="이관이 끝나면 (§5.6 동결 절차)">
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            V1~V8 검증 리포트를 종합 현황에서 확인하고 대표·재무가 서면 확인
          </li>
          <li>
            시트 사본을 「[동결] 데일리 현금흐름 ~YYYY-MM-DD」로 만들고 보기
            전용으로 전환
          </li>
          <li>
            원본 시트 상단에 「이 날짜부터 이 시트는 사용하지 않습니다」 고정 행
            추가
          </li>
          <li>
            이후 시트 수정은 시스템에 반영되지 않습니다 — 재이관 기능은 제공하지
            않습니다
          </li>
        </ol>
      </Card>
    </>
  );
}
