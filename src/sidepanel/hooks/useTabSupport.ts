import { useEffect, useState } from "react";
import { isSupportedUrl } from "@/lib/url-support";

export interface BoundTabState {
  /** 미지원 페이지인가. 판정 진행 중은 false. */
  unsupported: boolean;
  /** 마지막으로 읽힌 URL. 판독 불가·판정 전이면 null. */
  url: string | null;
}

/**
 * 바인딩된 탭의 상태. 네비게이션에 따라 자동 갱신된다.
 *
 * 미지원 판정과 현재 URL을 **한 번의 재조회로 함께** 돌려준다 — 둘을 별도 훅으로 나누면
 * tabs.get·onUpdated 리스너·seq 경합 가드가 통째로 복제되고, 아래 "changeInfo.url을
 * 신뢰하지 않는다" 규율이 한쪽에만 남는다. store write는 하지 않는다 — 소비처가 App
 * 하나이고, `tab-support-context.ts`가 이미 "App이 한 번 판정해 내려보낸다"를 규율로
 * 두고 있어 발행지도 App이어야 대칭이 맞는다.
 *
 * 빈 `tab.url`은 미지원으로 접힌다 — <all_urls>가 required가 된 뒤 http/https는 항상 읽히므로,
 * 빈 값이 남는 경우는 미지원 스킴이나 file: + 파일 접근 토글 off뿐이고 둘 다 캡처 불가다.
 * 판정 진행 중을 `false`로 두는 것은 기존 e2e의 first-paint 단언을 지키기 위한 선택이고,
 * 대가로 미지원 페이지에서 캡처 버튼이 몇 프레임 번쩍인다.
 *
 * `changeInfo.url`은 신뢰하지 않는다 — tab.url과 같은 host-permission 게이팅을 받아
 * 지원 → chrome:// 전이에서 redact되므로, url·status 이벤트마다 tabs.get으로 재조회한다.
 */
export function useBoundTabState(
  tabId: number | null | undefined,
): BoundTabState {
  const [state, setState] = useState<BoundTabState>({
    unsupported: false,
    url: null,
  });

  useEffect(() => {
    if (tabId == null) {
      setState((prev) => (prev.unsupported ? { ...prev, unsupported: false } : prev));
      return;
    }
    let cancelled = false;
    // 한 네비게이션이 onUpdated를 여러 번 발화시켜 classify가 겹친다. 늦게 도착한 옛 응답이
    // 최신 판정을 덮으면 지원 페이지에 안내가 굳고, 재판정 트리거가 onUpdated뿐이라 회복 수단이 없다.
    let seq = 0;

    const classify = async () => {
      const mine = ++seq;
      try {
        const tab = await chrome.tabs.get(tabId);
        if (cancelled || mine !== seq) return;
        const next = { unsupported: !isSupportedUrl(tab.url), url: tab.url ?? null };
        // 같은 값이면 prev를 그대로 돌려 리렌더를 접는다 — 한 네비게이션의 중복 onUpdated 흡수.
        setState((prev) =>
          prev.unsupported === next.unsupported && prev.url === next.url ? prev : next,
        );
      } catch {
        // 탭이 사라졌다. 마지막으로 읽힌 url은 남긴다 — 지우면 Page 행이 세션 원점으로
        // 되돌아가 오히려 더 틀리다.
        if (!cancelled && mine === seq) {
          setState((prev) => (prev.unsupported ? { ...prev, unsupported: false } : prev));
        }
      }
    };

    void classify();

    const onUpdated = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId) return;
      // title·favIconUrl·audible 등은 URL을 바꾸지 않는다 — 재조회 폭만 늘린다.
      if (!info.url && !info.status) return;
      void classify();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    return () => {
      cancelled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [tabId]);

  return state;
}
