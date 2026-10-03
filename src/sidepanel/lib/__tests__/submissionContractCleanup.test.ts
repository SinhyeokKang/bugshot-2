import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? entry.name === "__tests__" || entry.name === "test" ? [] : productionFiles(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}
describe("final submission contracts", () => {
  it("has no boolean degradation flags or obsolete toast producer", () => {
    const matches = productionFiles("src").filter((path) => /logsDropped|mediaDropped|toastSubmitDropped|legacyAttachmentDrops/.test(readFileSync(path, "utf8")));
    expect(matches).toEqual([]);
  });
});
