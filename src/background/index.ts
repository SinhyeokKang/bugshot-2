import { JiraError } from "./jira-api";
import { handleMessage } from "./messages";
import { setupTabBindings } from "./tab-bindings";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[bugshot] sidePanel init failed", err));
});

setupTabBindings();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) => {
      if (error instanceof JiraError) {
        sendResponse({
          ok: false,
          error: error.message,
          status: error.status,
          body: error.body,
        });
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: msg });
      }
    });
  return true;
});
