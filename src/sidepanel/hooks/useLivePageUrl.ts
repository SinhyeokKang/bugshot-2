import { useEffect } from "react";
import { useEditorStore } from "@/store/editor-store";

/**
 * 바인딩 탭의 현재 URL을 store로 발행한다. 재현 환경 Page 행이 이 값을 읽는다.
 *
 * `useBoundTabState`(판정+읽기)와 store(소비) 사이의 **유일한 배선**이라 별도 훅으로 뗐다 —
 * App 본문에 인라인 useEffect로 두면 그 세 줄을 지워도 전 스위트가 green이다(실측).
 * 리졸버·store·훅이 각자 아무리 촘촘해도 이 링크가 끊기면 기능 전체가 죽는다.
 */
export function useLivePageUrl(url: string | null): void {
  useEffect(() => {
    useEditorStore.getState().setLivePageUrl(url);
  }, [url]);
}
