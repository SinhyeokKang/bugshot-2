// action-recorder.ts에서 IIFE 자가호출하기 때문에 테스트가 필요한 순수 함수는 별도 파일로 분리.

const SENSITIVE_NAME_RE = /password|secret|card|cvv|ssn|token|pwd|auth|pin/;
const TARGET_NAME_CAP = 80;

export interface MaskFieldInput {
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  ariaLabel?: string;
}

export function shouldMaskField(input: MaskFieldInput): boolean {
  if (input.type?.toLowerCase() === "password") return true;
  const ac = input.autocomplete?.toLowerCase() ?? "";
  if (ac.includes("password") || ac.includes("cc-")) return true;
  // contentEditable은 type=password 신호가 없어 aria-label까지 키워드 검사에 포함.
  const name = `${input.name ?? ""} ${input.id ?? ""} ${input.ariaLabel ?? ""}`.toLowerCase();
  return SENSITIVE_NAME_RE.test(name);
}

export function maskValue(_value: string): string {
  return "***";
}

// 접근가능한 이름을 trim·길이 cap. 역할(button/link 등)은 ActionEntry.role로 따로 들고
// 렌더 레이어(i18n)에서 로케일에 맞춰 조립한다.
export function truncateName(name: string | null | undefined): string | undefined {
  const n = name?.trim();
  if (!n) return undefined;
  return n.length > TARGET_NAME_CAP ? `${n.slice(0, TARGET_NAME_CAP)}…` : n;
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
