import { Fragment } from "react";
import { Bug, ListOrdered, Monitor, Moon, StickyNote, Sun, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import {
  sectionHelpKey,
  sectionLabelKey,
  useAppSettingsStore,
  type IssueSection,
  type LocaleMode,
  type ThemeMode,
} from "@/store/app-settings-store";
import { PageScroll, PageShell, Section } from "../components/Section";

const LOCALE_OPTIONS: { value: LocaleMode; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

export function AppSettingsTab() {
  const t = useT();
  const theme = useAppSettingsStore((s) => s.theme);
  const setTheme = useAppSettingsStore((s) => s.setTheme);
  const locale = useAppSettingsStore((s) => s.locale);
  const setLocale = useAppSettingsStore((s) => s.setLocale);
  const issueSections = useAppSettingsStore((s) => s.issueSections);
  const setIssueEnabled = useAppSettingsStore((s) => s.setIssueEnabled);

  const themeOptions = [
    { value: "light" as ThemeMode, label: t("appSettings.theme.light"), icon: <Sun className="h-4 w-4" /> },
    { value: "dark" as ThemeMode, label: t("appSettings.theme.dark"), icon: <Moon className="h-4 w-4" /> },
    { value: "system" as ThemeMode, label: t("appSettings.theme.system"), icon: <Monitor className="h-4 w-4" /> },
  ];

  return (
    <PageShell>
      <PageScroll>
        <Section title={t("appSettings.language")}>
          <Tabs value={locale} onValueChange={(v) => setLocale(v as LocaleMode)}>
            <TabsList className="grid w-full grid-cols-2">
              {LOCALE_OPTIONS.map((o) => (
                <TabsTrigger key={o.value} value={o.value}>
                  {o.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Section>

        <Section title={t("appSettings.theme")}>
          <Tabs value={theme} onValueChange={(v) => setTheme(v as ThemeMode)}>
            <TabsList className="grid w-full grid-cols-3">
              {themeOptions.map((o) => (
                <TabsTrigger key={o.value} value={o.value} className="gap-1.5">
                  {o.icon}
                  {o.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Section>

        <Section title={t("appSettings.issueSections.title")}>
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
