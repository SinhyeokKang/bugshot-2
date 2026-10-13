import { describe, it, expect } from "vitest";

import type { EditorPhase } from "@/store/editor-store";
import { isMainTabLocked } from "../mainTabLock";

describe("isMainTabLocked", () => {
  it("녹화 중엔 debug 밖의 메인 탭을 잠근다", () => {
    for (const tab of ["issue-list", "integrations", "settings"]) {
      expect(isMainTabLocked(tab, "recording")).toBe(true);
    }
  });

  it("녹화 중에도 debug 탭은 잠그지 않는다", () => {
    expect(isMainTabLocked("debug", "recording")).toBe(false);
  });

  it("녹화가 아닌 phase에선 어떤 탭도 잠그지 않는다", () => {
    const phases: EditorPhase[] = ["idle", "picking", "styling", "capturing", "drafting", "previewing", "done"];
    for (const phase of phases) {
      for (const tab of ["debug", "issue-list", "integrations", "settings"]) {
        expect(isMainTabLocked(tab, phase)).toBe(false);
      }
    }
  });

  it("알 수 없는 탭 값도 녹화 중엔 잠근다", () => {
    expect(isMainTabLocked("unknown", "recording")).toBe(true);
  });
});
