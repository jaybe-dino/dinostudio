/**
 * 기준값 — 임시 기본값과 기준값이 전부 여기 있다.
 * is_provisional이면 화면에 「임시」 배지가 붙고, 변경은 감사로그에 남는다.
 */
import { useState } from "react";
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

/** 값의 모양 — 숫자·날짜·목록을 구분해 입력칸을 맞춘다 */
const KINDS: Record<string, "number" | "date" | "json"> = {
  cash_on_hand: "number",
  payroll_monthly_actual: "number",
  approval_single_limit: "number",
  debt_long_term_total: "number",
  opening_equity: "number",
  cash_requirement_horizon: "date",
  today_override: "date",
  pipeline_probability: "json",
  subscriptions: "json",
  vat_display_basis: "json",
  closed_periods: "json",
};

export function SettingsScreen() {
  const { query } = useErpUi();
  const utils = trpc.useUtils();
  const settings = trpc.erp.settings.useQuery();
  const me = trpc.erp.me.useQuery();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const put = trpc.erp.putSetting.useMutation({
    onSuccess: async saved => {
      setMessage(
        `${saved.key} 저장했습니다 — 변경 이력이 감사로그에 남았습니다.`
      );
      setDraft(prev => {
        const next = { ...prev };
        delete next[saved.key];
        return next;
      });
      await utils.erp.invalidate();
    },
    onError: error => setMessage(error.message),
  });

  const canWrite = me.data?.role === "대표" || me.data?.role === "재무";

  const parseValue = (key: string, raw: string): unknown => {
    if (raw.trim() === "") return null;
    const kind = KINDS[key] ?? "json";
    if (kind === "number") {
      const digits = raw.replace(/[^0-9-]/g, "");
      return digits === "" ? null : Number(digits);
    }
    if (kind === "date") return raw.trim();
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };
  const rows = (settings.data ?? []).filter(s =>
    matchesQuery(query, s.key, LABELS[s.key])
  );
  const provisional = rows.filter(s => s.isProvisional);
  const empty = rows.filter(s => s.value == null);

  return (
    <>
      <div className="ph">
        <div>
          <h1>기준값</h1>
          <div className="desc">
            숫자를 코드에 박지 않고 전부 여기에 둡니다. 임시값으로 개발을
            진행하되 값이 확정되면 이 화면에서 교체하고, 교체 이력은 감사로그에
            남습니다.
          </div>
        </div>
      </div>

      <div className="kpis">
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

      {message ? <Note>{message}</Note> : null}
      {canWrite ? null : (
        <Note tone="warn">
          {me.data?.role ?? "이"} 역할은 기준값을 변경할 수 없습니다 — 대표 또는
          재무만 가능합니다 (§13.1).
        </Note>
      )}

      <Note tone="warn">
        임계선 · 손익분기 · 커버리지는 번레이트가 확정된 뒤 이 화면에서 대표
        승인을 거쳐 다시 세웁니다. 추정 분모에서 파생된 기준선은 전부
        폐기했습니다.
      </Note>

      <Card title="설정" meta={`${rows.length}개`} body={false}>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>키</th>
                <th>의미</th>
                <th>값</th>
                <th>확정도</th>
                <th>담당</th>
                <th>갱신</th>
                <th>변경</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(setting => (
                <tr key={setting.key}>
                  <td style={{ fontFamily: "var(--mono)" }}>{setting.key}</td>
                  <td className="wrap">{LABELS[setting.key] ?? "—"}</td>
                  <td className="num">
                    {setting.value == null ? (
                      <span className="s">미확정</span>
                    ) : typeof setting.value === "number" ? (
                      setting.value.toLocaleString("ko-KR")
                    ) : (
                      String(setting.value)
                    )}
                  </td>
                  <td>
                    <span
                      className="chip"
                      data-tone={setting.isProvisional ? "warn" : "ok"}
                    >
                      {setting.isProvisional ? "임시" : "확정"}
                    </span>
                  </td>
                  <td>{setting.ownerRole ?? "—"}</td>
                  <td className="s">
                    {setting.updatedAt ? setting.updatedAt.slice(0, 10) : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input
                        type={KINDS[setting.key] === "date" ? "date" : "text"}
                        value={
                          draft[setting.key] ??
                          (setting.value == null
                            ? ""
                            : typeof setting.value === "object"
                              ? JSON.stringify(setting.value)
                              : String(setting.value))
                        }
                        onChange={e =>
                          setDraft(prev => ({
                            ...prev,
                            [setting.key]: e.target.value,
                          }))
                        }
                        disabled={!canWrite}
                        style={{
                          width: 150,
                          padding: "3px 6px",
                          border: "1px solid var(--rule)",
                          borderRadius: 4,
                          font: "inherit",
                        }}
                      />
                      <button
                        type="button"
                        className="btn"
                        disabled={
                          !canWrite ||
                          draft[setting.key] === undefined ||
                          put.isPending
                        }
                        onClick={() =>
                          put.mutate({
                            key: setting.key,
                            value: parseValue(
                              setting.key,
                              draft[setting.key] ?? ""
                            ),
                            // 사람이 확정한 값이므로 임시 배지를 뗀다
                            isProvisional: false,
                          })
                        }
                      >
                        저장
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
