export function toggleLabel(current: string[], name: string): string[] {
  if (current.includes(name)) return current.filter((l) => l !== name);
  return [...current, name];
}
