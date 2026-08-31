/**
 * 에이전트 13종 — 역할 · 의존 · 자동화 레벨 (원본 자료 「에이전트 13종」 화면)
 *
 * 설계는 13종이 끝나 있고 실제로 도는 것은 아직 거의 없다.
 * 이 레지스트리는 **무엇이 왜 안 도는지, 무엇을 오늘 켤 수 있는지**를 코드로 답한다.
 *
 * 정확도·처리량 숫자는 넣지 않는다. 측정된 적이 없기 때문이다 —
 * 목표치를 실측처럼 적어두면 돌고 있다고 착각하게 된다. 측정 전에는 「미측정」이다.
 *
 * 2층 구조 —
 *   임원층(E) 판단을 만든다. 판단이므로 L3(자동 실행)로 올리지 않는다. 영구 L2.
 *   실무층(A) 수집·검증·발송. A1이 최상단이고 A2·A4·A5가 그 결과에 의존한다.
 *             A3와 A9만 독립이라 지금 켤 수 있다.
 */

/**
 * 자동화 레벨 — 정확도가 쌓인 만큼만 권한을 올린다.
 * 사람이 계속 고쳐야 하는 일을 자동화하면 틀린 숫자가 더 빨리 퍼질 뿐이다.
 */
export type AutomationLevel = "L0" | "L1" | "L2" | "L3";

export interface LevelPolicy {
  level: AutomationLevel;
  authority: string;
  humanRole: string;
  promote: string;
  demote: string;
}

export const LEVEL_POLICY: readonly LevelPolicy[] = [
  {
    level: "L0",
    authority: "보기만",
    humanRole: "전부",
    promote: "탐지 규칙 확정",
    demote: "—",
  },
  {
    level: "L1",
    authority: "탐지 · 경보",
    humanRole: "판정 · 조치",
    promote: "4주 연속 오탐률 10% 미만",
    demote: "오탐률 20% 초과",
  },
  {
    level: "L2",
    authority: "초안 작성",
    humanRole: "승인",
    promote: "4주 연속 초안 수정률 5% 미만",
    demote: "수정률 15% 초과",
  },
  {
    level: "L3",
    authority: "규칙 내 자동 실행",
    humanRole: "사후 확인",
    promote: "판단이 개입하는 일은 L3 불가",
    demote: "1건이라도 규칙 밖 실행",
  },
] as const;

/** 레벨과 무관하게 영구 금지 — 어떤 정확도에서도 열지 않는다 */
export const PERMANENTLY_FORBIDDEN: readonly { what: string; why: string }[] = [
  {
    what: "자동 이체 · 지급",
    why: "금액·우선순위 계산까지만. 돈이 나가는 순간은 사람이 누른다",
  },
  {
    what: "외부 메일 자동 발송",
    why: "초안까지만. 회사 밖으로 나가는 글은 사람이 보낸다",
  },
  {
    what: "CRM 상태 자동 변경",
    why: "경보만. 쓰기 금지",
  },
] as const;

export type AgentLayer = "임원" | "실무";

export interface Agent {
  code: string;
  name: string;
  layer: AgentLayer;
  /** 무엇을 하는가 */
  does: string;
  /** 이 에이전트가 지켜야 하는 원칙 — 프롬프트의 핵심이 된다 */
  principle: string | null;
  trigger: string;
  /** 선행 조건 — 비어 있으면 지금 켤 수 있다 */
  requires: readonly string[];
  /** 원장·CRM에 대한 권한 */
  authority: string;
  targetLevel: AutomationLevel;
  /** 지금 구현되어 있는가 */
  implemented: boolean;
}

export const AGENTS: readonly Agent[] = [
  // ── 임원층 — 판단을 만든다. 읽기 전용 · 발송 · L2 상한 ──
  {
    code: "E1",
    name: "CFO",
    layer: "임원",
    does: "현금·손익·부채 판단",
    principle:
      "보수적 낙관 금지 — 최악의 주를 먼저 본다. 사실 → 의미 → 선택지 → 권고 순서로만 답한다",
    trigger: "주 월 08:30 · 월 5영업일 · 상시",
    requires: ["A1", "A2", "A4", "A5", "A8", "계산 코어"],
    authority: "읽기 전용",
    targetLevel: "L2",
    implemented: false,
  },
  {
    code: "E2",
    name: "COO",
    layer: "임원",
    does: "병목 진단",
    principle:
      "사람을 탓하지 않고 프로세스를 본다. 조치 순서는 규칙 → 재배치 → 자동화 → 증원은 마지막",
    trigger: "매일 08:45 · 주 월 08:30 · 상시",
    requires: ["A3", "A9", "CRM"],
    authority: "읽기 전용",
    targetLevel: "L2",
    implemented: false,
  },
  {
    code: "E3",
    name: "비서실장",
    layer: "임원",
    does: "오늘의 3가지 · 결정 큐",
    principle:
      "대표의 시간을 지킨다 — 정보를 늘리지 않고 줄인다. 결정하지 않아도 되는 것을 걷어낸다",
    trigger: "매일 07:30 · 주 금 17:00 · 상시",
    requires: ["E1", "E2", "A층 전체"],
    authority: "읽기 전용",
    targetLevel: "L2",
    // 4축 점수 규칙은 shared/erp/decisions.ts 에 구현되어 있다
    implemented: true,
  },

  // ── 실무층 — 수집·검증·발송. A1이 최상단 ──
  {
    code: "A1",
    name: "자금 마감",
    layer: "실무",
    does: "전일 거래를 원장에 정리하고 계좌와 대사",
    principle:
      "파이프라인 최상단. 실패하면 하루치 숫자 전체를 못 믿으므로 다운스트림을 차단한다",
    trigger: "매일 09:40",
    requires: [],
    authority: "제한적 쓰기",
    targetLevel: "L3",
    implemented: false,
  },
  {
    code: "A2",
    name: "현금 브리핑",
    layer: "실무",
    does: "오늘 현금과 지급해야 할 것을 한 장으로",
    principle: "대표가 시트를 열지 않아도 판단 가능하게",
    trigger: "매일 10:00",
    requires: ["A1"],
    authority: "발송만",
    targetLevel: "L3",
    implemented: false,
  },
  {
    code: "A3",
    name: "파이프라인 감시",
    layer: "실무",
    does: "CRM이 이미 판정해 둔 경보를 담당자에게 도달시킨다",
    principle: "판정은 CRM 이 한다 — 자체 판단을 넣지 않는다",
    trigger: "매일 09:00",
    requires: [],
    authority: "읽기 · 발송",
    targetLevel: "L2",
    implemented: false,
  },
  {
    code: "A4",
    name: "주간 리포트",
    layer: "실무",
    does: "자금회의 자료를 만든다",
    principle: "자료 만들기가 아니라 결정에 쓰이게 한다",
    trigger: "주 월 09:30",
    requires: ["A1"],
    authority: "발송만",
    targetLevel: "L3",
    implemented: false,
  },
  {
    code: "A5",
    name: "월간 손익",
    layer: "실무",
    does: "사업부별로 돈을 벌었는지 졌는지를 매달 확정",
    principle: null,
    trigger: "월 5영업일 09:00",
    requires: ["A1"],
    authority: "노션 생성 · 발송",
    targetLevel: "L2",
    implemented: false,
  },
  {
    code: "A6",
    name: "수주 게이트",
    layer: "실무",
    does: "수주 시점에 기여이익 계산",
    principle:
      "크지만 남지 않는 건을 모르고 받는 일을 없앤다 — 알고 받는 것과 모르고 받는 것은 다르다",
    trigger: "견적 등록 시",
    requires: ["사업부별 기준선"],
    authority: "발송만",
    targetLevel: "L2",
    implemented: false,
  },
  {
    code: "A7",
    name: "지출 승인 라우터",
    layer: "실무",
    does: "승인 경로를 채널 하나로 모으고 결과가 원장에 남게",
    principle: "위험도 최고 — 유일하게 원장에 상시 쓰기. 승인 후에만 쓴다",
    trigger: "승인 요청 등록 시",
    requires: ["단일 원장"],
    authority: "원장 쓰기",
    targetLevel: "L2",
    implemented: false,
  },
  {
    code: "A8",
    name: "조달 경보",
    layer: "실무",
    does: "임계선을 넘으면 조달 절차를 시작시킨다",
    principle:
      "협상할 시간이 남아 있을 때 알린다. 8주는 협상 가능한 최소, 4주면 조건을 고를 수 없다",
    trigger: "임계선 돌파 시",
    requires: ["A1", "부채 만기"],
    authority: "발송만",
    targetLevel: "L2",
    implemented: false,
  },
  {
    code: "A9",
    name: "데이터 위생",
    layer: "실무",
    does: "적요칸 금액 · 항목명 없음 · 금액 공란 · 단위 불명을 자동 탐지",
    principle:
      "위생이 무너지면 나머지 9개가 전부 틀린 답을 낸다. 판별 기준 문서의 규칙만 사용 — 자체 판단 금지",
    trigger: "매일 08:30 · 월 마감",
    requires: [],
    authority: "읽기 전용",
    targetLevel: "L1",
    // 규칙은 shared/erp/migrationChecks.ts · duplicates.ts 에 있다
    implemented: true,
  },
  {
    code: "A10",
    name: "경영 어시스턴트",
    layer: "실무",
    does: "아무 때나 물으면 근거와 확정도를 붙여 답한다",
    principle: "대시보드를 보러 가는 대신 물어보면 되게",
    trigger: "상시 대화",
    requires: ["A1~A9"],
    authority: "읽기 전용",
    targetLevel: "L2",
    implemented: false,
  },
] as const;

/** 지금 켤 수 있는 것 — 선행 조건이 없는 에이전트 */
export function readyToStart(): readonly Agent[] {
  return AGENTS.filter(a => a.requires.length === 0);
}

export interface Blocker {
  code: string;
  what: string;
  why: string;
  affects: readonly string[];
  resolve: string;
  /** 환경변수 하나로 해소되는가 — 그렇다면 오늘 끝낼 수 있다 */
  envKey: string | null;
}

/** 무엇이 막고 있는가 — 전부 해소해야 A층이 돈다 */
export const BLOCKERS: readonly Blocker[] = [
  {
    code: "①",
    what: "알림 도착지",
    why: "발송할 곳이 없으면 산출물이 아무에게도 닿지 않는다 — 작동하는데 아무 일도 일어나지 않는 상태",
    affects: ["A2", "A3", "A4", "A5", "A8", "E1", "E2", "E3"],
    resolve: "슬랙 채널 / 이메일 / 노션 중 택 1",
    envKey: "SLACK_NOTIFY_CHANNEL",
  },
  {
    code: "②",
    what: "단일 원장",
    why: "미분류가 남은 상태에 에이전트를 얹으면 오류가 자동으로 확산된다",
    affects: ["A1", "A2", "A4", "A5", "A6", "A7", "A8", "A10", "E1"],
    resolve: "DB 연결 + 실제 시트 이관 + 계정 태깅",
    envKey: "DATABASE_URL",
  },
  {
    code: "③",
    what: "실행 엔진",
    why: "스케줄로 도는 것은 상시 가동이 필요하다",
    affects: ["스케줄로 도는 전부"],
    resolve: "Vercel Cron / 자체 호스팅 중 선택",
    envKey: null,
  },
] as const;

/** 환경변수 상태를 받아 남은 차단 요인만 돌려준다 */
export function activeBlockers(
  env: Record<string, boolean>
): readonly Blocker[] {
  return BLOCKERS.filter(b => !(b.envKey && env[b.envKey]));
}

export interface GateStep {
  step: string;
  agents: readonly string[];
  requires: string;
}

/** 착수 게이트 — 순서를 지키는 이유는 앞이 틀리면 뒤가 전부 틀리기 때문이다 */
export const GATES: readonly GateStep[] = [
  {
    step: "STEP 1",
    agents: ["A3", "A9"],
    requires: "없음 — 알림 도착지만 정하면 착수 가능",
  },
  {
    step: "STEP 2",
    agents: ["A1", "A2", "A8"],
    requires: "단일 원장 · 인건비 실액 · 부채 만기",
  },
  { step: "STEP 3", agents: ["A4", "A5"], requires: "STEP 2 완료" },
  {
    step: "STEP 4",
    agents: ["A6", "A7", "A10"],
    requires: "기준선 · 저장소 확정",
  },
  {
    step: "임원층",
    agents: ["E1", "E2", "E3"],
    requires: "의존 A층 가동 — E2 는 A3·A9 만 필요해 STEP 1 직후 가능",
  },
] as const;

export function agentByCode(code: string): Agent | null {
  return AGENTS.find(a => a.code === code) ?? null;
}
