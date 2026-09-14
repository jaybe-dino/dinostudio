import { useState } from "react";
import type { Debt, DebtSchedule } from "@shared/erp";
import { trpc } from "@/lib/trpc";
import { Card, Note } from "./Bits";

const amount = (value: FormDataEntryValue | null) =>
  String(value ?? "").trim() === "" ? null : Number(value);

export function DebtEditor({
  debts,
  schedules,
}: {
  debts: Debt[];
  schedules: DebtSchedule[];
}) {
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [message, setMessage] = useState("");
  const current = debts.find(d => d.id === selected);
  const schedule = schedules.find(d => d.id === scheduleId);
  const mutation = trpc.erp.upsertMaster.useMutation({
    onSuccess: async () => {
      setMessage("저장했습니다. 차입 조건과 상환 일정은 각각 저장됩니다.");
      await Promise.all([
        utils.erp.debt.invalidate(),
        utils.erp.forecast.invalidate(),
        utils.erp.audit.invalidate(),
      ]);
    },
    onError: e => setMessage(e.message),
  });
  const style = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 12,
  };
  const field = { display: "grid", gap: 4 };
  return (
    <>
      {message && <Note>{message}</Note>}
      <Card title="차입 등록 · 조건 수정">
        <p>
          실행된 회사 차입의 현재 잔액과 확인된 약정 조건을 입력합니다. 모르는
          값은 비워 두십시오. 기존 미분해 장기부채 총액에 포함된 건은 기준값의
          미분해 잔액도 함께 대사해야 중복 합산을 막을 수 있습니다.
        </p>
        <label>
          등록할 차입{" "}
          <select
            value={selected}
            onChange={e => {
              setSelected(e.target.value);
              setMessage("");
            }}
          >
            <option value="">새 차입 등록</option>
            {debts.map(d => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.creditor}
              </option>
            ))}
          </select>
        </label>
        <form
          key={selected}
          onSubmit={async e => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const id = current?.id ?? crypto.randomUUID();
            try {
              await mutation.mutateAsync({
                kind: "debt",
                payload: {
                  id,
                  code: String(f.get("code")).trim(),
                  creditor: String(f.get("creditor")).trim(),
                  principal: amount(f.get("principal")),
                  rate: amount(f.get("rate")),
                  maturityDate: f.get("maturityDate") || null,
                  repayType: String(f.get("repayType") ?? "").trim() || null,
                  monthlyInterest: amount(f.get("monthlyInterest")),
                  term: f.get("term"),
                  isRelatedParty: f.get("isRelatedParty") === "on",
                  docUrl: String(f.get("docUrl") ?? "").trim() || null,
                },
              });
              setSelected(id);
            } catch {
              /* mutation displays the error and retains the draft */
            }
          }}
        >
          <div style={style}>
            <label style={field}>
              차입 코드
              <input
                name="code"
                required
                maxLength={32}
                defaultValue={current?.code ?? ""}
                placeholder="예: LOAN-2026-01"
              />
            </label>
            <label style={field}>
              채권자
              <input
                name="creditor"
                required
                maxLength={200}
                defaultValue={current?.creditor ?? ""}
              />
            </label>
            <label style={field}>
              현재 원금 잔액 (원)
              <input
                name="principal"
                type="number"
                min="0"
                step="1"
                defaultValue={current?.principal ?? ""}
              />
            </label>
            <label style={field}>
              연 이자율 (%)
              <input
                name="rate"
                type="number"
                min="0"
                max="100"
                step="0.0001"
                defaultValue={current?.rate ?? ""}
              />
            </label>
            <label style={field}>
              만기일
              <input
                name="maturityDate"
                type="date"
                defaultValue={current?.maturityDate ?? ""}
              />
            </label>
            <label style={field}>
              상환 조건
              <input
                name="repayType"
                maxLength={60}
                defaultValue={current?.repayType ?? ""}
                placeholder="예: 만기 원리금 일시상환"
              />
            </label>
            <label style={field}>
              약정상 월 이자액 (원)
              <input
                name="monthlyInterest"
                type="number"
                min="0"
                step="1"
                defaultValue={current?.monthlyInterest ?? ""}
              />
            </label>
            <label style={field}>
              분류
              <select name="term" defaultValue={current?.term ?? "단기"}>
                <option>단기</option>
                <option>장기</option>
              </select>
            </label>
            <label style={field}>
              약정서 링크
              <input
                name="docUrl"
                type="url"
                defaultValue={current?.docUrl ?? ""}
              />
            </label>
            <label>
              <input
                name="isRelatedParty"
                type="checkbox"
                defaultChecked={current?.isRelatedParty ?? false}
              />{" "}
              특수관계 차입
            </label>
          </div>
          <p>
            만기에 한 번 내는 총 이자는 월 이자액에 넣지 않고, 아래 상환 일정의
            이자로 입력하십시오.
          </p>
          <button className="btn primary" disabled={mutation.isPending}>
            차입 조건 저장
          </button>
        </form>
      </Card>
      <Card title="상환 일정 등록 · 수정">
        <p>
          13주 자금계획에는 아래에 저장한 지급일과 원금·이자가 반영됩니다. 실제
          지급 승인이나 원장 전표는 별도입니다.
        </p>
        <label>
          등록할 일정{" "}
          <select
            value={scheduleId}
            onChange={e => setScheduleId(e.target.value)}
          >
            <option value="">새 상환 일정</option>
            {schedules.map(s => (
              <option key={s.id} value={s.id}>
                {debts.find(d => d.id === s.debtId)?.creditor ?? s.debtId} ·{" "}
                {s.dueDate}
              </option>
            ))}
          </select>
        </label>
        <form
          key={scheduleId}
          onSubmit={async e => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const id = schedule?.id ?? crypto.randomUUID();
            try {
              await mutation.mutateAsync({
                kind: "debtSchedule",
                payload: {
                  id,
                  debtId: f.get("debtId"),
                  dueDate: f.get("dueDate"),
                  principal: amount(f.get("principal")) ?? 0,
                  interest: amount(f.get("interest")) ?? 0,
                },
              });
              setScheduleId(id);
            } catch {
              /* keep inputs for correction */
            }
          }}
        >
          <div style={style}>
            <label style={field}>
              차입 선택
              <select
                name="debtId"
                required
                defaultValue={schedule?.debtId ?? ""}
              >
                <option value="">선택하십시오</option>
                {debts.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.code} · {d.creditor}
                  </option>
                ))}
              </select>
            </label>
            <label style={field}>
              지급 예정일
              <input
                name="dueDate"
                type="date"
                required
                defaultValue={schedule?.dueDate ?? ""}
              />
            </label>
            <label style={field}>
              상환 원금 (원)
              <input
                name="principal"
                type="number"
                min="0"
                step="1"
                defaultValue={schedule?.principal ?? ""}
              />
            </label>
            <label style={field}>
              지급 이자 (원)
              <input
                name="interest"
                type="number"
                min="0"
                step="1"
                defaultValue={schedule?.interest ?? ""}
              />
            </label>
          </div>
          <button
            className="btn primary"
            disabled={mutation.isPending || !debts.length}
          >
            상환 일정 저장
          </button>
        </form>
      </Card>
    </>
  );
}
