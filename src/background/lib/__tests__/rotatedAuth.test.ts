import { expect, it } from "vitest";
import { pickRotatedAuth } from "../rotatedAuth";
const start = { kind: "oauth", grantId: "g", viewerGid: "1", accessToken: "a", refreshToken: "r" };
it("reuses nonrotating refresh token providers by access-token rotation", () => {
  const rotated = { ...start, accessToken: "b" };
  expect(pickRotatedAuth("asana", start, rotated)).toBe(rotated);
});
it("never reuses another grant, identity, or unverifiable legacy token", () => {
  expect(pickRotatedAuth("asana", start, { ...start, grantId: "new", accessToken: "b" })).toBeNull();
  expect(pickRotatedAuth("asana", start, { ...start, viewerGid: "2", accessToken: "b" })).toBeNull();
  expect(pickRotatedAuth("asana", { ...start, grantId: undefined }, { ...start, grantId: undefined, accessToken: "b" })).toBeNull();
  expect(pickRotatedAuth("asana", start, null)).toBeNull();
  expect(pickRotatedAuth("asana", start, start)).toBeNull();
});
