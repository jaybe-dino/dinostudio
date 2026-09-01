/**
 * 재인증 (docs/erp-qa.md D7)
 *
 * 세션 12시간은 「오늘 하루 일한다」에 맞춘 값이다. 급여 원장과 세무 제출
 * 파일은 그보다 짧아야 한다 — 자리를 비운 노트북에서 열리면 안 된다.
 *
 * 비밀번호를 다시 받아 같은 로그인 경로로 보낸다. 서버가 쿠키에 재인증 시각을
 * 새로 찍고, 그때부터 15분간만 열린다. 화면에서 숨기는 것이 아니라 서버가
 * 거부하는 것이므로, 이 폼을 건너뛰어도 자료는 나오지 않는다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Note } from "./Bits";

export function Reauth({
  what,
  onDone,
}: {
  /** 무엇을 열기 위한 재인증인지 — 사람이 왜 입력하는지 알아야 한다 */
  what: string;
  onDone: () => void;
}) {
  const me = trpc.erp.me.useQuery();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 이메일은 지금 로그인한 사람 그대로다 — 다른 사람으로 바꿔 넣을 수 없다
        body: JSON.stringify({ email: me.data?.id ?? "", password }),
      });
      const text = await response.text();
      let reason: string | null = null;
      try {
        reason = (JSON.parse(text) as { reason?: string }).reason ?? null;
      } catch {
        reason = null;
      }
      if (!response.ok) {
        setError(reason ?? "비밀번호를 확인하지 못했습니다.");
        return;
      }
      setPassword("");
      onDone();
    } catch {
      setError("서버에 연결하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Note tone="warn">
        <b>{what}은 비밀번호를 다시 확인한 뒤에만 열립니다.</b> 로그인 후 15분이
        지나면 다시 물어봅니다 — 세션이 살아 있어도 이 자료는 따로 잠깁니다.
      </Note>
      <div className="filters" style={{ marginTop: 8 }}>
        <label className="field">
          <span>계정</span>
          <input value={me.data?.id ?? ""} readOnly />
        </label>
        <label className="field" style={{ flex: "1 1 200px" }}>
          <span>비밀번호</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && password && !busy) void submit();
            }}
          />
        </label>
        <button
          type="button"
          className="btn pri"
          disabled={!password || busy}
          onClick={() => void submit()}
        >
          {busy ? "확인 중" : "확인하고 열기"}
        </button>
      </div>
      {error ? (
        <div style={{ marginTop: 8 }}>
          <Note tone="alert">{error}</Note>
        </div>
      ) : null}
    </div>
  );
}
