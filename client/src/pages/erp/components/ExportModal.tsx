/**
 * 내보내기 — 탭 구분 텍스트. 브라우저 정책상 파일 저장이 막혀 있어 복사로 넘긴다 (UI 동작 명세).
 */
import { useState } from "react";

export function ExportModal({
  title,
  rows,
  onClose,
}: {
  title: string;
  rows: (string | number | null)[][];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = rows
    .map(row => row.map(cell => (cell == null ? "" : String(cell))).join("\t"))
    .join("\n");

  return (
    <div className="erp-palette" onClick={onClose}>
      <div
        onClick={event => event.stopPropagation()}
        style={{ width: "min(880px, 94vw)", maxHeight: "72vh" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <strong>
            {title} — 탭 구분 텍스트 {rows.length - 1}행
          </strong>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="erp-btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "복사됨" : "전체 복사"}
            </button>
            <button type="button" className="erp-btn" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
        <textarea
          readOnly
          value={text}
          onFocus={event => event.currentTarget.select()}
          style={{
            width: "100%",
            minHeight: "48vh",
            border: 0,
            padding: "12px 14px",
            font: "12px/1.6 var(--mono)",
            resize: "none",
            background: "var(--surface)",
            color: "var(--ink)",
          }}
        />
      </div>
    </div>
  );
}
