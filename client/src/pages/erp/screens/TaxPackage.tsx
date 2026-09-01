/**
 * 세무대리인 제출 패키지 (docs/erp-qa.md E11)
 *
 * 지금까지 내보내기는 화면마다 다른 모양의 탭 구분 텍스트였다. 세무대리인이
 * 원하는 것은 「계정별 집계 + 증빙 목록」이라는 고정 양식이고, 매달 같은
 * 모양이어야 한다 — 모양이 바뀌면 저쪽에서 매달 다시 맞춰야 한다.
 *
 * 증빙이 빠진 건을 먼저 보여 준다. 제출한 뒤에 물어보면 자료를 다시 뒤져야 하고,
 * 신고 기한이 가까울수록 그 시간이 없다.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { kstToday } from "@shared/erp";
import { shortDate, won } from "../format";
import { ExportModal } from "../components/ExportModal";
import { Reauth } from "../components/Reauth";
import {
  AlertBox,
  Btn,
  Card,
  Field,
  Filters,
  Kpis,
  Note,
  OkBox,
  PageHead,
  Scroll,
} from "../components/Proto";

export function TaxPackageScreen() {
  const [ym, setYm] = useState(kstToday().slice(0, 7));
  const [exporting, setExporting] = useState<"accounts" | "evidence" | null>(
    null
  );
  const utils = trpc.useUtils();
  // 재인증이 필요하다는 응답은 재시도하지 않는다 — 바로 폼을 띄운다
  const q = trpc.erp.taxPackage.useQuery({ ym }, { retry: false });
  const d = q.data;

  // 파일로 들고 나가는 것은 재인증 뒤에만 (docs/erp-qa.md D7)
  const needsReauth = (q.error?.message ?? "").includes("비밀번호를 다시");

  const missing = (d?.evidence ?? []).filter(row => row.missing);

  const accountRows: (string | number | null)[][] = [
    ["계정코드", "계정과목", "재무제표 줄", "차변", "대변", "순액"],
    ...(d?.accountSummary ?? []).map(row => [
      row.code,
      row.name,
      row.fsLine,
      row.debit,
      row.credit,
      row.net,
    ]),
  ];

  const evidenceRows: (string | number | null)[][] = [
    ["코드", "일자", "항목", "계정", "금액", "증빙 종류", "적격증빙"],
    ...(d?.evidence ?? []).map(row => [
      row.code,
      row.date,
      row.title,
      row.accountCode,
      row.amount,
      row.kinds.join(" · "),
      row.missing ? "없음" : row.qualified ? "예" : "비적격",
    ]),
  ];

  return (
    <>
      <PageHead
        title="세무 제출 패키지"
        desc="세무대리인에게 매달 같은 모양으로 넘기는 두 장입니다 — 계정별 집계와 증빙 목록. 화면 필터가 아니라 월 단위로 고정되어 있어 매달 같은 파일이 나옵니다."
      />

      <Filters>
        <Field label="대상 월" hint="확정된 건만 들어갑니다">
          <input
            type="month"
            value={ym}
            onChange={e => setYm(e.target.value)}
          />
        </Field>
      </Filters>

      {needsReauth ? (
        <Reauth
          what="세무 제출 패키지"
          onDone={() => void utils.erp.taxPackage.invalidate()}
        />
      ) : q.error ? (
        <AlertBox>{q.error.message}</AlertBox>
      ) : null}

      {/* 잠긴 동안에는 집계·증빙 목록을 아예 그리지 않는다 */}
      {needsReauth ? null : (
        <>
          <Kpis
            items={[
              {
                k: "확정 건수",
                v: `${d?.counts.entries ?? 0}건`,
                s: `${ym} 발생일 또는 결제일 기준`,
              },
              {
                k: "증빙 없는 건",
                v: `${d?.counts.missingEvidence ?? 0}건`,
                s:
                  (d?.counts.missingEvidence ?? 0) > 0
                    ? "제출 전에 채워야 합니다"
                    : "모두 붙어 있습니다",
                tone: (d?.counts.missingEvidence ?? 0) > 0 ? "bad" : "good",
              },
              {
                k: "계정 수",
                v: `${d?.accountSummary.length ?? 0}개`,
                s: "세무대리인 장부와 맞추는 단위",
              },
            ]}
          />

          {missing.length > 0 ? (
            <AlertBox>
              <b>증빙이 없는 건이 {missing.length}건 있습니다.</b> 합계{" "}
              {won(missing.reduce((s, r) => s + (r.amount ?? 0), 0))} — 이
              상태로 넘기면 세무대리인이 다시 물어봅니다. 코드:{" "}
              {missing
                .slice(0, 8)
                .map(r => r.code)
                .join(", ")}
              {missing.length > 8 ? ` 외 ${missing.length - 8}건` : ""}
            </AlertBox>
          ) : (d?.counts.entries ?? 0) > 0 ? (
            <OkBox>증빙이 모두 붙어 있습니다 — 이대로 넘길 수 있습니다.</OkBox>
          ) : null}

          <Card
            title="① 계정별 집계"
            sub="세무대리인 장부와 대조하는 장"
            actions={
              <Btn onClick={() => setExporting("accounts")} disabled={!d}>
                내보내기
              </Btn>
            }
            bare
          >
            <Scroll>
              <table>
                <thead>
                  <tr>
                    <th>계정</th>
                    <th>계정과목</th>
                    <th>재무제표 줄</th>
                    <th className="n">차변</th>
                    <th className="n">대변</th>
                    <th className="n">순액</th>
                  </tr>
                </thead>
                <tbody>
                  {(d?.accountSummary ?? []).map(row => (
                    <tr key={row.code}>
                      <td className="nw">{row.code}</td>
                      <td className="k">{row.name}</td>
                      <td className="nw">
                        <span className="tag n">{row.fsLine}</span>
                      </td>
                      <td className="n">
                        {row.debit === 0 ? "" : won(row.debit)}
                      </td>
                      <td className="n">
                        {row.credit === 0 ? "" : won(row.credit)}
                      </td>
                      <td className="n k">{won(row.net)}</td>
                    </tr>
                  ))}
                  {(d?.accountSummary.length ?? 0) === 0 && !q.isLoading ? (
                    <tr>
                      <td colSpan={6} className="s">
                        이 달에 확정된 전표가 없습니다
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </Scroll>
          </Card>

          <Card
            title="② 증빙 목록"
            sub="적격증빙 여부를 건별로"
            actions={
              <Btn onClick={() => setExporting("evidence")} disabled={!d}>
                내보내기
              </Btn>
            }
            bare
          >
            <Scroll>
              <table>
                <thead>
                  <tr>
                    <th>코드</th>
                    <th>일자</th>
                    <th>항목</th>
                    <th>계정</th>
                    <th className="n">금액</th>
                    <th>증빙</th>
                  </tr>
                </thead>
                <tbody>
                  {(d?.evidence ?? []).map(row => (
                    <tr key={row.code}>
                      <td className="nw">{row.code}</td>
                      <td className="nw">{shortDate(row.date)}</td>
                      <td className="k">{row.title}</td>
                      <td className="nw">{row.accountCode ?? "—"}</td>
                      <td className="n">{won(row.amount)}</td>
                      <td className="nw">
                        {row.missing ? (
                          <span className="chip a">없음</span>
                        ) : row.qualified ? (
                          <span
                            className="chip g"
                            title={row.kinds.join(" · ")}
                          >
                            적격
                          </span>
                        ) : (
                          <span
                            className="chip w"
                            title={row.kinds.join(" · ")}
                          >
                            비적격
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(d?.evidence.length ?? 0) === 0 && !q.isLoading ? (
                    <tr>
                      <td colSpan={6} className="s">
                        이 달에 확정된 건이 없습니다
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </Scroll>
          </Card>

          <Note>
            <b>내보내기는 감사 기록에 남습니다.</b> 누가 어느 달 자료를 언제
            들고 나갔는지 통제 화면에서 확인할 수 있습니다. 외부열람 역할은
            화면에서 볼 수 있지만 파일로 내보낼 수 없습니다 — 보는 것과 들고
            나가는 것은 다른 위험입니다.
          </Note>
        </>
      )}

      {exporting === "accounts" ? (
        <ExportModal
          title={`세무제출_계정별집계_${ym}`}
          rows={accountRows}
          onClose={() => setExporting(null)}
        />
      ) : null}
      {exporting === "evidence" ? (
        <ExportModal
          title={`세무제출_증빙목록_${ym}`}
          rows={evidenceRows}
          onClose={() => setExporting(null)}
        />
      ) : null}
    </>
  );
}
