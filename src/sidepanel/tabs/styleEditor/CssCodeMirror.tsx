import { useEffect, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { css, cssLanguage } from "@codemirror/lang-css";
import { useSettingsUiStore } from "@/store/settings-ui-store";

// lang-css의 값 완성이 약해 흔한 값을 커스텀 소스로 보강. 선언부(콜론 뒤)에서만 제안.
const VALUE_HINTS = [
  "initial",
  "inherit",
  "unset",
  "auto",
  "none",
  "block",
  "inline-block",
  "flex",
  "inline-flex",
  "grid",
  "center",
  "flex-start",
  "flex-end",
  "space-between",
  "absolute",
  "relative",
  "fixed",
  "sticky",
  "hidden",
  "visible",
  "bold",
  "normal",
  "pointer",
  "transparent",
  "currentColor",
  "red",
  "blue",
  "green",
  "black",
  "white",
];

const cssValueCompletion = cssLanguage.data.of({
  autocomplete: (context: {
    pos: number;
    explicit: boolean;
    state: EditorView["state"];
    matchBefore: (re: RegExp) => { from: number; to: number; text: string } | null;
  }) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);
    if (!/:[^;{}]*$/.test(before)) return null;
    const word = context.matchBefore(/[\w-]+/);
    if (!word && !context.explicit) return null;
    return {
      from: word ? word.from : context.pos,
      options: VALUE_HINTS.map((label) => ({ label, type: "constant" })),
      validFor: /^[\w-]*$/,
    };
  },
});

export default function CssCodeMirror({
  value,
  onChange,
  onFocus,
  onBlur,
}: {
  value: string;
  onChange: (next: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const theme = useSettingsUiStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  // theme==="system"일 때 OS 다크모드 토글에 반응(useThemeEffect와 동일 규율).
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMqChange = () => setSystemDark(mq.matches);
    setSystemDark(mq.matches);
    mq.addEventListener("change", onMqChange);
    return () => mq.removeEventListener("change", onMqChange);
  }, [theme]);
  const dark = theme === "dark" || (theme === "system" && systemDark);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      theme={dark ? "dark" : "light"}
      extensions={[css(), cssValueCompletion, EditorView.lineWrapping]}
      minHeight="6rem"
      maxHeight="20rem"
      // indentWithTab=false로 Tab이 들여쓰기 대신 포커스 이탈 — 키보드 트랩 방지.
      indentWithTab={false}
      basicSetup={{ foldGutter: false }}
      spellCheck={false}
      className="overflow-hidden rounded-md border border-border text-sm"
    />
  );
}
