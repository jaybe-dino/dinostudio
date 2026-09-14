/**
 * 수집 검수함 — 원장 진입 전 대기열. 파싱 실패도 여기 남는다 (§11.1).
 * 승인은 슬랙에서 하지 않는다. 슬랙의 👍는 참고 이력이고 승인은 시스템 안에서만 이뤄진다.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
import { Reauth } from "../components/Reauth";
import { useErpUi } from "../context";
import { shortDate } from "../format";

const SLACK_FIELDS: [string, string, string][] = [
  [
    "기업명",
    "party_id",
    "거래처 마스터 매칭 · 미매칭 시 신규 후보로 검수함에 남김",
  ],
  ["지출 내용", "title + note_raw", "원문 보존"],
  ["착수일", "start_date", "수익·비용 대응의 시작점"],
  ["최종 업로드일", "deliver_date", "용역 완료일 = 손익 귀속 기본값 (B4)"],
  [
    "금액(VAT)",
    "amount / supply / vat",
    "IP는 (vat별도), 네트워크는 (VAT 포함) — 파서가 분리 저장 (B3)",
  ],
  ["지출 요청일", "request_date", "—"],
  ["입금계좌", "bank_account", "—"],
  ["계산서 발행 O/X", "invoice_issued", "—"],
  [
    "회차 · 사업부 · 대응 매출",
    "round_no · bu_code · linked_revenue",
    "신규 필드 — 양식에 추가 필요",
  ],
  ["스레드 ts", "source_ref", "중복 수집 방지 키 — UNIQUE"],
];

interface BackfillLine {
  channel: string;
  name: string | null;
  scanned: number;
  collected: number;
  duplicate: number;
  ignored: number;
  failed: number;
  done: boolean;
  error: string | null;
  lastMessageAt: string | null;
  dormant: boolean;
}

const BACKFILL_KEY = "dinostudio.slack-backfill.v1";
function savedBackfill(): {
  days: number;
  cursors: Record<string, string> | null;
} {
  try {
    const value = JSON.parse(localStorage.getItem(BACKFILL_KEY) ?? "null");
    if (
      value &&
      Number.isInteger(value.days) &&
      value.days >= 1 &&
      value.days <= 365 &&
      value.cursors &&
      typeof value.cursors === "object" &&
      !Array.isArray(value.cursors) &&
      Object.values(value.cursors).every(cursor => typeof cursor === "string")
    )
      return value;
  } catch {
    /* Storage may be unavailable in private browsing. */
  }
  return { days: 365, cursors: null };
}

export function IntakeScreen() {
  const { goto, openEntry } = useErpUi();
  const utils = trpc.useUtils();
  const masters = trpc.erp.masters.useQuery();
  const intakes = masters.data?.intakes ?? [];
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const me = trpc.erp.me.useQuery();
  const cross = trpc.erp.intake.crossReference.useQuery();
  /*
   * 기본값이 365일인 이유 — 지출 채널의 마지막 글이 2025-10 이다.
   * 30일로 두면 0건이 나오고, 그것은 「고장」처럼 보인다.
   */
  const [saved] = useState(savedBackfill);
  const [days, setDays] = useState(saved.days);
  const [cursors, setCursors] = useState<Record<string, string> | null>(
    saved.cursors
  );
  const [autoBackfill, setAutoBackfill] = useState(false);
  const [resumeAt, setResumeAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    try {
      if (cursors)
        localStorage.setItem(BACKFILL_KEY, JSON.stringify({ days, cursors }));
      else localStorage.removeItem(BACKFILL_KEY);
    } catch {
      /* The server still de-duplicates collected messages. */
    }
  }, [days, cursors]);
  const [backfillNote, setBackfillNote] = useState<string | null>(null);
  const [backfillLines, setBackfillLines] = useState<BackfillLine[] | null>(
    null
  );

  const refresh = async () => {
    await Promise.all([
      utils.erp.masters.invalidate(),
      utils.erp.entries.invalidate(),
    ]);
  };
  const promote = trpc.erp.intake.promote.useMutation({
    onSuccess: async result => {
      setMessage(
        `${result.entry.code} 로 적재했습니다 — 승인 대기 상태입니다.` +
          (result.partyCandidate
            ? ` 거래처 「${result.partyCandidate}」는 마스터에 없어 신규 후보입니다.`
            : "")
      );
      await refresh();
    },
    onError: e => setMessage(e.message),
  });
  const reject = trpc.erp.intake.reject.useMutation({
    onSuccess: async () => {
      setMessage("반려했습니다 — 기록은 검수함에 남습니다.");
      setReason("");
      await refresh();
    },
    onError: e => setMessage(e.message),
  });

  /*
   * 슬랙 백필 — 한 번에 다 못 가져오는 것이 정상이다.
   * 슬랙이 새 앱의 history 를 분당 1회로 조이기 때문에, 남으면 커서를 들고
   * 있다가 「이어서 가져오기」로 멈춘 자리에서 계속한다.
   */
  /*
   * 주민번호 원본 보기.
   *
   * 목록에서는 이미 서버가 가려서 보낸다 (마스킹은 API 응답 단계다 — 여기서만
   * 가리면 네트워크 탭에 그대로 보인다). 이 버튼은 서버에 원본을 따로 달라고
   * 하는 것이고, 서버는 비밀번호를 다시 확인했는지 보고 거부할 수 있다.
   */
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [needsReauthFor, setNeedsReauthFor] = useState<string | null>(null);
  const reveal = trpc.erp.intake.revealRaw.useMutation({
    onSuccess: result => {
      setRevealed(prev => ({ ...prev, [result.id]: result.raw ?? "" }));
      setNeedsReauthFor(null);
    },
    onError: (error, variables) => {
      if (error.message.includes("비밀번호를 다시")) {
        setNeedsReauthFor(variables.id);
        return;
      }
      setMessage(error.message);
    },
  });

  const backfill = trpc.erp.intake.backfillSlack.useMutation({
    onSuccess: async result => {
      setBackfillLines(previous => {
        const merged = new Map(
          (previous ?? []).map(line => [line.channel, line])
        );
        for (const line of result.channels) merged.set(line.channel, line);
        return Array.from(merged.values());
      });
      setResumeAt(
        Date.now() + Math.max(result.retryAfterSec ?? 2, 2) * 1000 + 1000
      );
      if (
        !result.remaining ||
        result.stopped === "error" ||
        (result.stopped !== "ratelimited" &&
          result.channels.some(line => line.error))
      )
        setAutoBackfill(false);
      setCursors(result.remaining ? result.cursors : null);
      setBackfillNote(
        `${result.from} 이후를 훑었습니다 — 검수함에 ${result.totals.collected}건 추가` +
          (result.totals.duplicate > 0
            ? ` · 이미 있던 ${result.totals.duplicate}건은 건너뜀`
            : "") +
          (result.totals.ignored > 0
            ? ` · 지출 요청이 아닌 ${result.totals.ignored}건 제외`
            : "") +
          (result.totals.failed > 0
            ? ` · 읽지 못한 ${result.totals.failed}건은 검수함에 원문으로 남김`
            : "") +
          `. ${result.note}`
      );
      await refresh();
    },
    onError: error => {
      setAutoBackfill(false);
      /*
       * `Failed to fetch` 는 서버가 준 말이 아니라 **브라우저가 연결을 잃었을
       * 때** 나오는 말이다. 그대로 보여 주면 무엇이 잘못됐는지 알 길이 없다.
       * 이 경우 대부분은 함수가 시간 안에 못 끝난 것이고, 그때까지 들여온
       * 것은 남아 있으므로 다시 누르면 이어진다.
       */
      const lost =
        error.message.includes("Failed to fetch") ||
        error.message.includes("NetworkError") ||
        error.message.includes("Load failed");
      setBackfillNote(
        lost
          ? "서버가 시간 안에 끝내지 못했습니다. 그때까지 가져온 것은 남아 있으니 다시 누르십시오 — 누를 때마다 조금씩 앞으로 갑니다."
          : error.message
      );
    },
  });

  useEffect(() => {
    if (!autoBackfill) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [autoBackfill]);
  useEffect(() => {
    if (autoBackfill && cursors && !backfill.isPending && clock >= resumeAt) {
      backfill.mutate({ days, cursors });
    }
  }, [autoBackfill, cursors, backfill.isPending, clock, resumeAt, days]);

  /*
   * 첨부 읽기 — 백필과 따로 둔 이유.
   *
   * 수집하면서 파일까지 읽으면 메시지마다 내려받기와 모델 호출이 붙어 한 번의
   * 호출이 몇 분씩 걸린다. 그래서 수집은 파일 **정보만** 남기고, 내용은
   * 여기서 몇 건씩 읽는다.
   */
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const [autoAttachments, setAutoAttachments] = useState(false);
  const readAttachments = trpc.erp.intake.readAttachments.useMutation({
    onSuccess: async result => {
      setAttachNote(result.note);
      if (result.unattempted === 0 || result.read + result.failed === 0) setAutoAttachments(false);
      await refresh();
    },
    onError: error => {
      setAutoAttachments(false);
      setAttachNote(
        error.message.includes("Failed to fetch")
          ? "서버가 시간 안에 끝내지 못했습니다 — 다시 누르면 이어서 읽습니다."
          : error.message
      );
    },
  });
  useEffect(() => {
    if (!autoAttachments || readAttachments.isPending) return;
    const timer = window.setTimeout(() => readAttachments.mutate({ limit: 3 }), 1000);
    return () => window.clearTimeout(timer);
  }, [autoAttachments, readAttachments.isPending]);

  return (
    <>
      <div className="ph">
        <div>
          <h1>수집 검수함</h1>
          <div className="desc">
            슬랙·은행·카드·홈택스에서 들어온 것이 원장에 바로 적재되지 않고
            여기서 사람 확인을 거칩니다. 파싱에 실패한 메시지도 사라지지 않고
            여기 남습니다.
          </div>
        </div>
      </div>

      <div className="kpis">
        <Tile
          label="대기"
          value={`${intakes.filter(i => i.status === "waiting").length}건`}
          note="사람 확인 대기"
        />
        <Tile
          label="파싱 실패"
          value={`${intakes.filter(i => i.status === "failed").length}건`}
          note="수기 입력 필요"
          tone="warn"
        />
        <Tile
          label="원장 적재"
          value={`${intakes.filter(i => i.status === "promoted").length}건`}
          note="검수 통과"
          tone="ok"
        />
      </div>

      {/*
        지출결의서·계약서 서명요청 — 금액도 양식도 없어 원장 건이 될 수 없다.
        대신 원장과 대조해 「반영됐다 / 아직 없다」를 보여 준다. **자동으로
        잇지 않는다** — 잘못 이으면 같은 지출이 두 번 잡히거나, 결재가 끝난
        것처럼 보이는데 실제로는 다른 건이 결재된 상태가 된다.
      */}
      {cross.data && cross.data.rows.length > 0 ? (
        <Card
          title="결의서 · 계약서 대조"
          meta={`${cross.data.summary.total}건 · 원장 반영 ${cross.data.summary.reflected}건`}
          body={false}
        >
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>종류</th>
                  <th>원문</th>
                  <th>항목</th>
                  <th>원장 대조</th>
                </tr>
              </thead>
              <tbody>
                {cross.data.rows.map(row => (
                  <tr key={row.id}>
                    <td>
                      {row.kind}
                      <div className="s">{shortDate(row.receivedAt)}</div>
                    </td>
                    <td className="wrap s">{row.raw}</td>
                    <td className="wrap">
                      {row.names.length > 0 ? row.names.join(" · ") : "—"}
                    </td>
                    <td className="wrap">
                      <div style={{ marginBottom: 4 }}>
                        <span className={row.reflected ? "chip o" : "chip w"}>
                          {row.reflected ? "원장 반영됨" : "확인 필요"}
                        </span>{" "}
                        <span className="s">{row.note}</span>
                      </div>
                      {row.matches.map(match => (
                        <div key={match.name} className="s">
                          <b>{match.name}</b> — {match.verdict}
                          {match.candidates.length > 0
                            ? ` · ${match.candidates
                                .map(c => `${c.code} (${c.reasons.join(", ")})`)
                                .join(" / ")}`
                            : ""}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            짝짓기는 <b>사람이 확인해야 합니다.</b> 자동으로 이으면 같은 지출이
            두 번 잡히거나, 결재가 끝난 것처럼 보이는데 실제로는 다른 건이
            결재된 상태가 됩니다.
          </Note>
        </Card>
      ) : null}

      <Card title="슬랙 과거 메시지 가져오기" meta="대표만">
        <Note>
          슬랙 연동은 <b>구독을 켠 다음</b>에 올라온 메시지만 보냅니다. 그
          이전에 오간 집행요청은 여기서 따로 가져와야 합니다. 가져온 것도
          검수함까지만 오고, 원장 적재는 아래에서 직접 누르셔야 합니다.
          <br />
          <b>365일로 두십시오.</b> 지출 채널은 마지막 글이 오래돼서 30일로
          잡으면 0건이 나옵니다. 한 번에 다 못 가져오는 것이 정상입니다 — 버튼이{" "}
          <b>「이어서 가져오기」</b>로 바뀌면 그게 안 뜰 때까지 계속 누르시면
          멈춘 자리에서 이어집니다. 여러 번 눌러도 같은 건이 두 번 들어가지
          않습니다. 자동 수집은 슬랙의 대기 시간을 지켜 이어갑니다. 창을 닫아도
          진행 위치는 이 브라우저에 남으며, 다시 열어 이어갈 수 있습니다.
        </Note>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 10,
          }}
        >
          <label className="s" htmlFor="backfill-days">
            최근
          </label>
          <select
            id="backfill-days"
            value={days}
            onChange={event => {
              setDays(Number(event.target.value));
              setCursors(null);
              setBackfillLines(null);
              setBackfillNote(null);
            }}
            disabled={backfill.isPending || autoBackfill}
          >
            <option value={7}>7일</option>
            <option value={30}>30일 (한 달)</option>
            <option value={60}>60일</option>
            <option value={90}>90일 (분기)</option>
            <option value={180}>180일</option>
            <option value={365}>365일 (1년) — 권장</option>
          </select>
          <button
            type="button"
            className="btn pri"
            disabled={
              backfill.isPending || autoBackfill || me.data?.role !== "대표"
            }
            onClick={() =>
              backfill.mutate({ days, cursors: cursors ?? undefined })
            }
          >
            {backfill.isPending
              ? "가져오는 중…"
              : cursors
                ? "이어서 가져오기"
                : "가져오기"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={
              me.data?.role !== "대표" || (!autoBackfill && backfill.isPending)
            }
            onClick={() => {
              if (autoBackfill) {
                setAutoBackfill(false);
                return;
              }
              setAutoBackfill(true);
              setResumeAt(Date.now() + 3000);
              backfill.mutate({ days, cursors: cursors ?? undefined });
            }}
          >
            {autoBackfill ? "자동 수집 일시정지" : "끝까지 자동으로 가져오기"}
          </button>
          {autoBackfill ? (
            <span className="s">
              {backfill.isPending
                ? "수집 중"
                : `${Math.max(0, Math.ceil((resumeAt - clock) / 1000))}초 후 계속`}{" "}
              · 이 화면을 열어 두십시오
            </span>
          ) : null}
          {cursors ? (
            <button
              type="button"
              className="btn"
              disabled={backfill.isPending || autoBackfill}
              onClick={() => {
                setCursors(null);
                setBackfillNote(null);
                setBackfillLines(null);
              }}
            >
              처음부터
            </button>
          ) : null}
        </div>
        {me.data?.role !== "대표" ? (
          <p className="s" style={{ marginTop: 6 }}>
            원장 앞단을 통째로 채우는 작업이라 대표만 실행할 수 있습니다.
          </p>
        ) : null}
        {backfillNote ? (
          <div style={{ marginTop: 10 }}>
            <Note tone={cursors ? "warn" : undefined}>{backfillNote}</Note>
          </div>
        ) : null}
        {backfillLines && backfillLines.length > 0 ? (
          <div className="scroll" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>채널</th>
                  <th>훑음</th>
                  <th>추가</th>
                  <th>중복</th>
                  <th>제외</th>
                  <th>마지막 글</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {backfillLines.map(line => (
                  <tr key={line.channel}>
                    <td>
                      {line.name ? `#${line.name}` : line.channel}
                      {line.name ? (
                        <div className="s">{line.channel}</div>
                      ) : null}
                    </td>
                    <td>{line.scanned}</td>
                    <td>{line.collected}</td>
                    <td>{line.duplicate}</td>
                    <td>{line.ignored}</td>
                    <td className="wrap">
                      {line.lastMessageAt ?? "—"}
                      {line.dormant ? (
                        <div className="s">30일 내 글 없음 · 안 쓰는 채널</div>
                      ) : null}
                    </td>
                    <td className="wrap">
                      {line.error ?? (line.done ? "완료" : "남음")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card title="첨부 읽기" meta="계약서 PDF · 견적서 · 캡처">
        <Note>
          수집은 파일 <b>이름만</b> 먼저 남깁니다. 내용은 여기서 읽습니다 —
          수집하면서 같이 읽으면 파일 하나마다 내려받기와 해독이 붙어 서버가
          시간 안에 못 끝냅니다.
          <br />한 번에 <b>최대 3개 파일</b>을 읽습니다. 처음 읽는 파일을 먼저 처리하며, 실패한 파일도 남은 수에 포함됩니다. 남았다고 나오면 다시 누르십시오.
        </Note>
        <button
          type="button"
          className="btn pri"
          style={{ marginTop: 10 }}
          disabled={readAttachments.isPending}
          onClick={() => readAttachments.mutate({ limit: 3 })}
        >
          {readAttachments.isPending ? "읽는 중…" : "첨부 읽기"}
        </button>
        <button type="button" className="btn" style={{ marginLeft: 8 }}
          onClick={() => setAutoAttachments(value => !value)}>
          {autoAttachments ? "첨부 자동 읽기 일시정지" : "남은 첨부 자동으로 읽기"}
        </button>
        <p className="s">자동 읽기는 이 화면을 열어 둔 동안 진행됩니다. 모든 미시도 파일을 한 번씩 처리한 뒤 멈추며, 실패 파일은 원인과 함께 남습니다.</p>
        {attachNote ? (
          <div style={{ marginTop: 10 }}>
            <Note>{attachNote}</Note>
          </div>
        ) : null}
        {readAttachments.data && readAttachments.data.rows.length > 0 ? (
          <div className="scroll" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>파일</th>
                  <th>결과</th>
                </tr>
              </thead>
              <tbody>
                {readAttachments.data.rows.map((row, i) => (
                  <tr key={`${row.id}-${i}`}>
                    <td className="wrap">{row.name}</td>
                    <td className="wrap">
                      <span className={row.ok ? "chip o" : "chip w"}>
                        {row.ok ? "읽음" : "실패"}
                      </span>{" "}
                      <span className="s">{row.note}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {intakes.length === 0 ? (
        <Note tone="warn">
          아직 수집된 항목이 없습니다. 슬랙 연동을 막 켜셨다면 위에서 과거
          메시지를 먼저 가져오십시오 — 구독 이후에 올라온 것만 자동으로
          들어옵니다.
        </Note>
      ) : (
        <Card title="검수 대기" meta={`${intakes.length}건`} body={false}>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>수집</th>
                  <th>원문</th>
                  <th>상태</th>
                  <th>실패 사유</th>
                  <th>원장</th>
                </tr>
              </thead>
              <tbody>
                {intakes.map(intake => (
                  <tr key={intake.id}>
                    <td>
                      {intake.source}
                      {intake.channel ? (
                        <div className="s">채널 {intake.channel}</div>
                      ) : null}
                      <span className="s"> · {intake.sourceRef}</span>
                    </td>
                    <td className="wrap">
                      {revealed[intake.id] ?? intake.raw}
                      {intake.hasSensitive ? (
                        <div style={{ marginTop: 6 }}>
                          <span className="s">
                            가려진 항목 — {intake.sensitiveKinds.join(" · ")}
                          </span>
                          <br />
                          {revealed[intake.id] ? (
                            <button
                              type="button"
                              className="btn"
                              onClick={() =>
                                setRevealed(prev => {
                                  const next = { ...prev };
                                  delete next[intake.id];
                                  return next;
                                })
                              }
                            >
                              다시 가리기
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn"
                              disabled={reveal.isPending || !intake.canReveal}
                              onClick={() => reveal.mutate({ id: intake.id })}
                              title={
                                intake.canReveal
                                  ? "비밀번호를 다시 확인한 뒤에 열립니다"
                                  : "원천징수와 지급을 처리하는 역할만 열 수 있습니다"
                              }
                            >
                              원본 보기
                            </button>
                          )}
                          {needsReauthFor === intake.id ? (
                            <div style={{ marginTop: 8 }}>
                              <Reauth
                                what="주민등록번호·계좌번호"
                                onDone={() => reveal.mutate({ id: intake.id })}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td>{intake.status}</td>
                    <td className="wrap">{intake.failReason ?? "—"}</td>
                    <td>
                      {intake.entryId ?? <span className="s">미적재</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title="슬랙 지출요청 → 원장 매핑 (§11.1)"
        meta="양식을 새로 만들지 않습니다"
        body={false}
      >
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>슬랙 필드</th>
                <th>entry 필드</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {SLACK_FIELDS.map(([slack, field, note]) => (
                <tr key={slack}>
                  <td>{slack}</td>
                  <td style={{ fontFamily: "var(--mono)" }}>{field}</td>
                  <td className="wrap">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="승인은 슬랙에서 하지 않습니다">
        <p style={{ margin: 0 }}>
          슬랙 스레드의 👍는 참고 이력으로만 저장하고, 원장의 승인은 시스템
          안에서 이뤄집니다 — 그래야 누가 언제 승인했는지가 감사로그에 남습니다.{" "}
          <button
            type="button"
            className="btn"
            onClick={() => goto("approvals")}
          >
            승인 대기로
          </button>
        </p>
      </Card>
    </>
  );
}
