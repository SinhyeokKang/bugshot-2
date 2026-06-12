# 광역 권한 패널 확대 — 기술 설계

## 개요

`deactivatePanelIfCrossOrigin`(`tab-bindings.ts:110–156`)의 cross-origin 분기에 광역 host 권한 체크 하나를 추가한다: 보유 + 새 URL이 지원 스킴이면 **same-origin과 동일 취급**(패널 유지·deferred 없음·stale 세션 정리만), 아니면 현행 분기(보존 → deferred 발신, 비보존 → 패널 닫기) 그대로. 판정 로직은 순수 헬퍼 `resolveNavigationAction`으로 추출해 단위 테스트로 현행 동작을 고정한다. 광역 권한 판정은 `chrome.permissions.contains()`만 사용 — 새 store 상태·요청 UI 없음(30s Replay 옵트인이 부여한 권한 공유). **deferred 경로·만료 다이얼로그·i18n은 일절 건드리지 않는다.**

## 변경 범위

### `src/lib/broad-host-origins.ts` (신규)
- `use-30s-replay.ts:16`의 `REPLAY_ORIGINS = ["https://*/*", "http://*/*"]`를 공용 상수로 추출 — background(`tab-bindings.ts`)에서도 contains 체크에 필요해 sidepanel 모듈 밖으로 옮긴다.

```typescript
export const BROAD_HOST_ORIGINS = ["https://*/*", "http://*/*"];
```

- `use-30s-replay.ts`(내부 contains, 86 부근)·`SettingsTab.tsx`(`handleReplayToggle` 90–104의 95·97)의 `REPLAY_ORIGINS` 참조를 이 상수 import로 교체, `REPLAY_ORIGINS` export 제거. 값·로직 불변.
- DIRECTORY.md에 새 파일 항목 추가 필요(`/push` 신선도 검사).

### `src/background/tab-bindings.ts`
- **현재 역할**: 탭 활성화/세션 바인딩, cross-origin 감지 → 패널 닫기 또는 deferred 메시지 발신.
- **변경 내용**:
  - 순수 헬퍼 `resolveNavigationAction` 추가(export — `shouldPreserveSession`과 동일하게 테스트 대상):

```typescript
export type NavigationAction = "keep" | "clearSession" | "notifyDeferredExpiry" | "deactivate";

export function resolveNavigationAction(input: {
  preserved: boolean;
  sameOrigin: boolean;      // origin 비교 결과 (URL 판별 불가 = false)
  pageKeyChanged: boolean;
  broadGranted: boolean;    // chrome.permissions.contains(BROAD_HOST_ORIGINS)
  newUrlSupported: boolean; // isSupportedUrl(newUrl)
}): NavigationAction
```

  판정: `effectiveSameOrigin = sameOrigin || (broadGranted && newUrlSupported)`

  | preserved | effectiveSameOrigin | 결과 | 비고 |
  |---|---|---|---|
  | true | true | `keep` | 현행 same-origin 보존과 동일 |
  | true | false | `notifyDeferredExpiry` | **현행 유지** — deferred 발신 |
  | false | true | pageKeyChanged ? `clearSession` : `keep` | 현행 same-origin 비보존과 동일. cross-origin인데 effectiveSameOrigin인 경우(광역 보유)는 pageKey가 항상 다르므로 `clearSession` |
  | false | false | `deactivate` | **현행 유지** — 패널 닫기 + 세션 remove |

  - `deactivatePanelIfCrossOrigin` 재구성: 기존 구조(activated 체크 → snap 로드 → refUrl resolve → origin 비교)는 유지하고, 분기 본문을 `resolveNavigationAction` 결과 실행으로 교체:
    - `keep` → 아무것도 안 함
    - `clearSession` → `chrome.storage.session.remove(key)` (현행 136–138)
    - `notifyDeferredExpiry` → `sendMessage(activeTabExpiredDeferred)` (현행 144–146, **그대로**)
    - `deactivate` → `setActivated(false)` + `setOptions(enabled:false)` + 세션 remove (현행 150–152)
  - `chrome.permissions.contains({ origins: BROAD_HOST_ORIGINS })` 조회는 origin 비교가 cross-origin일 때만 수행(same-origin이면 불필요한 권한 조회 생략).
  - 함수 주석(107–109)·`onUpdated` loading 분기 주석(223–224)에 광역 권한 예외를 한 줄 반영.
- **유지**: `ACTIVATION_URL_PREFIX`(refUrl fallback으로 계속 사용), deferred 발신, `onUpdated` 분기 구조, `apply`, `clearIfPageChanged`, `shouldPreserveSession`, `resolveTabSwitch`, `stopRecorders`, `activateTab`, `onRemoved`.

### 변경하지 않는 것 (명시)
- `src/types/messages.ts` — `activeTabExpiredDeferred` 타입·`onPickerPermissionExpired` 모두 불변.
- `src/sidepanel/hooks/usePickerMessages.ts` — deferred 플래그·idle 전환 fire·메시지 핸들러 불변.
- `src/sidepanel/App.tsx`·`src/i18n/namespaces/app.ts` — 만료 다이얼로그의 `window.close()`(339)·문구 불변. 패널 종료 → 재오픈이 grant 재취득을 유도하는 의도된 self-healing.
- 캡처 시점 가드(`ensureSupportedTab`·`maybeSurfacePermissionExpired`·`isTabCaptureUnavailable`) — 에러 후 분류 방식이라 광역 보유 시 captureVisibleTab·executeScript가 성공해 **자연히 발화하지 않는다**. 코드 변경 불필요.

### 문서 (구현과 분리, `/push` 신선도 검사에서 docs 커밋)
- **PERMISSION.md**: "만료 시 동작" 절(149–154 지연 경로 포함)·상태 표(273)·라이프사이클 다이어그램에 "광역 권한 보유 시 cross-origin에도 패널 유지·deferred 미발생" 예외 행 추가. §12 optional_host_permissions(521–560)에 "부여된 광역 권한은 선제 닫기 스킵·일반 캡처 지속에도 사용" 추가.
- **ARCHITECTURE.md**: "30s Replay > 사이드 패널 종료/유지 정책" 표(168–176)에 광역 보유 행 추가(기존 행은 미보유 기준으로 명시).
- **docs/privacy.md**: 선택적 호스트 권한 섹션(131–137) — 30초 리플레이로 부여된 권한이 일반 캡처 지속(페이지 이동 후 캡처·패널 유지)에도 사용됨을 명시 + 시행일. **manifest diff 0이어도 필수** — 기존 권한의 새 목적 사용(30s Replay 심사 탈락 전례와 동일 패턴).
- **DIRECTORY.md**: `src/lib/broad-host-origins.ts` 항목 추가.
- **CLAUDE.md**: 게이트웨이 optional_host_permissions 줄에 캡처 경로 공유 반영.

## 데이터 흐름

### 변경 전 (cross-origin 네비게이션, onUpdated loading)
```
deactivatePanelIfCrossOrigin
  ├─ same-origin              → 비보존+pageKey 변경 시 세션 remove
  ├─ cross-origin + 보존      → sendMessage(activeTabExpiredDeferred) → idle 복귀 시 다이얼로그 → window.close()
  └─ cross-origin + 비보존    → 패널 닫기 + 세션 remove
```

### 변경 후 (같은 지점)
```
deactivatePanelIfCrossOrigin → resolveNavigationAction
  ├─ same-origin (또는 cross-origin + 광역 보유 + 지원 URL)
  │   ├─ 보존   → keep
  │   └─ 비보존 → pageKey 변경 시 clearSession (패널 유지)
  └─ cross-origin + (광역 미보유 또는 미지원/판별불가 URL)   ← 현행 그대로
      ├─ 보존   → notifyDeferredExpiry (deferred 다이얼로그 경로 유지)
      └─ 비보존 → deactivate (패널 닫기)
```
이후 `info.url`/`complete` 분기의 `clearIfPageChanged → apply`는 현행 그대로(미지원 URL 닫기 포함).

## 인터페이스 설계

```typescript
// src/lib/broad-host-origins.ts — 신규
export const BROAD_HOST_ORIGINS = ["https://*/*", "http://*/*"];

// src/background/tab-bindings.ts — 신규 (export, 단위 테스트 대상)
export type NavigationAction = "keep" | "clearSession" | "notifyDeferredExpiry" | "deactivate";
export function resolveNavigationAction(input: {
  preserved: boolean;
  sameOrigin: boolean;
  pageKeyChanged: boolean;
  broadGranted: boolean;
  newUrlSupported: boolean;
}): NavigationAction;

// 제거 (이동)
- export const REPLAY_ORIGINS = [...];   // use-30s-replay.ts → BROAD_HOST_ORIGINS로 공용화
```

신규 메시지·store 필드·마이그레이션 없음.

## 기존 패턴 준수

- **순수 함수 추출 + 테스트**: `shouldPreserveSession`·`resolveTabSwitch`와 동일하게 chrome API 부수효과에서 판정만 분리, `__tests__/tab-bindings.test.ts`에 표 테스트 (CLAUDE.md 테스트 우선).
- **permissions.contains 가드**: `use-30s-replay.ts:86–95`·`SettingsTab.tsx:95`와 동일 패턴(사용 직전 조회, `permissions.onAdded` 리스너 없음).
- **외과적 변경**: deferred 경로·다이얼로그·loading 분기·`ACTIVATION_URL_PREFIX` 전부 존속. 내 변경이 만든 고아(`REPLAY_ORIGINS` 구명)만 제거.

## 대안 검토

**대안 A — deferred 다이얼로그 경로 제거 + 만료 다이얼로그 패널 유지형 전환**: 패널 연속성은 늘지만 미보유 사용자에게 "살아 보이는데 캡처가 안 되는" 상태와 비직관적 복구 제스처(열린 패널인데 아이콘 재클릭)를 학습시킨다. **채택 안 함** — 사용자 결정: 패널 종료 → 재오픈이 grant를 자연 재취득시키는 현행 self-healing이 미보유 사용자에겐 낫다. 이번 과업은 다이얼로그를 만나는 경우의 수를 줄이는 것이지 다이얼로그 자체를 바꾸는 게 아니다.

**대안 B — 만료 다이얼로그에 광역 권한 요청 버튼 추가**: 권한 요청 진입점이 2곳이 되고 video 경로 분기가 필요해진다. **채택 안 함** — 옵트인은 30s Replay 1곳 유지, 권한 동의 맥락이 리플레이 기능 설명과 묶여 있어 더 명확.

**대안 C — `chrome.permissions.onAdded` 리스너로 권한 상태 캐싱**: contains() 호출 비용이 미미하고 네비게이션 빈도도 낮다. **채택 안 함** — 오버엔지니어링.

**대안 D — 광역 보유 판정을 설정 store(`replayEnabled`)로**: 권한과 스위치 상태는 독립(권한은 영구, 스위치는 끌 수 있음)이라 스위치 OFF 사용자가 손해 본다. **채택 안 함** — 권한 실체(`contains`)가 단일 진실.

## 위험 요소

- **미보유 경로 회귀가 최대 리스크**: `resolveNavigationAction`의 `broadGranted=false` 케이스가 현행 분기와 완전히 일치해야 한다. 단위 테스트로 기존 4분기(보존/비보존 × same/cross-origin)를 먼저 고정한 뒤 광역 케이스를 추가.
- **URL 가시성과 판정 폴백**: 광역 보유 시 http/https 페이지의 `info.url`은 항상 가시. `chrome://`·`file:` 등은 권한 범위 밖이라 URL 미가시 또는 미지원 → `newUrlSupported=false` → 현행 닫기/deferred 분기로 자연 폴백. 보유 상태에서 "URL 판별 불가" 폴백이 광역 예외를 타는 경우는 없다.
- **e2e 빌드의 권한 상태**: `dist-e2e`는 `host_permissions: <all_urls>`라 `permissions.contains(BROAD_HOST_ORIGINS)`가 **항상 true** — e2e는 광역 보유 경로만 자동 검증 가능. 미보유 경로(닫힘·deferred)는 수동 테스트 전용(tasks.md 명시).
- **contains() 호출 시점**: `onUpdated(loading)`마다 1회 async 조회(cross-origin일 때만). 권한 조회는 IPC 1회 수준으로 비용 무시 가능.
- **privacy.md 누락 위험**: manifest diff 0이지만 기존 광역 권한의 새 목적 사용 — 30s Replay가 정확히 이 패턴으로 심사 탈락한 전례. Task에 명시적으로 포함.
- **30s Replay 회귀**: 상수 추출은 값 동일·로직 불변이지만 import 경로 변경 — Replay 토글 ON 흐름(권한 요청 프롬프트)·폴링 시작을 수동 1회 확인.
