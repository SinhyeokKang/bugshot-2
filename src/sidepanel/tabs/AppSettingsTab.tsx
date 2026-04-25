import { Monitor, Moon, Sun } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import {
  useAppSettingsStore,
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

  const themeOptions = [
    { value: "light" as ThemeMode, label: t("appSettings.theme.light"), icon: <Sun className="h-4 w-4" /> },
    { value: "dark" as ThemeMode, label: t("appSettings.theme.dark"), icon: <Moon className="h-4 w-4" /> },
    { value: "system" as ThemeMode, label: t("appSettings.theme.system"), icon: <Monitor className="h-4 w-4" /> },
  ];

  return (
    <PageShell>
      <PageScroll>
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
      </PageScroll>
    </PageShell>
  );
}
