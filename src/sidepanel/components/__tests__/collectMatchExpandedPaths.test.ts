import { describe, expect, it } from "vitest";
import { collectMatchExpandedPaths } from "../JsonTreeViewer";

// 트리 내부 path 인코딩 계약: SEP="\0", root="root", path = parent + SEP + key.
// 배열 인덱스는 String(i). 반환은 "매칭 노드를 드러내려면 열어야 하는 컨테이너" path 집합.
const SEP = "\0";
const p = (...keys: string[]) => ["root", ...keys].join(SEP);

describe("collectMatchExpandedPaths", () => {
  it("빈 쿼리는 빈 Set", () => {
    expect(collectMatchExpandedPaths({ a: { b: "x" } }, "")).toEqual(new Set());
  });

  it("무매칭이면 빈 Set", () => {
    expect(collectMatchExpandedPaths({ a: { b: "x" } }, "zzz")).toEqual(new Set());
  });

  it("depth 2+ 중첩 객체 값 매칭 시 조상 컨테이너 path를 전부 담는다", () => {
    const data = { user: { profile: { name: "alice" } } };
    expect(collectMatchExpandedPaths(data, "alice")).toEqual(
      new Set([p(), p("user"), p("user", "profile")]),
    );
  });

  it("대소문자를 무시한다", () => {
    const data = { user: { profile: { name: "alice" } } };
    expect(collectMatchExpandedPaths(data, "ALICE")).toEqual(
      new Set([p(), p("user"), p("user", "profile")]),
    );
  });

  it("배열 원소 값 매칭 시 배열 컨테이너 조상을 담는다(인덱스는 String)", () => {
    const data = { items: ["x", "needle"] };
    expect(collectMatchExpandedPaths(data, "needle")).toEqual(
      new Set([p(), p("items")]),
    );
  });

  it("숫자 값도 매칭한다", () => {
    const data = { res: { code: 404 } };
    expect(collectMatchExpandedPaths(data, "404")).toEqual(
      new Set([p(), p("res")]),
    );
  });

  it("컨테이너 키 매칭은 그 컨테이너의 부모까지만 연다(컨테이너 자신은 안 엶)", () => {
    // access_token 키는 컨테이너의 자기 행에 렌더되므로 root만 열면 보인다.
    const data = { access_token: { v: 1 } };
    expect(collectMatchExpandedPaths(data, "token")).toEqual(new Set([p()]));
  });

  it("leaf 키 매칭은 그 leaf를 담은 컨테이너까지 연다", () => {
    const data = { data: { userId: 5 } };
    expect(collectMatchExpandedPaths(data, "userid")).toEqual(
      new Set([p(), p("data")]),
    );
  });

  it("null 값도 'null' 매칭 대상(트리 렌더·raw 검색과 일치)", () => {
    const data = { a: { b: null } };
    expect(collectMatchExpandedPaths(data, "null")).toEqual(
      new Set([p(), p("a")]),
    );
  });
});
