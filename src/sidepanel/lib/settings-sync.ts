import { SETTINGS_STORAGE_KEY } from "@/lib/settings-storage";
import { useSettingsStore } from "@/store/settings-store";

export function installSettingsSync(store = useSettingsStore): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local" || !changes[SETTINGS_STORAGE_KEY]) return;
    void store.persist.rehydrate();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
