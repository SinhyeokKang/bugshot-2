import { Monitor, Moon, Sun } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useAppSettingsStore,
  type LocaleMode,
  type ThemeMode,
} from "@/store/app-settings-store";
import { PageScroll, PageShell, Section } from "../components/Section";

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "라이트", icon: <Sun className="h-4 w-4" /> },
  { value: "dark", label: "다크", icon: <Moon className="h-4 w-4" /> },
  { value: "system", label: "시스템", icon: <Monitor className="h-4 w-4" /> },
];

const LOCALE_OPTIONS: { value: LocaleMode; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

export function AppSettingsTab() {
  const theme = useAppSettingsStore((s) => s.theme);
  const setTheme = useAppSettingsStore((s) => s.setTheme);
  const locale = useAppSettingsStore((s) => s.locale);
  const setLocale = useAppSettingsStore((s) => s.setLocale);

  return (
    <PageShell>
      <PageScroll>
        <Section title="테마">
          <Tabs value={theme} onValueChange={(v) => setTheme(v as ThemeMode)}>
            <TabsList className="grid w-full grid-cols-3">
              {THEME_OPTIONS.map((o) => (
                <TabsTrigger key={o.value} value={o.value} className="gap-1.5">
                  {o.icon}
                  {o.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Section>

        <Section title="언어">
          <div className="flex flex-col gap-1.5">
            <Tabs value={locale} onValueChange={(v) => setLocale(v as LocaleMode)}>
              <TabsList className="grid w-full grid-cols-2">
                {LOCALE_OPTIONS.map((o) => (
                  <TabsTrigger key={o.value} value={o.value}>
                    {o.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              언어 번역은 아직 적용되지 않습니다.
            </p>
          </div>
        </Section>
      </PageScroll>
    </PageShell>
  );
}
