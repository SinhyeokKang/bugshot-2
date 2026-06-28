import {
  SiAsana,
  SiClickup,
  SiGithub,
  SiGitlab,
  SiJirasoftware,
  SiLinear,
  SiNotion,
} from "@icons-pack/react-simple-icons";
import { SlackIcon } from "@/components/icons/SlackIcon";
import { useT } from "@/i18n";
import type { PlatformId } from "@/types/platform";

export function PlatformChip({ platform }: { platform: PlatformId }) {
  const t = useT();
  if (platform === "jira") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <SiJirasoftware className="h-3 w-3" color="default" />
        {t("platform.tab.jira")}
      </span>
    );
  }
  if (platform === "linear") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <SiLinear className="h-3 w-3" color="default" />
        {t("platform.tab.linear")}
      </span>
    );
  }
  if (platform === "notion") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <SiNotion className="h-3 w-3 dark:invert" color="default" />
        {t("platform.tab.notion")}
      </span>
    );
  }
  if (platform === "gitlab") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <SiGitlab className="h-3 w-3" color="default" />
        {t("platform.tab.gitlab")}
      </span>
    );
  }
  if (platform === "asana") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <SiAsana className="h-3 w-3" color="default" />
        {t("platform.tab.asana")}
      </span>
    );
  }
  if (platform === "clickup") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <SiClickup className="h-3 w-3" color="default" />
        {t("platform.tab.clickup")}
      </span>
    );
  }
  if (platform === "slack") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <SlackIcon className="h-3 w-3" />
        {t("platform.tab.slack")}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <SiGithub className="h-3 w-3 dark:invert" color="default" />
      {t("platform.tab.github")}
    </span>
  );
}
