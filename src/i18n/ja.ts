import { ai } from "./namespaces/ai";
import { app } from "./namespaces/app";
import { common } from "./namespaces/common";
import { editor } from "./namespaces/editor";
import { integrations } from "./namespaces/integrations";
import { issue } from "./namespaces/issue";
import { logs } from "./namespaces/logs";
import { settings } from "./namespaces/settings";
import type { TranslationMap } from "./ko";

const ja = {
  ...ai.ja,
  ...app.ja,
  ...common.ja,
  ...editor.ja,
  ...integrations.ja,
  ...issue.ja,
  ...logs.ja,
  ...settings.ja,
};

export default ja satisfies TranslationMap;
