import { ai } from "./namespaces/ai";
import { app } from "./namespaces/app";
import { common } from "./namespaces/common";
import { editor } from "./namespaces/editor";
import { integrations } from "./namespaces/integrations";
import { issue } from "./namespaces/issue";
import { logs } from "./namespaces/logs";
import { settings } from "./namespaces/settings";
import type { TranslationMap } from "./ko";

const es = {
  ...ai.es,
  ...app.es,
  ...common.es,
  ...editor.es,
  ...integrations.es,
  ...issue.es,
  ...logs.es,
  ...settings.es,
};

export default es satisfies TranslationMap;
