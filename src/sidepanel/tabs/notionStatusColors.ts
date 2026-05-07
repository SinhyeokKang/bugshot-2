// Notion status option color (gray, brown, orange, yellow, green, blue, purple, pink, red, default)를
// 시각 카테고리 (new / indeterminate / done)로 매핑.
// 기준: green=완료, blue/purple=진행, 그 외=보류/시작전.
export type NotionStatusCategory = "new" | "indeterminate" | "done";

const NOTION_COLOR_TO_CATEGORY: Record<string, NotionStatusCategory> = {
  green: "done",
  blue: "indeterminate",
  purple: "indeterminate",
};

export function notionStatusCategory(
  color: string | undefined,
): NotionStatusCategory {
  if (!color) return "new";
  return NOTION_COLOR_TO_CATEGORY[color] ?? "new";
}
