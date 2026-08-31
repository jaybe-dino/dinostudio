/**
 * 세금계산서·부가세 · 홈택스 연동 · 예산 대비 실적 · 공통비 배부 · 보고서 빌더
 * 값이 없는 화면은 비워두지 않고 「무엇이 있어야 이 화면이 살아나는지」를 씁니다 (원칙 8).
 */
import { accountLabel } from "@shared/erp";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Money, Note, Tile } from "../components/Bits";
import { ExportModal } from "../components/ExportModal";
import { useErpUi } from "../context";
import { shortDate, won } from "../format";

export type OpsVariant = "vat" | "hometax" | "budget" | "allocation" | "report";

export function OpsScreen({ variant }: { variant: OpsVariant }) {
  const { openEntry, goto } = useErpUi();
  const ledger = trpc.erp.entries.list.useQuery({});
  const masters = trpc.erp.masters.useQuery();
  const pnl = trpc.erp.pnl.useQuery({});
  const [showExport, setShowExport] = useState(false);

  const entries = ledger.data?.entries ?? [];

  if (variant === "vat") {
    const vatEntries = entries.filter(
      e => e.accountCode === "2130" || e.accountCode === "1450"
    );
    const invoices = entries.filter(e => e.invoiceIssued != null);
    const splitMissing = entries.filter(
      e => e.amount != null && e.amountSupply == null
    ).length;

    return (
      <>
        <div className="ph">
          <div>
            <h1>세금계산서 · 부가세</h1>
            <div className="desc">
              공급가액과 세액을 분리 저장할 구조는 이미 있습니다(amount_supply ·
              amount_vat). 값이 비어 있는 이유는 전사 VAT 표기 기준이 정해지지
              않았기 때문입니다 — IP는 (vat별도), 네트워크는 (VAT 포함)으로 서로
              다릅니다.
            </div>
          </div>
        </div>

        <div className="kpis">
          <Tile
            label="부가세 관련 건"
            value={`${vatEntries.length}건`}
            note="2130 예수부가세 · 1450 매입세액"
          />
          <Tile
            label="공급가액 미분리"
            value={`${splitMissing}건`}
            note="구조는 있고 값이 비어 있음 (B3)"
            tone="warn"
          />
          <Tile
            label="계산서 발행"
            value={`${invoices.filter(e => e.invoiceIssued).length}건`}
            note="미수 판정의 기준 (원칙 4)"
          />
          <Tile
            label="대리납부(역과세)"
            value="2건 미처리"
            note="해외 SaaS · 광고 — 세무대리인"
            tone="alert"
          />
        </div>

        <Note tone="alert">
          부가세 2차 금액이 두 곳에서 다릅니다 — 현금 현황은 12,000,000(카드
          결제), 원장 적요칸은 1,200. 확인 전까지 판정 대기로 두고, 현금
          현황에서 포함/제외를 켜고 끌 수 있게 했습니다. 제외하면 P0 부족액이
          여유로 뒤집히므로 기본값은 포함입니다 (B9).
        </Note>

        <Card
          title="부가세 관련 원장"
          meta={`${vatEntries.length}건`}
          body={false}
        >
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>집행원장</th>
                  <th>일자</th>
                  <th>항목</th>
                  <th>계정</th>
                  <th className="n">금액</th>
                  <th className="n">공급가액</th>
                  <th className="n">세액</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {vatEntries.map(entry => (
                  <tr key={entry.code}>
                    <td>
                      <button
                        className="m"
                        onClick={() => openEntry(entry.code)}
                      >
                        {entry.code}
                      </button>
                    </td>
                    <td>{shortDate(entry.cashDate)}</td>
                    <td className="wrap">{entry.title}</td>
                    <td>{accountLabel(entry.accountCode)}</td>
                    <td className="n">
                      <Money
                        value={entry.amount}
                        reason={entry.undecidedReason}
                      />
                    </td>
                    <td className="num s">
                      {entry.amountSupply == null
                        ? "미분리"
                        : won(entry.amountSupply)}
                    </td>
                    <td className="num s">
                      {entry.amountVat == null
                        ? "미분리"
                        : won(entry.amountVat)}
                    </td>
                    <td className="wrap">{entry.undecidedReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="정해야 하는 것">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              VAT 표기 기준 — 전사 통일 vs 원장 분리 저장(공급가액/세액). 파서
              동작이 여기서 갈립니다
            </li>
            <li>부가세 2차 금액 — 12,000,000인지 1,200인지</li>
            <li>대리납부(역과세) 2건 처리 — 해외 SaaS · 광고</li>
          </ul>
        </Card>
      </>
    );
  }

  if (variant === "hometax") {
    return (
      <>
        <div className="ph">
          <div>
            <h1>홈택스 연동</h1>
            <div className="desc">
              전자세금계산서와 부가세 신고자료를 3차에 연동합니다. 지금은 연동
              준비 상태만 표시합니다.
            </div>
          </div>
        </div>

        <Note tone="warn">
          연동이 켜져 있지 않습니다. 홈택스는 자격증명과 접근 권한이 필요하므로
          코드만으로 시작할 수 없습니다.
        </Note>

        <Card title="연동 전 필요한 것" body={false}>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>항목</th>
                  <th>담당</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "홈택스 접근 자격증명 (전자세금계산서 조회 권한)",
                    "재무 + 세무대리인",
                    "미확보",
                  ],
                  ["사업자번호 · 거래처 사업자번호 등록", "재무", "미등록"],
                  ["VAT 표기 기준 확정 (B3)", "대표 + 재무", "미결"],
                  ["기초 재무상태표 (B6)", "재무 + 세무대리인", "미설정"],
                  ["대리납부(역과세) 2건 처리 방침", "세무대리인", "미처리"],
                ].map(([item, owner, status]) => (
                  <tr key={item}>
                    <td className="wrap">{item}</td>
                    <td>{owner}</td>
                    <td>
                      <span className="chip a">{status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="연동되면 달라지는 것">
          <p style={{ margin: 0 }}>
            계산서 발행일이 원장에 자동으로 들어와 입금예정일과 DSO가 손 대지
            않아도 계산됩니다. 지금은 발행일이 없어 DSO가 미수 3건 중 1건만
            반영하고 있습니다.{" "}
            <button type="button" className="btn" onClick={() => goto("ar")}>
              채권 관리로
            </button>
          </p>
        </Card>
      </>
    );
  }

  if (variant === "budget") {
    const projects = masters.data?.projects ?? [];
    const withBudget = projects.filter(p => p.budget != null);
    return (
      <>
        <div className="ph">
          <div>
            <h1>예산 대비 실적</h1>
            <div className="desc">
              예산이 등록된 단위에 대해서만 실적을 비교합니다. 예산이 없으면
              비교하지 않고 없다고 씁니다.
            </div>
          </div>
        </div>

        <div className="kpis">
          <Tile
            label="예산 등록 프로젝트"
            value={`${withBudget.length} / ${projects.length}`}
            note="예산이 없으면 비교 불가"
            tone={withBudget.length ? undefined : "alert"}
          />
          <Tile
            label="번레이트 예산"
            value="폐기"
            note="추정 분모에서 나온 값이라 근거를 잃었습니다"
            tone="null"
          />
        </div>

        <Note tone="warn">
          예산이 등록된 단위가 {withBudget.length}개입니다. 프로젝트 원장에서
          예산을 등록하면 이 화면이 살아납니다. 9월 번레이트 예산 73,088,790과
          예산 대비 189% 같은 수치는 추정 분모에서 나온 것이라 전부
          폐기했습니다.
        </Note>

        <Card title="프로젝트별" meta={`${projects.length}건`} body={false}>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>프로젝트</th>
                  <th className="n">예산</th>
                  <th className="n">기여이익 (실적)</th>
                  <th>비교</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(project => {
                  const actual = pnl.data?.byProject.find(
                    s => s.key === project.id
                  );
                  return (
                    <tr key={project.id}>
                      <td>
                        {project.code} {project.name}
                      </td>
                      <td className="n">
                        {won(project.budget) ?? (
                          <span className="s">미등록</span>
                        )}
                      </td>
                      <td className="n">
                        {won(actual?.contributionProfit ?? 0)}
                      </td>
                      <td className="s">
                        {project.budget == null ? "예산 없음 — 비교 불가" : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    );
  }

  if (variant === "allocation") {
    const common = pnl.data?.total.management.commonAllocated ?? 0;
    const segments = pnl.data?.byBu ?? [];
    const attributed = segments.filter(s => s.key !== "미지정");
    return (
      <>
        <div className="ph">
          <div>
            <h1>공통비 배부</h1>
            <div className="desc">
              공통배부 금액을 사업부·프로젝트에 나누는 규칙입니다. 배부 후 관리
              계단의 영업이익은 회계 계단과 반드시 일치해야 합니다 — 다르면 배부
              로직이 틀린 것입니다.
            </div>
          </div>
        </div>

        <div className="kpis">
          <Tile
            label="공통배부 총액"
            value={won(common) ?? "—"}
            note="배부 대상"
          />
          <Tile
            label="배부 기준"
            value="미확정"
            note="매출 비율 / 인원 / 직접원가 비율 중 택1"
            tone="alert"
          />
          <Tile
            label="두 계단 영업이익 차이"
            value={won(pnl.data?.total.operatingProfitGap ?? 0) ?? "—"}
            note={
              pnl.data?.total.operatingProfitGap === 0
                ? "일치"
                : "배부 로직 오류"
            }
            tone={pnl.data?.total.operatingProfitGap === 0 ? "ok" : "alert"}
          />
          <Tile
            label="귀속 미지정"
            value={`${pnl.data?.total.attributionMissing.count ?? 0}건`}
            note="배부 이전에 귀속이 먼저입니다"
            tone="warn"
          />
        </div>

        <Note tone="warn">
          배부 기준이 정해지지 않아 지금은 공통배부를 사업부에 나누지 않고 전사
          합계로만 둡니다. 귀속 미지정{" "}
          {pnl.data?.total.attributionMissing.count ?? 0}건을 먼저 채워야 배부
          결과가 의미를 갖습니다.
        </Note>

        <Card
          title="사업부별 귀속 현황"
          meta={`${attributed.length}개 사업부`}
          body={false}
        >
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>사업부</th>
                  <th className="n">직접원가</th>
                  <th className="n">공통배부 (현재)</th>
                  <th className="n">건수</th>
                </tr>
              </thead>
              <tbody>
                {segments.map(segment => (
                  <tr key={segment.key}>
                    <td>{segment.label}</td>
                    <td className="n">{won(segment.directCost)}</td>
                    <td className="n">{won(segment.commonAllocated)}</td>
                    <td className="n">{segment.entryCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    );
  }

  // 보고서 빌더
  const rows: (string | number | null)[][] = [
    [
      "집행원장",
      "일자",
      "상태",
      "항목",
      "계정",
      "원가성격",
      "사업부",
      "프로젝트",
      "금액",
    ],
    ...entries.map(e => [
      e.code,
      e.cashDate,
      e.status,
      e.title,
      e.accountCode,
      e.nature,
      e.buCode,
      e.projectId,
      e.amount,
    ]),
  ];

  return (
    <>
      <div className="ph">
        <div>
          <h1>보고서 빌더</h1>
          <div className="desc">
            화면의 표를 탭 구분 텍스트로 뽑습니다. 브라우저 정책상 파일 저장이
            막혀 있어 복사로 넘기고, 시트에 붙여 쓰십시오 — 다만 그 시트는
            참고용이고 원본은 계속 이 원장입니다.
          </div>
        </div>
      </div>

      <div className="kpis">
        <Tile
          label="원장 전건"
          value={`${entries.length}건`}
          note="필터 없이 전체"
        />
        <Tile
          label="확정"
          value={`${entries.filter(e => e.status === "confirmed").length}건`}
          note="합계에 들어가는 것"
          tone="ok"
        />
        <Tile
          label="승인 대기"
          value={`${entries.filter(e => e.status === "pending").length}건`}
          note="예약런웨이만"
          tone="warn"
        />
        <Tile
          label="판정 대기"
          value={`${entries.filter(e => e.status === "undecided").length}건`}
          note="어떤 합계에도 없음"
          tone="alert"
        />
      </div>

      <Card title="내보내기">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className="btn pri"
            onClick={() => setShowExport(true)}
          >
            원장 전건 내보내기
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => goto("cashflow")}
          >
            현금흐름표에서 내보내기
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => goto("cash-position")}
          >
            현금 현황에서 내보내기
          </button>
        </div>
        <p className="s" style={{ marginTop: 8 }}>
          내보낸 시트를 다시 이 시스템으로 들여오는 기능은 제공하지 않습니다 —
          원본이 둘이 되는 순간 반드시 어긋나기 때문입니다.
        </p>
      </Card>

      {showExport ? (
        <ExportModal
          title="집행원장 전건"
          rows={rows}
          onClose={() => setShowExport(false)}
        />
      ) : null}
    </>
  );
}
