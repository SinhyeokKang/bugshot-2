// action-recorder.ts에서 IIFE 자가호출하기 때문에 테스트가 필요한 순수 함수는 별도 파일로 분리.

// 영문은 단어 경계로 끊는다 — placeholder·라벨 문구가 판정 소스라 부분일치는 정상 폼을 죽인다
// (pin ⊂ shipping, auth ⊂ author, card ⊂ discard). 한글은 \b가 안 먹어 부분일치 유지(안전 측).
const SENSITIVE_NAME_RE =
  /\b(password|secret|card|cvv|ssn|token|pwd|auth|pin)\b|비밀번호|암호|주민|카드|계좌|전화|연락처|휴대폰|주소/;
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
  if (ac.includes("password") || ac.includes("cc-")) return true;
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
