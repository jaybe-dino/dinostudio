/**
 * 경영관리 시스템 1차 오픈 — 8화면.
 *
 * 레일 순서는 사용 빈도가 아니라 데이터 흐름을 따른다 —
 * 원장(원본)이 맨 위, 그 원장을 접은 화면이 그다음. 첫 진입은 현금흐름표다.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { trpc } from "@/lib/trpc";
import { EntryDrawer } from "./components/EntryDrawer";
import { ErpUiContext } from "./context";
import "./erp.css";
import { AccountsScreen } from "./screens/Accounts";
import { ApprovalsScreen } from "./screens/Approvals";
import { CashPositionScreen } from "./screens/CashPosition";
import { CashflowScreen } from "./screens/Cashflow";
import { LedgerScreen } from "./screens/Ledger";
import { OverviewScreen } from "./screens/Overview";

interface ScreenDef {
  id: string;
  label: string;
  group: string;
  hint: string;
  render: () => ReactElement;
}

const SCREENS: ScreenDef[] = [
  {
    id: "ledger",
    label: "집행원장",
    group: "핵심 원장 (원본)",
    hint: "전건 · 필터 10종",
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
    render: () => <AccountsScreen />,
  },
  {
    id: "cashflow",
    label: "현금흐름표",
    group: "지금 쓰는 것",
    hint: "일 · 월 · 연",
    render: () => <CashflowScreen />,
  },
  {
    id: "cash-position",
    label: "현금 현황",
    group: "지금 쓰는 것",
    hint: "부족액 3종",
    render: () => <CashPositionScreen />,
  },
  {
    id: "approvals",
    label: "승인 대기",
    group: "지금 쓰는 것",
    hint: "일괄 검토",
    render: () => <ApprovalsScreen />,
  },
  {
    id: "overview",
    label: "종합 현황",
    group: "지금 쓰는 것",
    hint: "확정도 배지",
    render: () => <OverviewScreen />,
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
      <div className="erp-root">
        <div className="erp-shell">
          <nav className="erp-rail" aria-label="화면">
            <div className="erp-rail-brand">
              DINOSTUDIO
              <small>경영관리 시스템 · 1차 오픈 8화면</small>
            </div>
            {GROUPS.map(group => (
              <div className="erp-rail-group" key={group}>
                <span>{group}</span>
                {SCREENS.filter(s => s.group === group).map(item => (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={item.id === screenId ? "page" : undefined}
                    onClick={() => ui.goto(item.id)}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
            <div className="erp-rail-group">
              <span>2 · 3차</span>
              <p className="erp-null" style={{ padding: "0 8px", margin: 0 }}>
                채권 · 부채 · 13주 · 전표 · 손익 · 재무제표 5종은 1차가 실사용에
                들어간 뒤 붙입니다.
              </p>
            </div>
          </nav>

          <main className="erp-main">
            <div className="erp-topbar">
              <button
                type="button"
                className="erp-btn"
                onClick={() => setPaletteOpen(true)}
              >
                화면 이동 <span className="erp-null">⌘K</span>
              </button>
              <input
                value={query}
                placeholder="이 화면의 표에서 검색 — 코드 · 항목 · 적요"
                onChange={event => setQuery(event.target.value)}
              />
              {me.data ? (
                <span className="erp-chip" data-tone="info">
                  {me.data.role}
                </span>
              ) : null}
              {me.error ? (
                <span className="erp-chip" data-tone="alert">
                  역할 미지정
                </span>
              ) : null}
            </div>

            {me.error ? (
              <div className="erp-page">
                <p className="erp-note" data-tone="alert">
                  {me.error.message}
                </p>
              </div>
            ) : (
              screen.render()
            )}
          </main>
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
    <div className="erp-palette" onClick={onClose}>
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
                <span>{item.label}</span>
                <span className="erp-null">{item.hint}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 ? (
            <li>
              <button type="button" disabled>
                <span className="erp-null">일치하는 화면이 없습니다</span>
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
