/**
 * 프로토타입 마크업 프리미티브.
 *
 * ERP 68화면 프로토타입이 쓰는 클래스(.ph · .kpi · .card · .chip …)를 그대로 낸다.
 * 클래스 이름을 바꾸지 않는 것이 원칙이다 — 이름을 바꾸는 순간 design.css 와 어긋나고,
 * 프로토타입이 갱신될 때 다시 맞추기가 어려워진다.
 *
 * design.css 는 모든 규칙을 .erp-app 안에 가둬 두었으므로 이 컴포넌트들은
 * 반드시 ErpApp 셸 안에서만 쓴다.
 */
import type { ReactNode } from "react";

export type Tone = "a" | "w" | "g" | "n";

/** 화면 머리 — 제목 · 한 줄 설명 · 우측 동작 버튼 */
export function PageHead({
  title,
  desc,
  actions,
}: {
  title: string;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ph">
      <div>
        <h1>{title}</h1>
        {desc ? <div className="desc">{desc}</div> : null}
      </div>
      {actions ? <div className="acts">{actions}</div> : null}
    </div>
  );
}

export interface KpiItem {
  /** 지표 이름 — 대문자 모노스페이스로 렌더된다 */
  k: string;
  v: ReactNode;
  s?: ReactNode;
  tone?: "bad" | "good" | "warn";
}

export function Kpis({ items }: { items: KpiItem[] }) {
  return (
    <div className="kpis">
      {items.map(item => (
        <div className={item.tone ? `kpi ${item.tone}` : "kpi"} key={item.k}>
          <div className="k">{item.k}</div>
          <div className="v">{item.v}</div>
          {item.s ? <div className="s">{item.s}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function Card({
  title,
  sub,
  actions,
  children,
  bare,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** 표를 카드 안에 꽉 채울 때 — .card-b 패딩을 두지 않는다 */
  bare?: boolean;
}) {
  return (
    <div className="card">
      {title || sub || actions ? (
        <div className="card-h">
          <div>
            {title ? <div className="t">{title}</div> : null}
            {sub ? <div className="s">{sub}</div> : null}
          </div>
          {actions ? <div className="acts">{actions}</div> : null}
        </div>
      ) : null}
      {bare ? children : <div className="card-b">{children}</div>}
    </div>
  );
}

/** 좋은 소식·안내 (녹색) */
export function OkBox({ children }: { children: ReactNode }) {
  return <div className="okbox">{children}</div>;
}

/** 지금 조치가 필요한 것 (빨강) */
export function AlertBox({ children }: { children: ReactNode }) {
  return <div className="alertbox">{children}</div>;
}

/** 알아두어야 하는 한계·미결 (노랑) */
export function Note({ children }: { children: ReactNode }) {
  return <div className="note">{children}</div>;
}

export function Chip({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={tone ? `chip ${tone}` : "chip"}>{children}</span>;
}

export function Tag({
  tone,
  children,
}: {
  tone?: "w" | "a" | "n";
  children: ReactNode;
}) {
  return <span className={tone ? `tag ${tone}` : "tag"}>{children}</span>;
}

export function Pill({
  live,
  children,
}: {
  live?: boolean;
  children: ReactNode;
}) {
  return <span className={live ? "pill live" : "pill"}>{children}</span>;
}

export function Btn({
  primary,
  pressed,
  onClick,
  disabled,
  title,
  children,
}: {
  primary?: boolean;
  pressed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={primary ? "btn pri" : "btn"}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function BtnXs({
  variant,
  onClick,
  disabled,
  title,
  children,
}: {
  variant?: "ok" | "no";
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={variant ? `btn-xs ${variant}` : "btn-xs"}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

/** 기간 단위 등 배타 선택 */
export function Seg<T extends string>({
  options,
  value,
  onPick,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onPick: (value: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(option => (
        <button
          type="button"
          key={option.value}
          aria-pressed={option.value === value}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function UnitBar({ children }: { children: ReactNode }) {
  return <div className="unitbar">{children}</div>;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onPick,
  trailing,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onPick: (id: T) => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(tab => (
        <button
          type="button"
          className="tab"
          role="tab"
          key={tab.id}
          aria-selected={tab.id === active}
          onClick={() => onPick(tab.id)}
        >
          {tab.label}
        </button>
      ))}
      {trailing ? (
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11.5,
            color: "var(--muted)",
          }}
        >
          {trailing}
        </div>
      ) : null}
    </div>
  );
}

/** 넓은 표는 화면이 아니라 이 안에서만 가로 스크롤한다 */
export function Scroll({ children }: { children: ReactNode }) {
  return <div className="scroll">{children}</div>;
}

export function Filters({ children }: { children: ReactNode }) {
  return <div className="filters">{children}</div>;
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span
        style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 9.5,
          letterSpacing: ".09em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {label}
      </span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

/** 화면 안 다른 화면으로 보내는 작은 화살표 — 프로토타입의 ↗ 버튼 */
export function GoTo({
  onClick,
  title,
}: {
  onClick: () => void;
  title: string;
}) {
  return (
    <button type="button" className="ico" onClick={onClick} title={title}>
      ↗
    </button>
  );
}
