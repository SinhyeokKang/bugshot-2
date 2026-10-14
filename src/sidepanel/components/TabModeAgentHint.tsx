import { useT } from "@/i18n";
import { useIsTabMode } from "@/sidepanel/hooks/useSelfTab";

// 탭 모드에서만 — 사이드패널(사람)에는 렌더하지 않는다. 라이브 영역 role은 달지 않는다.
export function TabModeAgentHint() {
  const t = useT();
  if (!useIsTabMode()) return null;
  return (
    <p
      data-testid="tab-mode-agent-hint"
      className="shrink-0 border-b bg-background px-4 py-2 text-xs text-muted-foreground"
    >
      {t("app.tabMode.agentHint")}
    </p>
  );
}
