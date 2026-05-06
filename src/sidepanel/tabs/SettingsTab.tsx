import { Fragment } from "react";
import { Bug, ListOrdered, Monitor, Moon, StickyNote, Sun, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { PageFooter, PageScroll, PageShell, Section } from "../components/Section";

const LOCALE_OPTIONS: { value: LocaleMode; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

export function SettingsTab() {
  const t = useT();
  const theme = useSettingsUiStore((s) => s.theme);
  const setTheme = useSettingsUiStore((s) => s.setTheme);
  const locale = useSettingsUiStore((s) => s.locale);
  const setLocale = useSettingsUiStore((s) => s.setLocale);
  const issueSections = useSettingsUiStore((s) => s.issueSections);
  const setIssueEnabled = useSettingsUiStore((s) => s.setIssueEnabled);
  const titlePrefix = useSettingsStore((s) => s.titlePrefix);
  const setTitlePrefix = useSettingsStore((s) => s.setTitlePrefix);

  const themeOptions = [
    { value: "light" as ThemeMode, label: t("settings.theme.light"), icon: <Sun className="h-4 w-4" /> },
    { value: "dark" as ThemeMode, label: t("settings.theme.dark"), icon: <Moon className="h-4 w-4" /> },
    { value: "system" as ThemeMode, label: t("settings.theme.system"), icon: <Monitor className="h-4 w-4" /> },
  ];

  return (
    <PageShell>
      <PageScroll>
        <Section title={t("settings.language")}>
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

        <Section title={t("settings.theme")}>
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

        <Section title={t("settings.issueSettings")}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="title-prefix" className="text-xs text-muted-foreground">
                {t("settings.titlePrefix")}
              </label>
              <Input
                id="title-prefix"
                placeholder="[QA] "
                value={titlePrefix}
                onChange={(e) => setTitlePrefix(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.titlePrefix.help")}
              </p>
            </div>
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
          </div>
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
            <Button
              asChild
            >
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
