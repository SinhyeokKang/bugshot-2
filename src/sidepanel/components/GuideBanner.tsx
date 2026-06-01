import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { useT } from "@/i18n";
import { USER_GUIDE_URLS } from "@/lib/external-links";
import { shouldShowGuideBanner } from "@/lib/guide-banner";
import { useSettingsUiStore } from "@/store/settings-ui-store";

export function GuideBanner(): JSX.Element | null {
  const t = useT();
  const [hydrated, setHydrated] = useState(
    useSettingsUiStore.persist.hasHydrated(),
  );
  useEffect(
    () => useSettingsUiStore.persist.onFinishHydration(() => setHydrated(true)),
    [],
  );

  const dismissedVersion = useSettingsUiStore((s) => s.guideBannerDismissedVersion);
  const dismissGuideBanner = useSettingsUiStore((s) => s.dismissGuideBanner);
  const locale = useSettingsUiStore((s) => s.locale);

  if (!hydrated) return null;

  const currentVersion = chrome.runtime.getManifest().version;
  if (!shouldShowGuideBanner(dismissedVersion, currentVersion)) return null;

  return (
    <div className="flex items-center border-b bg-muted/50 px-3 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => chrome.tabs.create({ url: USER_GUIDE_URLS[locale], active: true })}
        className="flex min-w-0 flex-1 items-center gap-1 py-1.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="truncate">{t("app.guideBanner.cta")}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      </button>
      {/* 컴팩트 띠 유지 위해 IconButton(h-8) 대신 인라인 닫기 선례 패턴(ConsoleLogContent/IssueListTab) */}
      <button
        type="button"
        aria-label={t("app.guideBanner.dismiss")}
        onClick={() => dismissGuideBanner(currentVersion)}
        className="ml-1 shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
