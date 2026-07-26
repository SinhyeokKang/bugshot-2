import { describe, it, expect } from "vitest";
import { cn } from "../utils";

// text-mono는 커스텀 fontSize 토큰이라 twMerge가 기본 설정에서 text-color로 오분류한다.
// extendTailwindMerge 등록이 풀리면 로그 표면 글꼴 크기가 색 클래스에 먹혀 조용히 사라진다.
describe("cn — text-mono 그룹 등록", () => {
  it("뒤따르는 text-* 색이 text-mono를 지우지 않는다", () => {
    expect(cn("text-mono", "text-red-500")).toBe("text-mono text-red-500");
  });

  it("text-mono와 다른 font-size는 서로 dedupe된다 (뒤가 이긴다)", () => {
    expect(cn("text-xs", "text-mono")).toBe("text-mono");
    expect(cn("text-mono", "text-xs")).toBe("text-xs");
  });

  it("일반 twMerge 동작은 그대로", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("flex", false && "hidden", "items-center")).toBe("flex items-center");
  });
});
