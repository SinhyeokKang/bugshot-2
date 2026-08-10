import { finder } from "@medv/finder";

/**
 * 선택 요소의 실행용 CSS selector 생성.
 *
 * finder는 후보를 누적 penalty 오름차순으로 yield하고 유일한 첫 후보를 반환하므로
 * 주어진 훅 구성에서 이미 "가장 싼 유일 selector"를 준다. 사람이 다시 정렬할 이유는
 * penalty가 하드코딩(id 0 / class 1 / attr 2 / tag 5 / nth-of-type 10 / nth-child 50)이라
 * test attribute가 흔한 스타일 class에 진다는 것 하나뿐이다. 그래서 훅만 두 가지로
 * 바꿔 2회 돌리고 (위치 유무, 단계, 길이)로 고른다.
 */

const BUDGET_MS = 500;
const PATH_CHECKS_PER_STAGE = 1000;

/** finder 기본 attr predicate의 wordLike 게이트에 막혀 후보로도 안 만들어지는 것들을 연다. */
export const TRUSTED_TEST_ATTRIBUTES: ReadonlySet<string> = new Set([
  "data-testid",
  "data-test-id",
  "data-test",
  "data-e2e",
  "data-cy",
  "data-qa",
  "data-automation-id",
  "data-pw",
]);

/** finder 기본 목록 + `for`(finder엔 없어 직접 더한다). */
const SEMANTIC_ATTRIBUTES: ReadonlySet<string> = new Set([
  "role",
  "name",
  "aria-label",
  "rel",
  "href",
  "for",
]);

// 숫자는 hex의 부분집합이라 이 하나가 UUID(12자 런)와 epoch-like 숫자열까지 덮는다.
// 별도 UUID·숫자 규칙을 두면 절대 도달하지 않는 죽은 분기가 된다.
const LONG_HEX_RE = /[0-9a-f]{8,}/i;
const REACT_USE_ID_RE = /^:[a-z0-9]+:$/i;
const GENERATED_ID_RE = /^(?:__id_\d+|ember\d+|mui-\d+)$/i;
// emotion·styled-components·JSS는 빌드마다 바뀌는 해시를 접두사 뒤에 붙인다.
const CSS_IN_JS_RE = /^(?:css|sc|jss|emotion|styled)-[a-z0-9]{2,}$/i;
// semantic attribute는 finder 기본과 같은 좁은 값 정책을 유지한다 — 여기를 열면
// aria-label의 화면 텍스트나 href의 URL이 selector에 실려 이슈 본문으로 나간다.
const SEMANTIC_VALUE_RE = /^[a-z][a-z0-9-]*$/i;
const POSITIONAL_RE = /:nth-(?:child|of-type)\(/;

/* ── 안정성 판정 (finder 훅 시그니처와 1:1) ────────── */

function isDynamicValue(value: string): boolean {
  return (
    LONG_HEX_RE.test(value) ||
    REACT_USE_ID_RE.test(value) ||
    GENERATED_ID_RE.test(value)
  );
}

export function isStableIdName(name: string): boolean {
  return name.length > 0 && !isDynamicValue(name);
}

export function isStableClassName(name: string): boolean {
  return (
    name.length > 0 &&
    !isDynamicValue(name) &&
    !hasHashSuffix(name) &&
    !CSS_IN_JS_RE.test(name)
  );
}

export function isStableAttribute(name: string, value: string): boolean {
  if (value.length === 0 || value.length > 100) return false;
  if (hasControlChar(value)) return false;
  if (isDynamicValue(value)) return false;
  // test contract 속성만 값 정책을 넓힌다(finder의 wordLike는 숫자를 막는다).
  if (TRUSTED_TEST_ATTRIBUTES.has(name)) return true;
  return SEMANTIC_ATTRIBUTES.has(name) && SEMANTIC_VALUE_RE.test(value);
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** CSS Modules류 `Component_ab12cd34` — 마지막 `_` 뒤가 영숫자 혼합 6자 이상. */
function hasHashSuffix(name: string): boolean {
  const at = name.lastIndexOf("_");
  if (at < 0) return false;
  const tail = name.slice(at + 1);
  return (
    tail.length >= 6 &&
    /^[a-z0-9]+$/i.test(tail) &&
    /\d/.test(tail) &&
    /[a-z]/i.test(tail)
  );
}

/* ── 후보 비교 ────────────────────────────────────── */

export type SelectorScore = readonly [
  positional: 0 | 1,
  stage: 0 | 1,
  length: number,
];

export function scoreSelector(selector: string, stage: 0 | 1): SelectorScore {
  return [POSITIONAL_RE.test(selector) ? 1 : 0, stage, selector.length];
}

export function compareSelectorScores(
  a: SelectorScore,
  b: SelectorScore,
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/* ── selector 생성 ────────────────────────────────── */

interface FinderOptions {
  seedMinLength: number;
  optimizedMinLength: number;
  timeoutMs: number;
  maxNumberOfPathChecks: number;
  idName?: (name: string) => boolean;
  className?: (name: string) => boolean;
  attr?: (name: string, value: string) => boolean;
}

export interface LocatorDeps {
  finder: (el: Element, options: FinderOptions) => string;
  now: () => number;
}

let lastSelection: { el: Element; selector: string } | null = null;

/** 테스트 전용 — 직전 선택 기억을 비운다. */
export function resetStableSelectorCache(): void {
  lastSelection = null;
}

/**
 * 선택 시점용. 항상 새로 계산하고 결과를 "직전 선택"으로 기억한다.
 *
 * 페이지 수명 캐시를 두지 않는 이유: 리스트가 정렬·필터돼 같은 노드가 다른 위치로
 * 옮겨간 뒤 그 노드를 다시 고르면, 캐시된 위치 selector가 지금은 **다른 요소**를
 * 가리킨다. 그 selector로 `applyEditsBySelector`·`prepareCaptureBySelector`가 돌면
 * 무음으로 엉뚱한 요소가 편집·캡처된다. 재선택 때 다시 계산하면 스스로 낫는다.
 */
export function buildStableSelector(
  el: Element,
  deps: Partial<LocatorDeps> = {},
): string {
  const selector = computeStableSelector(el, deps);
  lastSelection = { el, selector };
  return selector;
}

/**
 * cross-origin 스타일 보강용. 같은 선택 안에서는 `picker.selected`가 보낸 문자열을
 * 그대로 재사용한다 — `updateSelectionStyles`가 `sameElementKey`로 stale 가드를
 * 걸어서, 두 메시지의 selector가 갈리면 보강이 무음으로 드랍된다.
 */
export function reuseStableSelector(
  el: Element,
  deps: Partial<LocatorDeps> = {},
): string {
  if (lastSelection?.el === el) return lastSelection.selector;
  return buildStableSelector(el, deps);
}

function computeStableSelector(el: Element, deps: Partial<LocatorDeps>): string {
  if (!el.isConnected) {
    throw new Error("[bugshot] cannot build a selector for a detached element");
  }
  const find = deps.finder ?? finder;
  const now = deps.now ?? (() => Date.now());
  const start = now();

  const ownClassNames = new Set(Array.from(el.classList));
  const stageHooks: Partial<FinderOptions>[] = [
    {
      attr: isStableAttribute,
      idName: isStableIdName,
      // finder 훅에는 element 인자가 없어 "조상 class는 허용, 타깃 class만 제외"를
      // 표현할 수 없다. 이름 기준 전역 거부가 유일한 근사 — 조상이 같은 이름을
      // 쓰면 함께 빠지고, 그 손실은 compat 단계가 보전한다.
      className: (name) => !ownClassNames.has(name) && isStableClassName(name),
    },
    {},
  ];

  const scored: { selector: string; score: SelectorScore }[] = [];
  for (let stage = 0; stage < stageHooks.length; stage++) {
    const remaining = BUDGET_MS - (now() - start);
    // 예산이 끊기면 부분 결과를 채택하지 않고 결정적인 path fallback으로 수렴한다.
    // timeoutMs: 0은 중단이 아니라 "첫 후보에서 곧장 위치 체인 반환"이라 넘기지 않는다.
    if (remaining <= 0) return pathSelector(el);
    try {
      const selector = find(el, {
        seedMinLength: 2,
        optimizedMinLength: 2,
        timeoutMs: remaining,
        maxNumberOfPathChecks: PATH_CHECKS_PER_STAGE,
        ...stageHooks[stage],
      });
      scored.push({ selector, score: scoreSelector(selector, stage as 0 | 1) });
    } catch {
      // 단계별 개별 catch — 예산 초과·detached는 finder가 던진다. stable의 throw가
      // compat을 낙태시키면 안 된다.
    }
  }
  if (scored.length === 0) return pathSelector(el);
  scored.sort((a, b) => compareSelectorScores(a.score, b.score));
  return scored[0].selector;
}

/**
 * 최후 fallback. documentElement까지 nth-of-type 체인이라 구성상 항상 유일하고
 * 시간 예산과 무관해 결정적이다. dom-describe의 DOM Tree 경로도 이걸 쓴다.
 */
export function pathSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const same = Array.from(parent.children).filter(
      (s) => s.tagName === cur!.tagName,
    );
    if (same.length === 1) {
      parts.unshift(tag);
    } else {
      parts.unshift(`${tag}:nth-of-type(${same.indexOf(cur) + 1})`);
    }
    cur = parent;
  }
  return parts.join(" > ");
}
