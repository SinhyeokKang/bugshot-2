interface OriginalDeclaration {
  value: string;
  priority: string;
  present: boolean;
}

export interface StyleOverlayState {
  originals: Map<string, OriginalDeclaration>;
  applied: Map<string, OriginalDeclaration>;
  observer: MutationObserver | null;
  externalMutations: Set<string>;
}

export function createStyleOverlayState(): StyleOverlayState {
  return {
    originals: new Map(),
    applied: new Map(),
    observer: null,
    externalMutations: new Set(),
  };
}

function declarationsFromAttribute(value: string | null): Map<string, string> {
  const probe = document.createElement("div");
  if (value != null) probe.setAttribute("style", value);
  const declarations = new Map<string, string>();
  for (let i = 0; i < probe.style.length; i++) {
    const property = probe.style.item(i);
    declarations.set(
      property,
      `${probe.style.getPropertyValue(property)}!${probe.style.getPropertyPriority(property)}`,
    );
  }
  return declarations;
}

function recordExternalMutations(
  el: HTMLElement,
  state: StyleOverlayState,
  records: MutationRecord[],
): void {
  for (const record of records) {
    const before = declarationsFromAttribute(record.oldValue);
    const after = declarationsFromAttribute(el.getAttribute("style"));
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
      (property) => before.get(property) !== after.get(property),
    );
    if (changed.length === 0) {
      for (const property of state.applied.keys()) {
        state.externalMutations.add(property);
      }
    } else {
      for (const property of changed) state.externalMutations.add(property);
    }
  }
}

function ensureObserver(el: HTMLElement, state: StyleOverlayState): void {
  if (state.observer || typeof MutationObserver === "undefined") return;
  state.observer = new MutationObserver((records) => {
    recordExternalMutations(el, state, records);
  });
  state.observer.observe(el, {
    attributes: true,
    attributeFilter: ["style"],
    attributeOldValue: true,
  });
}

function consumeExternalMutations(
  el: HTMLElement,
  state: StyleOverlayState,
): void {
  const records = state.observer?.takeRecords() ?? [];
  if (records.length) recordExternalMutations(el, state, records);
}

function discardOwnMutations(state: StyleOverlayState): void {
  state.observer?.takeRecords();
}

export function disconnectStyleOverlay(state: StyleOverlayState): void {
  state.observer?.disconnect();
  state.observer = null;
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
  consumeExternalMutations(el, state);
  for (const [property, applied] of state.applied) {
    const original = state.originals.get(property);
    if (!original) continue;
    const currentValue = el.style.getPropertyValue(property);
    const currentPriority = el.style.getPropertyPriority(property);
    if (
      !state.externalMutations.has(property) &&
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
  state.externalMutations.clear();
  discardOwnMutations(state);
}

export function applyStyleOverlay(
  el: HTMLElement,
  state: StyleOverlayState,
  inlineStyle: Record<string, string>,
): void {
  ensureObserver(el, state);
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
    discardOwnMutations(state);
  }
}
