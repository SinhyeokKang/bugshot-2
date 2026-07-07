import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { applyStyles } from "@/sidepanel/picker-control";
import { serializeCssBlock, parseCssBlock, computeOverrides } from "./cssBlock";
import { parseBoxModel } from "./boxModel";
import { BoxModelDiagram } from "./BoxModelDiagram";

const CssCodeMirror = lazy(() => import("./CssCodeMirror"));

export function StyleCssView() {
  const selection = useEditorStore((s) => s.selection);
  const inlineStyle = useEditorStore((s) => s.styleEdits.inlineStyle);
  const setStyleEdits = useEditorStore((s) => s.setStyleEdits);
  const tabId = useBoundTabId();

  const selector = selection?.selector ?? "";
  const specified = selection?.specifiedStyles ?? {};

  const [value, setValue] = useState(() =>
    serializeCssBlock(selector, { ...specified, ...inlineStyle }),
  );
  // 재동기화 판별 기준은 사용자가 친 raw가 아니라 재구성 문자열 — store는 오버라이드만
  // 갖고 doc은 {...specified, ...overrides} 재구성이라 raw로는 자기입력 판별이 어긋난다.
  const lastCommittedRef = useRef(value);
  // 에디터 포커스 중엔 외부 재동기화로 doc를 통째 교체하지 않는다 — cross-origin 늦은
  // specified 보강이 타이핑 중 커서를 튀게 하는 것을 막고, blur 시 흡수한다.
  const focusedRef = useRef(false);

  const syncFromStore = () => {
    const next = serializeCssBlock(selector, { ...specified, ...inlineStyle });
    if (next !== lastCommittedRef.current) {
      setValue(next);
      lastCommittedRef.current = next;
    }
  };

  useEffect(() => {
    if (!focusedRef.current) syncFromStore();
    // 요소 전환은 key remount로 doc 재파생 — 동일 요소 내 inlineStyle·specified 변경만 흡수.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineStyle, specified]);

  if (!selection) return null;

  const handleChange = (next: string) => {
    setValue(next);
    const overrides = computeOverrides(parseCssBlock(next), specified);
    lastCommittedRef.current = serializeCssBlock(selector, {
      ...specified,
      ...overrides,
    });
    setStyleEdits({ inlineStyle: overrides });
    const frameId = useEditorStore.getState().selection?.frameId ?? 0;
    if (tabId) void applyStyles(tabId, frameId, overrides);
  };

  return (
    <div data-testid="style-css-view">
      <BoxModelDiagram box={parseBoxModel(selection.computedStyles)} />
      <div className="px-4 pb-3">
        <Suspense
          fallback={
            <div className="min-h-24 animate-pulse rounded-md border border-border bg-muted/40" />
          }
        >
          <CssCodeMirror
            value={value}
            onChange={handleChange}
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
    </div>
  );
}
