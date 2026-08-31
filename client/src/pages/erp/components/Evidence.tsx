/**
 * 증빙 (§6.3 attachment · §13.2)
 *
 * 종류를 자유 텍스트로 두지 않는다 — 적격/비적격이 갈리고 그에 따라 잃는 돈이 다르다.
 * 파일·링크·「증빙 없음」 세 가지를 모두 받는다. 증빙 없음은 사유를 반드시 받고,
 * 못 받게 되는 매입세액과 가산세를 그 자리에서 보여 준다.
 * 막는 것이 아니라 보이게 하는 방식이다 (원칙 8).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  EVIDENCE_KINDS,
  EVIDENCE_STORAGE_LABEL,
  MIN_NO_EVIDENCE_REASON_LENGTH,
  NO_EVIDENCE_KIND,
  evidenceKindSpec,
  type EvidenceStorage,
} from "@shared/erp";
import { won } from "../format";

export function Evidence({
  code,
  onChanged,
}: {
  code: string;
  onChanged: () => void;
}) {
  const list = trpc.erp.evidence.list.useQuery({ code });
  const [kind, setKind] = useState<string>("세금계산서");
  const [mode, setMode] = useState<EvidenceStorage>("link");
  const [link, setLink] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestUpload = trpc.erp.evidence.requestUpload.useMutation();
  const add = trpc.erp.evidence.add.useMutation({
    onSuccess: async () => {
      setLink("");
      setReason("");
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
  const risk = list.data?.risk;
  const spec = evidenceKindSpec(kind);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="card-h" style={{ padding: 0, border: 0 }}>
        <div className="t">
          증빙 {attachments.length > 0 ? `· ${attachments.length}건` : ""}
        </div>
        {risk == null ? null : !risk.applicable ? (
          <span className="chip n">매입 증빙 대상 아님</span>
        ) : risk.qualified ? (
          <span className="chip g">적격증빙 있음</span>
        ) : (
          <span className="chip a">적격증빙 없음</span>
        )}
      </div>

      {/* 잃는 돈을 먼저 보여 준다 — 증빙 목록보다 이것이 판단에 쓰인다 */}
      {risk && (risk.vatLost != null || risk.penalty != null) ? (
        <div className="alertbox">
          <b>이 건은 증빙 때문에 돈을 잃습니다.</b>
          <div className="daysum" style={{ marginTop: 8, borderTop: 0 }}>
            {risk.vatLost != null ? (
              <div>
                <span className="lb">못 받는 매입세액</span>
                <span className="vv">{won(risk.vatLost)}</span>
              </div>
            ) : null}
            {risk.penalty != null ? (
              <div>
                <span className="lb">증빙불비가산세</span>
                <span className="vv">{won(risk.penalty)}</span>
              </div>
            ) : null}
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {risk.reasons.map(text => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {attachments.length === 0 ? (
        <div className="note">
          증빙이 없습니다 — 이 건은 보류까지만 가능하고 확정되지 않습니다
          (§13.2). 실제로 증빙을 받을 수 없는 건이라면 아래에서 <b>증빙 없음</b>
          으로 사유를 남기십시오.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>종류</th>
              <th>보관</th>
              <th>내용</th>
              <th>등록자</th>
            </tr>
          </thead>
          <tbody>
            {attachments.map(item => {
              const itemSpec = evidenceKindSpec(item.kind);
              return (
                <tr key={item.id}>
                  <td className="nw">
                    <span
                      className={itemSpec?.qualified ? "chip g" : "chip n"}
                      title={
                        itemSpec?.qualified ? "적격증빙" : "적격증빙이 아닙니다"
                      }
                    >
                      {item.kind}
                    </span>
                  </td>
                  <td className="nw">{EVIDENCE_STORAGE_LABEL[item.storage]}</td>
                  <td>
                    {item.storage === "none" ? (
                      <span title="증빙 없이 등록한 사유">{item.reason}</span>
                    ) : (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.fileName ?? item.url}
                      </a>
                    )}
                  </td>
                  <td className="nw s">{item.uploadedBy}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="filters">
        <label className="field" style={{ flex: "1 1 190px" }}>
          <span>종류</span>
          <select
            value={kind}
            disabled={mode === "none"}
            onChange={e => setKind(e.target.value)}
          >
            {EVIDENCE_KINDS.map(k => (
              <option key={k.kind} value={k.kind}>
                {k.kind}
                {k.qualified ? " (적격)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: "1 1 150px" }}>
          <span>보관 방식</span>
          <select
            value={mode}
            onChange={e => {
              const next = e.target.value as EvidenceStorage;
              setMode(next);
              // 받지 못한 세금계산서를 세금계산서로 기록하면 나중에 있는 것으로 읽힌다
              if (next === "none") setKind(NO_EVIDENCE_KIND);
              else if (kind === NO_EVIDENCE_KIND) setKind("세금계산서");
            }}
          >
            {canUpload ? <option value="file">파일 첨부</option> : null}
            <option value="link">외부 링크</option>
            <option value="none">증빙 없음</option>
          </select>
        </label>
      </div>

      {spec ? (
        <p className="s" style={{ margin: 0 }}>
          {spec.note}
          {spec.vatDeductible ? " · 매입세액 공제됩니다" : ""}
        </p>
      ) : null}

      {mode === "file" ? (
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

      {mode === "link" ? (
        <div className="filters">
          <label className="field" style={{ flex: "1 1 260px" }}>
            <span>링크 주소</span>
            <input
              value={link}
              placeholder="https://drive.google.com/..."
              onChange={e => setLink(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn pri"
            disabled={!link.trim() || add.isPending || busy}
            onClick={() =>
              add.mutate({ code, kind, storage: "link", url: link.trim() })
            }
          >
            링크 등록
          </button>
        </div>
      ) : null}

      {mode === "none" ? (
        <div className="filters">
          <label className="field" style={{ flex: "1 1 260px" }}>
            <span>증빙이 없는 사유 (필수)</span>
            <input
              value={reason}
              placeholder="예: 해외 결제로 세금계산서 발급 불가"
              onChange={e => setReason(e.target.value)}
            />
            <span className="hint">
              {MIN_NO_EVIDENCE_REASON_LENGTH}자 이상. 나중에 왜 없었는지 아는
              사람이 남지 않으므로 구체적으로 적으십시오.
            </span>
          </label>
          <button
            type="button"
            className="btn"
            disabled={
              reason.trim().length < MIN_NO_EVIDENCE_REASON_LENGTH ||
              add.isPending ||
              busy
            }
            onClick={() =>
              add.mutate({
                code,
                kind,
                storage: "none",
                reason: reason.trim(),
              })
            }
          >
            증빙 없이 등록
          </button>
        </div>
      ) : null}

      {!canUpload && mode === "file" ? (
        <p className="s" style={{ margin: 0 }}>
          파일 스토리지가 설정되지 않아 링크 등록만 됩니다 (§11.2).
        </p>
      ) : null}
      {error ? <div className="alertbox">{error}</div> : null}
    </div>
  );
}
