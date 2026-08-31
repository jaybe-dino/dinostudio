/**
 * 은행 대사 (docs/erp-qa.md C6)
 *
 * 상단바의 「대사 차액 0」을 사실로 만드는 화면.
 * 기업은행 인터넷뱅킹에서 받은 거래내역을 붙여넣으면 원장과 맞춰 보고,
 * **안 맞는 것만** 남긴다. 자동으로 맞은 것은 굳이 보여 주지 않는다.
 *
 * 저장하지 않는다 — 무엇을 고칠지는 사람이 정한다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useErpUi } from "../context";
import { won } from "../format";
import {
  AlertBox,
  Card,
  Kpis,
  Note,
  OkBox,
  PageHead,
  Scroll,
} from "../components/Proto";

export function ReconcileScreen() {
  const { openEntry } = useErpUi();
  const [text, setText] = useState("");
  const preview = trpc.erp.reconcilePreview.useMutation();
  const d = preview.data;

  return (
    <>
      <PageHead
        title="은행 대사"
        desc="통장과 원장을 맞춰 보고 안 맞는 것만 남깁니다. 저장하지 않습니다 — 무엇을 고칠지는 사람이 정합니다."
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setText("");
                preview.reset();
              }}
            >
              지우기
            </button>
            <button
              type="button"
              className="btn pri"
              disabled={!text.trim() || preview.isPending}
              onClick={() => preview.mutate({ text })}
            >
              {preview.isPending ? "맞춰보는 중…" : "대사하기"}
            </button>
          </>
        }
      />

      <OkBox>
        <b>기업은행 인터넷뱅킹 → 조회 → 거래내역조회 → 엑셀 내려받기</b> 후,
        받은 표를 <b>헤더 줄까지 함께</b> 복사해 아래에 붙여넣으십시오. 헤더가
        없으면 어느 칸이 무엇인지 추측하지 않고 거부합니다 — 잘못 읽는 것보다
        낫습니다.
      </OkBox>

      <Card title="거래내역 붙여넣기" bare>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={
            "거래일자\t적요\t출금액\t입금액\t거래후잔액\n2026-09-01\t㈜셀릿\t1,100,000\t\t18,000,000"
          }
          spellCheck={false}
          style={{
            width: "100%",
            minHeight: 180,
            border: 0,
            padding: "12px 14px",
            font: '12px/1.6 "IBM Plex Mono", monospace',
            resize: "vertical",
            background: "var(--surface)",
            color: "var(--ink)",
          }}
        />
      </Card>

      {preview.error ? <AlertBox>{preview.error.message}</AlertBox> : null}

      {d ? (
        <>
          <Kpis
            items={[
              {
                k: "읽은 거래",
                v: `${d.parsed.count}건`,
                s:
                  d.parsed.skipped.length > 0
                    ? `${d.parsed.skipped.length}건은 읽지 못했습니다`
                    : "전부 읽었습니다",
                tone: d.parsed.skipped.length > 0 ? "warn" : undefined,
              },
              {
                k: "맞은 것",
                v: `${d.matched.length}건`,
                s: `근접 ${d.matched.filter(m => m.kind === "near").length}건 포함`,
                tone: "good",
              },
              {
                k: "통장에만 있음",
                v: `${d.bankOnly.length}건`,
                s: "원장 입력이 빠졌습니다",
                tone: d.bankOnly.length > 0 ? "bad" : undefined,
              },
              {
                k: "원장에만 있음",
                v: `${d.ledgerOnly.length}건`,
                s: "아직 안 나갔거나 잘못 넣었습니다",
                tone: d.ledgerOnly.length > 0 ? "bad" : undefined,
              },
            ]}
          />

          <div className="daysum">
            <div>
              <span className="lb">통장 출금</span>
              <span className="vv">{won(d.difference.bankOut)}</span>
            </div>
            <div>
              <span className="lb">원장 지출</span>
              <span className="vv">{won(d.difference.ledgerOut)}</span>
            </div>
            <div>
              <span className="lb">출금 차액</span>
              <span
                className="vv"
                style={{
                  color:
                    d.difference.outGap === 0
                      ? "var(--accent)"
                      : "var(--alert)",
                }}
              >
                {won(d.difference.outGap)}
              </span>
            </div>
            <div>
              <span className="lb">입금 차액</span>
              <span
                className="vv"
                style={{
                  color:
                    d.difference.inGap === 0 ? "var(--accent)" : "var(--alert)",
                }}
              >
                {won(d.difference.inGap)}
              </span>
            </div>
          </div>

          {!d.chain.ok ? (
            <AlertBox>
              <b>
                통장 잔액 체인이 끊겼습니다 — 대사 결과를 믿기 전에 이것부터
                보십시오.
              </b>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {d.chain.breaks.slice(0, 5).map(b => (
                  <li key={b.at}>
                    {b.at} — 계산상 {won(b.expected)} 인데 통장은{" "}
                    {won(b.actual)} 입니다
                  </li>
                ))}
              </ul>
              붙여넣기가 잘렸거나 줄이 빠졌을 가능성이 큽니다.
            </AlertBox>
          ) : null}

          {d.parsed.skipped.length > 0 ? (
            <Card title="읽지 못한 줄" sub="버리지 않고 그대로 둡니다" bare>
              <Scroll>
                <table>
                  <thead>
                    <tr>
                      <th>이유</th>
                      <th>원본</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.parsed.skipped.map((s, i) => (
                      <tr key={i}>
                        <td className="nw">{s.why}</td>
                        <td className="m s">{s.line}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroll>
            </Card>
          ) : null}

          {d.bankOnly.length > 0 ? (
            <Card
              title="통장에만 있는 것"
              sub="원장에 입력이 빠졌습니다 — 이것이 잔액이 안 맞는 첫 번째 이유입니다"
              bare
            >
              <Scroll>
                <table>
                  <thead>
                    <tr>
                      <th>일자</th>
                      <th>적요</th>
                      <th className="n">출금</th>
                      <th className="n">입금</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.bankOnly.map((t, i) => (
                      <tr key={i}>
                        <td className="m nw">{t.date}</td>
                        <td className="k">{t.description}</td>
                        <td className="n">{t.out ? won(t.out) : ""}</td>
                        <td className="n">{t.in ? won(t.in) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroll>
            </Card>
          ) : null}

          {d.ledgerOnly.length > 0 ? (
            <Card
              title="원장에만 있는 것"
              sub="아직 통장에 안 찍혔거나, 잘못 넣었거나, 날짜가 어긋납니다"
              bare
            >
              <Scroll>
                <table>
                  <thead>
                    <tr>
                      <th>코드</th>
                      <th>항목</th>
                      <th>지급일</th>
                      <th className="n">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.ledgerOnly.map(e => (
                      <tr key={e.code}>
                        <td className="nw">
                          <button
                            type="button"
                            className="m"
                            style={{
                              border: 0,
                              background: "none",
                              padding: 0,
                              cursor: "pointer",
                              color: "var(--accent)",
                              font: "inherit",
                            }}
                            onClick={() => openEntry(e.code)}
                          >
                            {e.code}
                          </button>
                        </td>
                        <td className="k">{e.title}</td>
                        <td className="m nw">{e.cashDate}</td>
                        <td className="n">{won(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroll>
            </Card>
          ) : null}

          {d.matched.some(m => m.kind === "near") ? (
            <Card
              title="날짜가 어긋난 채로 맞은 것"
              sub="금액은 같은데 며칠 차이가 납니다 — 카드 매입은 밀려 찍힙니다"
              bare
            >
              <Scroll>
                <table>
                  <thead>
                    <tr>
                      <th>통장</th>
                      <th>적요</th>
                      <th>원장</th>
                      <th className="n">차이</th>
                      <th className="n">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.matched
                      .filter(m => m.kind === "near")
                      .map((m, i) => (
                        <tr key={i}>
                          <td className="m nw">{m.txn.date}</td>
                          <td>{m.txn.description}</td>
                          <td className="m nw">{m.entry?.cashDate}</td>
                          <td className="n">{m.dayGap}일</td>
                          <td className="n">
                            {won(m.txn.out ?? m.txn.in ?? 0)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </Scroll>
            </Card>
          ) : null}

          {d.bankOnly.length === 0 &&
          d.ledgerOnly.length === 0 &&
          d.chain.ok ? (
            <OkBox>
              <b>대사 차액 0.</b> 통장과 원장이 전부 맞습니다. 이제 상단바의 그
              문구가 사실입니다.
            </OkBox>
          ) : null}
        </>
      ) : null}

      <Note>
        <b>은행 API 가 붙으면 이 화면은 그대로 씁니다.</b> 붙여넣기 자리만 자동
        수집으로 바뀌고, 맞추는 로직은 같습니다 — 그래서 대사를 API 에 묶어 짜지
        않았습니다.
      </Note>
    </>
  );
}
