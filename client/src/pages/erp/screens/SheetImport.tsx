/**
 * 시트 이관 — 구글 시트를 계속 쓰다가 이 시스템으로 넘어오는 그 한 번을 위한 화면.
 *
 * 미리보기에서 무엇이 판정 대기로 떨어지는지 먼저 보여주고, 확인해야 적재합니다.
 * 적요칸 숫자를 금액으로 승격하지 않고 단위 불명은 후보로도 올리지 않습니다 (§5.2 · 원칙 8).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Money, Note, Tile, chipClass } from "../components/Bits";
import { Reauth } from "../components/Reauth";
import { useErpUi } from "../context";
import { shortDate, won } from "../format";
import { SHEET_SEED } from "@shared/erp";
import { DAILY_CASH_SUMMARY } from "@shared/erp/data/dailyCash";

export function SheetImportScreen() {
  const { goto } = useErpUi();
  const utils = trpc.useUtils();
  const [text, setText] = useState("");
  const [from, setFrom] = useState("2026-08-26");
  const [committed, setCommitted] = useState<string | null>(null);

  /*
   * 개시 전 재이관 (§5.6) — 「데일리 현금흐름」 시트를 최종본으로 다시 깐다.
   * 원칙 9(물리 삭제 없음)의 유일한 예외라 문을 네 개 달아 두었다.
   * 여기(화면)는 그 중 마지막 하나 — 확인 문구를 직접 타이핑하게 하는 것 — 만
   * 담당한다. 나머지 셋(대표만 · 재인증 · 마감 없음)은 서버가 본다.
   */
  const REBUILD_CONFIRM = "기존 원장을 모두 지우고 다시 만든다";
  /*
   * 붙여 넣은 것이 없으면 `text` 를 **보내지 않는다**. 빈 문자열을 보내면
   * 서버는 「읽은 줄이 없다」로 거절한다 — 사본으로 깔라는 뜻이 전달되지 않는다.
   */
  const rebuildInput = () =>
    text.trim() ? { text: text.trim() } : ({} as { text?: string });
  const [confirm, setConfirm] = useState("");
  const [rebuildNote, setRebuildNote] = useState<string | null>(null);
  const [rebuildReauth, setRebuildReauth] = useState(false);
  const me = trpc.erp.me.useQuery();
  const rebuild = trpc.erp.rebuildFromSheet.useMutation({
    onSuccess: async result => {
      setRebuildReauth(false);
      setConfirm("");
      /*
       * **검수함이 함께 비워진 것을 반드시 말한다.**
       *
       * 재이관은 원장뿐 아니라 전표·일계·검수함을 모두 비운다. 그런데 이
       * 메시지가 원장 건수만 말해 주는 바람에, 슬랙에서 모아 둔 것이 사라진
       * 것을 아무도 모른 채 지나갔다. 지운 것은 지웠다고 말해야 한다.
       */
      setRebuildNote(
        `원장을 다시 만들었습니다 — 지운 것 원장 ${result.removed.entries}건 · ` +
          `전표 ${result.removed.journals}건 · 일계 ${result.removed.snapshots}건 · ` +
          `검수함 ${result.removed.intakes}건 / ` +
          `들여온 것 ${result.inserted}건 (${result.days.length}일) · ` +
          `금액 미확정 ${result.summary.undecided}건` +
          (result.warnings.length > 0
            ? ` · 못 읽은 줄 ${result.warnings.length}건`
            : "") +
          (result.removed.intakes > 0
            ? " — 검수함이 비워졌습니다. 슬랙 수집을 다시 돌리십시오."
            : "")
      );
      await utils.erp.invalidate();
    },
    onError: error => {
      if (error.message.includes("비밀번호를 다시")) {
        setRebuildReauth(true);
        return;
      }
      setRebuildNote(error.message);
    },
  });

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

      {/*
        운영이 시작된 뒤에는 **다시 깔기를 쓰면 안 된다.** 그 사이 사람이
        원장에서 고친 것과 슬랙에서 올라온 것이 전부 날아간다. 그래서
        차이만 보여 주는 이 카드를 위에 둔다 — 먼저 보이는 쪽이 기본이다.
      */}
      <SheetDiffCard text={text} />

      <Card
        title="시트를 최종본으로 다시 깔기 (§5.6)"
        meta="대표만 · 되돌릴 수 없음"
      >
        <Note tone="alert">
          <b>기존 원장·전표·일계·검수함을 모두 비우고</b> 「데일리 현금흐름」
          시트로 다시 만듭니다. <b>아무것도 붙여 넣지 않으면</b> 코드에 들어
          있는 시트 사본({SHEET_SEED.summary.days}일 · {SHEET_SEED.summary.rows}
          건, {DAILY_CASH_SUMMARY.asOf} 기준)으로 깝니다. 그보다 새 시트가
          있으면 위 칸에 붙여 넣으십시오 — 운영경비·실비/환불·기타는 지출로,
          매출·기타매출은 수입으로 들어갑니다.
          <br />
          시트에 적힌 건은 <b>
            이미 돈이 오간 것이므로 승인완료로 섭니다.
          </b>{" "}
          머리말의 보유현금·장기부채도 함께 갱신됩니다.
          <br />
          <b>검수함(슬랙에서 모아 둔 것)도 함께 비워집니다.</b> 다시 깐 뒤에는
          슬랙 수집을 한 번 더 돌리셔야 합니다.
          <br />
          <b>
            금액이 「적요」 칸에 들어가 있는 줄은 금액으로 올리지 않습니다.
          </b>{" "}
          후보로만 두고 판정 대기로 세웁니다 — 시트의 「계」가 0 으로 잡혀 있던
          바로 그 줄들입니다.
          <br />
          감사로그·계정과목·기준값·마스터는 지우지 않습니다. 마감된 기간이
          하나라도 있으면 실행되지 않습니다.
        </Note>
        <div className="filters" style={{ marginTop: 10 }}>
          <label className="field" style={{ flex: "1 1 320px" }}>
            <span>확인 문구를 그대로 입력</span>
            <input
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder={REBUILD_CONFIRM}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn"
          style={{ marginTop: 8 }}
          disabled={
            rebuild.isPending ||
            me.data?.role !== "대표" ||
            confirm.trim() !== REBUILD_CONFIRM
          }
          onClick={() => rebuild.mutate({ ...rebuildInput(), confirm })}
        >
          {rebuild.isPending
            ? "다시 만드는 중…"
            : text.trim()
              ? "붙여 넣은 시트로 다시 만든다"
              : "코드에 든 사본으로 다시 만든다"}
        </button>
        {me.data?.role !== "대표" ? (
          <p className="s" style={{ marginTop: 6 }}>
            원장을 통째로 갈아엎는 작업이라 대표만 실행할 수 있습니다.
          </p>
        ) : null}
        {rebuildReauth ? (
          <div style={{ marginTop: 10 }}>
            <Reauth
              what="원장 재이관"
              onDone={() => rebuild.mutate({ ...rebuildInput(), confirm })}
            />
          </div>
        ) : null}
        {rebuildNote ? (
          <div style={{ marginTop: 10 }}>
            <Note>{rebuildNote}</Note>
          </div>
        ) : null}
        {rebuild.data && rebuild.data.warnings.length > 0 ? (
          <div className="scroll" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>일자</th>
                  <th>못 읽은 이유</th>
                  <th>원문</th>
                </tr>
              </thead>
              <tbody>
                {rebuild.data.warnings.map((w, i) => (
                  <tr key={i}>
                    <td>{w.day ?? "—"}</td>
                    <td className="wrap">{w.reason}</td>
                    <td className="wrap">{w.raw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

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
            className="btn pri"
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
                    <th className="n">금액</th>
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
                      <td className="n">
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
                          className={chipClass(
                            item.entry.status === "pending" ? "warn" : "alert"
                          )}
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

/**
 * 시트와 원장의 차이 — **읽기만 한다.**
 *
 * 다시 깔기와 달리 아무것도 지우지 않는다. 무엇이 다른지 보여 주고 고치는
 * 것은 사람이 건별로 한다. 운영이 시작된 뒤에는 이쪽이 유일하게 안전한 길이다.
 */
function SheetDiffCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const q = trpc.erp.sheetDiff.useQuery(
    text.trim() ? { text: text.trim() } : {},
    { enabled: open }
  );
  const d = q.data;

  return (
    <Card
      title="시트와 원장의 차이 보기"
      meta="읽기만 합니다 · 아무것도 지우지 않습니다"
    >
      <Note>
        <b>운영이 시작된 뒤에는 「다시 깔기」를 쓰지 마십시오.</b> 그 사이
        원장에서 고친 것과 슬랙에서 올라온 것이 전부 날아갑니다. 대신 여기서
        차이를 보고 <b>건별로</b> 고치십시오.
        {text.trim() ? (
          <>
            <br />
            위에 붙여 넣은 시트와 비교합니다.
          </>
        ) : (
          <>
            <br />
            붙여 넣지 않으면 코드에 든 사본과 비교합니다.
          </>
        )}
      </Note>
      <button
        type="button"
        className="btn pri"
        style={{ marginTop: 10 }}
        onClick={() => {
          setOpen(true);
          void q.refetch();
        }}
        disabled={q.isFetching}
      >
        {q.isFetching ? "대조하는 중…" : "차이 보기"}
      </button>

      {q.error ? (
        <div style={{ marginTop: 10 }}>
          <Note tone="warn">{q.error.message}</Note>
        </div>
      ) : null}

      {d ? (
        <>
          <div className="kpis" style={{ marginTop: 12 }}>
            <Tile
              label="시트에만"
              value={`${d.summary["시트에만"]}건`}
              note="원장에 없는 줄"
              tone={d.summary["시트에만"] > 0 ? "warn" : "ok"}
            />
            <Tile
              label="원장에만"
              value={`${d.summary["원장에만"]}건`}
              note="시트에서 지워진 줄"
              tone={d.summary["원장에만"] > 0 ? "warn" : "ok"}
            />
            <Tile
              label="금액 다름"
              value={`${d.summary["금액 다름"]}건`}
              note="양쪽 다 금액이 있는 줄만"
              tone={d.summary["금액 다름"] > 0 ? "warn" : "ok"}
            />
            <Tile
              label="방향 다름"
              value={`${d.summary["방향 다름"]}건`}
              note="수입/지출이 반대"
              tone={d.summary["방향 다름"] > 0 ? "alert" : "ok"}
            />
          </div>
          {d.rows.length === 0 ? (
            <Note>
              차이가 없습니다 — 시트 {d.sheetRows}줄과 원장 {d.ledgerCompared}
              건이 맞습니다.
            </Note>
          ) : (
            <div className="scroll" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>종류</th>
                    <th>날짜</th>
                    <th>항목</th>
                    <th className="n">시트</th>
                    <th className="n">원장</th>
                    <th>할 일</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r, i) => (
                    <tr key={`${r.kind}-${r.title}-${i}`}>
                      <td className="nw">
                        <span
                          className={
                            r.kind === "방향 다름" ? "chip a" : "chip w"
                          }
                        >
                          {r.kind}
                        </span>
                      </td>
                      <td className="nw">{r.date ? shortDate(r.date) : "—"}</td>
                      <td className="wrap k">{r.title}</td>
                      <td className="n">
                        {r.sheetAmount == null ? "—" : won(r.sheetAmount)}
                      </td>
                      <td className="n">
                        {r.ledgerAmount == null ? "—" : won(r.ledgerAmount)}
                        {r.ledgerCode ? (
                          <div className="s">{r.ledgerCode}</div>
                        ) : null}
                      </td>
                      <td className="wrap s">{r.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </Card>
  );
}
