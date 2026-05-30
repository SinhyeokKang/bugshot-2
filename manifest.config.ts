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
    {
      matches: ["<all_urls>"],
      js: ["src/content/recorders-entry.ts"],
      run_at: "document_start",
      world: "MAIN",
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
    "tabCapture",
    "webNavigation",
  ],
  optional_host_permissions: ["https://*/*", "http://*/*"],
  host_permissions: [
    "https://*.atlassian.net/*",
    "https://api.atlassian.com/*",
    "https://auth.atlassian.com/*",
    "https://api.github.com/*",
    "https://github.com/*",
    "https://uploads.github.com/*",
    "https://api.linear.app/*",
    "https://api.notion.com/*",
    "https://gitlab.com/*",
    ...(proxyMatch ? [proxyMatch] : []),
  ],
  commands: {
    _execute_action: {
      suggested_key: {
        default: "Ctrl+Shift+E",
        mac: "Command+Shift+E",
      },
      description: "__MSG_CMD_TOGGLE_PANEL__",
    },
    "capture-element": {
      suggested_key: { default: "Ctrl+Shift+S", mac: "Command+Shift+S" },
      description: "__MSG_CMD_CAPTURE_ELEMENT__",
    },
    "capture-screenshot": {
      suggested_key: { default: "Ctrl+Shift+F", mac: "Command+Shift+F" },
      description: "__MSG_CMD_CAPTURE_SCREENSHOT__",
    },
    "capture-video": {
      suggested_key: { default: "Ctrl+Shift+X", mac: "Command+Shift+X" },
      description: "__MSG_CMD_CAPTURE_VIDEO__",
    },
  },
});
