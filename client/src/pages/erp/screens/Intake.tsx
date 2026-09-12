/**
 * 수집 검수함 — 원장 진입 전 대기열. 파싱 실패도 여기 남는다 (§11.1).
 * 승인은 슬랙에서 하지 않는다. 슬랙의 👍는 참고 이력이고 승인은 시스템 안에서만 이뤄진다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
import { Reauth } from "../components/Reauth";
import { useErpUi } from "../context";

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
}

export function IntakeScreen() {
  const { goto, openEntry } = useErpUi();
  const utils = trpc.useUtils();
  const masters = trpc.erp.masters.useQuery();
  const intakes = masters.data?.intakes ?? [];
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const me = trpc.erp.me.useQuery();
  const [days, setDays] = useState(30);
  const [cursors, setCursors] = useState<Record<string, string> | null>(null);
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
      setBackfillLines(result.channels);
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
      setBackfillLines(null);
      setBackfillNote(error.message);
    },
  });

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

      <Card title="슬랙 과거 메시지 가져오기" meta="대표만">
        <Note>
          슬랙 연동은 <b>구독을 켠 다음</b>에 올라온 메시지만 보냅니다. 그
          이전에 오간 집행요청은 여기서 따로 가져와야 합니다. 가져온 것도
          검수함까지만 오고, 원장 적재는 아래에서 직접 누르셔야 합니다.
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
            }}
            disabled={backfill.isPending}
          >
            <option value={7}>7일</option>
            <option value={30}>30일 (한 달)</option>
            <option value={60}>60일</option>
            <option value={90}>90일 (분기)</option>
            <option value={180}>180일</option>
            <option value={365}>365일 (1년)</option>
          </select>
          <button
            type="button"
            className="btn pri"
            disabled={backfill.isPending || me.data?.role !== "대표"}
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
          {cursors ? (
            <button
              type="button"
              className="btn"
              disabled={backfill.isPending}
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
                      {line.error ?? (line.done ? "완료" : "남음")}
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
                                  : "원천징수를 처리하는 역할만 열 수 있습니다"
                              }
                            >
                              주민번호 보기
                            </button>
                          )}
                          {needsReauthFor === intake.id ? (
                            <div style={{ marginTop: 8 }}>
                              <Reauth
                                what="주민등록번호"
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
