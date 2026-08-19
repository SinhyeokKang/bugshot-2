import type { Page } from "@playwright/test";

// 패널 컨텍스트의 navigator.clipboard를 stub해 복사 페이로드를 단언 가능하게 만든다.
//
// **스텁이 읽는 범위가 곧 계약이다** — text/plain만 읽던 시절엔 text/html을 통째로 지워도
// 3개 spec이 green이었다(없는 타입이면 getType이 throw → write reject → 앱이 writeText
// 폴백을 타고 plain 배열은 정상적으로 채워진다). 그래서 두 flavor를 모두 읽는다.
// 이 계약을 spec마다 복제하면 다음 flavor를 추가할 때 한 곳만 고쳐도 red가 안 난다 —
// 그래서 창구를 하나로 둔다(e2e/GOTCHAS.md 동명 항목).
export async function stubClipboard(panel: Page): Promise<void> {
  await panel.evaluate(() => {
    const w = window as unknown as { __copiedTexts: string[]; __copiedHtml: string[] };
    w.__copiedTexts = [];
    w.__copiedHtml = [];
    navigator.clipboard.write = async (items) => {
      for (const it of items) {
        w.__copiedTexts.push(await (await it.getType("text/plain")).text());
        w.__copiedHtml.push(await (await it.getType("text/html")).text());
      }
    };
    navigator.clipboard.writeText = async (t) => {
      w.__copiedTexts.push(t);
    };
  });
}
