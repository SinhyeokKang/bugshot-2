# 광역 캡처 권한을 `<all_urls>`로 전환 — 기술 설계

## 개요

광역 권한의 단일 출처는 `src/lib/broad-host-origins.ts`의 `BROAD_HOST_ORIGINS` 상수다. 이 값과 `manifest.config.ts`의 `optional_host_permissions`를 `["<all_urls>"]`로 바꾸면, 권한을 소비하는 3개 지점(설정 토글·replay 폴링 가드·navigation 분기)이 상수를 참조하므로 자동으로 따라온다. 캡처 권한이 실제로 부여되도록 만드는 것이 전부이며, 로직 분기 자체는 변경하지 않는다.

## 변경 범위

### `src/lib/broad-host-origins.ts` (값 변경)
- 현재 역할: `BROAD_HOST_ORIGINS = ["https://*/*", "http://*/*"]` — 광역 권한 origin 목록의 단일 출처.
- 변경: `["<all_urls>"]`로 교체.
- 영향: `chrome.permissions.contains` / `chrome.permissions.request`의 `origins` 인자가 `<all_urls>`가 된다.

### `manifest.config.ts` (권한 선언 변경)
- 현재 역할: `optional_host_permissions: ["https://*/*", "http://*/*"]` (line 88).
- 변경: `optional_host_permissions: ["<all_urls>"]`로 교체.
- `host_permissions`(특정 플랫폼) · `permissions` 배열은 변경 없음.

### 변경 불필요 (상수 참조로 자동 반영) — 회귀 확인 대상
- `src/sidepanel/tabs/SettingsTab.tsx:96-98` — replay 토글에서 `contains`/`request({ origins: BROAD_HOST_ORIGINS })`. 상수만 따라오면 `<all_urls>`를 요청.
- `src/sidepanel/30s-replay/use-30s-replay.ts:87-89` — 폴링 시작 전 `contains({ origins: BROAD_HOST_ORIGINS })` 가드. 구 권한 보유자는 자동 false → replay 비활성화(마이그레이션 경로).
- `src/background/tab-bindings.ts:179-181` — cross-origin navigation 시 `contains({ origins: BROAD_HOST_ORIGINS })`. `<all_urls>` 보유 시 true → `resolveNavigationAction`이 패널 유지.
- `src/sidepanel/lib/ai-provider.ts:389-395` — `requestHostPermission(baseUrl)`은 특정 origin(`{protocol}//{host}/*`)만 요청. `<all_urls>`가 optional에 선언돼 있으면 그 하위 특정 origin 요청도 유효하므로 변경 불필요.

### 변경하지 않음 (file: 비목표)
- `src/background/tab-bindings.ts:133-144` `isBroadCoveredUrl` — `BROAD_COVERED_SCHEMES = {http, https}`로 file:을 제외. 현행 유지. `<all_urls>`가 file:을 포함해도 navigation 분기는 file:을 cross-origin 만료로 취급(비목표 경계).

### 문서 갱신 (코드 외, `/push` 신선도 게이트)
- `PERMISSION.md` — `BROAD_HOST_ORIGINS` 값(§12, line 540), optional_host_permissions 표기(line 62-63), 분기표 주석(line 144·225·274·279). 특히 "광역 권한 보유 시 cross-origin 만료 미발생"이 **이제 실제로 성립**하므로 설명을 사실에 맞춤(현재는 잘못된 전제).
- `docs/privacy.md` — line 92·139의 `https://*/*`, `http://*/*` 표기를 `<all_urls>`로. 시행일 갱신.
- `guide/` — 30s Replay 권한 안내에 광역 권한 문자열이 노출되면 ko·en 대조(가이드 영향 절 참조).

## 데이터 흐름

권한 객체만 바뀌고 상태/메시지/스토리지 구조는 불변.

```
[replay 토글 ON]
  SettingsTab.handleReplayToggle
    → chrome.permissions.contains({origins: ["<all_urls>"]})
    → false면 chrome.permissions.request({origins: ["<all_urls>"]})  // 다이얼로그
    → granted면 setReplayEnabled(true)

[replay 폴링]
  use-30s-replay useEffect
    → contains({origins: ["<all_urls>"]})
    → false면 setReplayEnabled(false) + permissionRevoked 토스트  // 구 권한 보유자 마이그레이션 진입점
    → true면 600ms 폴링: captureVisibleTab (이제 <all_urls>로 cross-origin도 성공)

[A→B cross-origin navigation]
  tab-bindings.deactivatePanelIfCrossOrigin
    → sameOrigin=false → contains({origins: ["<all_urls>"]})=true
    → resolveNavigationAction(broadGranted=true, newUrlBroadCovered=http/https)
    → effectiveSameOrigin=true → "keep"/"clearSession" (deferred expiry 미발생)

[B에서 캡처/pick]
  captureVisibleTab → <all_urls> 권한으로 성공 (이전: activeTab 만료로 실패 → permission-expired)
```

## 인터페이스 설계

신규 타입·시그니처 없음. 상수 값만 변경.

```ts
// src/lib/broad-host-origins.ts
export const BROAD_HOST_ORIGINS = ["<all_urls>"];
```

`chrome.permissions.contains` / `request`의 `origins`는 match pattern 배열을 받으며 `<all_urls>`는 유효한 패턴이다. `optional_host_permissions`에 `<all_urls>`가 선언돼 있어야 `request`가 허용된다(둘을 함께 변경하므로 충족).

## 기존 패턴 준수

- **단일 출처 상수**: 광역 권한을 `BROAD_HOST_ORIGINS` 한 곳에서만 정의하는 기존 구조를 그대로 활용 — 소비처를 개별 수정하지 않는다(외과적 변경).
- **optional 권한 런타임 요청**: `chrome.permissions.request()`로 사용자 제스처 시점에 획득하는 현행 모델 유지(`PERMISSION.md` optional 라이프사이클).
- **문서 신선도 게이트**: manifest 권한·privacy 동작 변경 → `docs(PERMISSION)` / `docs(privacy)` 커밋으로 동반(CLAUDE.md 신선도 규칙).

## 대안 검토

### 대안 1: static `host_permissions`에 `<all_urls>` 추가
설치 시점부터 항상 보유 → replay 토글 권한 요청 불필요, 마이그레이션 무관. **기각**: 모든 사용자에게 "모든 웹사이트" 권한을 설치 시 강제 → 스토어 심사·프라이버시 경고 부담이 크고, replay를 안 쓰는 사용자에게도 광역 권한이 박힌다. 옵트인 모델과 충돌.

### 대안 2: 권한 유지하고 캡처를 tabCapture/offscreen으로 교체
`captureVisibleTab` 대신 `tabCapture` 스트림 1프레임 추출로 우회. **기각**: 정적 스크린샷에 비해 구조가 무겁고(스트림·offscreen 문서), 다수 캡처 경로(area/inline/element/replay)를 전부 갈아야 함. 회귀 위험 대비 이득 없음.

### 대안 3: `["*://*/*"]` 사용
`<all_urls>` 대신 `*://*/*`. **기각**: `*://*/*`도 일반 host 패턴이라 captureVisibleTab 캡처 권한으로 **여전히 무효** — 원 문제를 못 고친다. 캡처 권한을 주는 건 `<all_urls>`(또는 activeTab)뿐.

## 위험 요소

- **`chrome.permissions.request({origins: ["<all_urls>"]})` 실동작 검증 필수**: API가 `<all_urls>`를 origins 인자로 받아 다이얼로그를 띄우고 grant되는지 실제 Chrome에서 확인. (manifest optional 선언과 짝이 맞아야 함.) — 수동 테스트 핵심 항목.
- **기존 사용자 replay 일시 비활성화**: 업데이트 직후 구 권한 보유자는 replay가 자동으로 꺼진다(설계된 마이그레이션). 사용자에게는 "다시 켜야 함"으로 보임 — 의도된 동작이나 UX 인지 필요.
- **권한 경고 확대**: `https://*/*`+`http://*/*` → `<all_urls>`. 사용자/스토어에 노출되는 경고 문구가 넓어질 수 있다(둘 다 "모든 사이트" 수준이라 실질 차이는 작지만 심사 시 확인).
- **`captureVisibleTab` 캡처 후에도 `<all_urls>` 권한이 즉시 반영되는지**: optional 권한 grant 직후 background/sidepanel 컨텍스트에서 캡처 권한이 바로 유효한지 확인(일반적으로 즉시 반영되나 cross-origin 시나리오로 검증).
- **file: 경계 회귀 없음 확인**: `isBroadCoveredUrl`이 file: 제외를 유지하므로 file: 페이지의 만료 동작이 그대로인지 회귀 확인.
