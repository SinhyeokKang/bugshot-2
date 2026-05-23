import { common } from "./namespaces/common";
import { app } from "./namespaces/app";
import { issue } from "./namespaces/issue";
import { editor } from "./namespaces/editor";
import { integrations } from "./namespaces/integrations";
import { settings } from "./namespaces/settings";
import { logs } from "./namespaces/logs";
import { ai } from "./namespaces/ai";
import type { TranslationMap } from "./ko";

const en = {
  ...common.en,
  ...app.en,
  ...issue.en,
  ...editor.en,
  ...integrations.en,
  ...settings.en,
  ...logs.en,
  ...ai.en,
};

export default en satisfies TranslationMap;
