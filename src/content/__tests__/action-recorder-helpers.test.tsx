import { afterEach, describe, expect, it } from "vitest";

import { labelForText, shouldMaskField } from "../action-recorder-helpers";

// labelForText는 document.getElementById·CSS.escape·closest를 쓰므로 node 트랙
// (action-recorder-helpers.test.ts)에선 못 돈다 — jsdom 트랙 별 파일.

afterEach(() => {
  document.body.replaceChildren();
});

function mount(html: string): HTMLInputElement {
  document.body.innerHTML = html;
  const input = document.body.querySelector("input");
  if (!input) throw new Error("fixture has no input");
  return input;
}

describe("labelForText", () => {
  it("label[for]를 우선 읽는다", () => {
    const input = mount(`
      <label for="field">Card number</label>
      <input id="field" aria-labelledby="hint" />
      <span id="hint">Hint</span>
    `);

    expect(labelForText(input)).toBe("Card number");
  });

  it("aria-labelledby 단일 ID를 읽는다", () => {
    const input = mount(`
      <span id="l1">Card number</span>
      <input aria-labelledby="l1" />
    `);

    expect(labelForText(input)).toBe("Card number");
  });

  it("래핑 label의 텍스트를 읽는다", () => {
    const input = mount(`<label>Card number <input /></label>`);

    expect(labelForText(input)).toBe("Card number");
  });

  it("aria-labelledby 다중 ID를 공백으로 이어 읽는다", () => {
    const input = mount(`
      <span id="l1">Card</span>
      <span id="l2">number</span>
      <input aria-labelledby="l1 l2" />
    `);

    expect(labelForText(input)).toBe("Card number");
  });
});

describe("shouldMaskField × labelForText", () => {
  it("다중 ID로만 라벨이 붙은 민감 필드를 마스킹한다", () => {
    const input = mount(`
      <span id="l1">Card</span>
      <span id="l2">number</span>
      <input aria-labelledby="l1 l2" />
    `);

    expect(shouldMaskField({ labelText: labelForText(input) })).toBe(true);
  });
});
