import { ArrowUpRight, CircleCheck } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/sidepanel/components/Section";
import { STORE_REVIEW_URL } from "@/lib/external-links";

export function SubmitSuccessView({
  result,
  onClose,
}: {
  result: { key: string; url: string };
  onClose: () => void;
}) {
  const t = useT();
  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
        <div className="mb-3 rounded-full bg-muted p-3">
          <CircleCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
        </div>
        <h3 className="text-lg font-semibold">{t("submit.success")}</h3>
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {result.key}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            onClick={() => chrome.tabs.create({ url: STORE_REVIEW_URL })}
          >
            {t("settings.review")}
          </Button>
          <Button onClick={onClose}>{t("common.ok")}</Button>
        </div>
      </div>
    </PageShell>
  );
}
