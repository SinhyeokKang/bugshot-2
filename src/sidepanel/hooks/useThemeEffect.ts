import { useEffect } from "react";
import { resolveDark } from "@/sidepanel/lib/resolveDark";
import { useSettingsUiStore } from "@/store/settings-ui-store";

export function useThemeEffect(): void {
  const theme = useSettingsUiStore((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = resolveDark(
        theme,
        window.matchMedia("(prefers-color-scheme: dark)").matches,
      );
      root.classList.toggle("dark", dark);
    };
    apply();
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}
