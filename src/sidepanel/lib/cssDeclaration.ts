type SupportsDeclaration = (property: string, value: string) => boolean;

function browserSupports(property: string, value: string): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return true;
  return CSS.supports(property, value);
}

export function filterValidCssDeclarations(
  declarations: Record<string, string>,
  supports: SupportsDeclaration = browserSupports,
): Record<string, string> {
  const valid: Record<string, string> = {};
  for (const [property, rawValue] of Object.entries(declarations)) {
    const value = rawValue.replace(/\s*!\s*important\s*$/i, "").trim();
    if (!value) continue;
    if (property.startsWith("--") || supports(property, value)) {
      valid[property] = rawValue;
    }
  }
  return valid;
}
