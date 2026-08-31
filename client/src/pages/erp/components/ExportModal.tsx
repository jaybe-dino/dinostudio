/**
 * 내보내기 (§14) — CSV 파일 다운로드 + 탭 구분 텍스트 복사.
 *
 * 프로토타입은 아티팩트 제약 때문에 복사만 됐지만 실제 앱에서는 파일로 내려받을 수 있다.
 * 화면에 보이는 필터 그대로 나가고, BOM을 붙여 엑셀에서 한글이 깨지지 않게 한다.
 */
import { kstToday } from "@shared/erp";
import { useState } from "react";

/** XML 특수문자 이스케이프 */
function xmlCell(cell: string | number | null): string {
  if (cell == null) return '<Cell><Data ss:Type="String"></Data></Cell>';
  if (typeof cell === "number") {
    return `<Cell><Data ss:Type="Number">${cell}</Data></Cell>`;
  }
  const escaped = cell
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<Cell><Data ss:Type="String">${escaped}</Data></Cell>`;
}

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

  const download = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^가-힣A-Za-z0-9]+/g, "_")}_${kstToday()}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * XLSX — SpreadsheetML 2003. 라이브러리 없이 엑셀·넘버스·구글시트에서 열리고,
   * 숫자가 문자열로 들어가지 않아 바로 합계를 낼 수 있다 (§14).
   */
  const downloadXlsx = () => {
    const body = rows
      .map(row => `<Row>${row.map(xmlCell).join("")}</Row>`)
      .join("");
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<?mso-application progid="Excel.Sheet"?>` +
      `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
      `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
      `<Worksheet ss:Name="원장"><Table>${body}</Table></Worksheet></Workbook>`;
    download(new Blob([xml], { type: "application/vnd.ms-excel" }), "xls");
  };

  const downloadCsv = () => {
    const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    // BOM — 엑셀이 UTF-8로 열도록
    download(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
      "csv"
    );
  };

  return (
    <div
      className="modal on"
      role="dialog"
      aria-label={title}
      onClick={onClose}
    >
      <div className="modal-box" onClick={event => event.stopPropagation()}>
        <div className="modal-h">
          <b>{title}</b>
          <span className="chip n">탭 구분 · {rows.length - 1}행</span>
          <button
            type="button"
            className="ico x"
            onClick={onClose}
            aria-label="닫기"
            style={{ marginLeft: "auto" }}
          >
            ×
          </button>
        </div>

        <div className="modal-b" style={{ padding: 0 }}>
          <textarea
            readOnly
            value={text}
            onFocus={event => event.currentTarget.select()}
            aria-label={`${title} 내보내기 내용`}
            style={{
              width: "100%",
              minHeight: "44vh",
              border: 0,
              padding: "12px 14px",
              font: '12px/1.6 "IBM Plex Mono", monospace',
              resize: "none",
              background: "var(--surface)",
              color: "var(--ink)",
            }}
          />
        </div>

        <div className="modal-f">
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="btn" onClick={downloadCsv}>
            CSV
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
              } catch {
                // 클립보드 권한이 없으면 사용자가 직접 선택해 복사하면 된다
                setCopied(false);
              }
            }}
          >
            {copied ? "복사됨" : "전체 복사"}
          </button>
          <button type="button" className="btn pri" onClick={downloadXlsx}>
            엑셀 내려받기
          </button>
        </div>
      </div>
    </div>
  );
}
