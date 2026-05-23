import { common } from "./namespaces/common";
import { app } from "./namespaces/app";
import { issue } from "./namespaces/issue";
import { editor } from "./namespaces/editor";
import { integrations } from "./namespaces/integrations";
import { settings } from "./namespaces/settings";
import { logs } from "./namespaces/logs";
import { ai } from "./namespaces/ai";

const ko = {
  ...common.ko,
  ...app.ko,
  ...issue.ko,
  ...editor.ko,
  ...integrations.ko,
  ...settings.ko,
  ...logs.ko,
  ...ai.ko,
} as const;

export type TranslationKey = keyof typeof ko;
export type TranslationMap = Record<TranslationKey, string>;
export default ko satisfies TranslationMap;
