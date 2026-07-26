# 미지원 URL에서 사이드 패널 열기 + 미지원 안내

> 이 문서의 코드 인용은 모두 **HEAD `3655e7e` / v1.6.18** 기준이다. 리뷰 시 줄번호가 어긋나면 심볼명으로 대조할 것.

## 배경

### 증상: 설치 직후 첫 클릭이 조용히 삼켜진다

웹스토어 설치 버튼은 `chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig`에 있다. 스토어 경유 설치는 예외 없이 그 페이지에서 일어나므로 **설치 직후 활성 탭은 사실상 100% 이 URL**이다.

그런데 `src/lib/url-support.ts`의 `BLOCKED_HOSTS`가 `chromewebstore.google.com`을 미지원으로 판정한다. 차단 자체는 옳다 — Chrome이 그 호스트에 `chrome.scripting.executeScript`를 거부하며("The extensions gallery cannot be scripted."), `src/lib/__tests__/url-support.test.ts:27`이 하필 설치 직후 URL과 동일한 모양(`https://chromewebstore.google.com/detail/ext/abc`)을 `false`로 고정하고 있다.

문제는 그 판정이 **패널 오픈까지 함께 막는다**는 것이다. `src/background/tab-bindings.ts:208-210`:

```ts
export function activateTab(tab: chrome.tabs.Tab): void {
  if (tab.id == null) return;
  if (!isSupportedUrl(tab.url)) return;   // ← 여기서 종료. setOptions·open 도달 못 함
```

`chrome.action.onClicked`의 유일한 핸들러가 이 함수다(`tab-bindings.ts:253`). manifest `action`에 `default_popup`이 없으므로(`manifest.config.ts:22-28`) 클릭은 전부 이 경로로 오고, 여기서 `return`하면 **클릭이 없었던 일이 된다.**

### 왜 완전 무음인가 — 안전망 3개가 모두 빗나간다

| 안전망 | 빗나가는 이유 |
|---|---|
| `default_popup` | 존재하지 않음 → 클릭만으로 뜰 UI가 없다 |
| 패널 셸에 에러 표시 | `onInstalled`/`onStartup`이 `disableGlobalSidePanel()`(`src/background/index.ts:31-36`)로 **tabId 없이** `setOptions({enabled:false})`를 호출해 패널이 전역 비활성. `activateTab`이 켜주기 전엔 패널이 아예 존재하지 않아 "지원 안 되는 페이지"를 그릴 표면이 없다 |
| `onPickerUnavailable` 미지원 안내 다이얼로그 | 이 가드는 **사이드 패널 안에** 산다(`src/sidepanel/App.tsx:151,339-350`). 커버 범위는 "패널이 열려 있는데 탭이 race로 미지원 진입"이고, "패널이 애초에 안 열림"은 커버하지 않는다 |

배지·토스트·알림이 없고, 서비스워커 콘솔에 에러조차 없다(`throw`가 아니라 `return`이므로).

### 왜 비용이 큰가

버려지는 클릭이 **첫 클릭**이다. 게다가 Chrome이 설치 완료 후 퍼즐 조각 "확장 프로그램이 추가되었습니다" 버블로 툴바 아이콘을 가리켜 **사실상 클릭을 지시**한다. 사용자는 지시를 따르고 아무 반응도 얻지 못한다.

이 시점의 사용자는 확장의 동작 모델이 없어서 두 해석을 구분할 정보가 없다:

- "이 페이지에선 안 되는구나" (사실)
- "이 확장 고장났네" (실제로 내리는 결론)

무음 실패는 사용자에게 자기가 뭘 잘못했는지 알려줄 방법이 없으므로 실패가 **100% 제품 귀속**된다.

### 지표 정합

- Product Hunt 런치 2026-07-14: Day Rank #9, upvote 126, follow 145
- 설치 수는 **upvote를 상회**했다(사용자 확인)
- 현재 스토어 유지 사용자 125명, 평점 4.8

즉 리치·전환이 아니라 **첫 접촉 이탈**이 새는 지점이라는 시그니처다. 위 메커니즘은 정확히 그 모양을 만든다 — 권한 경고(설치 퍼널 최대 이탈 관문)까지 넘긴 사용자가 마지막 한 클릭에서 잘린다.

> **주의**: 이 인과는 **가설**이다. 메커니즘은 코드로 확정됐고 실측으로 재현했지만, 이탈 중 이 경로의 비중은 측정되지 않았다. 아래 목표 3(activation 퍼널 계측)이 사후 검증 수단이다.

## 실측으로 확정한 사실

임시 프로브(`activateTab`의 가드 1줄 주석 처리) → `pnpm build` → 확장 리로드 → 수동 확인:

1. **`chrome.sidePanel.open()`은 미지원 URL에서도 정상 동작한다.** 웹스토어 페이지와 `chrome://settings` **양쪽에서 패널이 열렸고**, 서비스워커 콘솔 에러 0건. (`tab-bindings.ts:218-220`의 `sidePanel.open`엔 이미 `.catch` 로깅이 붙어 있어, 거부됐다면 로그가 찍힌다.)
2. 캡처를 시도하면 기존 `onPickerUnavailable` 안내 다이얼로그가 정상 발화한다.
3. Chrome 공식 sidePanel API 문서에 **URL 기반 제약은 문서화된 것이 없다.** 명시된 제약은 user gesture 요구뿐이고, content script 제약과는 별개 스코프다.

→ 즉 기존 무반응은 Chrome 정책이 아니라 **`activateTab`의 조기 `return`이 유일한 원인**이다. 프로브는 원복 완료(작업 트리 클린).

## 미지원 페이지에서의 기능 가용성 (전수 대조)

### Debug 탭

| 기능 | 가용 | 근거 |
|---|---|---|
| 요소 스타일 편집 | ✗ | `picker-control.ts:209` `ensureSupportedTab` 게이트 |
| 요소 캡처 | ✗ | `picker-control.ts:570` |
| 영역·화면·페이지 캡처 | ✗ | `picker-control.ts:537` |
| 인라인 영역 캡처 | ✗ | `picker-control.ts:600` |
| 이슈 작성(freeform) | ✗ | `picker-control.ts:763` |
| 콘솔·네트워크 로그 | ✗ | 로그 레코더가 content script(`manifest.config.ts` `matches:["<all_urls>"]`)라 `chrome://`엔 매칭 자체가 안 되고 웹스토어는 정책 차단 |
| 30s Replay | ✗ | `captureVisibleTab` 차단 |
| **녹화** | **△ 동작함** | `src/sidepanel/video-capture.ts:76`의 `startScreenCapture`엔 지원 게이트가 **없다**. `getDisplayMedia`는 시스템 피커라 페이지와 무관. 탭 녹화도 `tabCapture` 실패 시 화면 녹화로 자동 폴백(`video-capture.ts:42-43`) |
| `[가이드]` 버튼 | ✓ | `IssueTab.tsx:335` `chrome.tabs.create` — 페이지 무관 |
| `IntegrationsCta` | ✓ | `IssueTab.tsx:328-330`, 연동 0개일 때 노출 |

### 비-Debug 탭

`chrome.scripting` / `chrome.tabs.sendMessage` / `captureVisibleTab` / `getPageUrl` / `useBoundTabId` 전수 grep 결과 **의존 0**:

| 기능 | 가용 | 근거 |
|---|---|---|
| 트래커 OAuth 8종 | ✓ | `chrome.identity.launchWebAuthFlow`(`background/oauth.ts:53`) — 자체 창, tabId 무관 |
| 트래커 토큰 인증 | ✓ | `src/sidepanel/tabs/connect/` 8개 폼 페이지 의존 0 |
| **LLM BYOK 연동** | ✓ | `tabs/settings/LlmConnectDialog.tsx` 페이지 의존 0. `requestHostPermission`(`sidepanel/lib/ai-provider.ts:595`)은 `chrome.permissions.request`이고 버튼 클릭이 gesture를 제공하며 `<all_urls>` 보유라 프롬프트도 없다 |
| 이슈 목록·상태 쓰기·Slack 승격 | ✓ | `IssueListTab.tsx` 페이지 의존 0 |
| 설정 전체 | ✓ | `SettingsTab.tsx` 페이지 의존 0 |

App 최상위도 안전하다 — `chrome.tabs.connect`(`App.tsx:200`)가 content script 부재로 즉시 끊기지만 `lastError`를 삼키고(`:202`), reset 가드는 `phase === "capturing"` 조건이라 idle에선 발화하지 않는다.

**결론: Debug 탭만 막으면 된다.** 첫 실행에서 가장 중요한 트래커·LLM 연결이 전부 비-Debug 탭에 있고 정상 동작한다.

## 목표

1. **미지원 URL에서 툴바 아이콘 클릭이 무음으로 삼켜지지 않는다.** 패널이 열리고, 왜 안 되는지와 무엇을 해야 하는지를 텍스트로 알려준다.
2. **미지원 페이지에서도 동작하는 기능(트래커·LLM 연동, 이슈 목록, 설정, 가이드)에 접근할 수 있다.** 패널 전체를 막지 않는다.
3. **activation 퍼널을 계측 가능하게 만든다.** `extension_installed` → `sidepanel_opened` → 첫 캡처. 현재는 미지원 페이지에서 패널이 안 열려 두 번째 단계가 관측되지 않는다.
4. **지원 페이지로 이동하면 사용자 조작 없이 정상 UI로 복구된다.** 새로고침 버튼 같은 수동 조치를 요구하지 않는다.
5. (Phase 2) **지원 → 미지원 이동 시에도 패널이 소리 없이 사라지지 않는다.** 방향 대칭.

## 비목표

- **설치 시점에 탭을 새로 열지 않는다.** `onInstalled` + `chrome.tabs.create`로 퀵스타트 페이지를 여는 안은 검토 후 기각(포커스 강탈이 개입으로 읽힘). 상세는 design.md "대안 검토".
- **새 권한을 추가하지 않는다.** `chrome.notifications`는 검토 후 기각.
- **미지원 페이지에서 일부 기능만 살려두지 않는다.** 녹화는 기술적으로 동작하지만 콘솔·네트워크 로그가 없는 녹화는 반쪽이고, 회색 버튼이 섞인 화면이 더 헷갈린다는 판단으로 함께 비활성화한다.
- **`picker-unavailable-dialog`를 제거하지 않는다.** 주 트리거는 사라지지만 race 경로는 실재한다.
- **`IssueTab.tsx:265`의 기존 `UnsupportedPage`를 삭제하지 않는다.** 기존 dead code로 보이지만(`App.tsx:221`이 `tabId === null`을 먼저 전체화면으로 걸러냄) 이번 스코프가 아니다.
- **미지원 URL 판정 기준(`isSupportedUrl` / `BLOCKED_HOSTS`) 자체를 바꾸지 않는다.** 차단은 옳다.

## 사용자 시나리오

### S1. 설치 직후 (핵심 시나리오)

1. 웹스토어에서 설치 → Chrome이 퍼즐 버블로 아이콘을 가리킴
2. 사용자가 아이콘 클릭
3. **패널이 열린다.** Debug 탭이 기본 선택
4. 캡처 진입 화면 자리에 안내가 보인다: **"이 페이지에서는 사용할 수 없습니다 / 웹 페이지(http, https, file)에서 BugShot을 실행해주세요."**
5. 콘솔·네트워크 서브탭은 비활성(로그가 쌓이지 않으므로)
6. 하단 `[가이드]`는 활성, `[이슈 작성]`은 잠금
7. 연동이 0개면 `IntegrationsCta`가 보이고, 눌러 Integrations 탭으로 이동해 **트래커·LLM 연결을 그 자리에서 완주할 수 있다**
8. 사용자가 자기 사이트로 이동 → **패널이 스스로 정상 캡처 진입 화면으로 바뀐다** (수동 새로고침 불필요)

### S2. `chrome://` 페이지에서 실행

S1의 4~8과 동일. `chrome://settings`에서 패널이 열리는 것은 실측 확인됨.

### S3. 이미 연동을 마친 기존 사용자가 미지원 페이지에서 실행

S1과 동일하되 `IntegrationsCta`는 노출되지 않는다(연동 ≥ 1). 안내 + `[가이드]`만 보인다.

### S4. 지원 페이지에서 작업 중 미지원 페이지로 이동 (Phase 2)

- **현재**: 패널이 소리 없이 닫힌다(idle + 비보존 세션인 경우). `e2e/activetab-broad-permission.spec.ts:94-101`이 이 동작을 고정하고 있다.
- **변경 후**: 패널이 유지되고 S1의 4~7 상태를 보여준다. 다시 지원 페이지로 돌아오면 정상 화면으로 복구.
- 작성 중 세션이 있으면(`shouldPreserveSession`) 기존 `notifyDeferredExpiry` 경로 유지 — 변경 없음.

### S5. 엣지 — 캡처 시작 직후 탭이 미지원으로 이동 (race)

기존 `onPickerUnavailable` 다이얼로그가 계속 담당한다. 진입 화면에서 버튼이 사라지므로 이 다이얼로그의 주 트리거는 없어지지만, 경로 자체는 유지된다.

## 성공 기준

1. 웹스토어 페이지와 `chrome://settings`에서 툴바 아이콘을 클릭하면 패널이 열리고 미지원 안내 텍스트가 보인다 (수동 확인).
2. 같은 상태에서 Integrations 탭으로 이동해 트래커 1개를 실제로 연결할 수 있다 (수동 확인).
3. 미지원 페이지에서 패널을 연 뒤 주소창으로 `https://` 사이트로 이동하면, 조작 없이 캡처 진입 화면(`mode-element` 버튼)이 나타난다 (e2e).
4. 미지원 페이지에서 콘솔·네트워크 서브탭 트리거가 비활성이고 `[이슈 작성]`이 잠겨 있다 (e2e).
5. `activateTab`이 미지원 URL에서 `setOptions`+`open`을 **동기로** 호출한다 (단위 테스트 — user gesture 보존).
6. 신규 i18n 키 0개, 신규 권한 0개.
7. `pnpm test` 통과, `pnpm typecheck` 통과, 기존 e2e 스위트 green(수정된 2개 spec 포함).
8. (Phase 2) 지원 → `chrome://` 이동 시 activated set이 보존되고 패널이 유지된다 (e2e 단언 교체).

## 리뷰어가 특히 따져줬으면 하는 것

- 목표 1의 해법으로 "패널을 열어 안내"가 맞는가. 기각한 대안 4개(설치 시 탭 열기 / OS 알림 / 배지·툴팁 / 탭 리다이렉트)의 기각 근거가 타당한가 → design.md "대안 검토"
- 녹화를 함께 비활성화하는 제품 결정. 기술적으로는 동작하는 기능을 끄는 것이다
- Phase 2에서 `resolveNavigationAction`의 `deactivate` → `clearSession` 라우팅 변경이 권한 라이프사이클에 의도치 않은 구멍을 만들지 않는가
- 배경의 인과 가설(무음 클릭 → 이탈)이 과대 해석은 아닌가. 대안 가설(권한 경고 부담, 기능 미스매치)을 배제하지 않았다
