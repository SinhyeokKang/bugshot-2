import { useMemo } from "react";
import { useSettingsStore } from "@/store/settings-store";

export function useJiraConfig(): { projectKey: string } | null {
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  return useMemo(() => {
    if (!jiraAccount?.projectKey || !jiraAccount.auth) return null;
    return { projectKey: jiraAccount.projectKey };
  }, [jiraAccount?.auth, jiraAccount?.projectKey]);
}
