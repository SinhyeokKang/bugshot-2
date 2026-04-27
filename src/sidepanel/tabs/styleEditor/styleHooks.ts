import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "../../hooks/useBoundTabId";
import { applyStyles } from "../../picker-control";

export function useStyleProp(prop: string) {
  const value = useEditorStore(
    (s) => s.styleEdits.inlineStyle[prop] ?? "",
  );
  const specified = useEditorStore(
    (s) => s.selection?.specifiedStyles[prop] ?? "",
  );
  const computed = useEditorStore(
    (s) => s.selection?.computedStyles[prop] ?? "",
  );
  const placeholder = specified || computed;
  const tabId = useBoundTabId();

  const set = (next: string) => {
    const current = useEditorStore.getState().styleEdits.inlineStyle;
    const nextInline = { ...current };
    if (next === "") delete nextInline[prop];
    else nextInline[prop] = next;
    useEditorStore.getState().setStyleEdits({ inlineStyle: nextInline });
    if (tabId) void applyStyles(tabId, nextInline);
  };

  return { value, placeholder, set };
}

export function usePropSource(prop: string): string | undefined {
  return useEditorStore((s) => s.selection?.propSources?.[prop]);
}

export function useCommonPropSource(props: string[]): string | undefined {
  return useEditorStore((s) => {
    const map = s.selection?.propSources;
    if (!map) return undefined;
    const vals = props.map((p) => map[p]).filter(Boolean);
    if (vals.length === 0) return undefined;
    return vals.every((v) => v === vals[0]) ? vals[0] : undefined;
  });
}
