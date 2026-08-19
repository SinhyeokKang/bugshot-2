// action-recorder.ts에서 IIFE 자가호출하기 때문에 테스트가 필요한 순수 함수는 별도 파일로 분리.
//
// ⚠️ content(레코더) 전용으로 유지할 것. recorders-entry 의존 트리가 self-contained여야
// crxjs가 동기 IIFE로 emit하고 document_start에 후크가 페이지 스크립트보다 먼저 깔린다.
// sidepanel·background가 이 모듈을 import하면 공유 청크로 hoist돼 recorders-entry가
// async-import loader로 되돌아가 pre-arm 후크가 늦어진다 (CLAUDE.md "pre-arm 버퍼링").
// shouldMaskField·isSensitiveValue·maskValue는 재사용하고 싶어지는 범용 PII 헬퍼 이름이라
// log-throttle이 겪은 것과 같은 형태의 유혹이다 — 수신부가 필요하면 복제본을 둔다.

// 영문은 단어 경계로 끊는다 — placeholder·라벨 문구가 판정 소스라 부분일치는 정상 폼을 죽인다
// (pin ⊂ shipping, auth ⊂ author, card ⊂ discard). 한글은 \b가 안 먹어 부분일치 유지(안전 측).
// key·otp류는 네트워크 층 MASKED_QUERY_KEYS(key/api_key)와 집합을 맞추려고 추가했다 —
// 한쪽에만 있으면 그 차집합이 곧 유출 경로다. `\bkey\b`는 monkey·keyword·keyboard에 안 걸린다.
const SENSITIVE_NAME_RE =
  /\b(password|secret|card|cvv|ssn|token|pwd|auth|pin|keys?|otp|passphrase|mnemonic|credentials?)\b|비밀번호|암호|주민|카드|계좌|전화|연락처|휴대폰|주소/;
const TARGET_NAME_CAP = 80;

// 라벨에 민감 키워드가 없어도(생성된 id `:r3:`, 커스텀 폼, 라벨 없는 입력) 값 형태로 PII를 잡는다.
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
// 점은 구분자에서 뺀다 — 지우면 소수(1234.56789)·IP가 긴 숫자열로 승격돼 오탐.
const VALUE_SEPARATORS_RE = /[\s\-()+]/g;
// 전화·카드·주민·계좌는 구분자를 빼면 9자리 이상 순수 숫자열. 짧은 숫자(수량·좌표)는 재현에
// 필요하므로 남긴다. 섞인 식별자(ORD-12345678)는 순수 숫자가 아니라 통과.
const LONG_DIGITS_RE = /^\d{9,}$/;

export interface MaskFieldInput {
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  ariaLabel?: string;
  labelText?: string;
  placeholder?: string;
}

// camelCase·snake_case·kebab을 단어로 끊어 \b 경계가 식별자에도 걸리게 한다(cardNumber → card number).
function normalizeName(raw: string): string {
  return raw
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]/g, " ")
    .toLowerCase();
}

export function shouldMaskField(input: MaskFieldInput): boolean {
  if (input.type?.toLowerCase() === "password") return true;
  const ac = input.autocomplete?.toLowerCase() ?? "";
  // one-time-code는 표준 autocomplete 토큰. `code`를 정규식 단어로 넣으면 zip/error/country code가
  // 통째로 죽으므로, 토큰 일치로만 좁혀 잡는다.
  if (ac.includes("password") || ac.includes("cc-") || ac.includes("one-time-code")) return true;
  // fieldLabel()이 라벨로 쓰는 소스(aria-label·label[for]·placeholder·name)를 판정에도 전부 넣는다.
  const name = normalizeName(
    [input.name, input.id, input.ariaLabel, input.labelText, input.placeholder]
      .filter(Boolean)
      .join(" "),
  );
  return SENSITIVE_NAME_RE.test(name);
}

export function isSensitiveValue(value: string): boolean {
  if (!value) return false;
  if (EMAIL_RE.test(value)) return true;
  return LONG_DIGITS_RE.test(value.replace(VALUE_SEPARATORS_RE, ""));
}

export function maskValue(_value: string): string {
  return "***";
}

export interface EntryNav {
  fromUrl: string;
  toUrl: string;
}

// 녹화 bind(setSentinel) 시점에 현재 페이지 진입(load) 네비게이션을 1회 기록하기 위한 결정.
// document_start의 load 기록은 recording=false라 버려지므로, cross-origin으로 새 페이지에
// 진입할 때마다 그 자취가 사라진다. bind 직후 이 함수로 메운다.
// referrer가 비면(cross-origin referrer 정책) lastUrl로 fallback, 이미 emit했으면 null(중복 방지).
export function entryNavOnBind(
  alreadyEmitted: boolean,
  referrer: string,
  lastUrl: string,
  currentUrl: string,
): EntryNav | null {
  if (alreadyEmitted) return null;
  return { fromUrl: referrer || lastUrl, toUrl: currentUrl };
}

// 문서 진입 계열 판정. PerformanceNavigationTiming.type을 액션 로그 navType으로 옮긴다.
// document_start 시점에 그 엔트리가 큐잉돼 있는지 코드베이스 선례가 0건이라 레거시
// performance.navigation.type(0=navigate/1=reload/2=back_forward)을 폴백으로 함께 받는다.
// back_forward는 traverse까지만 — 도착 문서는 방향을 알 수 없다.
export function entryNavType(
  perfType: string | undefined,
  legacyType?: number | undefined,
): "load" | "reload" | "traverse" {
  if (perfType === "reload") return "reload";
  if (perfType === "back_forward") return "traverse";
  // 모르는 문자열은 레거시로 넘기지 않는다 — 미래에 추가될 값을 레거시 숫자가 덮어쓰면
  // 두 소스가 어긋날 때 오래된 쪽이 이긴다.
  if (perfType !== undefined) return "load";
  if (legacyType === 1) return "reload";
  if (legacyType === 2) return "traverse";
  return "load";
}

// same-document traverse 방향. Navigation API 히스토리 인덱스 델타의 부호.
// NavigationHistoryEntry.index는 엔트리 리스트 밖일 때 -1을 반환하는데 그건 유한수라
// "유한하면 통과" 게이트를 그냥 지나 (3, -1)을 back으로 오판한다 — 음수를 명시적으로 거부한다.
export function traverseDirection(
  fromIndex: number | undefined,
  toIndex: number | undefined,
): "back" | "forward" | null {
  if (!isHistoryIndex(fromIndex) || !isHistoryIndex(toIndex)) return null;
  if (toIndex === fromIndex) return null;
  return toIndex < fromIndex ? "back" : "forward";
}

function isHistoryIndex(v: number | undefined): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

// popstate는 히스토리 이동 전용 신호가 아니다 — 같은 문서 프래그먼트 네비게이션(<a href="#x">)도
// popstate를 쏘고 인덱스를 +1 한다. 인덱스 델타만 보면 그 링크 클릭이 "앞으로가기"가 된다.
// 도착 엔트리 id를 전에 본 적 있어야 이동이고, 처음 보는 id는 새로 밀어 넣어진 엔트리다.
// 판정이 안 서면 기존 "popstate"로 — 틀린 방향보다 정보 없는 쪽이 낫다.
export function popstateNavType(
  fromIndex: number | undefined,
  toIndex: number | undefined,
  entryId: string | undefined,
  seenEntryIds: ReadonlySet<string>,
): "back" | "forward" | "popstate" {
  if (entryId === undefined || !seenEntryIds.has(entryId)) return "popstate";
  return traverseDirection(fromIndex, toIndex) ?? "popstate";
}

// 접근가능한 이름을 trim·길이 cap. 역할(button/link 등)은 ActionEntry.role로 따로 들고
// 렌더 레이어(i18n)에서 로케일에 맞춰 조립한다.
export function truncateName(name: string | null | undefined): string | undefined {
  const n = name?.trim();
  if (!n) return undefined;
  return n.length > TARGET_NAME_CAP ? `${n.slice(0, TARGET_NAME_CAP)}…` : n;
}

export interface KeyComboInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

const SPECIAL_KEYS = new Set([
  "Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);
const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift"]);

// 모디파이어 조합 또는 특수키만 사람이 읽는 문자열로, 인쇄 문자·단독 모디파이어·IME 조합은 null.
// IME 가드(isComposing/Process)로 한글·일본어·중국어 조합 중 keydown을 제외한다.
export function formatKeyCombo(input: KeyComboInput): string | null {
  if (input.isComposing || input.key === "Process") return null;
  if (MODIFIER_KEYS.has(input.key)) return null;
  if (input.ctrlKey || input.metaKey || input.altKey) {
    const parts: string[] = [];
    if (input.metaKey) parts.push("⌘");
    if (input.ctrlKey) parts.push("Ctrl");
    if (input.altKey) parts.push("Alt");
    if (input.shiftKey) parts.push("Shift");
    parts.push(input.key.length === 1 ? input.key.toUpperCase() : input.key);
    return parts.join("+");
  }
  if (SPECIAL_KEYS.has(input.key)) return input.key;
  return null;
}

// precision 우선 — 10보다 sloppy-click 경계 오탐을 더 줄인다(짧은 드래그 일부 손실 감수).
export const DRAG_THRESHOLD_PX = 15;

// 제곱 거리 비교(sqrt 회피). 정확히 threshold면 strict-greater라 false(미초과).
export function exceedsDragThreshold(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  threshold: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return dx * dx + dy * dy > threshold * threshold;
}

// 이벤트 조상 경로/closest에서 뽑은 element id 배열이 확장 자기-UI host(picker·annotation)에
// 걸리는지 판정. capture phase라 콘텐츠 측 stopPropagation으로 못 막으므로 host 제외가 유일 해법.
export function matchesOwnHost(
  elementIds: readonly string[],
  hostIds: readonly string[],
): boolean {
  return elementIds.some((id) => hostIds.includes(id));
}

export function buildLightSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const cls =
    typeof el.className === "string" && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
  if (cls) return `${tag}${cls}`;
  const parent = el.parentElement;
  if (!parent) return tag;
  const idx = Array.prototype.indexOf.call(parent.children, el) + 1;
  return `${tag}:nth-child(${idx})`;
}

function cleanText(el: Element | null): string | undefined {
  return el?.textContent?.replace(/\s+/g, " ").trim() || undefined;
}

// 마스킹 판정용 라벨 수집 — label[for]·암묵 라벨(래핑)·aria-labelledby 전부.
export function labelForText(el: Element): string | undefined {
  if (el.id) {
    const forLabel = cleanText(document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
    if (forLabel) return forLabel;
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    // 공백 구분 다중 ID가 정상 문법이다 — 통째로 넘기면 항상 null이고, 그러면
    // shouldMaskField의 라벨 근거가 사라져 민감 필드가 원문으로 로그에 실린다.
    const ref = labelledBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => cleanText(document.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (ref) return ref;
  }
  return cleanText(el.closest("label"));
}
