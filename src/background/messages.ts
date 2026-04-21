import type { BgRequest } from "@/types/messages";
import {
  getIssueTypes,
  getMyself,
  getPriorities,
  searchEpics,
  searchProjects,
  searchUsers,
} from "./jira-api";

export async function handleMessage(
  message: BgRequest,
  _sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case "ping":
      return { pong: true, at: Date.now() };

    case "captureVisibleTab": {
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.windowId) throw new Error("tab has no window");
      return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    }

    case "jira.myself":
      return getMyself(message.config);

    case "jira.listProjects":
      return searchProjects(message.config, message.query);

    case "jira.listIssueTypes":
      return getIssueTypes(message.config, message.projectKey);

    case "jira.listPriorities":
      return getPriorities(message.config);

    case "jira.searchUsers":
      return searchUsers(message.config, message.query);

    case "jira.searchEpics":
      return searchEpics(message.config, message.projectKey, message.query);

    default: {
      const _exhaustive: never = message;
      throw new Error(`unknown message: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
