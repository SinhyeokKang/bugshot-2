import { common } from "./namespaces/common";
import { app } from "./namespaces/app";
import { issue } from "./namespaces/issue";
import { editor } from "./namespaces/editor";
import { integrations } from "./namespaces/integrations";
import { settings } from "./namespaces/settings";
import { logs } from "./namespaces/logs";
import { ai } from "./namespaces/ai";
import type { TranslationMap } from "./ko";

const fr = {
  ...common.fr,
  ...app.fr,
  ...issue.fr,
  ...editor.fr,
  ...integrations.fr,
  ...settings.fr,
  ...logs.fr,
  ...ai.fr,
};

export default fr satisfies TranslationMap;
