import { createContext, useContext, useEffect, useState } from "react";
import { classifyTabSupport } from "@/lib/url-support";

/**
 * 바인딩된 탭이 미지원 페이지인지. 네비게이션에 따라 자동 갱신된다.
 *
 * - `true`: 미지원 페이지 (= 안내를 그린다)
 * - `false`: 판정 진행 중 / 지원 페이지 (= 기존 UI를 그린다)
 *
 * 판정 중을 `false`로 접는 것은 기존 e2e의 first-paint 단언을 지키기 위한 선택이다. 대가로
 * 미지원 페이지에서 캡처 버튼이 몇 프레임 번쩍인다(수용된 트레이드오프).
 *
 * `contentUrl`을 넘기지 않으므로 `classifyTabSupport`의 `permission-expired`는 도달하지 않는다 —
 * 빈 `tab.url`은 미지원으로 접힌다. <all_urls>가 required가 된 뒤 http/https는 항상 읽히므로,
 * 빈 값이 남는 경우는 미지원 스킴이나 file: + 파일 접근 토글 off뿐이고 둘 다 캡처 불가다.
 *
 * `changeInfo.url`은 신뢰하지 않는다 — tab.url과 같은 host-permission 게이팅을 받아
 * 지원 → chrome:// 전이에서 redact되므로, url·status 이벤트마다 tabs.get으로 재조회한다.
 */
export function useTabSupport(tabId: number | null | undefined): boolean {
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    if (tabId == null) {
      setUnsupported(false);
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
        setUnsupported(
          classifyTabSupport({ url: tab.url, contentUrl: undefined }) === "unsupported",
        );
      } catch {
        if (!cancelled && mine === seq) setUnsupported(false);
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

  return unsupported;
}

// App이 한 번 판정해 내려보낸다 — DebugTab·IssueTab이 각자 구독하면 판정 출처가 늘고
// 같은 탭에 tabs.get·onUpdated가 중복 붙는다.
const TabSupportContext = createContext(false);

export const TabSupportProvider = TabSupportContext.Provider;
export const useUnsupportedTab = () => useContext(TabSupportContext);
