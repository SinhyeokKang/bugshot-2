import { describe, it, expect } from "vitest";
import {
  pinSelectedFirst,
  orderSelectedFirst,
  type CcUserOption,
} from "../ccOptions";

const opt = (key: string, label = key, extra?: Partial<CcUserOption>): CcUserOption => ({
  key,
  label,
  ...extra,
});

describe("pinSelectedFirst", () => {
  it("selected가 없으면 options 순서 그대로", () => {
    const options = [opt("a"), opt("b"), opt("c")];
    expect(pinSelectedFirst(options, [])).toEqual(options);
  });

  it("선택된 항목을 selected 순서대로 최상단으로 올린다", () => {
    const options = [opt("a"), opt("b"), opt("c"), opt("d")];
    const selected = [opt("c"), opt("a")];
    expect(pinSelectedFirst(options, selected).map((o) => o.key)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("상단에는 options의 리치 데이터(email/avatar)를 쓴다", () => {
    const rich = opt("a", "Alice", { email: "a@x.com", avatarUrl: "u" });
    const options = [opt("b"), rich];
    const selected = [opt("a", "Alice")]; // 저장값은 name만
    const [first] = pinSelectedFirst(options, selected);
    expect(first).toEqual(rich);
  });

  it("검색 결과에 없는 선택 항목도 selected 항목으로 상단에 노출 (제거 가능 보장)", () => {
    const options = [opt("b"), opt("c")];
    const selected = [opt("a", "Alice")];
    const result = pinSelectedFirst(options, selected);
    expect(result.map((o) => o.key)).toEqual(["a", "b", "c"]);
    expect(result[0].label).toBe("Alice");
  });

  it("선택 항목을 하단 목록에서 중복 제거한다", () => {
    const options = [opt("a"), opt("b")];
    const selected = [opt("a")];
    const result = pinSelectedFirst(options, selected);
    expect(result.map((o) => o.key)).toEqual(["a", "b"]);
  });

  it("미선택 항목의 원래 순서를 보존한다", () => {
    const options = [opt("a"), opt("b"), opt("c"), opt("d")];
    const selected = [opt("b")];
    expect(pinSelectedFirst(options, selected).map((o) => o.key)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });
});

describe("orderSelectedFirst", () => {
  const item = (id: string) => ({ id });
  const isSel = (keys: string[]) => (it: { id: string }) => keys.includes(it.id);

  it("선택 없으면 원본 배열 그대로", () => {
    const items = [item("a"), item("b")];
    expect(orderSelectedFirst(items, isSel([]))).toBe(items);
  });

  it("선택 항목을 상단으로 올리고 나머지 순서 보존", () => {
    const items = [item("a"), item("b"), item("c")];
    expect(orderSelectedFirst(items, isSel(["c"])).map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("복수 선택은 원래 순서대로 앞에 모은다", () => {
    const items = [item("a"), item("b"), item("c"), item("d")];
    expect(
      orderSelectedFirst(items, isSel(["b", "d"])).map((i) => i.id),
    ).toEqual(["b", "d", "a", "c"]);
  });
});
