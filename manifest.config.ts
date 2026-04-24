import { defineManifest } from "@crxjs/vite-plugin";
import { loadEnv } from "vite";
import pkg from "./package.json" with { type: "json" };

const env = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
const isStoreBuild = process.env.BUGSHOT_STORE_BUILD === "1";
const DEV_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAze+ul+m82KNOush/KW9VlfyEM4SBd0ekf4XqAwRcYLXNnxmtdQyvEEM4U7Ae93NSuSR1dQPBbwS/v98WuWSisw6IA5jJtqHd/J07LuuQIooVra7wOFb9NriipLFPlWgEWuxrRO3xIdQYilVK5ACFpEFDe4m1XF2iUD1VOSCJsRITtd5e/9rZkYu4uyMvFMSbfdJDDCNR+MtKTL3I5dnkMg7iWDF/5Sd0jCCDEw+mIuOtbbzQ0SqOQnLmTC+VwIdg8/rTuU21eAmMrJyen4lsRGqTTMuiqnPmIhZh0bu8s1d+H7wZ8V7gYOr5Fwru8QopnW2TTms5OXnQUlwA0ndXCQIDAQAB";
function proxyMatchPattern(): string | null {
  const raw = env.VITE_OAUTH_PROXY_URL;
  if (!raw) return null;
  try {
    return `${new URL(raw).origin}/*`;
  } catch {
    return null;
  }
}
const proxyMatch = proxyMatchPattern();

export default defineManifest({
  manifest_version: 3,
  name: "__MSG_EXT_NAME__",
  short_name: "__MSG_EXT_NAME_SHORT__",
  description: "__MSG_EXT_DESCRIPTION__",
  version: pkg.version,
  default_locale: "ko",
  minimum_chrome_version: "116",
  ...(isStoreBuild ? {} : { key: DEV_KEY }),
  icons: {
    16: "src/assets/icons/icon-16.png",
    32: "src/assets/icons/icon-32.png",
    48: "src/assets/icons/icon-48.png",
    128: "src/assets/icons/icon-128.png",
  },
  action: {
    default_title: "__MSG_EXT_NAME_SHORT__",
    default_icon: {
      16: "src/assets/icons/icon-16.png",
      32: "src/assets/icons/icon-32.png",
    },
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/picker.ts"],
      run_at: "document_idle",
    },
  ],
  permissions: [
    "sidePanel",
    "activeTab",
    "scripting",
    "storage",
    "commands",
    "contextMenus",
    "identity",
  ],
  host_permissions: [
    "https://*.atlassian.net/*",
    "https://api.atlassian.com/*",
    "https://auth.atlassian.com/*",
    ...(proxyMatch ? [proxyMatch] : []),
  ],
  web_accessible_resources: [
    {
      resources: ["src/annotation/index.html"],
      matches: ["<all_urls>"],
    },
  ],
  commands: {
    _execute_action: {
      suggested_key: {
        default: "Alt+Shift+B",
        mac: "Alt+Shift+B",
      },
      description: "__MSG_CMD_TOGGLE_PANEL__",
    },
  },
});
