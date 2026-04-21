import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "__MSG_EXT_NAME__",
  short_name: "__MSG_EXT_NAME_SHORT__",
  description: "__MSG_EXT_DESCRIPTION__",
  version: pkg.version,
  default_locale: "ko",
  minimum_chrome_version: "116",
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
  ],
  host_permissions: ["https://*.atlassian.net/*"],
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
