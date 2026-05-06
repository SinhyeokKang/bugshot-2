import { describe, expect, it } from "vitest";
import type {
  LinearLastSubmitFields,
  NormalizedSubmitResult,
} from "../platform";

describe("NormalizedSubmitResult", () => {
  it("key와 url 필드를 가진다", () => {
    const result: NormalizedSubmitResult = { key: "#42", url: "https://example.com" };
    expect(result.key).toBe("#42");
    expect(result.url).toBe("https://example.com");
  });
});

describe("LinearLastSubmitFields", () => {
  it("teamKey 필드를 가진다", () => {
    const fields: LinearLastSubmitFields = { teamId: "t1", teamKey: "TA" };
    expect(fields.teamKey).toBe("TA");
  });

  it("labelName 필드를 가진다", () => {
    const fields: LinearLastSubmitFields = { labelId: "l1", labelName: "Bug" };
    expect(fields.labelName).toBe("Bug");
  });

  it("모든 필드가 optional", () => {
    const empty: LinearLastSubmitFields = {};
    expect(Object.keys(empty)).toHaveLength(0);
  });
});
