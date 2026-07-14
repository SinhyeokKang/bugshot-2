import { describe, it, expect } from "vitest";
import {
  shouldMaskField,
  isSensitiveValue,
  maskValue,
  truncateName,
  entryNavOnBind,
  formatKeyCombo,
  exceedsDragThreshold,
  matchesOwnHost,
  DRAG_THRESHOLD_PX,
  type KeyComboInput,
} from "../action-recorder-helpers";

// 모든 boolean 필드가 required라 테스트 가독성을 위해 false 기본값을 채우는 팩토리.
function combo(p: Partial<KeyComboInput> & { key: string }): KeyComboInput {
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...p,
  };
}

describe("shouldMaskField", () => {
  it("type=password면 마스킹", () => {
    expect(shouldMaskField({ type: "password" })).toBe(true);
  });

  it("일반 텍스트 username은 마스킹 안 함", () => {
    expect(shouldMaskField({ type: "text", name: "username" })).toBe(false);
  });

  it("민감 name/id는 마스킹 (cardNumber·cvv·user_ssn)", () => {
    expect(shouldMaskField({ name: "cardNumber" })).toBe(true);
    expect(shouldMaskField({ id: "cvv" })).toBe(true);
    expect(shouldMaskField({ name: "user_ssn" })).toBe(true);
  });

  it("autocomplete 힌트로 마스킹 (current-password·cc-number)", () => {
    expect(shouldMaskField({ autocomplete: "current-password" })).toBe(true);
    expect(shouldMaskField({ autocomplete: "cc-number" })).toBe(true);
  });

  it("aria-label의 민감 키워드로 마스킹 (contentEditable 사각지대 보강)", () => {
    expect(shouldMaskField({ ariaLabel: "Card number" })).toBe(true);
    expect(shouldMaskField({ ariaLabel: "CVV" })).toBe(true);
    expect(shouldMaskField({ ariaLabel: "Full name" })).toBe(false);
  });

  it("힌트 전무하면 마스킹 안 함", () => {
    expect(shouldMaskField({})).toBe(false);
  });
});

// 라벨 판정 확대: fieldLabel()이 이미 읽는 label[for] 텍스트·placeholder가 마스킹 판정엔
// 안 들어가 <label for>Card number</label> 같은 흔한 폼이 그대로 새어나갔다.
describe("shouldMaskField — 라벨 소스 확대", () => {
  it("label[for] 텍스트의 민감 키워드로 마스킹", () => {
    expect(shouldMaskField({ id: "f1", labelText: "Card number" })).toBe(true);
    expect(shouldMaskField({ id: "f1", labelText: "Nickname" })).toBe(false);
  });

  it("placeholder의 민감 키워드로 마스킹", () => {
    expect(shouldMaskField({ placeholder: "CVV" })).toBe(true);
    expect(shouldMaskField({ placeholder: "Search products" })).toBe(false);
  });
});

// 정규식이 영문 전용이라 한국어 라벨 폼이 전부 미탐이었다.
describe("shouldMaskField — 한국어 라벨", () => {
  it("한국어 민감 키워드로 마스킹", () => {
    expect(shouldMaskField({ ariaLabel: "비밀번호" })).toBe(true);
    expect(shouldMaskField({ labelText: "주민등록번호" })).toBe(true);
    expect(shouldMaskField({ labelText: "카드 번호" })).toBe(true);
    expect(shouldMaskField({ labelText: "계좌번호" })).toBe(true);
    expect(shouldMaskField({ placeholder: "전화번호" })).toBe(true);
    expect(shouldMaskField({ labelText: "주소" })).toBe(true);
  });

  it("비민감 한국어 라벨은 원문 유지", () => {
    expect(shouldMaskField({ labelText: "수량" })).toBe(false);
    expect(shouldMaskField({ labelText: "검색어" })).toBe(false);
  });
});

// placeholder·labelText를 판정에 합류시키면서 부분일치 오탐이 커졌다 —
// 사람이 읽는 문구가 판정 소스가 되므로 단어 경계로 끊어야 정상 폼이 안 죽는다.
describe("shouldMaskField — 부분일치 오탐 방지", () => {
  it("민감 키워드를 부분 문자열로 포함하는 일반 라벨은 마스킹 안 함", () => {
    expect(shouldMaskField({ placeholder: "Shipping address" })).toBe(false); // pin ⊂ shipping
    expect(shouldMaskField({ placeholder: "Search by author" })).toBe(false); // auth ⊂ author
    expect(shouldMaskField({ labelText: "Discard draft" })).toBe(false); // card ⊂ discard
  });

  it("camelCase·snake_case 경계에서는 여전히 마스킹", () => {
    expect(shouldMaskField({ name: "cardNumber" })).toBe(true);
    expect(shouldMaskField({ name: "user_ssn" })).toBe(true);
    expect(shouldMaskField({ id: "card-number" })).toBe(true);
  });
});

// 라벨 기반 판정의 구조적 한계(생성된 id `:r3:`, 커스텀 폼, 라벨 없는 입력)를 값 자체로 보완.
describe("isSensitiveValue", () => {
  it("이메일 형태는 민감", () => {
    expect(isSensitiveValue("hong@example.com")).toBe(true);
    expect(isSensitiveValue("a.b+c@sub.domain.co.kr")).toBe(true);
  });

  it("전화번호·카드번호·주민번호 등 9자리 이상 숫자열은 민감 (구분자 무시)", () => {
    expect(isSensitiveValue("010-1234-5678")).toBe(true);
    expect(isSensitiveValue("4111 1111 1111 1111")).toBe(true);
    expect(isSensitiveValue("900101-1234567")).toBe(true);
    expect(isSensitiveValue("+82 10 1234 5678")).toBe(true);
  });

  it("짧은 숫자·일반 텍스트는 원문 유지 (재현 가치 보존)", () => {
    expect(isSensitiveValue("-1")).toBe(false);
    expect(isSensitiveValue("42")).toBe(false);
    expect(isSensitiveValue("12345678")).toBe(false);
    expect(isSensitiveValue("검색어")).toBe(false);
    expect(isSensitiveValue("hello world")).toBe(false);
  });

  it("숫자가 섞인 식별자는 원문 유지 (순수 숫자열만 민감)", () => {
    expect(isSensitiveValue("ORD-12345678")).toBe(false);
  });

  it("소수·IP는 원문 유지 — 점은 구분자가 아니다 (재현에 필요한 값)", () => {
    expect(isSensitiveValue("1234.56789")).toBe(false);
    expect(isSensitiveValue("192.168.0.1")).toBe(false);
  });

  it("빈 값은 민감 아님", () => {
    expect(isSensitiveValue("")).toBe(false);
  });
});

describe("maskValue", () => {
  it("임의 값을 *** 로 치환", () => {
    expect(maskValue("hunter2")).toBe("***");
    expect(maskValue("")).toBe("***");
  });
});

describe("truncateName", () => {
  it("이름 trim 후 그대로 반환", () => {
    expect(truncateName("  Submit  ")).toBe("Submit");
  });

  it("빈 이름·null·undefined는 undefined", () => {
    expect(truncateName("")).toBeUndefined();
    expect(truncateName("   ")).toBeUndefined();
    expect(truncateName(null)).toBeUndefined();
    expect(truncateName(undefined)).toBeUndefined();
  });

  it("긴 이름은 cap(80) + 말줄임", () => {
    const out = truncateName("A".repeat(200))!;
    expect(out.length).toBeLessThan(200);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("formatKeyCombo", () => {
  it("모디파이어 조합은 표시 문자열 — 단일 문자 키는 대문자", () => {
    expect(formatKeyCombo(combo({ key: "k", metaKey: true }))).toBe("⌘+K");
  });

  it("Ctrl+Shift 조합 (shift는 단독으론 트리거 아니지만 다른 모디파이어와 함께면 포함)", () => {
    expect(formatKeyCombo(combo({ key: "p", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+P");
  });

  it("모디파이어 표기 순서는 ⌘·Ctrl·Alt·Shift", () => {
    expect(
      formatKeyCombo(combo({ key: "k", metaKey: true, ctrlKey: true, altKey: true, shiftKey: true })),
    ).toBe("⌘+Ctrl+Alt+Shift+K");
  });

  it("모디파이어 없는 특수키는 키 이름 그대로", () => {
    expect(formatKeyCombo(combo({ key: "Enter" }))).toBe("Enter");
    expect(formatKeyCombo(combo({ key: "Escape" }))).toBe("Escape");
    expect(formatKeyCombo(combo({ key: "Tab" }))).toBe("Tab");
    expect(formatKeyCombo(combo({ key: "ArrowDown" }))).toBe("ArrowDown");
  });

  it("모디파이어 없는 인쇄 문자는 null (input과 중복·키스트로크 누출 방지)", () => {
    expect(formatKeyCombo(combo({ key: "a" }))).toBeNull();
  });

  it("단독 Shift는 null (모디파이어 단독 누름은 무시)", () => {
    expect(formatKeyCombo(combo({ key: "Shift", shiftKey: true }))).toBeNull();
  });

  it("IME 조합 중(isComposing)은 null — 한글·일본어·중국어 조합 keydown 제외", () => {
    expect(formatKeyCombo(combo({ key: "Enter", isComposing: true }))).toBeNull();
  });

  it("key가 Process면 null (IME 가드)", () => {
    expect(formatKeyCombo(combo({ key: "Process" }))).toBeNull();
  });
});

describe("exceedsDragThreshold", () => {
  it("기본 임계는 15px (sloppy-click 경계 오탐 완화)", () => {
    expect(DRAG_THRESHOLD_PX).toBe(15);
  });

  it("수평 이동이 임계를 넘으면 true", () => {
    expect(exceedsDragThreshold(0, 0, 20, 0, 15)).toBe(true);
  });

  it("수평 이동이 임계 미만이면 false", () => {
    expect(exceedsDragThreshold(0, 0, 10, 0, 15)).toBe(false);
  });

  it("정확히 임계(15px) 거리는 false — strict-greater(dx²+dy² > t²)", () => {
    expect(exceedsDragThreshold(0, 0, 15, 0, 15)).toBe(false);
  });

  it("대각선 합성 거리로 임계 초과 판정 (11,11 → √242 > 15)", () => {
    expect(exceedsDragThreshold(0, 0, 11, 11, 15)).toBe(true);
  });

  it("대각선이라도 합성 거리가 임계 미만이면 false (10,10 → √200 < 15)", () => {
    expect(exceedsDragThreshold(0, 0, 10, 10, 15)).toBe(false);
  });

  it("음수 델타(역방향 이동)도 거리는 절댓값이라 true", () => {
    expect(exceedsDragThreshold(20, 20, 0, 0, 15)).toBe(true);
  });

  it("이동 없음(같은 좌표)은 false", () => {
    expect(exceedsDragThreshold(5, 5, 5, 5, 15)).toBe(false);
  });
});

describe("entryNavOnBind", () => {
  it("최초 bind면 referrer→현재 URL 진입 네비게이션을 반환", () => {
    expect(
      entryNavOnBind(false, "https://app.com/login", "https://app.com/login", "https://idp.com/authorize"),
    ).toEqual({ fromUrl: "https://app.com/login", toUrl: "https://idp.com/authorize" });
  });

  it("referrer가 비면 lastUrl로 fallback (cross-origin referrer 정책으로 referrer 소실 대비)", () => {
    expect(
      entryNavOnBind(false, "", "https://idp.com/authorize", "https://app.com/callback"),
    ).toEqual({ fromUrl: "https://idp.com/authorize", toUrl: "https://app.com/callback" });
  });

  it("이미 emit했으면 null — 같은 페이지 재bind(setSentinel 재호출) 시 중복 방지", () => {
    expect(
      entryNavOnBind(true, "https://app.com", "https://app.com", "https://idp.com"),
    ).toBeNull();
  });
});

describe("matchesOwnHost", () => {
  const PICKER = "__bugshot_picker_host";
  const ANNOTATION = "__bugshot_annotation_host";

  it("picker host id가 조상 경로에 있으면 true", () => {
    expect(matchesOwnHost(["something", PICKER], [PICKER, ANNOTATION])).toBe(true);
  });

  it("annotation host id가 조상 경로에 있으면 true (펜 드래그 오염 방지)", () => {
    expect(matchesOwnHost([ANNOTATION], [PICKER, ANNOTATION])).toBe(true);
  });

  it("두 host id가 모두 있어도 true", () => {
    expect(matchesOwnHost([PICKER, ANNOTATION], [PICKER, ANNOTATION])).toBe(true);
  });

  it("어느 host와도 매칭 안 되면 false — 일반 페이지 요소는 로깅 대상", () => {
    expect(matchesOwnHost(["app-root", "my-button"], [PICKER, ANNOTATION])).toBe(false);
  });

  it("elementIds가 비면 false", () => {
    expect(matchesOwnHost([], [PICKER, ANNOTATION])).toBe(false);
  });

  it("hostIds가 비면 항상 false", () => {
    expect(matchesOwnHost([PICKER, ANNOTATION], [])).toBe(false);
  });
});
