/**
 * 계정별 원장 (docs/erp-qa.md A13)
 *
 * 계정과목 체계는 있었지만 「그 계정에 무엇이 들어왔나」를 볼 방법이 없었다.
 * 잔액이 이상할 때 이 화면 없이는 원인을 찾을 자리가 없다 — 전표 목록에서
 * 한 계정만 골라 눈으로 훑는 것은 검증이 아니다.
 *
 * 누계 잔액을 줄마다 같이 둔다. 어느 줄에서 틀어졌는지 그 자리에서 보인다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ACCOUNTS } from "@shared/erp";
import { shortDate, won } from "../format";
import {
  AlertBox,
  Card,
  Field,
  Filters,
  Note,
  PageHead,
  Scroll,
} from "../components/Proto";

export function AccountLedgerScreen() {
  const [accountCode, setAccountCode] = useState("1110");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const q = trpc.erp.accountLedger.useQuery({
    accountCode,
    from: from || null,
    to: to || null,
  });

  const d = q.data;
  const opening = d?.opening ?? 0;
  const closing = d?.closing ?? 0;
  const debitSum = (d?.rows ?? []).reduce((s, r) => s + r.debit, 0);
  const creditSum = (d?.rows ?? []).reduce((s, r) => s + r.credit, 0);

  return (
    <>
      <PageHead
        title="계정별 원장"
        desc="한 계정에 들어온 전표만 시간순으로 모았습니다. 오른쪽 누계가 그 줄까지의 잔액이므로, 잔액이 틀어진 지점을 줄 단위로 찾을 수 있습니다."
      />

      <Filters>
        <Field label="계정과목">
          <select
            value={accountCode}
            onChange={e => setAccountCode(e.target.value)}
          >
            {ACCOUNTS.map(a => (
              <option key={a.code} value={a.code}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="시작일" hint="비우면 처음부터">
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
          />
        </Field>
        <Field label="종료일" hint="비우면 마지막까지">
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </Field>
      </Filters>

      {q.error ? <AlertBox>{q.error.message}</AlertBox> : null}

      <Card
        title={`${d?.accountCode ?? accountCode} ${d?.accountName ?? ""}`}
        sub={`정상 잔액은 ${d?.normalSide ?? "차변"} · 기초 ${won(opening)} → 기말 ${won(closing)}`}
        bare
      >
        <Scroll>
          <table>
            <thead>
              <tr>
                <th>전표번호</th>
                <th>일자</th>
                <th>적요</th>
                <th className="n">차변</th>
                <th className="n">대변</th>
                <th className="n">누계 잔액</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="s" colSpan={3}>
                  기초 잔액{from ? ` (${shortDate(from)} 이전 누계)` : ""}
                </td>
                <td className="n s">—</td>
                <td className="n s">—</td>
                <td className="n k">{won(opening)}</td>
              </tr>
              {(d?.rows ?? []).map(row => (
                <tr key={`${row.journalId}-${row.date}-${row.balance}`}>
                  <td className="nw">
                    {row.journalNo ?? <span className="s">번호 없음</span>}
                  </td>
                  <td className="nw">{shortDate(row.date)}</td>
                  <td>{row.memo ?? <span className="s">적요 없음</span>}</td>
                  <td className="n">{row.debit === 0 ? "" : won(row.debit)}</td>
                  <td className="n">
                    {row.credit === 0 ? "" : won(row.credit)}
                  </td>
                  <td className="n k">{won(row.balance)}</td>
                </tr>
              ))}
              {(d?.rows.length ?? 0) === 0 && !q.isLoading ? (
                <tr>
                  <td colSpan={6} className="s">
                    이 기간에 이 계정을 쓴 전표가 없습니다
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="k">
                  기간 합계 · 기말 잔액
                </td>
                <td className="n k">{won(debitSum)}</td>
                <td className="n k">{won(creditSum)}</td>
                <td className="n k">{won(closing)}</td>
              </tr>
            </tfoot>
          </table>
        </Scroll>
      </Card>

      <Note>
        <b>전표번호가 비어 있는 줄은 번호 체계 도입 전에 만들어진 전표입니다.</b>{" "}
        소급해서 번호를 붙이지 않았습니다 — 이미 다른 문서에 UUID 로 인용된 것이
        있으면 참조가 끊어집니다.
      </Note>
    </>
  );
}
