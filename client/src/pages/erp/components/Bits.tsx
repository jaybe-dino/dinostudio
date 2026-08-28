import type { EntryStatus, Priority } from "@shared/erp";
import { STATUS_RULES } from "@shared/erp";
import type { ReactNode } from "react";
import { nullReasonText, won, type Tone } from "../format";

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
      <span className="erp-null" title={nullReasonText(reason)}>
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
    <div className="erp-tile" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
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
    <span className="erp-chip" data-tone={STATUS_TONE[status]}>
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
  if (!priority) return <span className="erp-null">미지정</span>;
  return (
    <span
      className="erp-chip"
      data-tone={PRIORITY_TONE[priority]}
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
    <p className="erp-note" data-tone={tone} style={{ margin: 0 }}>
      {children}
    </p>
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
    <section className="erp-card">
      <header>
        <span>{title}</span>
        {meta ? <span>{meta}</span> : null}
      </header>
      {body ? <div className="erp-card-body">{children}</div> : children}
    </section>
  );
}
