import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
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
        <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground">
          {THEME_OPTIONS.map((o) => {
            const active = theme === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setTheme(o.value)}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-background text-foreground shadow"
                    : "hover:text-foreground",
                )}
              >
                {o.icon}
                {o.label}
              </button>
            );
          })}
        </div>
      </Section>

        <Section title="언어">
          <div className="flex flex-col gap-1.5">
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as LocaleMode)}
              className="h-9 rounded-md border bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {LOCALE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              언어 번역은 아직 적용되지 않습니다.
            </p>
          </div>
        </Section>
      </PageScroll>
    </PageShell>
  );
}
