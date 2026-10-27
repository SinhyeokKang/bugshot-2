import { expect, it } from "vitest";
import { elementShotBudget, serializedBytes, elementShotMessageBytes } from "../elementShotBudget";
it("accounts for other session keys, UTF-8 serialization and the replacement key", () => {
  expect(serializedBytes("한")).toBe(5);
  const bytes = serializedBytes({ x: "a" }) + 1;
  expect(elementShotBudget({ snapshot: { x: "a" }, key: "k", quotaBytes: bytes + 50, otherBytes: 50, images: [] }).ok).toBe(true);
  expect(elementShotBudget({ snapshot: { x: "a" }, key: "k", quotaBytes: bytes + 49, otherBytes: 50, images: [] }).ok).toBe(false);
});
it("fails closed on unknown usage and counts logs HTML embedding", () => {
  expect(elementShotBudget({ snapshot: {}, key: "k", quotaBytes: 100, otherBytes: null, images: [] }).ok).toBe(false);
  expect(elementShotMessageBytes(["data:image/webp;base64,AAAA"])).toBeGreaterThan(4 * 2);
  expect(elementShotBudget({ snapshot: {}, key: "k", quotaBytes: 100, otherBytes: 0, images: ["x".repeat(100)], messageLimit: 100 }).ok).toBe(false);
});
