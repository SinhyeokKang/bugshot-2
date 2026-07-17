import { useEffect, useRef } from "react";
import { countCodeLines } from "@/sidepanel/lib/codeCollapse";
import {
  createCodeCollapseShell,
  type CodeCollapseLabels,
} from "@/sidepanel/lib/codeCollapseShell";

/** html이 바뀔 때마다 root 안의 모든 pre에 접기 셸을 (재)부착한다. */
export function useCodeCollapse(html: string, labels: CodeCollapseLabels) {
  const rootRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const shells = Array.from(root.querySelectorAll("pre")).flatMap((pre) => {
      // 중첩 방지는 cleanup의 unwrap()이 이미 한다(React가 재실행 전 cleanup을 보장) —
      // 이건 unwrap이 리팩터로 사라질 경우의 2차 방어다.
      if (pre.closest(".code-collapse")) return [];
      const anchor = document.createComment("");
      pre.replaceWith(anchor);
      const shell = createCodeCollapseShell(pre, labelsRef.current);
      anchor.replaceWith(shell.wrapper);
      shell.update(countCodeLines(pre.textContent ?? ""));
      return [shell];
    });
    return () => {
      for (const shell of shells) {
        shell.destroy();
        // pre를 원래 자리로 돌려놔야 재부착이 idempotent하다 — StrictMode 재마운트나
        // 같은 html로의 effect 재실행에서 셸이 중첩되거나 리스너 없는 pill이 남는다.
        shell.unwrap();
      }
    };
    // labels.collapse는 locale이 바뀔 때만 값이 변하는 문자열이다 — 그때 셸을 다시 만들어
    // 이미 붙은 pill 라벨까지 새 언어로 돌린다(그 대가로 펼침 상태가 초기화된다).
  }, [html, labels.collapse]);

  return rootRef;
}
