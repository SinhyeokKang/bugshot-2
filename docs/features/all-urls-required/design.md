# `<all_urls>` required 승격 — 기술 설계

## 개요

`<all_urls>`를 `optional_host_permissions`에서 `host_permissions`로 옮긴다(required). 이로써 `chrome.permissions.contains/request`로 광역 권한을 확인·요청하던 3개 지점(30s Replay 토글, Replay 폴링 게이트, tab-bindings cross-origin 분기)이 모두 "항상 보유" 전제로 단순화된다. 30s Replay는 권한이 아니라 리소스 점유 opt-in이므로 `replayEnabled` 토글과 폴링 시작/중단 로직은 유지하되, 권한 체크만 떼어낸다. BYOK/GitLab의 `requestHostPermission`은 `<all_urls>` 보유 상태에서 즉시 grant 반환(프롬프트 없음)이라 호출을 남겨도 무해하다(외과적 유지). manifest의 e2e 전용 `<all_urls>` 조건 분기는 이제 기본 포함이라 제거된다.

## 변경 범위

### `manifest.config.ts` (라인 88–103)
- 현재: `optional_host_permissions: ["<all_urls>"]` (88), `host_permissions`에 명시 도메인 + `isE2eBuild ? ["<all_urls>"] : []` (102).
- 변경: `optional_host_permissions` 키 삭제. `host_permissions` 배열에 `"<all_urls>"` 상시 추가하고 `isE2eBuild` 조건 분기 제거. 명시 도메인(atlassian 등)은 `<all_urls>`에 포섭되나, 스토어 심사 가독성·문서 일관성을 위해 **유지할지/정리할지는 구현 시 결정**(유지가 외과적). proxyMatch 분기는 그대로.

### `src/sidepanel/components/RecordingSettingsCard.tsx` (라인 25–39)
- 현재: `handleReplayToggle`이 `permissions.contains` → `permissions.request` 후 `setReplayEnabled(true)`, 거부 시 toast.
- 변경: 권한 로직 전부 제거. `handleReplayToggle = (next) => setReplayEnabled(next)` 수준으로 축약(async 불필요). `BROAD_HOST_ORIGINS`·`toast`·`useT`(권한 메시지용) import 정리. `settings.replay.permissionDenied` i18n 키는 사용처 소멸 시 제거(ko/en 동시).

### `src/sidepanel/30s-replay/use-30s-replay.ts` (라인 85–96)
- 현재: 폴링 시작 전 `permissions.contains` 게이트 — 미보유면 `setReplayEnabled(false)`.
- 변경: contains 게이트 제거. `replayEnabled && tabId != null`이면 바로 `setInterval(tick, CAPTURE_INTERVAL_MS)` 시작. `BROAD_HOST_ORIGINS` import 정리. (cancelled 가드·displayId 타이머 로직은 유지.)

### `src/background/tab-bindings.ts` (라인 177–186)
- 현재: cross-origin이면 `chrome.permissions.contains({origins: BROAD_HOST_ORIGINS})`로 `broadGranted` 산출.
- 변경: contains 호출 제거. `broadGranted`를 `true`로 고정해 `resolveNavigationAction`에 전달(또는 `isBroadCoveredUrl(newUrl)`만으로 판정 — 의미 동일: 광역 보유 전제이므로 newUrl이 http/https면 패널 유지). `resolveNavigationAction` 순수 함수(117–131)는 **시그니처·로직 불변**(단위 테스트 유지). `BROAD_HOST_ORIGINS` import가 tab-bindings에서만 마지막으로 쓰였다면 정리.
- **stale 주석 갱신**: 시그니처를 보존하므로 `broadGranted` 파라미터가 항상 `true`만 받게 된다 → `resolveNavigationAction` 계약 주석(114–116), `deactivatePanelIfCrossOrigin`의 "광역 권한 미부여 → cross-origin 간주" 주석(151), `tab-bindings.test.ts`의 `legacyCases`(broadGranted=false)가 **런타임 도달 불가** 시나리오를 설명하게 됨. 주석을 "미보유 분기는 required 승격 후 프로덕션 미도달, 순수함수 안전망으로만 보존"으로 갱신. `legacyCases`는 회귀 자산으로 유지하되 동일 취지 주석 1줄 추가.

### `src/lib/broad-host-origins.ts` (+ `__tests__/broad-host-origins.test.ts`)
- 현재: `BROAD_HOST_ORIGINS = ["<all_urls>"]`. 사용처: RecordingSettingsCard·use-30s-replay·tab-bindings.
- 변경: 위 3개 사용처가 모두 제거되면 상수·테스트가 고아가 됨 → **내 변경이 만든 고아**라 삭제. (ai-provider의 `requestHostPermission`은 이 상수를 쓰지 않으므로 무관.)

### `src/sidepanel/lib/ai-provider.ts` (`requestHostPermission`, 라인 389–394) — 무변경(검토만)
- 현재: BYOK/GitLab이 **입력 origin만**(`${url.protocol}//${url.host}/*`) `chrome.permissions.request`. `<all_urls>`를 required로 보유하면 그 하위 origin 요청이 **상위에 포섭**돼 Chrome이 프롬프트 없이 즉시 true 반환(이미 보유한 권한의 하위 패턴 요청은 동기 grant).
- 변경: **없음**(외과적). 호출 유지해도 즉시 grant라 UX상 프롬프트만 사라짐. `LlmConnectDialog`·`GitlabConnectForm`의 거부 분기(`llm.error.permission`·`gitlab.selfManaged.permissionDenied` toast)는 도달 불가 경로가 되지만 제거는 별도 정리 사항(이번 스코프 외) — **dead UX 카피·i18n 키로 남는다는 점**을 인지. 코드를 남기므로 해당 i18n 키도 남긴다(스코프 일관성).
- **UX trade-off**: 프롬프트 소멸로 "이 확장이 내가 입력한 baseUrl에 접근한다"는 인지 모먼트가 사라진다. BYOK는 API 키를 사용자 지정 엔드포인트로 직접 전송하는 동작이라 접근 인지가 보안상 의미가 있으나, `LlmConnectDialog`의 `llm.apiKey.help` 카피("이 기기에만 저장, 선택 엔드포인트로 직접 전송")가 그 인지를 텍스트로 대체한다(별도 UI 보강 불필요).

### 문서 (필수)
- `docs/privacy.md`: 광역 host 권한이 optional→required로, 모든 사이트 데이터 접근이 기본임을 명시(시행일).
- `PERMISSION.md`: `<all_urls>` 항목을 optional→required로 이동, 용도 갱신, 런타임 요청 흐름 삭제 반영.
- `README.md`: 권한 설명·설치 안내 갱신.
- `CLAUDE.md`: 게이트웨이 섹션의 `optional_host_permissions: <all_urls>` 서술을 required로 수정. **추가로 `BUGSHOT_E2E_BUILD` 설명**("manifest host_permissions에 `<all_urls>` 추가 — 테스트 전용")이 stale가 됨 — isE2eBuild 분기 제거로 e2e/prod host_permissions가 동일해지므로 "`<all_urls>`는 이제 prod에도 포함, e2e 빌드의 권한 차이 없음(분리 이유는 outDir 격리·dev key)"으로 수정.
- `e2e/README.md`(89·109행): `BROAD_HOST_ORIGINS`·`permissions.contains`·"optional vs host `<all_urls>` 중복 선언" 서술이 stale → 갱신(상수 삭제·게이트 제거·중복 분기 제거 반영).

### e2e
- `e2e/activetab-broad-permission.spec.ts`: **실측 결과 이미 broad-held(`<all_urls>` 보유) 경로만 단언**(dist-e2e가 항상 `<all_urls>`라 미보유 경로는 e2e에 부재). 따라서 "미보유 시나리오 제거"가 아니라 **기존 단언이 그대로 green인지 재확인** + cross-origin keep 단언(test1: 127.0.0.1→localhost cover-URL 이동 → `isActivated=true`)이 회귀 가드임을 명시. spec 헤더 주석(6–8행)이 `permissions.contains(BROAD_HOST_ORIGINS)` 전제를 설명하므로 그 주석도 갱신. 미보유 분기는 `tab-bindings.test.ts` legacyCases(순수함수)에만 존재.

## 데이터 흐름

```
[변경 전] Replay 토글 ON
  → permissions.contains → request → (grant) → setReplayEnabled(true) → 폴링

[변경 후] Replay 토글 ON
  → setReplayEnabled(true) → 폴링  (권한은 이미 required로 보유)

[변경 전] cross-origin navigation
  → permissions.contains(<all_urls>) → broadGranted → resolveNavigationAction

[변경 후] cross-origin navigation
  → broadGranted=true 고정 → resolveNavigationAction  (http/https면 패널 유지)
```

`replayEnabled`는 기존대로 `useSettingsUiStore`(persist: `bugshot-app-settings`, chrome.local)에 저장 — 변경 없음.

## 인터페이스 설계

새 타입 없음. 시그니처 변경 핵심:

```ts
// RecordingSettingsCard.tsx — async 제거
const handleReplayToggle = (next: boolean) => setReplayEnabled(next);

// tab-bindings.ts deactivatePanelIfCrossOrigin 내부
// (변경 전) let broadGranted = false; if (!sameOrigin) broadGranted = await contains(...)
// (변경 후) const broadGranted = true;  // <all_urls> required
// resolveNavigationAction 시그니처는 그대로(broadGranted: boolean 인자 유지)
```

`resolveNavigationAction`은 순수 함수로 남겨 호출부만 `true`를 넘긴다 — 회귀 테스트 자산 보존.

## 기존 패턴 준수

- **i18n 동시 갱신**: `settings.replay.permissionDenied` 등 삭제 키는 ko/en 양쪽 동시(PostToolUse 훅이 대칭 검사).
- **순수 함수 테스트 보존**: `resolveNavigationAction` 시그니처 불변으로 `tab-bindings.test.ts` 유지.
- **고아 제거 한정**: `BROAD_HOST_ORIGINS`는 이번 변경이 사용처를 모두 없앤 경우에만 삭제(CLAUDE.md "내 변경이 만든 고아만").
- **문서 신선도**: manifest 권한 변경 → privacy/PERMISSION/README/CLAUDE + `/push` 게이트.

## 대안 검토

- **optional 유지 + cross-origin은 grant된 사용자만**(직전 cross-origin-styles 결정): 반쪽 기능·권한 프롬프트 잔존. 사용자가 required 승격으로 전환 결정.
- **`https://*/*` + `http://*/*`로 좁히기**: 경고 문구 사실상 동일("모든 사이트"), file 명시 제외로 SUPPORTED_SCHEMES(http/https/file)와 어긋남. `<all_urls>`가 e2e와 일치해 단순.
- **Replay 토글까지 제거**(권한=기능 동일시): Replay는 리소스 점유라 토글이 권한과 독립적으로 필요. 유지.
- **명시 도메인 host_permissions 전부 삭제**(`<all_urls>`가 포섭): 스토어 심사 가독성 저하 + diff 확대. 유지가 외과적.

## 위험 요소

- **기존 사용자 자동 비활성화**: Chrome은 host_permission 확대 시 확장을 비활성화하고 재동의 요구 → 현 ~100명 재활성화 필요, 이탈 위험. **비가역·제품 영향**, 배포 노트·스토어 설명에 안내. (코드로 회피 불가.)
- **스토어 심사**: broad host 정당화 필요("임의 웹페이지의 DOM/스타일/스크린샷/로그 캡처가 핵심 기능"). privacy.md 정합 필수.
- **cross-origin 패널 동작 변화**: 변경 전 권한 미보유자는 cross-origin에서 패널이 닫혔으나, 변경 후 모든 사용자가 http/https cross-origin에서 패널 유지. 의도된 개선이나 동작 변화이므로 회귀 테스트로 확인.
- **e2e 권한 전제 spec**: 권한 미보유 분기를 검증하던 spec이 항상-보유로 깨짐 → 갱신 필요(activetab-broad-permission 등).
- **cross-origin-styles feature와의 관계**: 이 변경이 먼저 머지되면 cross-origin-styles 설계의 `permissions.contains(<all_urls>)` 게이트가 불필요해짐(항상 true) → 그 feature 구현 시 게이트 생략·단순화. 두 문서가 같은 권한을 다루므로 구현 순서상 **all-urls-required 선행** 권장.
- **file: 회귀**: `isBroadCoveredUrl`의 file: 배제(133–145)를 건드리지 말 것 — `<all_urls>`가 file을 명목 포함해도 Chrome 별도 토글이 필요하므로 분기 유지.
