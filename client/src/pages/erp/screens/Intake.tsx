/**
 * 수집 검수함 — 원장 진입 전 대기열. 파싱 실패도 여기 남는다 (§11.1).
 * 승인은 슬랙에서 하지 않는다. 슬랙의 👍는 참고 이력이고 승인은 시스템 안에서만 이뤄진다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
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

export function IntakeScreen() {
  const { goto, openEntry } = useErpUi();
  const utils = trpc.useUtils();
  const masters = trpc.erp.masters.useQuery();
  const intakes = masters.data?.intakes ?? [];
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");

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

  return (
    <div className="erp-page">
      <header>
        <h1>수집 검수함</h1>
        <p>
          슬랙·은행·카드·홈택스에서 들어온 것이 원장에 바로 적재되지 않고 여기서
          사람 확인을 거칩니다. 파싱에 실패한 메시지도 사라지지 않고 여기
          남습니다.
        </p>
      </header>

      <div className="erp-tiles">
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

      {intakes.length === 0 ? (
        <Note tone="warn">
          연동이 아직 켜져 있지 않아 수집된 항목이 없습니다.
          #지출-네트워크-사업부는 봇이 이미 정형 메시지를 생성하고 있으므로
          파서만 붙이면 되고, #지출-ip-사업부는 수기라 파싱 실패를 허용합니다.
          알림 도착지(B7)와 함께 슬랙 워크스페이스를 살리는 것이 선행
          조건입니다.
        </Note>
      ) : (
        <Card title="검수 대기" meta={`${intakes.length}건`} body={false}>
          <div className="erp-scroll">
            <table className="erp-table">
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
                      <span className="erp-null"> · {intake.sourceRef}</span>
                    </td>
                    <td className="wrap">{intake.raw}</td>
                    <td>{intake.status}</td>
                    <td className="wrap">{intake.failReason ?? "—"}</td>
                    <td>
                      {intake.entryId ?? (
                        <span className="erp-null">미적재</span>
                      )}
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
        <div className="erp-scroll">
          <table className="erp-table">
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
            className="erp-btn"
            onClick={() => goto("approvals")}
          >
            승인 대기로
          </button>
        </p>
      </Card>
    </div>
  );
}
