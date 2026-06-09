import { BookOpen } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { STORE_REVIEW_URL, USER_GUIDE_URLS } from "@/lib/external-links";
import { PageFooter } from "@/sidepanel/components/Section";

export function SettingsFooter() {
  const t = useT();
  const locale = useSettingsUiStore((s) => s.locale);
  return (
    <PageFooter>
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          onClick={() => chrome.tabs.create({ url: USER_GUIDE_URLS[locale], active: true })}
        >
          <BookOpen />
          {t("settings.guide")}
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <a href="mailto:ox501501@gmail.com">{t("settings.contact")}</a>
          </Button>
          <Button onClick={() => chrome.tabs.create({ url: STORE_REVIEW_URL })}>
            {t("settings.review")}
          </Button>
        </div>
      </div>
    </PageFooter>
  );
}
