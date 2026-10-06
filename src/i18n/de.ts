import { ai } from "./namespaces/ai";
import { app } from "./namespaces/app";
import { common } from "./namespaces/common";
import { editor } from "./namespaces/editor";
import { integrations } from "./namespaces/integrations";
import { issue } from "./namespaces/issue";
import { logs } from "./namespaces/logs";
import { settings } from "./namespaces/settings";
import type { TranslationMap } from "./ko";

const de = {
  ...ai.de,
  ...app.de,
  ...common.de,
  ...editor.de,
  ...integrations.de,
  ...issue.de,
  ...logs.de,
  ...settings.de,
};

export default de satisfies TranslationMap;
