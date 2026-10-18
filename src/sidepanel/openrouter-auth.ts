import {
  runOpenRouterAuth,
  type OpenRouterAuthResult,
} from "@/sidepanel/lib/free-llm";

export function launchOpenRouterAuth(): Promise<OpenRouterAuthResult> {
  return runOpenRouterAuth({
    launch: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }),
    redirectUrl: chrome.identity.getRedirectURL(),
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    fetchImpl: fetch,
  });
}
