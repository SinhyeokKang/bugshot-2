/**
 * sentinel 발행 경로의 단일 게이트.
 *
 * stop/start를 한 번 맞춰놓는 것만으로는 로그 1벌이 유지되지 않는다 — sentinel을 발행하는
 * 경로가 셋인데 전부 서브트리를 모른다:
 *   ① `activate*Recorder` 3종: `useBackgroundRecorder.inject()`가 visibilitychange·
 *      `tabs.onUpdated(status==="complete")`·idle 복귀마다 부르고, **래퍼 iframe 로드가 top 탭
 *      status를 complete로 되돌리므로 전환 직후가 가장 잘 걸린다.** broadcast면 숨겨진 top이
 *      sentinel을 다시 받아 되살아난다.
 *   ② `rebroadcastSentinelsToFrame`: 커밋된 모든 자식 프레임에 무조건 재발행한다.
 *   ③ 모드 전환 자신.
 *
 * 호출 트리거를 하나씩 막는 방식은 새 트리거가 생길 때마다 샌다. 발행 지점을 하나로 좁혀
 * 여기에 게이트를 건다. 모드 판정은 캐시가 아니라 `deviceTree.length > 0`이다.
 *
 * 되살아난 레코더는 **에러가 아니라 그냥 중복 엔트리**라 조용하다 — 이 게이트를 우회하는
 * 신규 발행 코드가 하나만 생겨도 로그가 2벌이 된다.
 */
export type SentinelTarget =
  | { kind: "broadcast" }
  | { kind: "frame"; frameId: number }
  | { kind: "documents"; documentIds: string[] }
  | { kind: "none" };

export type SentinelScope =
  | { kind: "all" }
  | { kind: "frame"; frameId: number; documentId?: string };

export function resolveSentinelTargets(args: {
  deviceTree: string[] | null;
  scope: SentinelScope;
}): SentinelTarget {
  const { deviceTree, scope } = args;
  if (deviceTree == null) return { kind: "none" };
  const deviceMode = deviceTree.length > 0;

  if (!deviceMode) {
    return scope.kind === "all"
      ? { kind: "broadcast" }
      : { kind: "frame", frameId: scope.frameId };
  }

  if (scope.kind === "all") return { kind: "documents", documentIds: deviceTree };

  // documentId를 모르면 서브트리 소속을 판정할 수 없다 — fail-closed로 발행하지 않는다.
  // 발행 누락은 로그 공백(조용하지만 복구 가능)이고, 오발행은 로그 2벌(무증상)이다.
  if (!scope.documentId || !deviceTree.includes(scope.documentId)) return { kind: "none" };
  return { kind: "frame", frameId: scope.frameId };
}
