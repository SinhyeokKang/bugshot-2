interface OriginalDeclaration {
  value: string;
  priority: string;
  present: boolean;
}

export interface StyleOverlayState {
  originals: Map<string, OriginalDeclaration>;
  applied: Map<string, OriginalDeclaration>;
}

export function createStyleOverlayState(): StyleOverlayState {
  return { originals: new Map(), applied: new Map() };
}

function restoreProperty(
  style: CSSStyleDeclaration,
  property: string,
  original: OriginalDeclaration,
): void {
  if (original.present) {
    style.setProperty(property, original.value, original.priority);
  } else {
    style.removeProperty(property);
  }
}

function snapshot(style: CSSStyleDeclaration): Map<string, OriginalDeclaration> {
  const declarations = new Map<string, OriginalDeclaration>();
  for (let i = 0; i < style.length; i++) {
    const property = style.item(i);
    declarations.set(property, {
      value: style.getPropertyValue(property),
      priority: style.getPropertyPriority(property),
      present: true,
    });
  }
  return declarations;
}

export function restoreStyleOverlay(
  el: HTMLElement,
  state: StyleOverlayState,
): void {
  for (const [property, applied] of state.applied) {
    const original = state.originals.get(property);
    if (!original) continue;
    const currentValue = el.style.getPropertyValue(property);
    const currentPriority = el.style.getPropertyPriority(property);
    if (
      currentValue === applied.value &&
      currentPriority === applied.priority
    ) {
      restoreProperty(el.style, property, original);
    } else {
      // 페이지가 같은 속성을 다시 썼으면 그 값을 새 baseline으로 승격한다.
      state.originals.set(property, {
        value: currentValue,
        priority: currentPriority,
        present: currentValue !== "",
      });
    }
    state.originals.delete(property);
  }
  state.applied.clear();
}

export function applyStyleOverlay(
  el: HTMLElement,
  state: StyleOverlayState,
  inlineStyle: Record<string, string>,
): void {
  restoreStyleOverlay(el, state);
  for (const [property, rawValue] of Object.entries(inlineStyle)) {
    if (!rawValue) continue;
    const before = snapshot(el.style);
    const value = rawValue.replace(/\s*!\s*important\s*$/i, "");
    if (!value) continue;
    const priority = value === rawValue ? "" : "important";
    el.style.setProperty(property, value, priority);
    const after = snapshot(el.style);
    const affected = new Set([...before.keys(), ...after.keys()]);
    for (const affectedProperty of affected) {
      const previous = before.get(affectedProperty) ?? {
        value: "",
        priority: "",
        present: false,
      };
      const applied = after.get(affectedProperty) ?? {
        value: "",
        priority: "",
        present: false,
      };
      if (
        previous.value === applied.value &&
        previous.priority === applied.priority &&
        previous.present === applied.present
      ) continue;
      if (!state.originals.has(affectedProperty)) {
        state.originals.set(affectedProperty, previous);
      }
      state.applied.set(affectedProperty, applied);
    }
  }
}
