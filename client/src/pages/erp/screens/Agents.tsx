/**
 * 에이전트 13종 — 역할 · 의존 · 자동화 레벨
 *
 * 설계는 13종이 끝나 있고 실제로 도는 것은 일부다.
 * 이 화면은 **무엇이 왜 안 도는지, 무엇을 오늘 켤 수 있는지**를 답한다.
 *
 * 정확도·처리량 숫자는 표시하지 않는다 — 측정된 적이 없다.
 * 목표치를 실측처럼 보여 주면 돌고 있다고 착각하게 된다.
 */
import { trpc } from "@/lib/trpc";
import {
  AlertBox,
  Card,
  Kpis,
  Note,
  OkBox,
  PageHead,
  Scroll,
} from "../components/Proto";

export function AgentsScreen() {
  const data = trpc.erp.agents.useQuery();

  if (data.error)
    return (
      <>
        <PageHead title="에이전트 13종" />
        <AlertBox>{data.error.message}</AlertBox>
      </>
    );

  const d = data.data;
  const exec = (d?.agents ?? []).filter(a => a.layer === "임원");
  const ops = (d?.agents ?? []).filter(a => a.layer === "실무");

  return (
    <>
      <PageHead
        title="에이전트 13종"
        desc="무엇이 왜 안 도는지, 무엇을 오늘 켤 수 있는지를 답하는 화면입니다."
      />

      <Note>
        <b>정확도 숫자를 적지 않습니다 — 측정된 적이 없습니다.</b> 배포된
        에이전트가 적으므로 정확도도 처리량도 존재하지 않습니다. 목표치를
        실측처럼 적어두면 돌고 있다고 착각하게 됩니다.
      </Note>

      <Kpis
        items={[
          {
            k: "설계 완료",
            v: d ? `${d.counts.designed}종` : "—",
            s: `임원 ${exec.length} · 실무 ${ops.length}`,
          },
          {
            k: "구현됨",
            v: d ? `${d.counts.implemented}종` : "—",
            s: "규칙이 코드로 있는 것",
            tone: "good",
          },
          {
            k: "지금 켤 수 있는 것",
            v: d ? `${d.counts.ready}종` : "—",
            s: "선행조건 없음",
          },
          {
            k: "막고 있는 것",
            v: d ? `${d.blockers.length}건` : "—",
            s: d && d.blockers.length > 0 ? "해소해야 A층이 돕니다" : "없음",
            tone: d && d.blockers.length > 0 ? "bad" : "good",
          },
        ]}
      />

      {d && d.blockers.length > 0 ? (
        <Card title="막고 있는 것" sub="전부 해소해야 실무층이 돕니다" bare>
          <Scroll>
            <table>
              <thead>
                <tr>
                  <th>—</th>
                  <th>무엇</th>
                  <th>왜 막히나</th>
                  <th>영향받는 에이전트</th>
                  <th>해소 조건</th>
                </tr>
              </thead>
              <tbody>
                {d.blockers.map(b => (
                  <tr key={b.code}>
                    <td className="n">{b.code}</td>
                    <td className="k nw">{b.what}</td>
                    <td>{b.why}</td>
                    <td className="s">{b.affects.join(" · ")}</td>
                    <td>
                      {b.resolve}
                      {b.envKey ? (
                        <span className="s"> ({b.envKey})</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </Card>
      ) : (
        <OkBox>
          <b>막고 있는 것이 없습니다.</b> 알림 도착지와 원장이 준비되어 실무층을
          켤 수 있습니다.
        </OkBox>
      )}

      <OkBox>
        <b>2층 구조입니다.</b> <b>임원층(E)</b>은 판단을 만듭니다 — 숫자를
        보고하는 게 아니라 「그래서 어떻게 하지」에 답합니다. 판단이므로{" "}
        <b>L3(자동 실행)로 올리지 않습니다.</b> <b>실무층(A)</b>은
        수집·검증·발송을 합니다. A1이 최상단이고 A2·A4·A5가 그 결과에
        의존합니다. A3와 A9만 독립이라 지금 켤 수 있습니다.
      </OkBox>

      {[
        {
          label: "임원층 · 판단을 만든다",
          rows: exec,
          note: "읽기 전용 · L2 상한",
        },
        { label: "실무층 · 수집·검증·발송", rows: ops, note: "A1이 최상단" },
      ].map(group => (
        <Card key={group.label} title={group.label} sub={group.note} bare>
          <Scroll>
            <table>
              <thead>
                <tr>
                  <th>코드</th>
                  <th>역할</th>
                  <th>무엇을 하는가</th>
                  <th>지켜야 하는 원칙</th>
                  <th>트리거</th>
                  <th>선행</th>
                  <th>권한</th>
                  <th>목표</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(a => (
                  <tr key={a.code}>
                    <td className="m nw">{a.code}</td>
                    <td className="k nw">{a.name}</td>
                    <td>{a.does}</td>
                    <td className="s">{a.principle ?? "—"}</td>
                    <td className="s nw">{a.trigger}</td>
                    <td className="s">
                      {a.requires.length === 0 ? (
                        <span className="chip g">없음</span>
                      ) : (
                        a.requires.join(" · ")
                      )}
                    </td>
                    <td className="s nw">{a.authority}</td>
                    <td className="m nw">{a.targetLevel}</td>
                    <td className="nw">
                      {a.implemented ? (
                        <span className="chip g">구현됨</span>
                      ) : (
                        <span className="chip n">미배포</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </Card>
      ))}

      <Card
        title="착수 게이트"
        sub="순서를 지키는 이유 — 앞이 틀리면 뒤가 전부 틀린다"
        bare
      >
        <Scroll>
          <table>
            <thead>
              <tr>
                <th>단계</th>
                <th>에이전트</th>
                <th>선행</th>
              </tr>
            </thead>
            <tbody>
              {(d?.gates ?? []).map(g => (
                <tr key={g.step}>
                  <td className="m nw">{g.step}</td>
                  <td className="k">{g.agents.join(" · ")}</td>
                  <td>{g.requires}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      </Card>

      <Card
        title="자동화 레벨 정책"
        sub="정확도가 쌓인 만큼만 권한을 올린다"
        bare
      >
        <Scroll>
          <table>
            <thead>
              <tr>
                <th>레벨</th>
                <th>권한</th>
                <th>사람의 역할</th>
                <th>승격 조건</th>
                <th>강등 조건</th>
              </tr>
            </thead>
            <tbody>
              {(d?.levelPolicy ?? []).map(p => (
                <tr key={p.level}>
                  <td className="m nw">{p.level}</td>
                  <td className="k nw">{p.authority}</td>
                  <td className="nw">{p.humanRole}</td>
                  <td>{p.promote}</td>
                  <td>{p.demote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      </Card>

      <AlertBox>
        <b>레벨과 무관하게 영구 금지</b>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {(d?.forbidden ?? []).map(f => (
            <li key={f.what}>
              <b>{f.what}</b> — {f.why}
            </li>
          ))}
        </ul>
      </AlertBox>

      <Note>
        사람이 계속 고쳐야 하는 일을 자동화하면 틀린 숫자가 더 빨리 퍼질
        뿐입니다. 그래서 레벨을 올리는 조건을 먼저 정해 두었습니다.
      </Note>
    </>
  );
}
