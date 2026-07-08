import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { applyStyles } from "@/sidepanel/picker-control";
import {
  serializeCssBlock,
  parseCssBlock,
  computeOverrides,
  collapseTrbl,
  expandTrbl,
} from "./cssBlock";

const CssCodeMirror = lazy(() => import("./CssCodeMirror"));

export function StyleCssView() {
  const selection = useEditorStore((s) => s.selection);
  const inlineStyle = useEditorStore((s) => s.styleEdits.inlineStyle);
  const setStyleEdits = useEditorStore((s) => s.setStyleEdits);
  const tokens = useEditorStore((s) => s.tokens);
  const tabId = useBoundTabId();

  const selector = selection?.selector ?? "";
  // specified·오버라이드 모두 longhand 기준으로 diff하고, 표시만 shorthand로 병합한다
  // (long→short). specified가 저자 shorthand(`padding: 8px 8px 8px 8px`)로 와도 expand로
  // longhand화해 baseline을 통일 — round-trip 시 삭제=원복·변경 다이얼로그가 어긋나지 않는다.
  const specifiedLong = expandTrbl(selection?.specifiedStyles ?? {});
  const buildDoc = (overrides: Record<string, string>) =>
    serializeCssBlock(selector, collapseTrbl({ ...specifiedLong, ...overrides }));

  const [value, setValue] = useState(() => buildDoc(inlineStyle));
  // 재동기화 판별 기준은 사용자가 친 raw가 아니라 재구성(collapse) 문자열 — store는
  // 오버라이드만 갖고 doc은 병합·축약 재구성이라 raw로는 자기입력 판별이 어긋난다.
  const lastCommittedRef = useRef(value);
  // 에디터 포커스 중엔 외부 재동기화로 doc를 통째 교체하지 않는다 — cross-origin 늦은
  // specified 보강이 타이핑 중 커서를 튀게 하는 것을 막고, blur 시 흡수한다.
  const focusedRef = useRef(false);

  const syncFromStore = () => {
    const next = buildDoc(inlineStyle);
    if (next !== lastCommittedRef.current) {
      setValue(next);
      lastCommittedRef.current = next;
    }
  };

  useEffect(() => {
    if (!focusedRef.current) syncFromStore();
    // 요소 전환은 key remount로 doc 재파생 — 동일 요소 내 inlineStyle·specified 변경만 흡수.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineStyle, selection?.specifiedStyles]);

  if (!selection) return null;

  const handleChange = (next: string) => {
    setValue(next);
    const overrides = computeOverrides(
      expandTrbl(parseCssBlock(next)),
      specifiedLong,
    );
    lastCommittedRef.current = buildDoc(overrides);
    setStyleEdits({ inlineStyle: overrides });
    const frameId = useEditorStore.getState().selection?.frameId ?? 0;
    if (tabId) void applyStyles(tabId, frameId, overrides);
  };

  return (
    <div data-testid="style-css-view" className="flex min-h-0 flex-1 flex-col">
      <Suspense
        fallback={
          <div className="min-h-24 flex-1 animate-pulse rounded-md border border-border bg-muted/40" />
        }
      >
        <CssCodeMirror
          value={value}
          onChange={handleChange}
          computed={selection.computedStyles}
          tokens={tokens}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onBlur={() => {
            focusedRef.current = false;
            syncFromStore();
          }}
        />
      </Suspense>
    </div>
  );
}
