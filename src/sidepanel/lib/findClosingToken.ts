export function findClosingToken(
  tokens: { type: string }[],
  start: number,
  openType: string,
  closeType: string,
): number {
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i].type === openType) depth++;
    if (tokens[i].type === closeType) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}
