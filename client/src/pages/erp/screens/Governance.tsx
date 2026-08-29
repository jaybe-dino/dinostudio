/**
 * 권한 · 내부통제 · 변경 이력 · 지표 신뢰도
 * 권한 적용은 1차 오픈의 필수 항목이었다 (G10). 이 화면은 실제로 적용된 매트릭스를 보여준다.
 */
import {
  ROLE_MATRIX,
  ROLES,
  rolesAllowedToApprove,
  type Resource,
  type Role,
} from "@shared/erp";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
import { matchesQuery, useErpUi } from "../context";
import { won } from "../format";

const RESOURCES: [Resource, string][] = [
  ["entry", "집행원장 · 전건"],
  ["priority_override", "우선순위 override"],
  ["payroll", "급여 · 인건비 상세"],
  ["debt", "부채 원장 · 약정"],
  ["account", "계정과목 마스터"],
  ["setting", "기준값 · 설정"],
  ["period_close", "월 마감 잠금/해제"],
  ["audit", "감사로그"],
];

function cell(resource: Resource, role: (typeof ROLES)[number]) {
  const p = ROLE_MATRIX[role][resource];
  const marks = [
    p.read ? "R" : "",
    p.write ? "W" : "",
    p.approve ? "A" : "",
  ].join("");
  if (!marks) return "—";
  return p.scope && p.scope !== "all"
    ? `${marks} (${p.scope === "own_bu" ? "자기 사업부" : "본인 입력분"})`
    : marks;
}

export function GovernanceScreen({
  variant,
}: {
  variant: "permissions" | "audit" | "reliability";
}) {
  const { query } = useErpUi();
  const utils = trpc.useUtils();
  const me = trpc.erp.me.useQuery();
  const users = trpc.erp.users.list.useQuery(undefined, { retry: false });
  const [draft, setDraft] = useState({ email: "", name: "", role: "담당자" as Role });
  const [message, setMessage] = useState<string | null>(null);
  const putUser = trpc.erp.users.put.useMutation({
    onSuccess: async saved => {
      setMessage(`${saved.email} → ${saved.role} 로 저장했습니다.`);
      setDraft({ email: "", name: "", role: "담당자" });
      await utils.erp.users.invalidate();
    },
    onError: e => setMessage(e.message),
  });
  const audit = trpc.erp.audit.useQuery({});
  const ledger = trpc.erp.entries.list.useQuery({});
  const runway = trpc.erp.runway.useQuery();
  const migration = trpc.erp.migration.useQuery();

  if (variant === "permissions") {
    return (
      <div className="erp-page">
        <header>
          <h1>권한 · 내부통제</h1>
          <p>
            R 조회 · W 입력/수정 · A 승인. 개인별 급여는 응답 단계에서
            마스킹되므로 프론트에서 숨기는 방식이 아닙니다 — 권한이 없는
            역할에는 금액 자체가 내려가지 않습니다.
          </p>
        </header>

        <div className="erp-tiles">
          <Tile
            label="내 역할"
            value={me.data?.role ?? "—"}
            note={me.data?.id ?? ""}
          />
          <Tile
            label="1인 승인 기본"
            value="5,000,000까지"
            note="사업부 리더 포함"
          />
          <Tile
            label="상위 승인"
            value="20,000,000까지"
            note="대표 · 부대표 · 재무"
            tone="warn"
          />
          <Tile
            label="대표 단독"
            value="20,000,000 초과"
            note="그 외 역할은 승인 불가"
            tone="alert"
          />
        </div>

        <Card
          title="역할 매트릭스"
          meta="대표 검토 후 확정 — 초안"
          body={false}
        >
          <div className="erp-scroll">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>리소스</th>
                  {ROLES.map(role => (
                    <th key={role}>{role}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RESOURCES.map(([resource, label]) => (
                  <tr key={resource}>
                    <td className="wrap">{label}</td>
                    {ROLES.map(role => (
                      <td key={role} style={{ fontFamily: "var(--mono)" }}>
                        {cell(resource, role)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td className="wrap">승인 — 금액 ≤ 5,000,000</td>
                  {ROLES.map(role => (
                    <td key={role} style={{ fontFamily: "var(--mono)" }}>
                      {rolesAllowedToApprove(5_000_000).includes(role)
                        ? "A"
                        : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="wrap">승인 — 5,000,001 ~ 20,000,000</td>
                  {ROLES.map(role => (
                    <td key={role} style={{ fontFamily: "var(--mono)" }}>
                      {rolesAllowedToApprove(20_000_000).includes(role)
                        ? "A"
                        : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="wrap">승인 — 20,000,000 초과</td>
                  {ROLES.map(role => (
                    <td key={role} style={{ fontFamily: "var(--mono)" }}>
                      {rolesAllowedToApprove(20_000_001).includes(role)
                        ? "A"
                        : "—"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="사용자 · 역할"
          meta={`${users.data?.length ?? 0}명 · 역할 지정은 대표만`}
          body={false}
        >
          <div className="erp-scroll">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>이메일</th>
                  <th>이름</th>
                  <th>역할</th>
                  <th>상태</th>
                  <th>변경</th>
                </tr>
              </thead>
              <tbody>
                {users.error ? (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--muted)" }}>
                      {users.error.message}
                    </td>
                  </tr>
                ) : (users.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--muted)" }}>
                      아직 배정된 계정이 없습니다 — 배정 전에는 환경변수 ERP_ROLE_MAP이 쓰입니다
                    </td>
                  </tr>
                ) : (
                  (users.data ?? []).map(user => (
                    <tr key={user.id}>
                      <td>{user.email}</td>
                      <td>{user.name}</td>
                      <td>
                        <span className="erp-chip" data-tone={user.role === "대표" ? "alert" : "info"}>
                          {user.role}
                        </span>
                      </td>
                      <td>{user.active ? "사용" : "정지"}</td>
                      <td>
                        <button
                          type="button"
                          className="erp-btn"
                          disabled={me.data?.role !== "대표" || putUser.isPending}
                          onClick={() => putUser.mutate({ ...user, active: !user.active })}
                        >
                          {user.active ? "정지" : "사용"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="erp-card-body">
            <div className="erp-filters">
              <label className="erp-field" style={{ flex: "1 1 220px" }}>
                <span>이메일 (회사 구글 계정)</span>
                <input
                  value={draft.email}
                  onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                />
              </label>
              <label className="erp-field">
                <span>이름</span>
                <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
              </label>
              <label className="erp-field">
                <span>역할</span>
                <select
                  value={draft.role}
                  onChange={e => setDraft(d => ({ ...d, role: e.target.value as Role }))}
                >
                  {ROLES.map(role => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="erp-btn"
                data-variant="primary"
                disabled={
                  me.data?.role !== "대표" ||
                  !draft.email.includes("@") ||
                  !draft.name.trim() ||
                  putUser.isPending
                }
                onClick={() =>
                  putUser.mutate({
                    id: draft.email.trim().toLowerCase(),
                    email: draft.email.trim().toLowerCase(),
                    name: draft.name.trim(),
                    role: draft.role,
                    active: true,
                  })
                }
              >
                계정 발급
              </button>
            </div>
            {message ? (
              <div style={{ marginTop: 8 }}>
                <Note>{message}</Note>
              </div>
            ) : null}
            <p className="erp-null" style={{ marginTop: 6 }}>
              권한을 나눠주는 일은 위임하지 않습니다 — 역할 지정은 대표만 할 수 있고 감사로그에 남습니다 (G13).
            </p>
          </div>
        </Card>

        <Card title="승인 규칙 (§13.2)">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              1인 승인이 기본. 20,000,000 초과만 대표 단독 승인으로 좁힙니다
            </li>
            <li>
              본인이 입력한 건을 본인이 승인할 수 없습니다 — 시스템이 거부합니다
            </li>
            <li>증빙이 없는 건은 보류까지만 가능하고 확정되지 않습니다</li>
            <li>
              중복 의심은 경고 후 강행 가능하되 강행 사유가 감사로그에 남습니다
            </li>
          </ul>
        </Card>

        <Card title="개인정보 · 민감정보 (§13.3)">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              개인별 급여는 API 응답 단계에서 마스킹합니다 — 프론트에서 숨기는
              방식은 금지
            </li>
            <li>급여·부채는 조회도 감사로그에 남습니다</li>
            <li>
              계좌번호는 뒤 4자리만 화면에 노출하고 전체는 지급 실행 시에만
            </li>
          </ul>
        </Card>
      </div>
    );
  }

  if (variant === "audit") {
    const rows = (audit.data ?? []).filter(a =>
      matchesQuery(query, a.rowId, a.action, a.actor)
    );
    return (
      <div className="erp-page">
        <header>
          <h1>변경 이력</h1>
          <p>
            데이터를 지우지 않습니다. 물리 삭제가 없고 모든 변경·승인·강행이
            여기 남습니다 — 3개월 뒤 「이 숫자가 어디서 왔나」를 되짚을 수
            있어야 하기 때문입니다.
          </p>
        </header>

        <div className="erp-tiles">
          <Tile
            label="기록"
            value={`${rows.length}건`}
            note="이 세션에서 발생한 변경"
          />
          <Tile
            label="물리 삭제"
            value="0건"
            note="DELETE를 제공하지 않습니다"
            tone="ok"
          />
        </div>

        <Card title="감사로그" meta={`${rows.length}건`} body={false}>
          <div className="erp-scroll">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>테이블</th>
                  <th>대상</th>
                  <th>동작</th>
                  <th>수행자</th>
                  <th>사유 · 변경 내용</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ color: "var(--muted)" }}>
                      아직 변경 기록이 없습니다 — 승인·수정·등급 상향을 하면
                      여기 쌓입니다
                    </td>
                  </tr>
                ) : (
                  rows.map(log => (
                    <tr key={log.id}>
                      <td className="erp-null">
                        {log.at.slice(0, 19).replace("T", " ")}
                      </td>
                      <td>{log.table}</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                        {log.rowId.slice(0, 14)}
                      </td>
                      <td>{log.action}</td>
                      <td>{log.actor}</td>
                      <td className="wrap erp-null">
                        {(() => {
                          const after = log.after as {
                            _reason?: string;
                          } | null;
                          return after?._reason ?? "—";
                        })()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  // 지표 신뢰도 — 어떤 지표가 왜 못 나오는지 한 화면에 모은다
  const undecided = ledger.data?.out.excluded.undecided.n ?? 0;
  const failing = (migration.data?.checks ?? []).filter(
    c => c.verdict === "fail"
  );
  const metrics = [
    {
      label: "확정 지출 · 확정 수입",
      value: won(ledger.data?.out.sum ?? 0),
      confidence: "확정",
      basis: `원장 확정분 ${ledger.data?.out.count ?? 0}건`,
    },
    {
      label: "부족액 3종",
      value: "산출됨",
      confidence: "확정",
      basis: "확정 + 승인 대기 · 판정 대기 포함 토글",
    },
    {
      label: "현금흐름 종료 잔액",
      value: "계산 불가",
      confidence: "N",
      basis: `판정 대기 ${undecided}건 승계`,
    },
    {
      label: "DSO",
      value: "부분",
      confidence: "추정",
      basis: "계산서 발행일이 있는 건만",
    },
    {
      label: "월 번레이트",
      value: "계산 불가",
      confidence: "N",
      basis: `산출 조건 6개 중 ${runway.data?.conditionsMet ?? 0}개 충족`,
    },
    {
      label: "런웨이 3종",
      value: "계산 불가",
      confidence: "N",
      basis: "분모 없음",
    },
    {
      label: "이자보상배율",
      value: "계산 불가",
      confidence: "N",
      basis: "영업이익 음수 · 귀속 미지정",
    },
    {
      label: "재무상태표",
      value: "가결산",
      confidence: "추정",
      basis: "기초 재무상태표 미설정 (B6)",
    },
    {
      label: "8월 마감",
      value: "불가",
      confidence: "N",
      basis: `${failing.map(c => c.id).join(" · ")} · 판정 대기 ${undecided}건`,
    },
  ];

  return (
    <div className="erp-page">
      <header>
        <h1>지표 신뢰도</h1>
        <p>
          지표마다 확정도를 답니다. 「계산 불가」는 오류가 아니라 무엇이 아직
          없다는 답이고, 그 자리를 추정치로 메우지 않습니다.
        </p>
      </header>

      <Card title="지표별 확정도" meta={`${metrics.length}개`} body={false}>
        <div className="erp-scroll">
          <table className="erp-table">
            <thead>
              <tr>
                <th>지표</th>
                <th>현재</th>
                <th>확정도</th>
                <th>근거 · 막고 있는 것</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => (
                <tr key={m.label}>
                  <td className="wrap">{m.label}</td>
                  <td
                    className={m.value === "계산 불가" ? "erp-null" : undefined}
                  >
                    {m.value}
                  </td>
                  <td>
                    <span
                      className="erp-chip"
                      data-tone={
                        m.confidence === "확정"
                          ? "ok"
                          : m.confidence === "추정"
                            ? "warn"
                            : "alert"
                      }
                    >
                      {m.confidence}
                    </span>
                  </td>
                  <td className="wrap">{m.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Note>
        확정도 N은 「모른다」이고, 추정은 「일부 근거로 계산했다」입니다. 대외
        자료에는 확정만 씁니다.
      </Note>
    </div>
  );
}
