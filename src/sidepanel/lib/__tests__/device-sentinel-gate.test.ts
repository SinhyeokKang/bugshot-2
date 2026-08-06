import { describe, expect, it } from "vitest";
import { resolveSentinelTargets } from "../device-sentinel-gate";

// sentinel을 발행하는 경로가 셋이고 전부 서브트리를 모른다. 호출 트리거를 하나씩 막으면
// 새 트리거가 생길 때마다 새므로 발행 지점 하나로 좁혀 여기에 게이트를 건다.
// 모드 판정은 캐시가 아니라 deviceTree.length > 0이다.
describe("resolveSentinelTargets — 모드 OFF (기존 경로 무변경)", () => {
  it("scope=all이면 broadcast로 떨어진다", () => {
    expect(resolveSentinelTargets({ deviceTree: [], scope: { kind: "all" } })).toEqual({
      kind: "broadcast",
    });
  });

  it("scope=frame이면 그 frameId 지정 송신으로 떨어진다", () => {
    expect(
      resolveSentinelTargets({
        deviceTree: [],
        scope: { kind: "frame", frameId: 3, documentId: "ad" },
      }),
    ).toEqual({ kind: "frame", frameId: 3 });
  });
});

describe("resolveSentinelTargets — 문서 열거 실패", () => {
  it("scope와 무관하게 fail-closed로 발행하지 않는다", () => {
    expect(resolveSentinelTargets({ deviceTree: null, scope: { kind: "all" } })).toEqual({
      kind: "none",
    });
    expect(
      resolveSentinelTargets({
        deviceTree: null,
        scope: { kind: "frame", frameId: 3, documentId: "ad" },
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("resolveSentinelTargets — 모드 ON", () => {
  const deviceTree = ["wrap", "wrapChild"];

  // 이 항목이 게이트의 존재 이유다. useBackgroundRecorder.inject()가 visibilitychange·
  // tabs.onUpdated(complete)·idle 복귀마다 activate 3종을 부르고, 래퍼 iframe 로드가 top 탭
  // status를 complete로 되돌리므로 전환 직후 곧바로 걸린다. 되살아난 top 레코더는 에러 없이
  // 로그만 2벌이 되어 조용하다.
  it("activate 3종(scope=all)이 broadcast가 아니라 deviceTree documentId 지정으로 간다", () => {
    expect(resolveSentinelTargets({ deviceTree, scope: { kind: "all" } })).toEqual({
      kind: "documents",
      documentIds: deviceTree,
    });
  });

  it("래퍼 서브트리 커밋이면 재발행한다 (same-origin 이동 후 start 재전달의 정식 경로)", () => {
    expect(
      resolveSentinelTargets({
        deviceTree,
        scope: { kind: "frame", frameId: 7, documentId: "wrapChild" },
      }),
    ).toEqual({ kind: "frame", frameId: 7 });
  });

  it("래퍼 밖 프레임 커밋에는 발행하지 않는다", () => {
    expect(
      resolveSentinelTargets({
        deviceTree,
        scope: { kind: "frame", frameId: 3, documentId: "ad" },
      }),
    ).toEqual({ kind: "none" });
  });

  it("documentId를 모르는 프레임 커밋은 발행하지 않는다 (fail-closed)", () => {
    expect(
      resolveSentinelTargets({ deviceTree, scope: { kind: "frame", frameId: 3 } }),
    ).toEqual({ kind: "none" });
  });
});
