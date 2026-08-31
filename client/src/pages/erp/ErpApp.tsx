/**
 * 경영관리 시스템 1차 오픈 — 8화면.
 *
 * 레일 순서는 사용 빈도가 아니라 데이터 흐름을 따른다 —
 * 원장(원본)이 맨 위, 그 원장을 접은 화면이 그다음. 첫 진입은 현금흐름표다.
 */
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { trpc } from "@/lib/trpc";
import { EntryDrawer } from "./components/EntryDrawer";
import { ErpUiContext } from "./context";
import "./design.css";
import "./erp.css";
import { AccountsScreen } from "./screens/Accounts";
import { ApprovalsScreen } from "./screens/Approvals";
import { ArScreen } from "./screens/Ar";
import { BurnRateScreen } from "./screens/BurnRate";
import { CashPositionScreen } from "./screens/CashPosition";
import { CashflowScreen } from "./screens/Cashflow";
import { ClosingScreen } from "./screens/Closing";
import { DebtScreen } from "./screens/Debt";
import { FinancialStatementsScreen } from "./screens/FinancialStatements";
import { Forecast13wScreen } from "./screens/Forecast13w";
import { GovernanceScreen } from "./screens/Governance";
import { IntakeScreen } from "./screens/Intake";
import { JournalsScreen } from "./screens/Journals";
import { LedgerScreen } from "./screens/Ledger";
import { MastersScreen } from "./screens/Masters";
import { NotificationsScreen } from "./screens/Notifications";
import { OpsScreen } from "./screens/Ops";
import { OverviewScreen } from "./screens/Overview";
import { PnlScreen } from "./screens/Pnl";
import { SettingsScreen } from "./screens/Settings";
import { SheetImportScreen } from "./screens/SheetImport";

interface ScreenDef {
  id: string;
  label: string;
  group: string;
  hint: string;
  stage: 1 | 2 | 3;
  render: () => ReactElement;
}

const SCREENS: ScreenDef[] = [
  {
    id: "ledger",
    label: "집행원장",
    group: "핵심 원장 (원본)",
    hint: "전건 · 필터 10종",
    stage: 1,
    render: () => (
      <LedgerScreen
        title="집행원장"
        blurb="회사에서 오간 돈 한 건 한 건. 이 시스템의 단일 원본입니다. 다른 화면은 전부 이 원장을 접은 것입니다."
      />
    ),
  },
  {
    id: "ledger-out",
    label: "지출 원장",
    group: "핵심 원장 (원본)",
    hint: "방향 + 상태 필터",
    stage: 1,
    render: () => (
      <LedgerScreen
        direction="out"
        title="지출 원장"
        blurb="집행원장에서 방향(지출) + 승인 상태로 걸러낸 뷰입니다. 어느 화면에서 입력해도 같은 원장에 들어갑니다."
      />
    ),
  },
  {
    id: "ledger-in",
    label: "수입 원장",
    group: "핵심 원장 (원본)",
    hint: "방향 + 상태 필터",
    stage: 1,
    render: () => (
      <LedgerScreen
        direction="in"
        title="수입 원장"
        blurb="집행원장에서 방향(수입) + 승인 상태로 걸러낸 뷰입니다. 계산서 발행 여부가 미수 판정의 기준입니다."
      />
    ),
  },
  {
    id: "accounts",
    label: "계정과목 체계",
    group: "핵심 원장 (원본)",
    hint: "자동 판정 3종",
    stage: 1,
    render: () => <AccountsScreen />,
  },
  {
    id: "cashflow",
    label: "현금흐름표",
    group: "지금 쓰는 것",
    hint: "일 · 월 · 연",
    stage: 1,
    render: () => <CashflowScreen />,
  },
  {
    id: "cash-position",
    label: "현금 현황",
    group: "지금 쓰는 것",
    hint: "부족액 3종",
    stage: 1,
    render: () => <CashPositionScreen />,
  },
  {
    id: "approvals",
    label: "승인 대기",
    group: "지금 쓰는 것",
    hint: "일괄 검토",
    stage: 1,
    render: () => <ApprovalsScreen />,
  },
  {
    id: "overview",
    label: "종합 현황",
    group: "지금 쓰는 것",
    hint: "확정도 배지",
    stage: 1,
    render: () => <OverviewScreen />,
  },
  {
    id: "ar",
    label: "채권 관리",
    group: "곧 붙일 것 (2차)",
    hint: "미수 · 발행 대기 · DSO",
    stage: 2,
    render: () => <ArScreen />,
  },
  {
    id: "debt",
    label: "부채 원장",
    group: "곧 붙일 것 (2차)",
    hint: "차입 · 만기 알람",
    stage: 2,
    render: () => <DebtScreen variant="ledger" />,
  },
  {
    id: "funding",
    label: "부채 · 조달",
    group: "곧 붙일 것 (2차)",
    hint: "조달 게이트",
    stage: 2,
    render: () => <DebtScreen variant="funding" />,
  },
  {
    id: "forecast",
    label: "13주 자금계획",
    group: "곧 붙일 것 (2차)",
    hint: "Base · Stress · Upside",
    stage: 2,
    render: () => <Forecast13wScreen />,
  },
  {
    id: "contracts",
    label: "계약 원장",
    group: "곧 붙일 것 (2차)",
    hint: "입금예정일의 근거",
    stage: 2,
    render: () => <MastersScreen kind="contract" />,
  },
  {
    id: "parties",
    label: "거래처 마스터",
    group: "곧 붙일 것 (2차)",
    hint: "슬랙 매칭 · VAT 표기",
    stage: 2,
    render: () => <MastersScreen kind="party" />,
  },
  {
    id: "projects",
    label: "프로젝트 원장",
    group: "곧 붙일 것 (2차)",
    hint: "귀속 단위",
    stage: 2,
    render: () => <MastersScreen kind="project" />,
  },
  {
    id: "journals",
    label: "전표 · 분개장",
    group: "곧 붙일 것 (2차)",
    hint: "자동 분개 · 시산표",
    stage: 2,
    render: () => <JournalsScreen />,
  },
  {
    id: "intake",
    label: "수집 검수함",
    group: "곧 붙일 것 (2차)",
    hint: "슬랙 · 은행 · 카드",
    stage: 2,
    render: () => <IntakeScreen />,
  },
  {
    id: "notifications",
    label: "알림 규칙",
    group: "곧 붙일 것 (2차)",
    hint: "T0~T3 · 대표 3건 상한",
    stage: 2,
    render: () => <NotificationsScreen />,
  },
  {
    id: "pnl-bu",
    label: "사업부 손익",
    group: "손익 · 재무제표 (3차)",
    hint: "회계 계단 · 관리 계단",
    stage: 3,
    render: () => <PnlScreen variant="bu" />,
  },
  {
    id: "pnl-project",
    label: "프로젝트 마진",
    group: "손익 · 재무제표 (3차)",
    hint: "기여이익",
    stage: 3,
    render: () => <PnlScreen variant="project" />,
  },
  {
    id: "cost",
    label: "비용 구조",
    group: "손익 · 재무제표 (3차)",
    hint: "운영비 분해",
    stage: 3,
    render: () => <PnlScreen variant="cost" />,
  },
  {
    id: "burnrate",
    label: "번레이트 마스터",
    group: "손익 · 재무제표 (3차)",
    hint: "런웨이 3종",
    stage: 3,
    render: () => <BurnRateScreen />,
  },
  {
    id: "fs",
    label: "재무제표 5종",
    group: "손익 · 재무제표 (3차)",
    hint: "전표 누계에서 생성",
    stage: 3,
    render: () => <FinancialStatementsScreen />,
  },
  {
    id: "vat",
    label: "세금계산서 · 부가세",
    group: "손익 · 재무제표 (3차)",
    hint: "공급가액 · 세액",
    stage: 3,
    render: () => <OpsScreen variant="vat" />,
  },
  {
    id: "hometax",
    label: "홈택스 연동",
    group: "손익 · 재무제표 (3차)",
    hint: "연동 준비 상태",
    stage: 3,
    render: () => <OpsScreen variant="hometax" />,
  },
  {
    id: "closing",
    label: "월 마감",
    group: "기준 · 통제 (3차)",
    hint: "blockers가 비어야 성공",
    stage: 3,
    render: () => <ClosingScreen />,
  },
  {
    id: "settings",
    label: "기준값",
    group: "기준 · 통제 (3차)",
    hint: "임시값 · 기준선",
    stage: 3,
    render: () => <SettingsScreen />,
  },
  {
    id: "budget",
    label: "예산 대비 실적",
    group: "기준 · 통제 (3차)",
    hint: "예산 등록 단위만",
    stage: 3,
    render: () => <OpsScreen variant="budget" />,
  },
  {
    id: "allocation",
    label: "공통비 배부",
    group: "기준 · 통제 (3차)",
    hint: "두 계단 일치 검증",
    stage: 3,
    render: () => <OpsScreen variant="allocation" />,
  },
  {
    id: "reliability",
    label: "지표 신뢰도",
    group: "기준 · 통제 (3차)",
    hint: "확정 · 추정 · N",
    stage: 3,
    render: () => <GovernanceScreen variant="reliability" />,
  },
  {
    id: "permissions",
    label: "권한 · 내부통제",
    group: "기준 · 통제 (3차)",
    hint: "역할 매트릭스",
    stage: 3,
    render: () => <GovernanceScreen variant="permissions" />,
  },
  {
    id: "audit",
    label: "변경 이력",
    group: "기준 · 통제 (3차)",
    hint: "감사로그",
    stage: 3,
    render: () => <GovernanceScreen variant="audit" />,
  },
  {
    id: "sheet-import",
    label: "시트 이관",
    group: "기준 · 통제 (3차)",
    hint: "시트 → 원장 1회",
    stage: 3,
    render: () => <SheetImportScreen />,
  },
  {
    id: "report",
    label: "보고서 빌더",
    group: "기준 · 통제 (3차)",
    hint: "탭 구분 텍스트",
    stage: 3,
    render: () => <OpsScreen variant="report" />,
  },
];

const GROUPS = Array.from(new Set(SCREENS.map(s => s.group)));

export default function ErpApp() {
  // 첫 진입 화면은 현금흐름표다 (08-27 회의 결정)
  const [screenId, setScreenId] = useState("cashflow");
  const [query, setQuery] = useState("");
  const [entryCode, setEntryCode] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const me = trpc.erp.me.useQuery(undefined, { retry: false });
  const screen = SCREENS.find(s => s.id === screenId) ?? SCREENS[4];

  const ui = useMemo(
    () => ({
      openEntry: (code: string) => setEntryCode(code),
      query,
      goto: (id: string) => {
        setScreenId(id);
        setQuery("");
      },
    }),
    [query]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setEntryCode(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ErpUiContext.Provider value={ui}>
      <div className="erp-app">
        <div className="app">
          <aside className="rail">
            <div className="rail-top">
              <div className="co">디노스튜디오</div>
              <div className="sub">경영관리 시스템</div>
            </div>
            <nav aria-label="모듈">
              {GROUPS.map(group => (
                <Fragment key={group}>
                  <div className="grp">{group}</div>
                  {SCREENS.filter(s => s.group === group).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className="nav"
                      aria-current={item.id === screenId ? "page" : undefined}
                      onClick={() => ui.goto(item.id)}
                      title={item.hint}
                    >
                      <span
                        className={`dot${item.stage === 1 ? " a" : item.stage === 2 ? " w" : ""}`}
                      />
                      {item.label}
                      <span className="cnt">{item.stage}차</span>
                    </button>
                  ))}
                </Fragment>
              ))}
            </nav>
          </aside>

          <div className="main">
            <header className="top">
              <div className="crumb">
                <span>{screen.group}</span>
                <span>›</span>
                <b>{screen.label}</b>
              </div>
              <div className="top-r">
                <span className="qbox">
                  <span className="k">⌕</span>
                  <input
                    value={query}
                    placeholder="이 화면 행 검색"
                    aria-label="현재 화면의 표 행 검색"
                    onChange={event => setQuery(event.target.value)}
                  />
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPaletteOpen(true)}
                  title="화면 이동 (⌘K)"
                >
                  화면 이동{" "}
                  <span className="m" style={{ opacity: 0.6 }}>
                    ⌘K
                  </span>
                </button>
                {me.data ? (
                  <span className="pill live">{me.data.role}</span>
                ) : null}
                {me.error ? <span className="chip a">역할 미지정</span> : null}
                {me.data ? <span>{me.data.id}</span> : null}
              </div>
            </header>

            <section className="screen on">
              {me.error ? (
                <SignIn message={me.error.message} />
              ) : (
                screen.render()
              )}
            </section>
          </div>
        </div>

        {paletteOpen ? (
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            onPick={id => {
              ui.goto(id);
              setPaletteOpen(false);
            }}
          />
        ) : null}

        {entryCode ? (
          <EntryDrawer code={entryCode} onClose={() => setEntryCode(null)} />
        ) : null}
      </div>
    </ErpUiContext.Provider>
  );
}

/**
 * 로그인 · 접근 안내 — 급여·부채를 다루므로 익명 접근을 허용하지 않는다 (§14).
 * 이메일 + 지정 비밀번호가 임시 경로이고, 구글 SSO가 켜지면 버튼이 함께 나온다.
 * 역할이 아직 배정되지 않은 사람은 로그인해도 화면이 열리지 않는다 (§13.1 · G10).
 */
interface LoginReply {
  ok?: boolean;
  reason?: string;
  next?: string;
}

function SignIn({ message }: { message: string }) {
  const needsRole = message.includes("역할");
  const [methods, setMethods] = useState<{
    google: boolean;
    password: boolean;
  } | null>(null);
  const [email, setEmail] = useState(
    () => window.localStorage.getItem("erp:lastEmail") ?? ""
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/methods", { credentials: "same-origin" })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as {
          google: boolean;
          password: boolean;
        };
      })
      .then(data => {
        if (alive) setMethods(data);
      })
      // 조회가 실패하면 두 수단을 모두 보여 주되, 실패했다는 사실을 감추지 않는다 —
      // 이 조회가 안 되면 로그인 요청도 십중팔구 안 된다.
      .catch((cause: Error) => {
        if (!alive) return;
        setMethods({ google: true, password: true });
        setError(
          `서버 함수에 연결하지 못했습니다 (${cause.message}). 배포 상태를 확인하십시오.`
        );
      });
    return () => {
      alive = false;
    };
  }, []);

  // 서버가 "둘 다 꺼져 있다"고 확실히 답한 경우에만 참이다.
  // 조회가 실패해 methods 가 null 인 것과 구분해야 한다 — 그때는 폼을 계속 보여준다.
  const noMethod =
    !needsRole && methods != null && !methods.password && !methods.google;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          next: window.location.pathname || "/",
        }),
      });
      // 본문을 먼저 글자로 받는다 — 404 안내 페이지처럼 JSON이 아닌 응답이 와도
      // "서버에 연결하지 못했습니다"로 뭉뚱그리지 않고 진짜 원인을 보여주기 위해서다.
      const raw = await response.text();
      let data: LoginReply | null = null;
      try {
        data = JSON.parse(raw) as LoginReply;
      } catch {
        data = null;
      }

      if (data == null) {
        setError(
          response.status === 404
            ? "로그인 API를 찾을 수 없습니다 (404). 배포에 서버 함수가 포함되지 않았습니다."
            : `서버가 예상과 다른 응답을 보냈습니다 (HTTP ${response.status}). ${raw.slice(0, 120)}`
        );
        setPassword("");
        return;
      }
      if (!response.ok || !data.ok) {
        setError(
          data.reason ?? `로그인에 실패했습니다 (HTTP ${response.status}).`
        );
        setPassword("");
        return;
      }
      // 다음에 이메일을 다시 치지 않도록 남긴다. 비밀번호는 절대 남기지 않는다.
      window.localStorage.setItem("erp:lastEmail", email.trim().toLowerCase());
      window.location.replace(data.next ?? "/");
    } catch (cause) {
      // 여기까지 오면 요청 자체가 나가지 못한 것이다 (네트워크·CORS·차단)
      setError(
        `서버에 연결하지 못했습니다 — ${cause instanceof Error ? cause.message : "원인 불명"}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="erp-page">
      <header>
        <h1>
          {needsRole ? "역할이 지정되지 않았습니다" : "로그인이 필요합니다"}
        </h1>
        <p>
          {needsRole
            ? "로그인은 되었지만 이 계정에 경영관리 시스템 역할이 배정되지 않았습니다. 대표님께 역할 지정을 요청하십시오 — 급여·부채는 역할이 있어야 보입니다."
            : "회사 이메일과 지정 비밀번호로 로그인하십시오. 승인·수정 이력이 사람 신원에 묶여 감사로그에 남습니다."}
        </p>
      </header>

      <section className="card">
        <div
          className="card-b"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          {needsRole ? (
            <p className="note" data-tone="warn" style={{ margin: 0 }}>
              {message}
            </p>
          ) : null}

          {noMethod ? (
            <>
              <p className="note" data-tone="alert" style={{ margin: 0 }}>
                서버에 로그인 수단이 설정되지 않았습니다. 들어올 수 있는 방법이
                없는 상태입니다.
              </p>
              <p className="s" style={{ margin: 0 }}>
                배포 환경변수에 <code>ERP_PASSWORD</code> (비밀번호 로그인) 또는{" "}
                <code>GOOGLE_CLIENT_ID</code> ·{" "}
                <code>GOOGLE_CLIENT_SECRET</code> (구글 SSO) 중 하나를 넣고{" "}
                <b>재배포</b>해야 합니다. 환경변수는 배포 시점에 함께 굳으므로,
                추가만 하고 재배포하지 않으면 반영되지 않습니다.
              </p>
              <p className="s" style={{ margin: 0 }}>
                현재 설정 상태는 <a href="/api/diag">/api/diag</a> 에서 확인할
                수 있습니다 (값은 나오지 않고 설정 여부만 표시됩니다).
              </p>
            </>
          ) : null}

          {!needsRole && !noMethod && methods?.password !== false ? (
            <form
              onSubmit={submit}
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              <label className="field">
                <span>회사 이메일</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  placeholder="name@dinostudio.kr"
                />
              </label>
              <label className="field">
                <span>비밀번호</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                />
              </label>
              {error ? (
                <p className="note" data-tone="alert" style={{ margin: 0 }}>
                  {error}
                </p>
              ) : null}
              <div>
                <button
                  className="btn"
                  data-variant="primary"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? "확인 중…" : "로그인"}
                </button>
              </div>
            </form>
          ) : null}

          {!needsRole && methods?.google ? (
            <div>
              <a
                className="btn"
                href={`/api/auth/google/start?next=${encodeURIComponent(window.location.pathname || "/")}`}
              >
                구글 워크스페이스 계정으로 로그인
              </a>
            </div>
          ) : null}

          <p className="s" style={{ margin: 0 }}>
            허용된 도메인·계정만 들어올 수 있습니다. 로그인 후 역할(대표 ·
            부대표 · 재무 · 사업부 리더 · 담당자 · 외부 세무)에 따라 보이는
            화면과 승인 한도가 달라집니다.
          </p>
        </div>
      </section>
    </div>
  );
}

function CommandPalette({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = SCREENS.filter(s =>
    `${s.label} ${s.group} ${s.hint} ${s.id}`
      .toLowerCase()
      .includes(text.trim().toLowerCase())
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setCursor(0);
  }, [text]);

  return (
    <div className="pal" onClick={onClose}>
      <div onClick={event => event.stopPropagation()}>
        <input
          ref={inputRef}
          value={text}
          placeholder="화면 이름으로 이동 — ↑↓ Enter"
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor(c => Math.min(c + 1, matches.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor(c => Math.max(c - 1, 0));
            }
            if (event.key === "Enter" && matches[cursor])
              onPick(matches[cursor].id);
          }}
        />
        <ul>
          {matches.map((item, index) => (
            <li key={item.id} data-active={index === cursor}>
              <button type="button" onClick={() => onPick(item.id)}>
                <span>
                  {item.label} <span className="s">· {item.stage}차</span>
                </span>
                <span className="s">{item.hint}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 ? (
            <li>
              <button type="button" disabled>
                <span className="s">일치하는 화면이 없습니다</span>
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
