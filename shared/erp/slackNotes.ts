/**
 * 양식이 없는 글 — 지출결의서와 계약서 서명요청.
 *
 * 이 둘은 지출 요청과 성격이 다르다.
 *
 *   · **지출결의서** — 부대표가 「@대표 지출결의서」만 올리고, **스레드 안에**
 *     항목을 줄로 적는다. 대표가 「네승인」이라고 답하면 그것이 결재다.
 *     금액이 없다. 즉 **원장 건이 아니라 「누가 무엇을 결재했다」는 기록**이다
 *   · **계약서 서명요청** — 자유 문장이다. 금액도 날짜도 없다. 앞으로 생길
 *     거래의 **선행 신호**다
 *
 * 그래서 이 글들로 원장 건을 만들지 않는다. 원장과 **대조**해서 「반영됐다 /
 * 아직 없다」를 말해 주는 데까지가 이 파일의 일이다.
 */

/** 대표가 스레드에 남기는 승인 표시 */
const APPROVED = /^(네)?\s*(승인|컨펌|confirm|ok|오케이|ㅇㅋ|진행)/i;
const REJECTED = /(반려|보류|취소|안됨|하지\s*마|중단)/;

export type NoteKind = "지출결의서" | "계약서 서명요청";

export interface DecisionNote {
  kind: "지출결의서";
  /** 스레드에서 읽은 항목 — 한 줄이 한 건이다 */
  items: string[];
  /** 대표가 승인했는가. 답이 없으면 null (아직 결재 전) */
  approved: boolean | null;
  /** 승인·반려를 남긴 사람 */
  decidedBy: string | null;
}

export interface ContractNote {
  kind: "계약서 서명요청";
  /** 글에서 읽어낸 상대 이름 후보 */
  names: string[];
  text: string;
}

/** 멘션·이모지·꾸밈을 걷어낸 줄 */
function cleanLine(line: string): string {
  return line
    .replace(/<@[^>]+>/g, "")
    .replace(/<[^>]*\|([^>]*)>/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/^[\s>\-•·]+/, "")
    .trim();
}

/**
 * 지출결의서 스레드를 읽는다.
 *
 * 부모 글은 「@대표 지출결의서」뿐이라 읽을 것이 없다. **답글이 본문**이다.
 */
export function parseDecisionThread(
  replies: { text: string; user: string | null }[]
): DecisionNote {
  const items: string[] = [];
  let approved: boolean | null = null;
  let decidedBy: string | null = null;

  for (const reply of replies) {
    for (const raw of reply.text.split(/\r?\n/)) {
      const line = cleanLine(raw);
      if (!line) continue;

      if (REJECTED.test(line)) {
        approved = false;
        decidedBy = reply.user;
        continue;
      }
      if (APPROVED.test(line)) {
        // 반려가 먼저 나왔으면 뒤집지 않는다 — 사람이 봐야 할 상태다
        if (approved !== false) {
          approved = true;
          decidedBy = reply.user;
        }
        continue;
      }
      // 「지출결의서」처럼 제목만 있는 줄은 항목이 아니다
      if (/^지출결의서$/.test(line)) continue;
      items.push(line);
    }
  }

  return { kind: "지출결의서", items, approved, decidedBy };
}

/**
 * 계약서 서명요청에서 상대 이름 후보를 뽑는다.
 *
 * 양식이 없으므로 **욕심내지 않는다.** 「<>」 안에 적힌 제목과, 괄호 앞의
 * 회사 이름처럼 보이는 토막만 본다. 못 찾으면 빈 목록이고, 그러면 화면은
 * 「대조할 이름을 못 찾았습니다」라고 말한다 — 틀린 짝을 만들어 주는 것보다 낫다.
 */
export function parseContractRequest(text: string): ContractNote {
  const names: string[] = [];

  // < 아비투먼트 Sena 님 크리에이터 계약 건 > 처럼 꺾쇠 제목
  const titled = /<\s*([^<>|]{2,60}?)\s*>/g;
  let m: RegExpExecArray | null = titled.exec(text);
  while (m) {
    const inner = cleanLine(m[1]);
    if (inner && !inner.includes("@")) names.push(inner);
    m = titled.exec(text);
  }

  // 「데이셀코스메틱(닥터비타) 틱톡샵 계약서」처럼 계약서 앞의 이름
  const before = /([가-힣A-Za-z0-9()\s]{2,40}?)\s*계약서/.exec(
    cleanLine(text.replace(/<[^>]*>/g, ""))
  );
  if (before) {
    const name = before[1].trim();
    if (name) names.push(name);
  }

  return {
    kind: "계약서 서명요청",
    names: Array.from(new Set(names)),
    text: cleanLine(text),
  };
}

/** 이 글이 위 둘 중 하나인가 — 채널이 아니라 내용으로 가른다 */
export function classifyNote(text: string): NoteKind | null {
  const flat = text.replace(/\s/g, "");
  if (flat.includes("지출결의서")) return "지출결의서";
  if (/계약서.*(서명|사인|날인)|서명.*계약서|전자계약/.test(flat))
    return "계약서 서명요청";
  return null;
}
