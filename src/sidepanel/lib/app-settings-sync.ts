import { APP_SETTINGS_PERSIST_KEY } from "@/lib/session-keys";
import { useSettingsUiStore } from "@/store/settings-ui-store";

export function installAppSettingsSync(store = useSettingsUiStore): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local" || !changes[APP_SETTINGS_PERSIST_KEY]) return;
    void store.persist.rehydrate();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
