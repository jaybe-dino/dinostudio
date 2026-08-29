/**
 * 전표 · 분개장 — 원장이 확정되는 순간 자동 생성된다. 수기 생성 화면을 두지 않는다 (원칙 12).
 */
import { accountLabel } from "@shared/erp";
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
import { matchesQuery, useErpUi } from "../context";
import { shortDate, won } from "../format";

export function JournalsScreen() {
  const { openEntry, query } = useErpUi();
  const data = trpc.erp.journals.useQuery();

  const journals = (data.data?.journals ?? []).filter(j =>
    matchesQuery(
      query,
      j.entryCode,
      j.memo,
      j.lines.map(l => l.accountCode).join(" ")
    )
  );
  const tb = data.data?.trialBalance;

  return (
    <div className="erp-page">
      <header>
        <h1>전표 · 분개장</h1>
        <p>
          사람이 분개를 만들지 않습니다. 원장이 확정되면 전표가 자동 생성되고,
          수정은 -R1 역분개, 취소는 -C 상계로만 이뤄집니다. 수기 생성 API를
          노출하지 않습니다.
        </p>
      </header>

      <div className="erp-tiles">
        <Tile
          label="전표"
          value={`${journals.length}건`}
          note="전부 자동 생성"
        />
        <Tile
          label="차변 합"
          value={won(tb?.debitTotal ?? 0) ?? "—"}
          note="총계정원장 누계"
        />
        <Tile
          label="대변 합"
          value={won(tb?.creditTotal ?? 0) ?? "—"}
          note="총계정원장 누계"
        />
        <Tile
          label="차·대 차액"
          value={won(tb?.difference ?? 0) ?? "—"}
          note={tb?.difference === 0 ? "일치" : "전표 생성 오류"}
          tone={tb?.difference === 0 ? "ok" : "alert"}
        />
      </div>

      <Card title="시산표" meta="계정과목으로 접은 것" body={false}>
        <div className="erp-scroll">
          <table className="erp-table">
            <thead>
              <tr>
                <th>계정</th>
                <th>대분류</th>
                <th className="num">차변</th>
                <th className="num">대변</th>
                <th className="num">잔액</th>
              </tr>
            </thead>
            <tbody>
              {(tb?.rows ?? []).map(row => (
                <tr key={row.accountCode}>
                  <td>{accountLabel(row.accountCode)}</td>
                  <td>{row.type}</td>
                  <td className="num">{won(row.debit)}</td>
                  <td className="num">{won(row.credit)}</td>
                  <td className="num">{won(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>합계</td>
                <td className="num">{won(tb?.debitTotal ?? 0)}</td>
                <td className="num">{won(tb?.creditTotal ?? 0)}</td>
                <td className="num">{won(tb?.difference ?? 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title="분개장" meta={`${journals.length}건`} body={false}>
        <div className="erp-scroll">
          <table className="erp-table">
            <thead>
              <tr>
                <th>집행원장</th>
                <th>전표일</th>
                <th>차변 계정</th>
                <th className="num">차변</th>
                <th>대변 계정</th>
                <th className="num">대변</th>
                <th>적요</th>
              </tr>
            </thead>
            <tbody>
              {journals.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ color: "var(--muted)" }}>
                    확정된 건이 없어 전표가 없습니다
                  </td>
                </tr>
              ) : (
                journals.map(journal => {
                  const debit = journal.lines.find(l => l.debit !== 0);
                  const credit = journal.lines.find(l => l.credit !== 0);
                  return (
                    <tr key={journal.id}>
                      <td>
                        <button
                          className="erp-code"
                          onClick={() => openEntry(journal.entryCode)}
                        >
                          {journal.entryCode}
                        </button>
                      </td>
                      <td>{shortDate(journal.journalDate)}</td>
                      <td>{accountLabel(debit?.accountCode)}</td>
                      <td className="num">{won(debit?.debit ?? 0)}</td>
                      <td>{accountLabel(credit?.accountCode)}</td>
                      <td className="num">{won(credit?.credit ?? 0)}</td>
                      <td className="wrap">{journal.memo}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {tb && tb.difference !== 0 ? (
        <Note tone="alert">
          차변 합과 대변 합이 맞지 않습니다 — 전표 생성 로직을 확인해야 합니다.
        </Note>
      ) : null}
    </div>
  );
}
