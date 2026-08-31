/**
 * 경영자 3줄 브리프 (E1 CFO · E2 런웨이)
 *
 * 표를 읽어야 판단이 나오면 늦다. 화면에 들어오는 순간
 *   ① 지금 얼마가 모자라나  ② 오늘 무엇을 결정해야 하나  ③ 얼마나 버티나
 * 세 가지를 먼저 답한다.
 *
 * 「런웨이」라고만 쓰지 않는다 — 단순/예약을 라벨과 함께 쓴다 (원칙 3 · T15).
 */
import { trpc } from "@/lib/trpc";
import { useErpUi } from "../context";
import { nullReasonText, won } from "../format";

export function Brief() {
  const brief = trpc.erp.brief.useQuery();
  const { goto } = useErpUi();
  const d = brief.data;

  // 로그인 전이거나 아직 못 불러왔으면 자리를 차지하지 않는다
  if (!d) return null;

  const p0 = d.shortfall.p0;
  const short = p0?.shortfall ?? null;
  const tone =
    short == null
      ? "n"
      : short < 0
        ? "a"
        : d.runway.threshold === "warning"
          ? "w"
          : "g";

  return (
    <div className="kpis" style={{ marginBottom: 2 }}>
      <button
        type="button"
        className={`kpi ${short != null && short < 0 ? "bad" : ""}`}
        style={{
          textAlign: "left",
          border: 0,
          font: "inherit",
          cursor: "pointer",
        }}
        onClick={() => goto("cash-position")}
      >
        <div className="k">지금 모자란 돈 · P0</div>
        <div className="v">{short == null ? "계산 불가" : won(short)}</div>
        <div className="s">
          {short == null
            ? "보유현금이 확정되지 않았습니다"
            : short < 0
              ? `미룰 수 없는 것만 내도 ${won(Math.abs(short))} 부족합니다`
              : "미룰 수 없는 것을 내고도 남습니다"}
          {d.shortfall.isProvisional ? " · 잠정치" : ""}
        </div>
      </button>

      <button
        type="button"
        className={`kpi ${d.decisions.irreversible > 0 ? "bad" : ""}`}
        style={{
          textAlign: "left",
          border: 0,
          font: "inherit",
          cursor: "pointer",
        }}
        onClick={() => goto("today")}
      >
        <div className="k">오늘 결정할 것</div>
        <div className="v">{d.decisions.owner}건</div>
        <div className="s">
          {d.decisions.irreversible > 0
            ? `되돌릴 수 없는 것 ${d.decisions.irreversible}건 — ${d.decisions.top?.title ?? ""}`
            : d.decisions.owner > 0
              ? (d.decisions.top?.title ?? "")
              : `대표 결정 없음 · 리더 ${d.decisions.leader}건`}
        </div>
      </button>

      <button
        type="button"
        className={`kpi ${d.runway.threshold === "critical" ? "bad" : d.runway.threshold === "warning" ? "warn" : ""}`}
        style={{
          textAlign: "left",
          border: 0,
          font: "inherit",
          cursor: "pointer",
        }}
        onClick={() => goto("burnrate")}
      >
        <div className="k">예약런웨이</div>
        <div className="v">
          {d.runway.reserved.value == null
            ? "계산 불가"
            : `${d.runway.reserved.value}개월`}
        </div>
        <div className="s">
          {d.runway.reserved.value == null
            ? nullReasonText(d.runway.reserved.nullReason)
            : d.runway.expectedWeeks != null
              ? `예상런웨이 ${d.runway.expectedWeeks}주 · 승인대기와 세금을 뺀 값`
              : "승인대기와 세금을 뺀 값"}
        </div>
      </button>
    </div>
  );
}
