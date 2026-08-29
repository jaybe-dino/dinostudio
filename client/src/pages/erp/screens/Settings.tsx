/**
 * 기준값 — 임시 기본값과 기준값이 전부 여기 있다.
 * is_provisional이면 화면에 「임시」 배지가 붙고, 변경은 감사로그에 남는다.
 */
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
import { matchesQuery, useErpUi } from "../context";

const LABELS: Record<string, string> = {
  cash_on_hand: "보유현금 (계좌 대사 기준)",
  cash_requirement_horizon: "지급 소요 지평",
  payroll_monthly_actual: "급여 실액 · 월 총액 (B1)",
  vat_display_basis: "VAT 표기 기준 (B3)",
  approval_single_limit: "1인 승인 한도",
  debt_long_term_total: "장기 차입 총액 (건별 미분해)",
  pipeline_probability: "성사 가능성 환산율 (B10)",
  today_override: "기준일 (D-day 판정)",
  opening_equity: "기초 자본 (B6)",
  subscriptions: "구독 목록",
};

export function SettingsScreen() {
  const { query } = useErpUi();
  const settings = trpc.erp.settings.useQuery();
  const rows = (settings.data ?? []).filter(s =>
    matchesQuery(query, s.key, LABELS[s.key])
  );
  const provisional = rows.filter(s => s.isProvisional);
  const empty = rows.filter(s => s.value == null);

  return (
    <div className="erp-page">
      <header>
        <h1>기준값</h1>
        <p>
          숫자를 코드에 박지 않고 전부 여기에 둡니다. 임시값으로 개발을 진행하되
          값이 확정되면 이 화면에서 교체하고, 교체 이력은 감사로그에 남습니다.
        </p>
      </header>

      <div className="erp-tiles">
        <Tile
          label="기준값"
          value={`${rows.length}개`}
          note="설정으로 교체 가능"
        />
        <Tile
          label="임시값"
          value={`${provisional.length}개`}
          note="확정 전까지 「임시」 배지"
          tone="warn"
        />
        <Tile
          label="비어 있는 값"
          value={`${empty.length}개`}
          note="이 값이 없어 막혀 있는 지표가 있습니다"
          tone={empty.length ? "alert" : "ok"}
        />
      </div>

      <Note tone="warn">
        임계선 · 손익분기 · 커버리지는 번레이트가 확정된 뒤 이 화면에서 대표
        승인을 거쳐 다시 세웁니다. 추정 분모에서 파생된 기준선은 전부
        폐기했습니다.
      </Note>

      <Card title="설정" meta={`${rows.length}개`} body={false}>
        <div className="erp-scroll">
          <table className="erp-table">
            <thead>
              <tr>
                <th>키</th>
                <th>의미</th>
                <th>값</th>
                <th>확정도</th>
                <th>담당</th>
                <th>갱신</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(setting => (
                <tr key={setting.key}>
                  <td style={{ fontFamily: "var(--mono)" }}>{setting.key}</td>
                  <td className="wrap">{LABELS[setting.key] ?? "—"}</td>
                  <td className="num">
                    {setting.value == null ? (
                      <span className="erp-null">미확정</span>
                    ) : typeof setting.value === "number" ? (
                      setting.value.toLocaleString("ko-KR")
                    ) : (
                      String(setting.value)
                    )}
                  </td>
                  <td>
                    <span
                      className="erp-chip"
                      data-tone={setting.isProvisional ? "warn" : "ok"}
                    >
                      {setting.isProvisional ? "임시" : "확정"}
                    </span>
                  </td>
                  <td>{setting.ownerRole ?? "—"}</td>
                  <td className="erp-null">
                    {setting.updatedAt ? setting.updatedAt.slice(0, 10) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
