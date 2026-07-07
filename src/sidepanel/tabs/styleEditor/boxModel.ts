export interface BoxSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoxModel {
  margin: BoxSides;
  border: BoxSides;
  padding: BoxSides;
  content: { width: number; height: number };
  contentLabel: string;
}

function px(computed: Record<string, string>, key: string): number {
  const raw = computed[key];
  if (!raw) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function sides(
  computed: Record<string, string>,
  key: (side: string) => string,
): BoxSides {
  return {
    top: px(computed, key("top")),
    right: px(computed, key("right")),
    bottom: px(computed, key("bottom")),
    left: px(computed, key("left")),
  };
}

export function parseBoxModel(computed: Record<string, string>): BoxModel {
  const width = px(computed, "width");
  const height = px(computed, "height");
  return {
    margin: sides(computed, (s) => `margin-${s}`),
    border: sides(computed, (s) => `border-${s}-width`),
    padding: sides(computed, (s) => `padding-${s}`),
    content: { width, height },
    contentLabel: `${width}×${height}`,
  };
}
