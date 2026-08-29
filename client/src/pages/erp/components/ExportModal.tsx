/**
 * 내보내기 (§14) — CSV 파일 다운로드 + 탭 구분 텍스트 복사.
 *
 * 프로토타입은 아티팩트 제약 때문에 복사만 됐지만 실제 앱에서는 파일로 내려받을 수 있다.
 * 화면에 보이는 필터 그대로 나가고, BOM을 붙여 엑셀에서 한글이 깨지지 않게 한다.
 */
import { kstToday } from "@shared/erp";
import { useState } from "react";

/** 쉼표·따옴표·줄바꿈이 든 셀은 따옴표로 감싼다 */
function csvCell(cell: string | number | null): string {
  if (cell == null) return "";
  const text = String(cell);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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

  const downloadCsv = () => {
    const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    // BOM — 엑셀이 UTF-8로 열도록
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^가-힣A-Za-z0-9]+/g, "_")}_${kstToday()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

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
              data-variant="primary"
              onClick={downloadCsv}
            >
              CSV 내려받기
            </button>
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
