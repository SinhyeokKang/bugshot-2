import { Monitor, Moon, Sun } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
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
          <ToggleGroup
            type="single"
            value={theme}
            onValueChange={(v) => { if (v) setTheme(v as ThemeMode); }}
            className="inline-flex h-9 rounded-lg bg-muted p-1"
          >
            {THEME_OPTIONS.map((o) => (
              <ToggleGroupItem
                key={o.value}
                value={o.value}
                className="gap-1.5 rounded-md px-3 py-1 text-sm data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow"
              >
                {o.icon}
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Section>

        <Section title="언어">
          <div className="flex flex-col gap-1.5">
            <Select value={locale} onValueChange={(v) => setLocale(v as LocaleMode)}>
              <SelectTrigger className="h-9 w-full">
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
            <p className="text-xs text-muted-foreground">
              언어 번역은 아직 적용되지 않습니다.
            </p>
          </div>
        </Section>
      </PageScroll>
    </PageShell>
  );
}
