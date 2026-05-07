// `abc123` 같은 6/8자리 hex에 `#`만 붙임. 2/3/4자리는 입력 중 깜빡임 방지를 위해
// 라이브 적용에서 제외하고 blur 시 `expandShortHex`로 풀어쓴다.
export function normalizeHexInput(v: string): string {
  const t = v.trim();
  if (!t || t.startsWith("#")) return t;
  if (/^[0-9a-fA-F]{6}$/.test(t)) return `#${t}`;
  if (/^[0-9a-fA-F]{8}$/.test(t)) return `#${t}`;
  return t;
}

// 디자인 툴 컨벤션 + 그레이스케일 단축 입력:
// - 2자리: `ff` → `#ffffff` (단일 채널 반복)
// - 3자리: `fff` → `#ffffff`
// - 4자리: `f0a8` → `#ff00aa88`
export function expandShortHex(v: string): string | null {
  const t = v.trim();
  const stripped = t.startsWith("#") ? t.slice(1) : t;
  if (/^[0-9a-fA-F]{2}$/.test(stripped)) {
    return `#${stripped}${stripped}${stripped}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(stripped)) {
    const [r, g, b] = stripped;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-fA-F]{4}$/.test(stripped)) {
    const [r, g, b, a] = stripped;
    return `#${r}${r}${g}${g}${b}${b}${a}${a}`;
  }
  return null;
}
