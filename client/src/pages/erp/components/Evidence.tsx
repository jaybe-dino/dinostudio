/**
 * 증빙 (§6.3 attachment · §13.2)
 *
 * 파일 업로드와 드라이브 링크를 함께 받는다. 스토리지가 설정되지 않은 환경에서는
 * 링크 등록만 열어 둔다 — 받을 수 없는데 받은 것처럼 보이면 증빙 규칙이 명예 규정이 된다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Note } from "./Bits";

const KINDS = ["계산서", "영수증", "계약서", "이체확인증", "기타"] as const;
type Kind = (typeof KINDS)[number];

export function Evidence({
  code,
  onChanged,
}: {
  code: string;
  onChanged: () => void;
}) {
  const list = trpc.erp.evidence.list.useQuery({ code });
  const [kind, setKind] = useState<Kind>("계산서");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestUpload = trpc.erp.evidence.requestUpload.useMutation();
  const add = trpc.erp.evidence.add.useMutation({
    onSuccess: async () => {
      setLink("");
      setError(null);
      await list.refetch();
      onChanged();
    },
    onError: e => setError(e.message),
  });

  const uploadFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const ticket = await requestUpload.mutateAsync({
        code,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      // 서버를 거치지 않고 스토리지에 바로 올린다 — 서버리스 함수 본문 크기 제한을 피한다
      const response = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) throw new Error(`업로드 실패 (${response.status})`);
      await add.mutateAsync({
        code,
        kind,
        storage: "file",
        url: ticket.key,
        fileName: file.name,
        sizeBytes: file.size,
        contentType: file.type || null,
        attachmentId: ticket.attachmentId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드에 실패했습니다");
    } finally {
      setBusy(false);
    }
  };

  const attachments = list.data?.attachments ?? [];
  const canUpload = list.data?.storageConfigured ?? false;

  return (
    <div>
      <h4 style={{ margin: "0 0 6px", fontSize: 12.5, color: "var(--muted)" }}>
        증빙 {attachments.length > 0 ? `· ${attachments.length}건` : ""}
      </h4>

      {attachments.length === 0 ? (
        <p className="s" style={{ margin: "0 0 8px" }}>
          증빙이 없습니다 — 이 건은 보류까지만 가능하고 확정되지 않습니다
          (§13.2)
        </p>
      ) : (
        <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
          {attachments.map(item => (
            <li key={item.id}>
              <span className="chip">{item.kind}</span>{" "}
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.fileName ?? item.url}
              </a>
              <span className="s">
                {" "}
                · {item.storage === "file" ? "업로드" : "링크"} ·{" "}
                {item.uploadedBy}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="filters">
        <label className="field">
          <span>종류</span>
          <select value={kind} onChange={e => setKind(e.target.value as Kind)}>
            {KINDS.map(k => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>

        {canUpload ? (
          <label className="field">
            <span>파일 (PDF · 이미지 · 20MB 이하)</span>
            <input
              type="file"
              accept="application/pdf,image/*"
              disabled={busy}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) void uploadFile(file);
                e.target.value = "";
              }}
            />
          </label>
        ) : null}

        <label className="field" style={{ flex: "1 1 220px" }}>
          <span>드라이브 링크</span>
          <input
            value={link}
            placeholder="https://drive.google.com/..."
            onChange={e => setLink(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={!link.trim() || add.isPending || busy}
          onClick={() =>
            add.mutate({ code, kind, storage: "link", url: link.trim() })
          }
        >
          링크 등록
        </button>
      </div>

      {!canUpload ? (
        <p className="s" style={{ marginTop: 6 }}>
          파일 스토리지가 설정되지 않아 링크 등록만 됩니다. 계약서처럼 원본이
          드라이브에 있는 것은 링크가 맞습니다 (§11.2).
        </p>
      ) : null}
      {error ? (
        <div style={{ marginTop: 8 }}>
          <Note tone="alert">{error}</Note>
        </div>
      ) : null}
    </div>
  );
}
