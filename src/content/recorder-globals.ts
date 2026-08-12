// MAIN world 레코더는 페이지와 같은 realm에서 돌기 때문에, 호출 시점의 전역을 쓰면 페이지가
// 그것을 갈아끼워 마스킹을 무력화하거나(JSON.parse를 throw로 → catch 폴백이 원문 통과) 우리
// 리스너 등록·발화를 가로채고 억제할 수 있다(document.addEventListener 후킹).
// document_start에 내장을 스냅샷해 그것만 쓴다.
//
// **sentinel 은닉이 목적이 아니다** — 브리지가 setSentinel을 평문 detail로 dispatch하므로
// 페이지는 고정 이름 리스너 하나로 진짜 UUID를 읽는다(sentinel-registry.ts 헤더 참조).
//
// recorders-entry 청크에 인라인되므로 src/content/ 밖 런타임 import를 두면 안 된다
// (CLAUDE.md "pre-arm 버퍼링 (동기 IIFE 빌드 제약)").

// 마스킹 경로는 파싱·순회·직렬화를 다 떠야 한다 — 하나라도 ambient로 남으면 페이지가 그걸
// throw로 바꿔 catch 폴백을 태우고 원문을 통과시킨다. 다만 이건 전역 **교체**까지만 막고
// prototype 메서드 재정의는 못 막는다.
export const jsonParse = JSON.parse;
export const jsonStringify = JSON.stringify;
export const objectEntries = Object.entries;
export const isArray = Array.isArray;
export const URLCtor = URL;
export const URLSearchParamsCtor = URLSearchParams;
export const CustomEventCtor = CustomEvent;

// 엔트리 id가 페이지 손에 들어가면 사이드패널 log-merge의 id dedup이 전체 로그를 1건으로 접는다.
// crypto 객체만 잡으면 `crypto.randomUUID = () => "x"` 속성 재정의가 그대로 통하므로 함수를 뗀다.
export const randomUUID: (() => string) | undefined =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID.bind(crypto)
    : undefined;

// 네비게이션 유형 판정이 읽는 두 전역. 페이지가 나중에 덮어써도 레코더는 원본을 본다.
// 하나만 스냅샷하면 위협모델이 비대칭이 된다.
// lib.dom에 Navigation API 타입이 없다 — `declare var navigation`도 없어 `typeof navigation`
// 형태는 컴파일되지 않으므로 globalThis 캐스팅 + 히스토리 인덱스만 읽는 최소 구조적 타입으로 받는다.
interface NavigationLike {
  currentEntry?: { index?: number };
}
export const navigationRef: NavigationLike | undefined = (
  globalThis as unknown as { navigation?: NavigationLike }
).navigation;
export const performanceRef: Performance | undefined =
  typeof performance !== "undefined" ? performance : undefined;

// 인스턴스 속성으로 덮인 document.addEventListener도 우회하도록 prototype에서 뗀다.
const rawAddEventListener = EventTarget.prototype.addEventListener;
const rawRemoveEventListener = EventTarget.prototype.removeEventListener;
const rawDispatchEvent = EventTarget.prototype.dispatchEvent;

// 제네릭 기본값으로 호출부의 `as MouseEvent` 류 단언을 없앤다(E는 핸들러 어노테이션에서 추론되므로
// 타입 안전도는 단언과 동등 — 가독성 목적이다).
export function addEventListener<E extends Event = Event>(
  target: EventTarget,
  type: string,
  listener: (ev: E) => void,
  options?: boolean | AddEventListenerOptions,
): void {
  rawAddEventListener.call(target, type, listener as EventListener, options);
}

export function removeEventListener<E extends Event = Event>(
  target: EventTarget,
  type: string,
  listener: (ev: E) => void,
  options?: boolean | EventListenerOptions,
): void {
  rawRemoveEventListener.call(target, type, listener as EventListener, options);
}

export function dispatchEvent(target: EventTarget, event: Event): boolean {
  return rawDispatchEvent.call(target, event);
}
