/**
 * 파트너십 문의함 — dinostudio.kr 공개 사이트의 문의 폼(contact.submit)으로
 * 들어온 접수 내역. 원본은 contacts 테이블이며 이 화면은 읽기 전용이다.
 * 접근은 contact.list 가 §13.1(이메일 → 역할)로 판정한다.
 */
import { trpc } from "@/lib/trpc";
import { Card, Note, Tile } from "../components/Bits";
import { Scroll } from "../components/Proto";

/** 문의 폼 select 의 value → 사이트에 표시되는 솔루션 이름 */
const SOLUTION_LABELS: Record<string, string> = {
  "commerce-gonggu": "커머스 - 공동구매",
  "commerce-youtube": "커머스 - 유튜브 커머스",
  "commerce-tiktok": "커머스 - 틱톡샵 크로스보더",
  ip: "콘텐츠 IP 솔루션",
  "finance-fund": "파이낸스 - 펀드",
  "finance-invest": "파이낸스 - 투자",
  "finance-equity": "파이낸스 - 지분 투자",
  "reels-market": "릴스마켓 캠페인",
};

const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short",
  timeStyle: "short",
});

function solutionLabel(value: string | null): string {
  if (!value) return "—";
  return SOLUTION_LABELS[value] ?? value;
}

export function ContactsScreen() {
  const list = trpc.contact.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const rows = list.data ?? [];
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const within = (ms: number) =>
    rows.filter(r => now - new Date(r.createdAt).getTime() <= ms).length;

  return (
    <>
      <div className="ph">
        <div>
          <h1>파트너십 문의</h1>
          <div className="desc">
            dinostudio.kr 문의 폼으로 들어온 접수 내역입니다. 최신 접수가 먼저
            보이고, 1분마다 자동 갱신됩니다. 접수와 동시에 DB에 저장되므로 이
            화면이 원본과 같습니다.
          </div>
        </div>
      </div>

      <div className="kpis">
        <Tile
          label="전체 접수"
          value={`${rows.length}건`}
          note="문의 폼 오픈 이후 누적"
        />
        <Tile
          label="최근 7일"
          value={`${within(7 * DAY)}건`}
          note="이번 주 들어온 문의"
          tone={within(7 * DAY) ? "warn" : "ok"}
        />
        <Tile
          label="오늘"
          value={`${within(DAY)}건`}
          note="24시간 이내"
          tone={within(DAY) ? "alert" : "ok"}
        />
      </div>

      {list.isLoading ? (
        <Note>불러오는 중…</Note>
      ) : rows.length === 0 ? (
        <Note>
          아직 접수된 문의가 없거나, 이 계정에 조회 권한이 없습니다. 문의가
          있어야 할 시점인데 비어 있다면 DATABASE_URL 과 ERP_ROLE_MAP 설정을
          확인하세요.
        </Note>
      ) : (
        <Card title="접수 내역" meta={`${rows.length}건 · 최신순`}>
          <Scroll>
            <table>
              <thead>
                <tr>
                  <th>접수일시</th>
                  <th>이름</th>
                  <th>회사</th>
                  <th>관심 솔루션</th>
                  <th>문의 내용</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td className="s" style={{ whiteSpace: "nowrap" }}>
                      {DATE_FORMAT.format(new Date(row.createdAt))}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{row.name}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{row.company}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {solutionLabel(row.solution)}
                    </td>
                    <td
                      style={{
                        whiteSpace: "pre-wrap",
                        maxWidth: 480,
                        wordBreak: "break-word",
                      }}
                    >
                      {row.message ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </Card>
      )}
    </>
  );
}
