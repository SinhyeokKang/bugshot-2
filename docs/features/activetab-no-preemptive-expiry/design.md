# activeTab 선제 만료 트리거 제거 — 기술 설계

## 개요

`tab-bindings.ts`의 `deactivatePanelIfCrossOrigin`와 그에 딸린 deferred 경로(`activeTabExpiredDeferred` 메시지 + 사이드패널 핸들러)를 제거한다. cross-origin 네비게이션 시 패널을 닫던 책임은 이미 `clearIfPageChanged`(stale 세션 정리·element `picker.clear`) + `apply`(미지원 URL 패널 닫기)가 전부 커버하므로, 별도 선제 함수가 없어도 동작이 보존된다. activeTab 만료 안내는 캡처 시점 런타임 가드(즉시 경로)만 남긴다.

추가로 유지되는 캡처 시점 만료 다이얼로그를 **패널 유지형**으로 바꾼다 — 확인 시 `window.close()` 제거 + 문구를 아이콘 재클릭 복구 안내로 교체. "패널 유지" 철학이 캡처 시도 시점까지 일관되도록.

## 변경 범위

### `src/background/tab-bindings.ts`
- **현재 역할**: 탭 활성화/세션 바인딩, cross-origin 감지·패널 닫기·deferred 메시지 발신.
- **변경 내용**:
  - `deactivatePanelIfCrossOrigin`(110–156) 함수 **전체 삭제**.
  - `onUpdated` 리스너의 `status === "loading"` 분기(225–228)를 **early return 포함 통째 삭제**. 이후 loading 이벤트에 실린 `info.url`(cross-document 네비게이션의 통상 케이스)이 곧바로 `clearIfPageChanged → apply`로 흘러 세션 정리·패널 enable/disable이 loading 시점에 실행된다 — 의도된 동작(기존 선제 트리거와 유사한 타이밍, complete 분기가 같은 판정을 한 번 더 거침). SPA same-document는 애초에 loading 미발화(주석 224).
  - `ACTIVATION_URL_PREFIX` 상수(14)와 그 write(`activateTab` 173–175)·read(삭제됨)·remove(`onRemoved` 243의 배열에서 제거) — `deactivatePanelIfCrossOrigin`의 refUrl fallback 전용이었으므로 **고아가 되어 제거**. `onRemoved`는 `sessionKey(tabId)` 단일 키만 remove하도록 축소. 기존에 저장된 `sidePanel:url:<tabId>` 키는 `chrome.storage.session`이라 브라우저 종료 시 휘발 — 마이그레이션 불필요.
  - `BgInternalMessage` import는 다른 곳(없음) 확인 후 미사용이면 제거.
- **유지**: `apply`, `clearIfPageChanged`, `shouldPreserveSession`, `resolveTabSwitch`, `stopRecorders`, `activateTab`, 모든 onActivated/onUpdated(url·complete)/onRemoved/onActivated 로직.

### `src/sidepanel/hooks/usePickerMessages.ts`
- **현재 역할**: bg→패널 메시지 수신, 로그 머지, deferred 만료 플래그 처리.
- **변경 내용**:
  - 모듈 스코프 `deferredActiveTabExpiry` 플래그(23) 제거.
  - `useEditorStore.subscribe` 콜백의 idle 전환 시 `onPickerPermissionExpired.fire()` 분기(47–50) 제거. 같은 콜백의 로그 flush 분기(53–57)는 유지.
  - `activeTabExpiredDeferred` 메시지 핸들러(162–165) 제거.
- **유지**: `onPickerPermissionExpired` import는 이 파일에서 더 안 쓰면 제거(다른 import는 유지). 캡처 시점 fire는 `picker-control.ts`·`video-capture.ts`가 담당하므로 이벤트 자체는 살아있다.

### `src/sidepanel/App.tsx` + `src/i18n/namespaces/app.ts`
- **현재**: `app.permissionExpired` AlertDialog(`App.tsx:327–344`)가 확인 클릭 시 `window.close()`로 패널 강제 종료. 문구 ko "페이지가 변경되어 권한이 만료되었습니다. BugShot을 다시 실행해 주세요." / en "…Please relaunch BugShot."
- **변경 내용**:
  - 확인 액션의 `window.close()` 제거 — 확인은 다이얼로그만 닫고 패널은 유지.
  - 문구를 아이콘 재클릭 복구 안내로 교체(예: "페이지가 변경되어 캡처 권한이 만료되었습니다. 툴바의 BugShot 아이콘을 다시 클릭해 주세요."). ko/en 동시 갱신 — `src/i18n/` 수정은 PostToolUse 훅이 `locales.test.ts`(ko/en 대칭) 자동 검사.
  - 다이얼로그에 `data-testid` 부착 — e2e가 무관한 `SessionExpiredDialog`와 구분 판정하기 위함.
- **유지**: 같은 파일의 다른 다이얼로그·핸들러 불변. `onPickerPermissionExpired` 구독 구조 불변(fire → 다이얼로그 open 경로 그대로).

### `src/types/messages.ts`
- `BgInternalMessage` union에서 `{ type: "activeTabExpiredDeferred"; tabId: number }`(211) 제거.
- 관련 주석(295 부근 "페이지 이동으로 activeTab grant가 만료돼…") 정리.
- `onPickerPermissionExpired` 이벤트 정의(296) **유지** — 캡처 시점 가드가 사용.

### `PERMISSION.md`
- "만료 시 동작 > 지연 경로(보존 상태)" 절(149–154) 제거 또는 "패널 유지, 캡처 시점 안내"로 수정.
- "만료 감지(3중 방어)"는 진입 가드(1단계)·캡처 시점(2·3단계)만 남기고, 표(273 부근)의 cross-origin 행·`activeTabExpiredDeferred` 흐름(293) 갱신.
- activeTab 라이프사이클 다이어그램에서 cross-origin → 패널 닫기 경로 갱신.
- 만료 다이얼로그의 `window.close()`·문구 관련 서술이 있으면 함께 갱신.
- `docs(PERMISSION): ...` 커밋으로 분리(구현 단계가 아니라 `/push` 신선도 검사에서 처리).

### `ARCHITECTURE.md`
- "30s Replay > 사이드 패널 종료/유지 정책" 절(168–176)이 `deactivatePanelIfCrossOrigin`·`activeTabExpiredDeferred`·"cross-origin + 비보존 → 패널 닫기" 표를 전제 — 변경 후 통째로 stale. "cross-origin에도 패널 유지, 만료는 캡처 시점 안내(패널 유지형 다이얼로그)"로 갱신.
- PERMISSION.md와 같이 docs 커밋으로 분리(`/push` 신선도 검사에서 처리).

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
onUpdated(info.url 실린 모든 이벤트 — loading 포함) → clearIfPageChanged → apply
  ├─ clearIfPageChanged
  │   ├─ 보존 element + pageKey 변경 → picker.clear (선택 초기화)
  │   └─ 비보존 + pageKey 변경        → 세션 remove (stale 정리)
  └─ apply
      ├─ 지원 URL + activated  → setOptions path 재등록 (패널 유지)
      └─ 미지원 URL + 비보존   → setOptions(enabled:false) (패널 닫힘) ← S3
```
캡처 시점 만료는 변경 없이 `ensureSupportedTab`(진입)·`maybeSurfacePermissionExpired`(captureVisibleTab)·`isTabCaptureUnavailable`(tabCapture)가 `onPickerPermissionExpired.fire()` → 다이얼로그. 단 다이얼로그는 패널을 닫지 않고(`window.close()` 제거) 아이콘 재클릭 복구를 안내한다.

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

// src/sidepanel/App.tsx — 만료 다이얼로그 확인 액션에서 제거
- window.close()
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
- **loading 분기 통째 삭제의 타이밍**: loading 이벤트의 `info.url`로 `clearIfPageChanged → apply`가 즉시 실행된다(기존엔 early return이 막던 경로). 세션 정리·패널 enable/disable이 complete 이전에 일어나지만 complete 분기가 같은 판정을 한 번 더 거치므로 무해 — 의도된 단순화. SPA same-document 네비게이션은 loading 미발화라 영향 없음(주석 224).
- **즉시 경로 회귀**: deferred 제거가 캡처 시점 가드를 건드리지 않는지 확인. `onPickerPermissionExpired` 이벤트는 유지되고, fire 지점은 현재 4곳 중 `usePickerMessages.ts:49` 1곳만 제거돼 `picker-control.ts:155,164`·`video-capture.ts:43` 3곳만 남아야 한다.
- **30s Replay 폴링 지속**: 변경 후 비보존 idle에서 cross-origin 이동해도 패널이 유지되므로 600ms `captureVisibleTab` 폴링이 계속 돈다. 폴링은 광역 optional host 권한 기반이라 activeTab grant 만료와 무관하게 정상 동작하고, 페이지 간 프레임 혼합은 ARCHITECTURE.md에 명시된 의도된 look-back 설계 — **신규 위험 아님, 코드 변경 없음**.
- **다이얼로그 변경의 영향 범위**: `window.close()` 제거는 `permissionExpired` 다이얼로그 확인 액션 한정 — 같은 파일의 다른 `window.close()` 사용처(있다면)는 불변 확인. i18n 문구 변경은 ko/en 대칭 훅 검사 통과 필요.
- **broadcast 메시지 호환**: SW 핫스왑 중 이전 버전 bg가 `activeTabExpiredDeferred`를 보낼 수 있으나, 새 패널 핸들러가 무시(unknown type → no-op)하므로 안전.
