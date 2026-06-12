# activeTab 선제 만료 트리거 제거 — 기술 설계

## 개요

`tab-bindings.ts`의 `deactivatePanelIfCrossOrigin`와 그에 딸린 deferred 경로(`activeTabExpiredDeferred` 메시지 + 사이드패널 핸들러)를 제거한다. cross-origin 네비게이션 시 패널을 닫던 책임은 이미 `clearIfPageChanged`(stale 세션 정리·element `picker.clear`) + `apply`(미지원 URL 패널 닫기)가 전부 커버하므로, 별도 선제 함수가 없어도 동작이 보존된다. activeTab 만료 안내는 캡처 시점 런타임 가드(즉시 경로)만 남긴다.

## 변경 범위

### `src/background/tab-bindings.ts`
- **현재 역할**: 탭 활성화/세션 바인딩, cross-origin 감지·패널 닫기·deferred 메시지 발신.
- **변경 내용**:
  - `deactivatePanelIfCrossOrigin`(110–156) 함수 **전체 삭제**.
  - `onUpdated` 리스너의 `status === "loading"` 분기(225–228)에서 `deactivatePanelIfCrossOrigin` 호출 제거. loading 단계는 더 이상 별도 처리하지 않는다(SPA same-document는 애초에 loading 없음 — 주석대로). cross-document 네비게이션은 이어지는 `info.url`/`complete` 분기의 `clearIfPageChanged` + `apply`가 처리.
  - `ACTIVATION_URL_PREFIX` 상수(14)와 그 write(`activateTab` 173–174)·read(삭제됨)·remove(`onRemoved` 243의 배열에서 제거) — `deactivatePanelIfCrossOrigin`의 refUrl fallback 전용이었으므로 **고아가 되어 제거**. `onRemoved`는 `sessionKey(tabId)` 단일 키만 remove하도록 축소.
  - `BgInternalMessage` import는 다른 곳(없음) 확인 후 미사용이면 제거.
- **유지**: `apply`, `clearIfPageChanged`, `shouldPreserveSession`, `resolveTabSwitch`, `stopRecorders`, `activateTab`, 모든 onActivated/onUpdated(url·complete)/onRemoved/onActivated 로직.

### `src/sidepanel/hooks/usePickerMessages.ts`
- **현재 역할**: bg→패널 메시지 수신, 로그 머지, deferred 만료 플래그 처리.
- **변경 내용**:
  - 모듈 스코프 `deferredActiveTabExpiry` 플래그(23) 제거.
  - `useEditorStore.subscribe` 콜백의 idle 전환 시 `onPickerPermissionExpired.fire()` 분기(47–50) 제거. 같은 콜백의 로그 flush 분기(53–57)는 유지.
  - `activeTabExpiredDeferred` 메시지 핸들러(162–165) 제거.
- **유지**: `onPickerPermissionExpired` import는 이 파일에서 더 안 쓰면 제거(다른 import는 유지). 캡처 시점 fire는 `picker-control.ts`·`video-capture.ts`가 담당하므로 이벤트 자체는 살아있다.

### `src/types/messages.ts`
- `BgInternalMessage` union에서 `{ type: "activeTabExpiredDeferred"; tabId: number }`(211) 제거.
- 관련 주석(295 부근 "페이지 이동으로 activeTab grant가 만료돼…") 정리.
- `onPickerPermissionExpired` 이벤트 정의(296) **유지** — 캡처 시점 가드가 사용.

### `PERMISSION.md`
- "만료 시 동작 > 지연 경로(보존 상태)" 절(149–154) 제거 또는 "패널 유지, 캡처 시점 안내"로 수정.
- "만료 감지(3중 방어)"는 진입 가드(1단계)·캡처 시점(2·3단계)만 남기고, 표(273 부근)의 cross-origin 행·`activeTabExpiredDeferred` 흐름(293) 갱신.
- activeTab 라이프사이클 다이어그램에서 cross-origin → 패널 닫기 경로 갱신.
- `docs(PERMISSION): ...` 커밋으로 분리(구현 단계가 아니라 `/push` 신선도 검사에서 처리).

## 데이터 흐름

### 변경 전 (cross-origin 네비게이션)
```
onUpdated(loading) → deactivatePanelIfCrossOrigin
  ├─ same-origin    → 비보존+pageKey 변경 시 세션 remove
  ├─ cross-origin + 보존   → bg sendMessage(activeTabExpiredDeferred)
  │                          → 패널 usePickerMessages: deferredActiveTabExpiry=true
  │                          → idle 전환 시 onPickerPermissionExpired.fire() → 다이얼로그 → window.close()
  └─ cross-origin + 비보존 → setActivated(false)+setOptions(enabled:false)+세션 remove (패널 닫힘)
```

### 변경 후 (cross-origin 네비게이션)
```
onUpdated(loading)        → (처리 없음)
onUpdated(info.url)       → clearIfPageChanged → apply
  ├─ clearIfPageChanged
  │   ├─ 보존 element + pageKey 변경 → picker.clear (선택 초기화)
  │   └─ 비보존 + pageKey 변경        → 세션 remove (stale 정리)
  └─ apply
      ├─ 지원 URL + activated  → setOptions path 재등록 (패널 유지)
      └─ 미지원 URL + 비보존   → setOptions(enabled:false) (패널 닫힘) ← S3
```
캡처 시점 만료는 변경 없이 `ensureSupportedTab`(진입)·`maybeSurfacePermissionExpired`(captureVisibleTab)·`isTabCaptureUnavailable`(tabCapture)가 `onPickerPermissionExpired.fire()` → 다이얼로그.

## 인터페이스 설계

신규/변경 타입 시그니처 없음. 순수 함수 시그니처(`shouldPreserveSession`, `resolveTabSwitch`)는 그대로. 제거되는 것:

```typescript
// src/types/messages.ts — BgInternalMessage union에서 제거
- | { type: "activeTabExpiredDeferred"; tabId: number }

// src/background/tab-bindings.ts — 함수·상수 제거
- const ACTIVATION_URL_PREFIX = "sidePanel:url:";
- async function deactivatePanelIfCrossOrigin(tabId, newUrl): Promise<void>

// src/sidepanel/hooks/usePickerMessages.ts — 모듈 상태·핸들러 제거
- let deferredActiveTabExpiry = false;
```

## 기존 패턴 준수

- **세션 영속화**: `apply`/`clearIfPageChanged`의 `shouldPreserveSession` 게이트는 그대로 — 보존 상태 판정 단일 출처 유지.
- **메시지 비동기 응답**: bg→패널 broadcast 메시지에서 한 종류(`activeTabExpiredDeferred`)만 제거, union 패턴 유지.
- **고아 제거 원칙(CLAUDE.md)**: 내 변경(`deactivatePanelIfCrossOrigin` 삭제)이 만든 고아(`ACTIVATION_URL_PREFIX`)만 제거. 그 외 dead code는 건드리지 않는다.

## 대안 검토

**대안 A — 함수는 두고 cross-origin 분기 내용만 제거(보수적)**: `deactivatePanelIfCrossOrigin`을 남긴 채 cross-origin 분기에서 닫기/deferred만 빼고 세션 remove만 남긴다. diff는 작지만 (1) loading 단계에서 굳이 호출이 유지되고 (2) same-origin 세션 remove가 `clearIfPageChanged`와 중복되며 (3) `ACTIVATION_URL_PREFIX` fallback이 죽은 분기로 남는다. **채택 안 함** — 죽은 분기·중복 책임이 남아 코드가 더 지저분해진다. 통째 제거가 더 단순(CLAUDE.md "200줄을 50줄로").

**대안 B — cross-origin 시 패널 유지하되 가벼운 안내 배너 추가**: drafting stale 상태를 배너로 알린다. **채택 안 함** — 사용자가 "그냥 유지(최소)"로 결정. 요청하지 않은 UI 추가는 원칙 위반.

## 위험 요소

- **`clearIfPageChanged`가 cross-origin을 빠짐없이 커버하는지**: cross-origin은 `pageKeyOf` 비교에서 항상 다름 → 보존 element면 `picker.clear`, 비보존이면 세션 remove. 단 `snap.target?.url`(prevUrl)이 없는 상태(activateTab 직후·picking 진입 전 idle)에서는 `clearIfPageChanged`가 early-return해 세션 정리를 건너뛴다. 그러나 그 상태의 세션은 캡처 데이터가 없어 정리할 것이 없으므로 실질 회귀 아님. **e2e/수동 검증 필수**.
- **loading 단계 제거의 타이밍**: 기존엔 loading 즉시 패널을 닫았다. 이제 complete까지 패널이 떠 있는다 — 의도된 동작(패널 유지)이라 문제 없음. SPA same-document 네비게이션은 loading 미발화라 영향 없음(주석 224).
- **즉시 경로 회귀**: deferred 제거가 캡처 시점 가드를 건드리지 않는지 확인. `onPickerPermissionExpired` 이벤트는 유지되고, fire 지점은 `picker-control.ts:155,164`·`video-capture.ts:43`만 남아야 한다.
- **broadcast 메시지 호환**: SW 핫스왑 중 이전 버전 bg가 `activeTabExpiredDeferred`를 보낼 수 있으나, 새 패널 핸들러가 무시(unknown type → no-op)하므로 안전.
