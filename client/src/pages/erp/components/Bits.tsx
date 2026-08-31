import type { EntryStatus, Priority } from "@shared/erp";
import { STATUS_RULES } from "@shared/erp";
import type { ReactNode } from "react";
import { nullReasonText, won, type Tone } from "../format";

/**
 * 색 의미를 프로토타입 클래스로 옮긴다.
 * kpi 는 bad/good/warn, chip·tag 는 a/w/g/n 을 쓴다 — 둘이 다르므로 표를 따로 둔다.
 */
const TONE_CLASS: Record<NonNullable<Tone>, string> = {
  alert: "bad",
  warn: "warn",
  ok: "good",
  info: "good",
  // 계산 불가는 색으로 강조하지 않는다 — 숫자가 없다는 사실 자체가 메시지다
  null: "",
};

const CHIP_CLASS: Record<NonNullable<Tone>, string> = {
  alert: "a",
  warn: "w",
  ok: "g",
  info: "n",
  null: "n",
};

/** Tone → 프로토타입 chip 변형 클래스. 화면들도 동적 색에 이걸 쓴다. */
export function chipClass(tone: Tone): string {
  return tone ? `chip ${CHIP_CLASS[tone]}` : "chip";
}

/** 금액 셀 — null이면 숫자 자리에 이유가 온다 (§10.2 ①) */
export function Money({
  value,
  reason,
}: {
  value: number | null | undefined;
  reason?: string | null;
}) {
  const text = won(value);
  if (text == null)
    return (
      <span className="s" title={nullReasonText(reason)}>
        계산 불가
      </span>
    );
  return <>{text}</>;
}

export function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`kpi ${tone ? TONE_CLASS[tone] : ""}`.trim()}>
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      {note ? <div className="s">{note}</div> : null}
    </div>
  );
}

const STATUS_TONE: Record<EntryStatus, Tone> = {
  confirmed: "ok",
  pending: "warn",
  undecided: "alert",
  held: "info",
  rejected: undefined,
  superseded: undefined,
  cancelled: undefined,
};

export function StatusChip({ status }: { status: EntryStatus }) {
  return (
    <span className={chipClass(STATUS_TONE[status])}>
      {STATUS_RULES[status].label}
    </span>
  );
}

const PRIORITY_TONE: Record<Priority, Tone> = {
  P0: "alert",
  P1: "warn",
  P2: "info",
  P3: undefined,
};

export function PriorityChip({
  priority,
  overridden,
}: {
  priority: Priority | null;
  overridden?: boolean;
}) {
  if (!priority) return <span className="s">미지정</span>;
  return (
    <span
      className={chipClass(PRIORITY_TONE[priority])}
      title={overridden ? "사람이 올린 등급" : undefined}
    >
      {priority}
      {overridden ? " ↑" : ""}
    </span>
  );
}

export function Note({
  tone,
  children,
}: {
  tone?: "alert" | "warn";
  children: ReactNode;
}) {
  return (
    <div className={tone === "alert" ? "alertbox" : "note"}>{children}</div>
  );
}

export function Card({
  title,
  meta,
  children,
  body = true,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  body?: boolean;
}) {
  return (
    <section className="card">
      <header>
        <span>{title}</span>
        {meta ? <span>{meta}</span> : null}
      </header>
      {body ? <div className="card-b">{children}</div> : children}
    </section>
  );
}
