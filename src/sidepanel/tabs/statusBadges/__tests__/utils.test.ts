import { describe, it, expect } from "vitest";
import { BgError } from "@/types/messages";
import { classifyBadgeError } from "../utils";

describe("classifyBadgeError", () => {
  it("returns 'deleted' for BgError with status 404", () => {
    expect(classifyBadgeError(new BgError("Not found", 404))).toBe("deleted");
  });

  it("returns 'deleted' for BgError with status 410 (Gone)", () => {
    expect(classifyBadgeError(new BgError("This issue was deleted", 410))).toBe("deleted");
  });

  it("returns 'error' for BgError with non-404/410 status", () => {
    expect(classifyBadgeError(new BgError("Forbidden", 403))).toBe("error");
    expect(classifyBadgeError(new BgError("Server error", 500))).toBe("error");
    expect(classifyBadgeError(new BgError("Unauthorized", 401))).toBe("error");
  });

  it("returns 'error' for BgError without status", () => {
    expect(classifyBadgeError(new BgError("Unknown"))).toBe("error");
  });

  it("returns 'error' for non-BgError", () => {
    expect(classifyBadgeError(new Error("network failure"))).toBe("error");
    expect(classifyBadgeError("string error")).toBe("error");
    expect(classifyBadgeError(null)).toBe("error");
  });
});
