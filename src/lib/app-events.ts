import type { PlatformId } from "@/types/platform";

export interface AppEvent<A extends unknown[] = []> {
  subscribe(fn: (...args: A) => void): () => void;
  fire(...args: A): void;
}

export function createEmitter<A extends unknown[] = []>(): AppEvent<A> {
  const listeners = new Set<(...args: A) => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    fire(...args) {
      listeners.forEach((fn) => fn(...args));
    },
  };
}

export const onOAuthExpired = createEmitter<[platform: PlatformId | null]>();

export const onPickerUnavailable = createEmitter();

// 페이지 이동으로 activeTab grant가 만료돼 캡처가 불가한 상태. 다이얼로그가 패널 재실행을 안내한다.
export const onPickerPermissionExpired = createEmitter();

export const onPickerIframeUnsupported = createEmitter();

export const onBlobSaveFailed = createEmitter();

// 레코드 본체(chrome.storage.local) 저장 실패. blob 실패에는 onBlobSaveFailed가 있는데
// 레코드엔 알림 채널이 없어, confirmDraft가 true를 반환하며 "초안 저장됨"만 뜨고 레코드는
// 없는 상태가 조용히 만들어졌다. rethrow는 zustand persist 경로에 unhandled rejection을
// 낳으므로 blob 쪽과 대칭인 이벤트로 올린다.
export const onStateSaveFailed = createEmitter();

export const onSessionSaveExhausted = createEmitter();
