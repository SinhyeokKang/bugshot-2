export const ELEMENT_LABEL_MAX_CLASSES = 3;

export interface VisibleClasses {
  shown: string[];
  extra: number;
}

export function visibleClasses(classList: string[]): VisibleClasses {
  return {
    shown: classList.slice(0, ELEMENT_LABEL_MAX_CLASSES),
    extra: Math.max(0, classList.length - ELEMENT_LABEL_MAX_CLASSES),
  };
}

export interface FormatElementNameOptions {
  tag: string;
  classList: string[];
  id?: string | null;
  brackets?: boolean;
}

export function formatElementName(opts: FormatElementNameOptions): string {
  const { shown, extra } = visibleClasses(opts.classList);
  const idPart = opts.id ? `#${opts.id}` : "";
  const clsPart = shown.map((c) => `.${c}`).join("");
  const extraPart = extra > 0 ? `+${extra}` : "";
  const inner = `${opts.tag}${idPart}${clsPart}${extraPart}`;
  return opts.brackets ? `<${inner}>` : inner;
}
