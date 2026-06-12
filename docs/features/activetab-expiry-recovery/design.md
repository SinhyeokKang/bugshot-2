# activeTab 만료 복구 개선 — 기술 설계

## 개요

`deactivatePanelIfCrossOrigin`(`tab-bindings.ts:110–156`)을 **유지하되 재구성**한다: ① 보존 상태의 deferred 발신(144–146)을 제거하고, ② 비보존 닫기 분기(150–152)에 광역 host 권한 체크를 추가해 보유 시 패널을 유지한다. 판정 로직은 순수 헬퍼 `resolveNavigationAction`으로 추출해 단위 테스트한다. 광역 권한 판정은 `chrome.permissions.contains()`만 사용 — 새 store 상태·요청 UI 없음(30s Replay 옵트인이 부여한 권한을 공유). 캡처 시점 만료 다이얼로그는 패널 유지형으로 전환한다.

이전 설계(activetab-no-preemptive-expiry)와 달리 `onUpdated`의 loading 분기·`ACTIVATION_URL_PREFIX`는 **그대로 둔다** — 선제 함수가 존속하므로 고아가 아니다.

## 변경 범위

### `src/lib/broad-host-origins.ts` (신규)
- `use-30s-replay.ts:16`의 `REPLAY_ORIGINS = ["https://*/*", "http://*/*"]`를 공용 상수로 추출. background(`tab-bindings.ts`)에서도 contains 체크에 필요해 sidepanel 모듈 밖으로 옮긴다.

```typescript
export const BROAD_HOST_ORIGINS = ["https://*/*", "http://*/*"];
```

- `use-30s-replay.ts`·`SettingsTab.tsx`(90–104 `handleReplayToggle`)의 `REPLAY_ORIGINS` 참조를 이 상수로 교체, `REPLAY_ORIGINS` export 제거. 로직 변경 없음(값 동일).
- DIRECTORY.md에 새 파일 항목 추가 필요(`/push` 신선도 검사).

### `src/background/tab-bindings.ts`
- **현재 역할**: 탭 활성화/세션 바인딩, cross-origin 감지·패널 닫기·deferred 메시지 발신.
- **변경 내용**:
  - 순수 헬퍼 `resolveNavigationAction` 추가(export — `shouldPreserveSession`과 동일하게 테스트 대상):

```typescript
export function resolveNavigationAction(input: {
  preserved: boolean;
  sameOrigin: boolean;      // origin 비교 결과 (URL 판별 불가 = false)
  pageKeyChanged: boolean;
  broadGranted: boolean;    // chrome.permissions.contains(BROAD_HOST_ORIGINS)
  newUrlSupported: boolean; // isSupportedUrl(newUrl)
}): { closePanel: boolean; removeSession: boolean }
```

  판정 표:

  | preserved | sameOrigin | broadGranted && newUrlSupported | closePanel | removeSession |
  |---|---|---|---|---|
  | true | * | * | false | false |
  | false | true | * | false | pageKeyChanged |
  | false | false | true | false | true |
  | false | false | false | true | true |

  - `deactivatePanelIfCrossOrigin` 재구성: 기존 구조(activated 체크 → snap 로드 → refUrl resolve → origin 비교)는 유지하고, 분기 본문을 `resolveNavigationAction` 결과 실행으로 교체. cross-origin 진입 시 `chrome.permissions.contains({ origins: BROAD_HOST_ORIGINS })` 1회 조회(보존이면 조회 생략 가능 — preserved는 항상 keep). **deferred 발신(144–146) 삭제.**
  - 함수 주석(107–109)·loading 분기 주석(223–224)을 새 정책으로 갱신("cross-origin이면 패널 닫기" → "광역 권한 미보유 시에만 닫기").
  - `BgInternalMessage` import(4)는 deferred 발신 제거 후 미사용이면 제거.
- **유지**: `ACTIVATION_URL_PREFIX`(refUrl fallback으로 계속 사용), `onUpdated` loading 분기 구조, `apply`, `clearIfPageChanged`, `shouldPreserveSession`, `resolveTabSwitch`, `stopRecorders`, `activateTab`, `onRemoved` remove 배열.

### `src/types/messages.ts`
- `BgInternalMessage` union에서 `{ type: "activeTabExpiredDeferred"; tabId: number }`(211) 제거.
- `onPickerPermissionExpired` 정의(295–300) 유지. 인접 주석("다이얼로그가 패널 재실행을 안내한다")을 새 동작("아이콘 재클릭을 안내한다")으로 갱신.

### `src/sidepanel/hooks/usePickerMessages.ts`
- 모듈 스코프 `deferredActiveTabExpiry` 플래그(23) 제거.
- `useEditorStore.subscribe` 콜백의 idle 전환 `onPickerPermissionExpired.fire()` 분기(47–50) 제거. 로그 flush 분기(53–57) 유지.
- `activeTabExpiredDeferred` 메시지 핸들러(162–165) 제거. 라인 163의 `Extract<BgInternalMessage, …>` 캐스트가 사라지므로 `BgInternalMessage` import 잔존 사용처 확인 후 미사용이면 제거.
- `onPickerPermissionExpired` import도 미사용이면 제거 — fire는 `picker-control.ts:155,164`·`video-capture.ts:43` 3곳만 남는다.

### `src/sidepanel/App.tsx` + `src/i18n/namespaces/app.ts`
- **현재**: `permissionExpired` AlertDialog(327–344) 확인 버튼(`AlertDialogAction`, 339)이 `window.close()` 호출 — 코드베이스 유일 사용처. 문구 ko "페이지가 변경되어 권한이 만료되었습니다. BugShot을 다시 실행해 주세요."(`app.ts:16–17`) / en "…Please relaunch BugShot."(73–74).
- **변경 내용**:
  - 확인 액션의 `window.close()` 제거 — 확인은 다이얼로그만 닫고 패널 유지(`onOpenChange`가 이미 state를 관리하므로 onClick 핸들러 자체가 불필요해질 수 있음).
  - 문구 교체(ko/en 동시 — `src/i18n/` 수정 시 PostToolUse 훅이 `locales.test.ts` 자동 검사):
    - ko: "페이지가 변경되어 캡처 권한이 만료되었습니다. 툴바의 BugShot 아이콘을 다시 클릭하면 이어서 사용할 수 있습니다."
    - en: "The page changed and the capture permission expired. Click the BugShot icon in the toolbar to continue."
  - `AlertDialogContent`에 `data-testid` 부착 — e2e가 무관한 `SessionExpiredDialog`와 구분 판정용.
- **유지**: subscribe 경로(139–147)·다른 다이얼로그 불변. fire에 reason 파라미터 추가하지 않는다(권한 요청 버튼이 없으므로 video 경로 구분 불필요 — 모든 경로에서 같은 안내).

### 문서 (구현과 분리, `/push` 신선도 검사에서 docs 커밋)
- **PERMISSION.md**: "만료 시 동작 > 지연 경로(보존 상태)"(149–154) 제거, 상태 표(273)·`activeTabExpiredDeferred` 흐름(293)·라이프사이클 다이어그램 갱신. §12 optional_host_permissions(521–560)에 "부여된 광역 권한은 일반 캡처 경로·선제 닫기 스킵에도 사용" 추가.
- **ARCHITECTURE.md**: "30s Replay > 사이드 패널 종료/유지 정책" 표(168–176)를 새 정책(광역 보유 시 cross-origin에도 유지, deferred 행 삭제)으로 갱신.
- **docs/privacy.md**: 선택적 호스트 권한 섹션(131–137) — 30초 리플레이로 부여된 권한이 일반 캡처 지속(페이지 이동 후 캡처)에도 사용됨을 명시 + 시행일. **manifest diff 0이어도 필수** — 기존 권한의 새 목적 사용(30s Replay 심사 탈락 전례와 동일 패턴).
- **DIRECTORY.md**: `src/lib/broad-host-origins.ts` 항목 추가.
- **CLAUDE.md**: 게이트웨이 optional_host_permissions 설명 줄에 캡처 경로 공유 반영.

## 데이터 흐름

### 변경 전 (cross-origin 네비게이션, onUpdated loading)
```
deactivatePanelIfCrossOrigin
  ├─ same-origin              → 비보존+pageKey 변경 시 세션 remove
  ├─ cross-origin + 보존      → sendMessage(activeTabExpiredDeferred)
  │                             → 패널: idle 전환 시 다이얼로그 → window.close()
  └─ cross-origin + 비보존    → 패널 닫기 + 세션 remove
```

### 변경 후 (같은 지점)
```
deactivatePanelIfCrossOrigin → resolveNavigationAction
  ├─ 보존                                  → 아무것도 안 함 (패널·세션 유지)
  ├─ same-origin + 비보존                  → pageKey 변경 시 세션 remove (현행)
  ├─ cross-origin + 비보존 + 광역 보유     → 세션 remove만 (패널 유지)
  └─ cross-origin + 비보존 + 광역 미보유   → 패널 닫기 + 세션 remove (현행)
```
이후 `info.url`/`complete` 분기의 `clearIfPageChanged → apply`는 현행 그대로(미지원 URL 닫기 포함). 캡처 시점 만료는 `ensureSupportedTab`·`maybeSurfacePermissionExpired`·`isTabCaptureUnavailable` → `onPickerPermissionExpired.fire()` → 다이얼로그(패널 유지형) — 광역 보유 시 captureVisibleTab·executeScript가 성공하므로 이 경로 자체가 발화하지 않는다(tabCapture 제외).

## 인터페이스 설계

```typescript
// src/lib/broad-host-origins.ts — 신규
export const BROAD_HOST_ORIGINS = ["https://*/*", "http://*/*"];

// src/background/tab-bindings.ts — 신규 (export, 단위 테스트 대상)
export function resolveNavigationAction(input: {
  preserved: boolean;
  sameOrigin: boolean;
  pageKeyChanged: boolean;
  broadGranted: boolean;
  newUrlSupported: boolean;
}): { closePanel: boolean; removeSession: boolean };

// 제거
- | { type: "activeTabExpiredDeferred"; tabId: number }   // messages.ts BgInternalMessage
- let deferredActiveTabExpiry = false;                     // usePickerMessages.ts
- export const REPLAY_ORIGINS = [...];                     // use-30s-replay.ts (공용 상수로 이동)
- window.close()                                           // App.tsx:339
```

## 기존 패턴 준수

- **순수 함수 추출 + 테스트**: `shouldPreserveSession`·`resolveTabSwitch`와 동일하게 chrome API 부수효과에서 판정 로직만 분리해 `__tests__/tab-bindings.test.ts`에 표 테스트 (CLAUDE.md 테스트 우선).
- **permissions.contains 가드**: `use-30s-replay.ts:86–95`·`SettingsTab.tsx:95`와 동일 패턴(사용 직전 조회, 리스너 없음).
- **i18n 동시 갱신**: ko/en 키 대칭 — PostToolUse 훅 자동 검사.
- **외과적 변경**: 선제 함수·loading 분기·ACTIVATION_URL_PREFIX 존속. 내 변경이 만든 고아(`activeTabExpiredDeferred`, `REPLAY_ORIGINS` 구명)만 제거.

## 대안 검토

**대안 A — 만료 다이얼로그에 "모든 사이트 항상 허용" 권한 요청 버튼 추가**: 아픔 발생 시점에 권한을 제안하는 장점이 있으나, 권한 요청 진입점이 2곳이 되고 video(tabCapture) 경로에선 버튼이 무의미해 fire reason 분기가 필요해진다. **채택 안 함** — 사용자 결정: 30s Replay 옵트인 1곳을 유지하고 권한을 공유. 권한 요청이 리플레이 기능 설명과 묶여 있어 동의 맥락도 더 명확하다.

**대안 B — 전면 패널 유지(광역 권한 무관, 이전 설계)**: 광역 미보유 사용자에게 "살아 보이는데 캡처가 안 되는 좀비 패널" + 비직관적 복구 제스처(열린 패널인데 아이콘 재클릭)를 학습시킨다. **채택 안 함** — 비보존 닫기는 self-healing이라 미보유 사용자에겐 현행이 낫다.

**대안 C — 다이얼로그 문구에 "30초 리플레이를 켜면 끊김이 사라집니다" 힌트**: 권한 혜택의 발견성을 높이지만 요청하지 않은 안내 추가. **채택 안 함** — 최소 문구 유지, 필요해지면 후속.

**대안 D — `chrome.permissions.onAdded` 리스너로 권한 상태 캐싱**: contains()는 호출 비용이 미미하고 navigation 빈도도 낮다. **채택 안 함** — 오버엔지니어링.

## 위험 요소

- **광역 미보유 경로 회귀**: `resolveNavigationAction` 표의 마지막 행(현행 닫기)이 기존 동작과 정확히 일치해야 한다. 단위 테스트로 기존 분기(보존/비보존 × same/cross-origin) 전 케이스를 고정하고, 수동 테스트로 실탭 확인.
- **`newUrlSupported` 판정과 URL 가시성**: 광역 권한 보유 시 http/https 페이지의 `info.url`은 항상 보인다. `chrome://`·`file:` 등은 광역 권한 범위 밖이라 URL이 안 보이거나 미지원 → `newUrlSupported=false` → 현행대로 닫힘(자연 처리). 보유 상태에서 cross-origin 판정이 "URL 판별 불가" 폴백으로 빠지는 경우는 미지원 스킴뿐.
- **e2e 빌드의 권한 상태**: `dist-e2e`는 `host_permissions`에 `<all_urls>`가 있어 `permissions.contains(BROAD_HOST_ORIGINS)`가 **항상 true** — e2e는 광역 보유 경로만 자동 검증 가능. 미보유 닫기 경로는 수동 테스트로만 커버(tasks.md 명시).
- **아이콘 재클릭의 토글 여부**: 이미 열린 패널에서 `action.onClicked` → `sidePanel.open()`이 토글(닫힘)로 동작하면 다이얼로그 안내("아이콘 재클릭")의 전제가 흔들린다. 구현 전 실탭 확인(수동 테스트 선행 항목).
- **privacy.md 누락 위험**: manifest diff 0이지만 기존 광역 권한의 새 목적 사용 — 30s Replay가 정확히 이 패턴으로 심사 탈락한 전례. Task에 명시적으로 포함.
- **SW 핫스왑 호환**: 구버전 패널이 새 bg와 공존해도 deferred 메시지 발신 자체가 사라져 무해. 역방향(새 패널 + 구 bg)은 unknown type no-op.
- **30s Replay 회귀**: 상수 추출은 값 동일·로직 불변이지만 import 경로가 바뀌므로 Replay 토글 ON 흐름(권한 요청)과 폴링 시작을 수동 1회 확인.
