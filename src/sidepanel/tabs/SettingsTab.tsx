import { Fragment } from "react";
import { Bug, ListOrdered, Monitor, Moon, Paperclip, SlidersHorizontal, Sparkles, StickyNote, Sun, Target, WandSparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
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
import { PageScroll, PageShell, Section } from "@/sidepanel/components/Section";
import { RecordingSettingsCard } from "@/sidepanel/components/RecordingSettingsCard";
import { SettingsFooter } from "./settings/SettingsFooter";
import { LlmConnectForm } from "./settings/LlmConnectForm";

const LOCALE_OPTIONS: { value: LocaleMode; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

export function SettingsTab({ sub, onSubChange }: { sub: string; onSubChange: (v: string) => void }) {
  const t = useT();

  return (
    <Tabs
      value={sub}
      onValueChange={onSubChange}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="shrink-0 border-b border-border px-4 py-4">
        <CollapsingTabsList className="grid h-9 w-full grid-cols-3">
          <TabsTrigger value="issue" className="min-w-0 gap-1.5" data-testid="settings-sub-issue">
            <StickyNote className="h-3.5 w-3.5 shrink-0" />
            <TabLabel>{t("settings.tab.issue")}</TabLabel>
          </TabsTrigger>
          <TabsTrigger value="ai" className="min-w-0 gap-1.5">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <TabLabel>{t("settings.tab.ai")}</TabLabel>
          </TabsTrigger>
          <TabsTrigger value="general" className="min-w-0 gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <TabLabel>{t("settings.tab.general")}</TabLabel>
          </TabsTrigger>
        </CollapsingTabsList>
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
  const attachmentsEnabled = useSettingsUiStore((s) => s.attachmentsEnabled);
  const setAttachmentsEnabled = useSettingsUiStore((s) => s.setAttachmentsEnabled);
  const autoReproPrefill = useSettingsUiStore((s) => s.autoReproPrefill);
  const setAutoReproPrefill = useSettingsUiStore((s) => s.setAutoReproPrefill);
  const titlePrefix = useSettingsStore((s) => s.titlePrefix);
  const setTitlePrefix = useSettingsStore((s) => s.setTitlePrefix);

  return (
    <PageShell>
      <PageScroll>
        <Section title={t("settings.titleSettings")}>
          <div className="space-y-2">
            <Input
              id="title-prefix"
              placeholder={t("settings.titlePrefix.placeholder")}
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

        <Section title={t("settings.recording")}>
          <RecordingSettingsCard />
        </Section>

        <Section title={t("settings.bodyComposition")}>
          <Card>
            <CardContent className="flex flex-col gap-3 px-3 py-3">
              {issueSections.map((section, idx) => (
                <Fragment key={section.id}>
                  {idx > 0 ? <Separator className="-mx-3 w-auto" /> : null}
                  <IssueSectionRow
                    section={section}
                    onToggle={(enabled) => setIssueEnabled(section.id, enabled)}
                  />
                </Fragment>
              ))}
              <Separator className="-mx-3 w-auto" />
              <AttachmentToggleRow
                enabled={attachmentsEnabled}
                onToggle={setAttachmentsEnabled}
              />
              <Separator className="-mx-3 w-auto" />
              <AutoReproPrefillToggleRow
                enabled={autoReproPrefill}
                onToggle={setAutoReproPrefill}
              />
            </CardContent>
          </Card>
        </Section>
      </PageScroll>
      <SettingsFooter />
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
      <SettingsFooter />
    </PageShell>
  );
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  description: <Bug className="h-4 w-4" />,
  stepsToReproduce: <ListOrdered className="h-4 w-4" />,
  expectedResult: <Target className="h-4 w-4" />,
  notes: <StickyNote className="h-4 w-4" />,
};

function AttachmentToggleRow({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0">
        <Paperclip className="h-4 w-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor="setting-attachments-enabled" className="cursor-pointer text-sm">
          {t("settings.attachments.label")}
        </label>
        <p className="text-sm text-muted-foreground">{t("settings.attachments.help")}</p>
      </div>
      <Switch
        id="setting-attachments-enabled"
        checked={enabled}
        onCheckedChange={(v) => onToggle(v === true)}
      />
    </div>
  );
}

function AutoReproPrefillToggleRow({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0">
        <WandSparkles className="h-4 w-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor="setting-auto-repro-prefill" className="cursor-pointer text-sm">
          {t("settings.autoReproPrefill.label")}
        </label>
        <p className="text-sm text-muted-foreground">{t("settings.autoReproPrefill.help")}</p>
      </div>
      <Switch
        id="setting-auto-repro-prefill"
        checked={enabled}
        onCheckedChange={(v) => onToggle(v === true)}
      />
    </div>
  );
}

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
