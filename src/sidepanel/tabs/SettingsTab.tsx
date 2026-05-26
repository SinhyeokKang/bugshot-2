import { Fragment, useState } from "react";
import { Bug, ListOrdered, Monitor, Moon, SlidersHorizontal, Sparkles, StickyNote, Sun, Target, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import {
  sectionHelpKey,
  sectionLabelKey,
  useSettingsUiStore,
  type IssueSection,
  type LocaleMode,
  type ThemeMode,
} from "@/store/settings-ui-store";
import { useSettingsStore } from "@/store/settings-store";
import { PageFooter, PageScroll, PageShell, Section } from "@/sidepanel/components/Section";
import { REPLAY_ORIGINS } from "@/sidepanel/30s-replay/use-30s-replay";
import { LlmConnectForm } from "./settings/LlmConnectForm";

type SettingsSubTab = "issue" | "ai" | "general";

const LOCALE_OPTIONS: { value: LocaleMode; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

export function SettingsTab() {
  const t = useT();
  const [sub, setSub] = useState<SettingsSubTab>("issue");

  return (
    <Tabs
      value={sub}
      onValueChange={(v) => setSub(v as SettingsSubTab)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="shrink-0 border-b border-border px-4 py-4">
        <TabsList className="grid h-9 w-full grid-cols-3">
          <TabsTrigger value="issue" className="gap-1.5">
            <StickyNote className="h-3.5 w-3.5" />
            {t("settings.tab.issue")}
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            {t("settings.tab.ai")}
          </TabsTrigger>
          <TabsTrigger value="general" className="gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t("settings.tab.general")}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="issue"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <IssueSettingsContent />
      </TabsContent>

      <TabsContent
        value="ai"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <LlmConnectForm />
      </TabsContent>

      <TabsContent
        value="general"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <GeneralSettingsContent />
      </TabsContent>
    </Tabs>
  );
}

function IssueSettingsContent() {
  const t = useT();
  const issueSections = useSettingsUiStore((s) => s.issueSections);
  const setIssueEnabled = useSettingsUiStore((s) => s.setIssueEnabled);
  const replayEnabled = useSettingsUiStore((s) => s.replayEnabled);
  const setReplayEnabled = useSettingsUiStore((s) => s.setReplayEnabled);
  const titlePrefix = useSettingsStore((s) => s.titlePrefix);
  const setTitlePrefix = useSettingsStore((s) => s.setTitlePrefix);

  const handleReplayToggle = async (next: boolean) => {
    if (!next) {
      setReplayEnabled(false);
      return;
    }
    try {
      const has = await chrome.permissions.contains({ origins: REPLAY_ORIGINS });
      const granted =
        has || (await chrome.permissions.request({ origins: REPLAY_ORIGINS }));
      if (granted) setReplayEnabled(true);
      else toast.error(t("settings.replay.permissionDenied"));
    } catch {
      toast.error(t("settings.replay.permissionDenied"));
    }
  };

  return (
    <PageShell>
      <PageScroll>
        <Section title={t("settings.titleSettings")}>
          <div className="space-y-2">
            <Input
              id="title-prefix"
              placeholder="[QA] "
              value={titlePrefix}
              onChange={(e) => setTitlePrefix(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[0.8rem] text-muted-foreground">
              {t("settings.titlePrefix.help")}
            </p>
          </div>
        </Section>

        <Section title={t("settings.capture")}>
          <Card>
            <CardContent className="flex flex-col gap-3 px-3 py-3">
              <div className="flex items-center gap-3">
                <div className="shrink-0">
                  <Timer className="h-4 w-4" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <label htmlFor="replay-enabled" className="cursor-pointer text-sm">
                    {t("settings.replay.label")}
                  </label>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.replay.help")}
                  </p>
                </div>
                <Switch
                  id="replay-enabled"
                  checked={replayEnabled}
                  onCheckedChange={(v) => void handleReplayToggle(v === true)}
                />
              </div>
            </CardContent>
          </Card>
        </Section>

        <Section title={t("settings.bodyComposition")}>
          <Card>
            <CardContent className="flex flex-col gap-3 px-3 py-3">
              {issueSections.map((section, idx) => (
                <Fragment key={section.id}>
                  {idx > 0 ? <Separator /> : null}
                  <IssueSectionRow
                    section={section}
                    onToggle={(enabled) => setIssueEnabled(section.id, enabled)}
                  />
                </Fragment>
              ))}
            </CardContent>
          </Card>
        </Section>
      </PageScroll>
    </PageShell>
  );
}

function GeneralSettingsContent() {
  const t = useT();
  const theme = useSettingsUiStore((s) => s.theme);
  const setTheme = useSettingsUiStore((s) => s.setTheme);
  const locale = useSettingsUiStore((s) => s.locale);
  const setLocale = useSettingsUiStore((s) => s.setLocale);

  const themeOptions = [
    { value: "light" as ThemeMode, label: t("settings.theme.light"), icon: <Sun className="h-4 w-4" /> },
    { value: "dark" as ThemeMode, label: t("settings.theme.dark"), icon: <Moon className="h-4 w-4" /> },
    { value: "system" as ThemeMode, label: t("settings.theme.system"), icon: <Monitor className="h-4 w-4" /> },
  ];

  return (
    <PageShell>
      <PageScroll>
        <Section title={t("settings.language")}>
          <Select value={locale} onValueChange={(v) => setLocale(v as LocaleMode)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section title={t("settings.theme")}>
          <Select value={theme} onValueChange={(v) => setTheme(v as ThemeMode)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {themeOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  <span className="inline-flex items-center gap-1.5">
                    {o.icon}
                    {o.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>
      </PageScroll>
      <PageFooter>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => chrome.tabs.create({ url: "https://sinhyeokkang.github.io/bugshot-2/privacy" })}
          >
            {t("settings.privacy")}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => chrome.tabs.create({ url: "https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig/reviews" })}
            >
              {t("settings.review")}
            </Button>
            <Button asChild>
              <a href="mailto:ox501501@gmail.com">{t("settings.contact")}</a>
            </Button>
          </div>
        </div>
      </PageFooter>
    </PageShell>
  );
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  description: <Bug className="h-4 w-4" />,
  stepsToReproduce: <ListOrdered className="h-4 w-4" />,
  expectedResult: <Target className="h-4 w-4" />,
  notes: <StickyNote className="h-4 w-4" />,
};

function IssueSectionRow({
  section,
  onToggle,
}: {
  section: IssueSection;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useT();
  const id = `issue-section-${section.id}`;
  const label = section.labelOverride?.trim() || t(sectionLabelKey(section.id));
  const help = t(sectionHelpKey(section.id));
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0">{SECTION_ICONS[section.id]}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm">
          {label}
        </label>
        <p className="text-sm text-muted-foreground">{help}</p>
      </div>
      <Switch
        id={id}
        checked={section.enabled}
        onCheckedChange={(v) => onToggle(v === true)}
      />
    </div>
  );
}
