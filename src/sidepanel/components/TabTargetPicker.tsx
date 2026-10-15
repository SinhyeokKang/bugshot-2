import { useEffect, useState } from "react";
import { Globe, SquareMousePointer } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PANEL_PATH, buildPanelUrl } from "@/lib/panel-tab-url";
import { listTargetCandidates, type TabLike } from "@/sidepanel/lib/tab-mode";
import { PageScroll, PageShell } from "./Section";

const CONTENT_MAX_W = "max-w-[480px]";

function hostnameOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

// 대상 선택은 문서 리로드다 — useBoundTabId가 여러 곳에서 따로 질의하고 popstate를 듣지 않는다.
const reloadTo = (url: string) => window.location.replace(url);

export function TabTargetPicker({
  selfTabId,
  navigate = reloadTo,
}: {
  selfTabId: number;
  navigate?: (url: string) => void;
}) {
  const t = useT();
  const [tabs, setTabs] = useState<TabLike[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let seq = 0;
    const refresh = async () => {
      const mine = ++seq;
      try {
        const [all, self] = await Promise.all([chrome.tabs.query({}), chrome.tabs.get(selfTabId)]);
        if (cancelled || mine !== seq) return;
        setTabs(listTargetCandidates(all, { id: selfTabId, windowId: self.windowId }));
      } catch {
        if (!cancelled && mine === seq) setTabs((prev) => prev ?? []);
      }
    };
    const onUpdated = (_id: number, info: { url?: string; title?: string }) => {
      if (info.url !== undefined || info.title !== undefined) void refresh();
    };
    const onChanged = () => void refresh();
    chrome.tabs.onCreated.addListener(onChanged);
    chrome.tabs.onRemoved.addListener(onChanged);
    chrome.tabs.onUpdated.addListener(onUpdated);
    void refresh();
    return () => {
      cancelled = true;
      chrome.tabs.onCreated.removeListener(onChanged);
      chrome.tabs.onRemoved.removeListener(onChanged);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [selfTabId]);

  const select = (tabId: number) =>
    navigate(buildPanelUrl(chrome.runtime.getURL(PANEL_PATH), tabId));

  return (
    <PageShell data-testid="tab-target-picker">
      <PageScroll>
        <div className={cn("mx-auto flex w-full flex-col gap-4 px-4 py-6", CONTENT_MAX_W)}>
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="mb-1 rounded-full bg-muted p-3">
              <SquareMousePointer className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">{t("app.tabTarget.title")}</h3>
            <p className="text-sm text-muted-foreground">{t("app.tabTarget.description")}</p>
          </div>
          {tabs && tabs.length === 0 ? (
            <p
              data-testid="tab-target-empty"
              className="text-center text-sm text-muted-foreground"
            >
              {t("app.tabTarget.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {(tabs ?? []).map((tab) => (
                <Button
                  key={tab.id}
                  variant="outline"
                  data-testid={`tab-target-option-${tab.id}`}
                  onClick={() => select(tab.id as number)}
                  className="h-auto justify-start gap-2 px-3 py-2 text-xs"
                >
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{tab.title || hostnameOf(tab.url)}</span>
                    <span className="truncate text-muted-foreground">{tab.url}</span>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </div>
      </PageScroll>
    </PageShell>
  );
}
