import { describe, it, expect } from "vitest";
import {
  splitTemplate,
  resolveClickTarget,
  resolveActionNode,
  navVerbKey,
  NAV_VERB_KEYS,
} from "../actionInline";

describe("splitTemplate", () => {
  it("다중 슬롯 템플릿을 text/slot 토큰으로 분할한다", () => {
    expect(splitTemplate("Entered {value} in {field}")).toEqual([
      { type: "text", value: "Entered " },
      { type: "slot", name: "value" },
      { type: "text", value: " in " },
      { type: "slot", name: "field" },
    ]);
  });

  it("선행 슬롯 + 뒤따르는 텍스트를 처리한다", () => {
    expect(splitTemplate("{target} 클릭")).toEqual([
      { type: "slot", name: "target" },
      { type: "text", value: " 클릭" },
    ]);
  });

  it("슬롯이 없으면 text 1토큰만 반환한다", () => {
    expect(splitTemplate("Recording started")).toEqual([
      { type: "text", value: "Recording started" },
    ]);
  });

  it("연속 슬롯 사이에 빈 문자열 토큰을 남기지 않는다", () => {
    expect(splitTemplate("{a}{b}")).toEqual([
      { type: "slot", name: "a" },
      { type: "slot", name: "b" },
    ]);
  });

  it("슬롯명에 밑줄·숫자가 있어도 슬롯으로 인식한다", () => {
    expect(splitTemplate("{key_1} {x2}")).toEqual([
      { type: "slot", name: "key_1" },
      { type: "text", value: " " },
      { type: "slot", name: "x2" },
    ]);
  });

  it("빈 문자열은 빈 토큰 배열을 반환한다", () => {
    expect(splitTemplate("")).toEqual([]);
  });
});

describe("resolveClickTarget", () => {
  it("target이 있으면 name 모드", () => {
    expect(resolveClickTarget({ target: "Save" })).toEqual({
      mode: "name",
      name: "Save",
    });
  });

  it("빈 target은 name으로 빠지지 않고 폴백한다", () => {
    expect(resolveClickTarget({ target: "" })).toEqual({ mode: "empty" });
  });

  it("공백뿐인 target도 폴백한다", () => {
    expect(resolveClickTarget({ target: "   " })).toEqual({ mode: "empty" });
  });

  it("target 없고 tagName + tagType이면 tag 모드(type 포함)", () => {
    expect(
      resolveClickTarget({ tagName: "button", tagType: "submit" }),
    ).toEqual({ mode: "tag", tagName: "button", tagType: "submit" });
  });

  it("tagType 없는 tagName이면 tag 모드(type 없음)", () => {
    expect(resolveClickTarget({ tagName: "div" })).toEqual({
      mode: "tag",
      tagName: "div",
    });
  });

  it("target·tagName 없고 selector만 있으면 name 모드(레거시 폴백)", () => {
    expect(resolveClickTarget({ selector: "div.foo" })).toEqual({
      mode: "name",
      name: "div.foo",
    });
  });

  it("아무 필드도 없으면 empty 모드", () => {
    expect(resolveClickTarget({})).toEqual({ mode: "empty" });
  });

  it("target 우선순위가 tagName보다 높다", () => {
    expect(
      resolveClickTarget({ target: "Save", tagName: "button" }),
    ).toEqual({ mode: "name", name: "Save" });
  });
});

// resolveClickTarget을 ActionNode 슬롯(drag source/target)에서 재사용하기 위한 미러.
// 우선순위: name → tag(tagName/tagType) → selector(name 모드 폴백) → empty.
describe("resolveActionNode", () => {
  it("name이 있으면 name 모드", () => {
    expect(resolveActionNode({ name: "카드" })).toEqual({
      mode: "name",
      name: "카드",
    });
  });

  it("공백뿐인 name은 폴백한다", () => {
    expect(resolveActionNode({ name: "   " })).toEqual({ mode: "empty" });
  });

  it("name 없고 tagName + tagType이면 tag 모드(type 포함)", () => {
    expect(
      resolveActionNode({ tagName: "input", tagType: "checkbox" }),
    ).toEqual({ mode: "tag", tagName: "input", tagType: "checkbox" });
  });

  it("tagType 없는 tagName이면 tag 모드(type 없음)", () => {
    expect(resolveActionNode({ tagName: "div" })).toEqual({
      mode: "tag",
      tagName: "div",
    });
  });

  it("name·tagName 없고 selector만 있으면 name 모드(레거시 폴백)", () => {
    expect(resolveActionNode({ selector: "div.card" })).toEqual({
      mode: "name",
      name: "div.card",
    });
  });

  it("아무 필드도 없으면 empty 모드", () => {
    expect(resolveActionNode({})).toEqual({ mode: "empty" });
  });

  it("name 우선순위가 tagName보다 높다", () => {
    expect(resolveActionNode({ name: "카드", tagName: "div" })).toEqual({
      mode: "name",
      name: "카드",
    });
  });

  it("role 필드는 해석에 영향 없다", () => {
    expect(resolveActionNode({ role: "button", tagName: "div" })).toEqual({
      mode: "tag",
      tagName: "div",
    });
  });
});

// navigation 항목의 i18n 동사 키. 목록(ActionLogContent)과 타임라인(markers.ts)이 이걸 공유해야
// 문구가 갈라지지 않는다. navType 축엔 exhaustive 검사가 저장소에 0건이라 렌더 분기 누락을
// 컴파일러가 못 잡는다 — 아래 폴백 케이스가 유일한 그물이다.
describe("navVerbKey", () => {
  it("back은 전용 키", () => {
    expect(navVerbKey("back")).toBe("actionLog.verb.navigateBack");
  });

  it("forward는 전용 키", () => {
    expect(navVerbKey("forward")).toBe("actionLog.verb.navigateForward");
  });

  it("reload는 전용 키", () => {
    expect(navVerbKey("reload")).toBe("actionLog.verb.navigateReload");
  });

  it("traverse는 전용 키", () => {
    expect(navVerbKey("traverse")).toBe("actionLog.verb.navigateTraverse");
  });

  // 구 로그(IndexedDB에 저장된 초안)가 raw 키·빈 문구로 뜨지 않아야 한다.
  it("구 값 5종은 전부 기존 navigate 키로 폴백", () => {
    for (const legacy of ["load", "pushState", "replaceState", "popstate", "hashchange"] as const) {
      expect(navVerbKey(legacy)).toBe("actionLog.verb.navigate");
    }
  });

  it("navType이 없으면 기존 navigate 키로 폴백", () => {
    expect(navVerbKey(undefined)).toBe("actionLog.verb.navigate");
  });
});

// 동적 키는 log-viewer의 리터럴 스캐너를 우회하고, 값 drift 검사도 복제 사전에 키가 아예 없으면
// 통과한다. 닫힌 집합 상수가 그 구멍을 막는 유일한 장치라 집합 자체를 고정한다.
describe("NAV_VERB_KEYS", () => {
  it("navVerbKey가 반환할 수 있는 키를 전부 담는다", () => {
    const reachable = new Set(
      (["back", "forward", "reload", "traverse", "load", "pushState", "replaceState", "popstate", "hashchange", undefined] as const)
        .map((v) => navVerbKey(v)),
    );
    for (const key of reachable) expect(NAV_VERB_KEYS).toContain(key);
  });

  it("도달 불가능한 키를 담지 않는다", () => {
    const reachable = new Set(
      (["back", "forward", "reload", "traverse", "load", undefined] as const).map((v) => navVerbKey(v)),
    );
    for (const key of NAV_VERB_KEYS) expect(reachable).toContain(key);
  });
});
