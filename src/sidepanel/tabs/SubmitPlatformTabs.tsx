import { type ComponentType } from "react";
import { Webhook } from "lucide-react";
import { SlackIcon } from "@/components/icons/SlackIcon";
import {
  SiAsana,
  SiClickup,
  SiGithub,
  SiGitlab,
  SiJirasoftware,
  SiLinear,
  SiNotion,
} from "@icons-pack/react-simple-icons";
import { TabsTrigger } from "@/components/ui/tabs";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { PLATFORM_TAB_KEYS, type PlatformId } from "@/types/platform";
import { submitTabsLayout } from "./submitTabsLayout";

const PLATFORM_TABS: {
  id: PlatformId;
  Icon: ComponentType<{ className?: string; color?: string }>;
  invertOnDark?: boolean;
}[] = [
  { id: "jira", Icon: SiJirasoftware },
  { id: "github", Icon: SiGithub, invertOnDark: true },
  { id: "linear", Icon: SiLinear },
  { id: "notion", Icon: SiNotion, invertOnDark: true },
  { id: "gitlab", Icon: SiGitlab },
  { id: "asana", Icon: SiAsana },
  { id: "clickup", Icon: SiClickup },
  // lucide 아이콘은 color="default"(브랜드 hex)를 못 받아 투명해진다 → currentColor로 렌더.
  { id: "slack", Icon: ({ className }) => <SlackIcon className={className} /> },
  { id: "webhook", Icon: ({ className }) => <Webhook className={className} /> },
];

// Tabs 루트 안에 둔다 — TabsList를 쓰므로 단독으로는 렌더되지 않는다.
export function SubmitPlatformTabs({ availablePlatforms }: { availablePlatforms: PlatformId[] }) {
  const t = useT();
  // 레이아웃은 렌더되는 트리거 수로 정한다 — availablePlatforms는 PLATFORM_FALLBACK_RANK에서
  // 오고 트리거는 PLATFORM_TABS 리터럴에서 와서, 한쪽만 늘면 컴파일이 안 잡는다.
  const tabs = PLATFORM_TABS.filter((p) => availablePlatforms.includes(p.id));
  const layout = submitTabsLayout(tabs.length);

  return (
    <div className={layout.wrapperClass}>
      <CollapsingTabsList className={layout.listClass} forceCollapsed={layout.forceCollapsed}>
        {tabs.map(({ id, Icon, invertOnDark }) => (
          <TabsTrigger key={id} value={id} className={layout.triggerClass} data-testid={`platform-tab-${id}`}>
            <Icon className={cn("h-3.5 w-3.5 shrink-0", invertOnDark && "dark:invert")} color="default" />
            <TabLabel>{t(PLATFORM_TAB_KEYS[id])}</TabLabel>
          </TabsTrigger>
        ))}
      </CollapsingTabsList>
    </div>
  );
}
