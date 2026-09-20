/**
 * 이 건이 **그 날 통장 잔액을 실제로 움직이는가.**
 *
 * 원장에 한 줄이 섰다고 그 날 현금이 움직이는 것은 아니다. 두 가지가
 * 대표적이고, 둘 다 그냥 두면 현금흐름이 실제와 어긋난다.
 *
 *   ① **법인카드 사용** — 긁은 날 통장은 그대로다. 돈은 카드대금 결제일에
 *      한 번 나간다. 긁은 날에도 빼고 결제일에도 빼면 **같은 돈이 두 번**
 *      빠진다. 전표(§6.3)는 이미 카드를 미지급금(2120)으로 끊고 있는데
 *      현금흐름만 그 구분을 안 하고 있었다
 *
 *   ② **내부 계좌이체** — 우리 계좌에서 우리 계좌로 옮긴 것이다. 보유현금
 *      총액은 한 푼도 변하지 않는데, 양쪽을 다 계상하면 그 날 지출계와
 *      입금계가 동시에 부풀어 오른다. 「이번 달에 3억을 썼다」가 사실은
 *      계좌를 옮긴 것일 수 있다
 *
 * 숨기지는 않는다. 계에서 빼고 **따로 보여 준다** — 안 보이면 빠진 것인지
 * 잘못된 것인지 알 수 없다.
 */
import type { Entry } from "./types.js";

export type CardMethod = "법인카드" | "개인카드선결제";

export function isCardSpend(
  entry: Pick<Entry, "payMethod" | "direction">
): boolean {
  return (
    entry.direction === "out" &&
    (entry.payMethod === "법인카드" || entry.payMethod === "개인카드선결제")
  );
}

export function isInternalTransfer(
  entry: Pick<Entry, "internalTransferId">
): boolean {
  return entry.internalTransferId != null;
}

/**
 * 그 날 통장이 실제로 움직이는가 — 현금흐름 계의 판정 기준.
 *
 * 카드대금 **결제 건**은 `payMethod` 가 계좌이므로 여기서 true 가 되고,
 * 그때 한 번만 빠진다.
 */
export function movesCash(
  entry: Pick<Entry, "payMethod" | "direction" | "internalTransferId">
): boolean {
  return !isCardSpend(entry) && !isInternalTransfer(entry);
}

/** 손익에 잡히는가 — 내부이체는 비용도 수익도 아니다 */
export function affectsPnl(
  entry: Pick<Entry, "internalTransferId" | "nature">
): boolean {
  return !isInternalTransfer(entry) && entry.nature !== "손익아님";
}
