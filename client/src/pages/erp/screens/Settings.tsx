/**
 * 기준값 — 임시 기본값과 기준값이 전부 여기 있다.
 * is_provisional이면 화면에 「임시」 배지가 붙고, 변경은 감사로그에 남는다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile, chipClass } from "../components/Bits";
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
  credit_lines: "여신 한도 — 마이너스통장 · 법인카드 (C4)",
  bank_accounts: "계좌 목록 · 은행 잔액 (C5)",
  ar_aging_buckets: "채권 연령 구간 (C7)",
  allocation_basis: "공통비 배부 기준 (E8)",
  project_remaining_estimates: "프로젝트별 잔여 원가 추정 (E4)",
  headcount: "인원 수 (E7 인당 생산성)",
};

/**
 * 어느 묶음에 속하는가. 기준값이 16개가 되면서 한 줄로 늘어놓으면 무엇부터
 * 넣어야 할지가 안 보였다 — 급한 것과 나중 것이 섞여 있었다.
 */
const GROUPS: { id: string; label: string; desc: string; keys: string[] }[] = [
  {
    id: "cash",
    label: "① 현금 — 먼저 넣어야 할 것",
    desc: "이 셋이 없으면 런웨이·부족액이 계산되지 않습니다",
    keys: [
      "cash_on_hand",
      "payroll_monthly_actual",
      "cash_requirement_horizon",
    ],
  },
  {
    id: "account",
    label: "② 계좌 · 여신",
    desc: "대사의 단위이고, 부족액의 의미를 판단하는 근거입니다",
    keys: ["bank_accounts", "credit_lines", "debt_long_term_total"],
  },
  {
    id: "judgement",
    label: "③ 판단 기준 — 대표 결정",
    desc: "시스템이 고르면 근거가 없는 숫자가 됩니다",
    keys: [
      "allocation_basis",
      "ar_aging_buckets",
      "pipeline_probability",
      "headcount",
      "approval_single_limit",
    ],
  },
  {
    id: "accounting",
    label: "④ 회계 · 세무",
    desc: "결산과 신고에 쓰이는 값입니다",
    keys: ["opening_equity", "vat_display_basis"],
  },
  {
    id: "ops",
    label: "⑤ 운영",
    desc: "구독·추정·기준일",
    keys: ["subscriptions", "project_remaining_estimates", "today_override"],
  },
];

/** 이 값이 없으면 무엇이 막히는가 — 넣을 이유를 그 자리에서 보여 준다 */
const BLOCKS: Record<string, string> = {
  cash_on_hand: "현금 현황 부족액 · 13주 자금계획 · 이월 기초잔액",
  payroll_monthly_actual: "번레이트 · 런웨이 3종 전부",
  cash_requirement_horizon: "부족액이 며칠치인지",
  bank_accounts: "계좌별 잔액 · 은행 대사",
  credit_lines: "여신 화면 · 즉시 동원 가능액",
  debt_long_term_total: "부채 원장의 장기 차입",
  allocation_basis: "사업부·프로젝트 손익의 공통비 배부",
  ar_aging_buckets: "채권 연령분석 구간",
  pipeline_probability: "13주 자금계획의 파이프라인",
  headcount: "인당 매출 · 인당 이익",
  approval_single_limit: "1인 승인 한도",
  opening_equity: "재무제표 5종 (지금은 가결산)",
  vat_display_basis: "부가세 표기 · 슬랙 파서",
  subscriptions: "번레이트 산출 조건 6번",
  project_remaining_estimates: "프로젝트 예상 마진",
  today_override: "D-day 판정 기준일",
};

/** 무엇을 어떤 모양으로 넣는지 — 형식이 틀리면 저장돼도 화면이 안 읽는다 */
const HINTS: Record<string, string> = {
  credit_lines:
    '[{"id":"1","name":"기업은행 마이너스","kind":"마이너스통장","limit":50000000,"used":20000000}]',
  bank_accounts:
    '[{"code":"1110-01","name":"주거래","bank":"기업은행","balance":30000000}]',
  ar_aging_buckets: "[30, 60, 90]",
  allocation_basis: '"매출 비율"',
  project_remaining_estimates: '{"PRJ-0132": 12000000}',
  subscriptions: '[{"name":"Adobe","monthly":60000}]',
  pipeline_probability: '{"상":0.7,"중":0.4,"하":0.1}',
  headcount: "8",
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
  credit_lines: "json",
  bank_accounts: "json",
  ar_aging_buckets: "json",
  allocation_basis: "json",
  project_remaining_estimates: "json",
  headcount: "number",
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

  /*
   * 묶음별로 나눈다. 어느 묶음에도 안 적힌 키는 마지막 「기타」로 몰아 둔다 —
   * 새 키를 추가하고 GROUPS 에 넣는 것을 잊어도 화면에서 사라지지 않아야 한다.
   */
  const grouped = GROUPS.map(group => ({
    ...group,
    rows: group.keys
      .map(key => rows.find(item => item.key === key))
      .filter((item): item is (typeof rows)[number] => item != null),
  })).filter(group => group.rows.length > 0);
  const listed = new Set(GROUPS.flatMap(g => g.keys));
  const others = rows.filter(item => !listed.has(item.key));
  const sections = others.length
    ? [
        ...grouped,
        {
          id: "etc",
          label: "기타",
          desc: "묶음에 아직 넣지 않은 값",
          keys: [],
          rows: others,
        },
      ]
    : grouped;

  /** 가장 급한 빈 값 — 무엇부터 넣어야 하는지 하나만 가리킨다 */
  const firstEmpty = GROUPS.flatMap(g => g.keys).find(
    key => rows.find(item => item.key === key)?.value == null
  );

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

      {firstEmpty ? (
        <Note tone="warn">
          <b>다음에 넣을 것 — {LABELS[firstEmpty] ?? firstEmpty}</b>
          <div style={{ marginTop: 4 }}>
            이 값이 없어서 <b>{BLOCKS[firstEmpty] ?? "일부 화면"}</b> 이 막혀
            있습니다. 아래 ① 묶음부터 순서대로 채우시면 됩니다 — 회색으로 떠
            있는 모양 그대로 넣으십시오.
          </div>
        </Note>
      ) : (
        <Note>
          기준값이 모두 채워져 있습니다. 값을 바꾸면 감사로그에 남고, 파생
          지표는 다음 조회에서 즉시 반영됩니다.
        </Note>
      )}

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

      {/* 묶음별로 나눠 보여 준다 — 무엇부터 넣어야 할지가 순서로 보이게 */}
      {sections.map(section => (
        <div key={section.id}>
          <Card
            title={section.label}
            meta={`${section.rows.length}개 · ${section.desc}`}
            body={false}
          >
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>의미</th>
                    <th>값</th>
                    <th>없으면 막히는 것</th>
                    <th>확정도</th>
                    <th>담당</th>
                    <th>변경</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map(setting => (
                    <tr key={setting.key}>
                      <td className="wrap">
                        {LABELS[setting.key] ?? setting.key}
                        <div
                          className="s"
                          style={{ fontFamily: "var(--mono)" }}
                        >
                          {setting.key}
                        </div>
                      </td>
                      <td className="n">
                        {setting.value == null ? (
                          <span className="s">미확정</span>
                        ) : typeof setting.value === "number" ? (
                          setting.value.toLocaleString("ko-KR")
                        ) : (
                          String(setting.value)
                        )}
                      </td>
                      <td className="wrap s">
                        {setting.value == null
                          ? (BLOCKS[setting.key] ?? "—")
                          : "—"}
                      </td>
                      <td>
                        <span
                          className={chipClass(
                            setting.isProvisional ? "warn" : "ok"
                          )}
                        >
                          {setting.isProvisional ? "임시" : "확정"}
                        </span>
                      </td>
                      <td className="nw">
                        {setting.ownerRole ?? "—"}
                        <div className="s">
                          {setting.updatedAt
                            ? setting.updatedAt.slice(0, 10)
                            : "미입력"}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <input
                            type={
                              KINDS[setting.key] === "date" ? "date" : "text"
                            }
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
                            // 형식이 틀리면 저장돼도 화면이 읽지 못한다 — 모양을 그대로 보여 준다
                            placeholder={HINTS[setting.key] ?? ""}
                            title={
                              HINTS[setting.key]
                                ? `이 모양으로 넣습니다 — ${HINTS[setting.key]}`
                                : undefined
                            }
                            style={{
                              width: HINTS[setting.key] ? 320 : 150,
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
        </div>
      ))}
    </>
  );
}
