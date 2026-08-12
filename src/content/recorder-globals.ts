// MAIN world 레코더는 페이지와 같은 realm에서 돌기 때문에, 호출 시점의 전역을 쓰면 페이지가
// 그것을 갈아끼워 마스킹을 무력화하거나(JSON.parse를 throw로) sentinel 문자열을 관측할 수 있다
// (document.addEventListener 후킹). document_start에 내장을 스냅샷해 그것만 쓴다.
//
// recorders-entry 청크에 인라인되므로 src/content/ 밖 런타임 import를 두면 안 된다
// (CLAUDE.md "pre-arm 버퍼링 (동기 IIFE 빌드 제약)").

export const jsonParse = JSON.parse;
export const jsonStringify = JSON.stringify;
export const URLSearchParamsCtor = URLSearchParams;
export const CustomEventCtor = CustomEvent;

// 인스턴스 속성으로 덮인 document.addEventListener도 우회하도록 prototype에서 뗀다.
const rawAddEventListener = EventTarget.prototype.addEventListener;
const rawRemoveEventListener = EventTarget.prototype.removeEventListener;
const rawDispatchEvent = EventTarget.prototype.dispatchEvent;

export function addEventListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  rawAddEventListener.call(target, type, listener, options);
}

export function removeEventListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | EventListenerOptions,
): void {
  rawRemoveEventListener.call(target, type, listener, options);
}

export function dispatchEvent(target: EventTarget, event: Event): boolean {
  return rawDispatchEvent.call(target, event);
}
