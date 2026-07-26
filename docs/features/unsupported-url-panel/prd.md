# 미지원 URL에서 사이드 패널 열기 + 미지원 안내

> 이 문서의 코드 인용은 모두 **HEAD `3655e7e` / v1.6.18** 기준이다. 리뷰 시 줄번호가 어긋나면 심볼명으로 대조할 것.

## 배경

### 증상: 툴바 아이콘 클릭이 조용히 삼켜진다

`src/lib/url-support.ts`의 `BLOCKED_HOSTS`가 `chromewebstore.google.com`을 미지원으로 판정한다. 차단 자체는 옳다 — Chrome이 그 호스트에 `chrome.scripting.executeScript`를 거부하며("The extensions gallery cannot be scripted."), `src/lib/__tests__/url-support.test.ts:27`이 설치 직후 URL과 동일한 모양(`https://chromewebstore.google.com/detail/ext/abc`)을 `false`로 고정하고 있다.

문제는 그 판정이 **패널 오픈까지 함께 막는다**는 것이다. `src/background/tab-bindings.ts:208-210`:

```ts
export function activateTab(tab: chrome.tabs.Tab): void {
  if (tab.id == null) return;
  if (!isSupportedUrl(tab.url)) return;   // ← 여기서 종료. setOptions·open 도달 못 함
```

`activateTab`은 진입점이 **3개**다 — `chrome.action.onClicked`(`tab-bindings.ts:253`), 단축키 `_execute_action`(Chrome이 내부적으로 `onClicked`로 라우팅), 컨텍스트 메뉴 `bugshot-activate`(`src/background/index.ts:79-81`). manifest `action`에 `default_popup`이 없으므로(`manifest.config.ts:22-28`) 세 경로 모두 이 함수로 수렴하고, 여기서 `return`하면 **클릭이 없었던 일이 된다.**

### 왜 완전 무음인가 — 안전망 3개가 모두 빗나간다

| 안전망 | 빗나가는 이유 |
|---|---|
| `default_popup` | 존재하지 않음 → 클릭만으로 뜰 UI가 없다 |
| 패널 셸에 에러 표시 | `onInstalled`/`onStartup`이 `disableGlobalSidePanel()`(`src/background/index.ts:31-35`)로 **tabId 없이** `setOptions({enabled:false})`를 호출해 패널이 전역 비활성. `activateTab`이 켜주기 전엔 패널이 아예 존재하지 않아 "지원 안 되는 페이지"를 그릴 표면이 없다 |
| `onPickerUnavailable` 미지원 안내 다이얼로그 | 이 가드는 **사이드 패널 안에** 산다(subscribe effect `src/sidepanel/App.tsx:151`, 다이얼로그 `:339-350`). 커버 범위는 "패널이 열려 있는데 탭이 race로 미지원 진입"이고, "패널이 애초에 안 열림"은 커버하지 않는다 |

배지·토스트·알림이 없고, 서비스워커 콘솔에 에러조차 없다(`throw`가 아니라 `return`이므로).

### 왜 고치는가 (1차 근거)

**무음 실패는 그 자체로 제품 결함이고, 수정 비용이 극히 낮다.** 사용자가 명시적으로 조작했는데 아무 피드백도 없으면 그 실패는 100% 제품에 귀속된다 — 사용자에게 자기가 뭘 잘못했는지 알려줄 방법이 없기 때문이다. 이 시점의 사용자는 확장의 동작 모델이 없어서 두 해석("이 페이지에선 안 되는구나" / "이 확장 고장났네")을 구분할 정보가 없다.

수정 규모는 프로덕션 파일 4개 + 신규 훅 1개다. 이 정당화만으로 충분하고, 아래 이탈 서사가 없어도 결론은 바뀌지 않는다.

### 이탈 가설 (2차 근거 — 미검증)

웹스토어 설치 버튼은 `chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig`에 있다. 스토어 경유 설치는 예외 없이 그 페이지에서 일어나므로 **설치 직후 활성 탭은 사실상 100% 이 URL**이다. 게다가 Chrome이 설치 완료 후 퍼즐 조각 "확장 프로그램이 추가되었습니다" 버블로 툴바 아이콘을 가리켜 **사실상 클릭을 지시**한다. 즉 버려지는 클릭이 **첫 클릭**일 수 있다.

- Product Hunt 런치 2026-07-14: Day Rank #9, upvote 126, follow 145
- 설치 수는 upvote를 상회했다(사용자 확인)
- 현재 스토어 유지 사용자 125명, 평점 4.8

> **주의: 이 인과는 가설이며, 위 숫자는 가설을 지지하지 않는다.** 설치가 150~200이라면 유지 125는 60~80%로 오히려 **높게** 읽힌다. 메커니즘은 코드로 확정되고 실측으로 재현했지만, 이탈 중 이 경로의 비중은 측정되지 않았다. 배제하지 못한 대안 가설: 권한 경고 부담(설치 퍼널 최대 이탈 관문), 기능 미스매치, 지연 activation(나중에 자기 사이트에서 다시 누르는 사용자 — 이 경우 결함 비용은 0). 목표 3(activation 퍼널 계측)이 이 가설들을 판별하는 사후 검증 수단이며, **배포 후 지표 상승을 승리로 해석하지 않는다**(위험 8 참조 — 미지원 페이지에서 패널이 열리는 것만으로 `sidepanel_opened`가 기계적으로 증가한다).

## 실측으로 확정한 사실

임시 프로브(`activateTab`의 가드 1줄 주석 처리) → `pnpm build` → 확장 리로드 → 수동 확인:

1. **`chrome.sidePanel.open()`은 미지원 URL에서도 정상 동작한다.** 웹스토어 페이지와 `chrome://settings` **양쪽에서 패널이 열렸고**, 서비스워커 콘솔 에러 0건. (`tab-bindings.ts:218-220`의 `sidePanel.open`엔 이미 `.catch` 로깅이 붙어 있어, 거부됐다면 로그가 찍힌다.)
2. 캡처를 시도하면 기존 `onPickerUnavailable` 안내 다이얼로그가 정상 발화한다.
3. Chrome 공식 sidePanel API 문서에 **URL 기반 제약은 문서화된 것이 없다.** 명시된 제약은 user gesture 요구뿐이고, content script 제약과는 별개 스코프다.

→ 즉 기존 무반응은 Chrome 정책이 아니라 **`activateTab`의 조기 `return`이 유일한 원인**이다. 프로브는 원복 완료(작업 트리 클린).

> **프로브가 확인하지 않은 것 (재실측 필요)**: 패널의 **지속성**. `apply()`(`tab-bindings.ts:37-68`)가 `activated && supported`를 보고 `setOptions({enabled:false})`를 실행하며 `onActivated`(`:255`)·`onUpdated`(`:272`) 경로에서 매번 돈다. 즉 가드만 지우면 패널이 열린 직후 **다음 탭 전환·네비게이션에 다시 닫힌다.** 그래서 `apply()` 수정이 Phase 1로 들어갔다(design.md 변경 범위). 프로브를 "패널 열기 → 다른 탭 → 복귀"까지 확장해 재실행할 것.

## 미지원 페이지에서의 기능 가용성 (전수 대조)

### Debug 탭

| 기능 | 가용 | 근거 |
|---|---|---|
| 요소 스타일 편집 | ✗ | `src/sidepanel/picker-control.ts:209` `ensureSupportedTab` 게이트 |
| 요소 캡처 | ✗ | `picker-control.ts:570` |
| 영역·화면·페이지 캡처 | ✗ | `picker-control.ts:537` |
| 인라인 영역 캡처 | ✗ | `picker-control.ts:600` |
| 이슈 작성(freeform) | ✗ | `picker-control.ts:763` |
| 콘솔·네트워크 로그 | ✗ | 로그 레코더가 content script(`manifest.config.ts` `matches:["<all_urls>"]`)라 `chrome://`엔 매칭 자체가 안 되고 웹스토어는 정책 차단 |
| 30s Replay | **△ 부분 동작** | `captureVisibleTab`은 `chrome://`에서 차단되지만 **웹스토어는 https라 `<all_urls>` 안이므로 캡처가 성공한다.** `src/sidepanel/30s-replay/use-30s-replay.ts:88`의 600ms 폴링엔 지원 게이트가 **없다**(`:85` 주석이 "`<all_urls>`가 required라 권한 확인 없이 폴링을 시작한다"고 전제를 명시 — 그 전제가 이 변경으로 깨진다) → 제품 결정으로 비활성(비목표 참조) |
| **녹화** | **△ 동작함** | `src/sidepanel/video-capture.ts:76`의 `startScreenCapture`엔 지원 게이트가 **없다**. `getDisplayMedia`는 시스템 피커라 페이지와 무관. 탭 녹화도 `tabCapture` 실패 시 화면 녹화로 자동 폴백(`video-capture.ts:42-43`) → 제품 결정으로 비활성(비목표 참조) |
| `[가이드]` 버튼 | ✓ | `IssueTab.tsx:333-339` `chrome.tabs.create` — 페이지 무관. **단 새 탭에는 패널이 따라오지 않는다**(패널은 탭 스코프 + 전역 비활성). 기존 동작이지만 이 변경으로 미지원 화면의 주 경로가 되면서 문제로 드러난다 — design.md 대안 I 참조 |
| `IntegrationsCta` | ✓ | `IssueTab.tsx:328-330`, 연동 0개일 때 노출 |

### 비-Debug 탭

`chrome.scripting` / `chrome.tabs.sendMessage` / `captureVisibleTab` / `getPageUrl` / `useBoundTabId` 전수 grep 결과:

| 기능 | 가용 | 근거 |
|---|---|---|
| 트래커 OAuth 8종 | ✓ | `chrome.identity.launchWebAuthFlow`(`background/oauth.ts:53`) — 자체 창, tabId 무관 |
| 트래커 토큰 인증 | ✓ | `src/sidepanel/tabs/connect/` 8개 폼 페이지 의존 0 |
| **LLM BYOK 연동** | ✓ | `tabs/settings/LlmConnectDialog.tsx` 페이지 의존 0. `requestHostPermission`(`sidepanel/lib/ai-provider.ts:595`)은 `chrome.permissions.request`이고 버튼 클릭이 gesture를 제공하며 `<all_urls>` 보유라 프롬프트도 없다 |
| 이슈 목록·상태 쓰기·Slack 승격 | ✓ | 페이지 의존은 `IssueListTab.tsx:227`이 렌더하는 `DraftDetailDialog`의 `clearPicker` **1건뿐**이고(8개 호출부 → `picker-control.ts:268` → `sendAll` `:119-128`), content script 부재 시 빈 `catch`로 무해하게 삼켜진다 |
| 설정 전체 | ✓ | `SettingsTab.tsx` 페이지 의존 0 |

App 최상위도 안전하다 — `chrome.tabs.connect`(`App.tsx:200`)가 content script 부재로 즉시 끊기지만 `lastError`를 삼키고(`:202`), reset 가드는 `phase === "capturing"` 조건이라 idle에선 발화하지 않는다. (단 그 port의 effect deps가 `[tabId]`라 한 번 죽으면 재연결되지 않는다 — design.md 위험 요소 10.)

**결론: Debug 탭만 막으면 된다.** 첫 실행에서 가장 중요한 트래커·LLM 연결이 전부 비-Debug 탭에 있고 정상 동작한다.

## 목표

1. **미지원 URL에서 툴바 아이콘 클릭이 무음으로 삼켜지지 않는다.** 패널이 열리고, 왜 안 되는지와 무엇을 해야 하는지를 텍스트로 알려준다. **열린 패널은 탭 전환·네비게이션을 넘어 유지된다.**
2. **미지원 페이지에서도 동작하는 기능(트래커·LLM 연동, 이슈 목록, 설정, 가이드)에 접근할 수 있다.** 패널 전체를 막지 않고, 안내 문구가 그 사실을 알린다.
3. **activation 퍼널을 판별 가능하게 계측한다.** `sidepanel_opened` 이벤트는 이미 존재하지만 허용 property가 `[]`라(`src/background/analytics.ts:30`) 열린 페이지가 지원인지 미지원인지 구분할 수 없다. `page_supported` property를 추가해 배포 후 지표 상승이 "미지원 페이지에서 패널이 열리게 된 기계적 증가"인지 "실제 activation 회복"인지 가를 수 있게 한다.
4. **지원 페이지로 이동하면 사용자 조작 없이 정상 UI로 복구된다.** 새로고침 버튼 같은 수동 조치를 요구하지 않는다.
5. (Phase 2) **동일 탭에서 지원 → 미지원으로 이동할 때 패널이 소리 없이 사라지지 않는다.** 범위는 **네비게이션 한정**이다 — 탭 전환은 비목표 참조.

## 비목표

- **설치 시점에 탭을 새로 열지 않는다.** `onInstalled` + `chrome.tabs.create`로 퀵스타트 페이지를 여는 안은 검토 후 기각(포커스 강탈이 개입으로 읽힘). 상세는 design.md "대안 검토".
- **새 권한을 추가하지 않는다.** `chrome.notifications`는 검토 후 기각. `tabs` 권한 추가도 기각(권한 경고 증가 + 심사 중 버전) — design.md 대안 J.
- **미지원 페이지에서 일부 기능만 살려두지 않는다.** 녹화와 30s Replay는 기술적으로 동작하지만 함께 비활성화한다. 근거는 design.md 대안 E.
- **미지원 탭으로 *전환*했을 때의 패널 유지는 다루지 않는다.** `onActivated` → `apply()` → 그 탭이 activated set에 없으면 `enabled:false`다. 목표 5는 동일 탭 네비게이션 한정이며, 탭 전환 대칭성은 별건이다.
- **`picker-unavailable-dialog`를 제거하지 않는다.** 주 트리거는 사라지지만 race 경로는 실재한다.
- **`IssueTab.tsx:265`의 기존 `UnsupportedPage`를 삭제하지 않는다.** 기존 dead code로 보이지만(`App.tsx:221`이 `tabId === null`을 먼저 전체화면으로 걸러냄) 이번 스코프가 아니다.
- **미지원 URL 판정 기준(`isSupportedUrl` / `BLOCKED_HOSTS`) 자체를 바꾸지 않는다.** 차단은 옳다.
- **`disableGlobalSidePanel()` / 전역 비활성 정책은 바꾸지 않는다.** 배경이 이 함수를 무음의 공범으로 지목하지만 `docs/ARCHITECTURE.md`가 탭 스코프 보장을 위해 이를 필수로 규정한다.
- **기존 `app.unsupported.*` 문구를 수정하지 않는다.** 이 키는 `App.tsx:488,490`의 전체화면 미지원 화면과 공유되므로 편집하면 무관한 화면이 함께 바뀐다. 새 문구는 신규 키로 만든다(`app.ts:47-48`의 "맥락이 다르면 값이 같아도 일부러 분리한다" 컨벤션).
- **`useTabSupport`를 다른 탭·`App.tsx`·`useBackgroundRecorder.ts:46`의 기존 게이트로 확산시키지 않는다.** 판정 출처가 늘어난다 — design.md 위험 요소 9.
- **신규 analytics 이벤트는 만들지 않는다.** 목표 3은 기존 `sidepanel_opened`에 property 1개를 더하는 것으로 한정한다.

## 사용자 시나리오

### S1. 설치 직후 (핵심 시나리오)

1. 웹스토어에서 설치 → Chrome이 퍼즐 버블로 아이콘을 가리킴
2. 사용자가 아이콘 클릭
3. **패널이 열린다.** Debug 탭이 기본 선택
4. 캡처 진입 화면 자리에 안내가 보인다: **"이 페이지에서는 캡처할 수 없습니다 / 브라우저가 확장 접근을 막아둔 화면이에요. 웹 페이지(http, https, file)에서 실행해주세요. 연동·설정은 지금 그대로 사용할 수 있어요."** (신규 i18n 키 — 기존 `app.unsupported.*`는 "BugShot 전체를 못 쓴다"는 뜻이라 목표 2와 어긋난다)
5. 콘솔·네트워크 서브탭은 비활성(로그가 쌓이지 않으므로)
6. 하단에는 `[가이드]`만 남는다(`[이슈 작성]`은 렌더되지 않음)
7. 연동이 0개면 `IntegrationsCta`가 보이고, 눌러 Integrations 탭으로 이동해 **트래커·LLM 연결을 그 자리에서 완주할 수 있다**
8. 그 도중 다른 탭을 봤다 돌아와도(OAuth 창 왕복 포함) **패널이 유지된다**
9. 사용자가 자기 사이트로 이동 → **패널이 스스로 정상 캡처 진입 화면으로 바뀐다** (수동 새로고침 불필요)

> **알려진 거스러미**: 3~4단계 사이에 캡처 버튼 5개가 1~3프레임 그려진 뒤 안내로 교체된다. `useTabSupport`의 초기 판정이 `chrome.tabs.get` 비동기 왕복을 필요로 하고, "판정 중"을 지원으로 접는 결정(기존 e2e 42개 spec 보호 — design.md 위험 요소 4)의 결과다. 수용된 트레이드오프.

### S2. `chrome://` 페이지에서 실행

S1의 4~9와 동일. `chrome://settings`에서 패널이 열리는 것은 실측 확인됨.

`chrome://` 탭은 host permission 밖이라 `tab.url`이 **항상 빈다**. 판정 규약은 "**빈 `tab.url` = 미지원**"이다 — `<all_urls>`가 required가 된 뒤 http/https는 activeTab과 무관하게 `tab.url`이 항상 읽히므로, 빈 값이 남는 경우는 미지원 스킴 또는 `file:` + 파일 접근 토글 off뿐이고 둘 다 캡처 불가라 안내가 옳다. 상세는 design.md "지원 여부 판정의 단일 출처".

### S3. 이미 연동을 마친 기존 사용자가 미지원 페이지에서 실행

S1과 동일하되 `IntegrationsCta`는 노출되지 않는다(연동 ≥ 1). 안내 + `[가이드]`만 보인다 — 문구가 "연동·설정은 사용할 수 있다"를 알리는 것이 이 시나리오에서 특히 중요하다.

단 같은 tabId에 **보존 세션**(drafting/previewing/done, 또는 video)이 남아 있으면 안내가 아니라 `DraftingPanel`/`PreviewPanel`이 그려진다 — 안내는 `isCaptureEntryScreen`(`IssueTab.tsx:241`) 가드 안에 산다. 의도된 동작이다(작성 중 세션이 안내보다 우선).

### S4. 지원 페이지에서 작업 중 미지원 페이지로 이동 (Phase 2)

- **현재**: 패널이 소리 없이 닫힌다(idle + 비보존 세션인 경우). `e2e/activetab-broad-permission.spec.ts:94-106`이 이 동작을 고정하고 있다.
- **변경 후**: 패널이 유지되고 S1의 4~7 상태를 보여준다. 다시 지원 페이지로 돌아오면 정상 화면으로 복구.
- **세션이 남아 있으면 안내 앞에 모달이 한 단계 낀다**: `clearSession`은 세션 키만 지우므로, `captureMode === "element" && phase === "styling"` 세션이 살아 있으면 `useEditorSessionSync`가 `sessionExpired`를 세워 `SessionExpiredDialog`가 뜬다. 오늘은 같은 순간에 패널이 파괴돼 이 모달을 아무도 못 봤다. Phase 2 후에는 **사용자가 모달을 닫아야 안내에 도달한다.** 스타일 편집 중 미지원 페이지로 이동하면 세션 손실이 사실이므로 알리는 것이 맞다는 판단 — 의도된 동작으로 수용한다.
- 작성 중 세션이 있으면(`shouldPreserveSession`) 기존 `notifyDeferredExpiry` 경로 유지 — 변경 없음.
- **미커버 구멍**: `captureMode === "element" && phase === "capturing"`(요소 캡처 진행 중)은 `useEditorSessionSync`의 `needsExpiry`·`needsReset` 두 분기 어디에도 걸리지 않는다. 오늘은 `deactivate`가 패널을 닫아 가려졌던 공백이 Phase 2로 드러난다 — design.md 위험 요소 8.

### S5. 엣지 — 캡처 시작 직후 탭이 미지원으로 이동 (race)

기존 `onPickerUnavailable` 다이얼로그가 계속 담당한다. 진입 화면에서 버튼이 사라지므로 이 다이얼로그의 주 트리거는 없어지지만, 경로 자체는 유지된다.

## 성공 기준

1. 웹스토어 페이지와 `chrome://settings`에서 툴바 아이콘을 클릭하면 패널이 열리고 미지원 안내 텍스트가 보인다 (수동 확인).
2. 그 상태에서 **다른 탭으로 전환했다 돌아와도 패널이 유지된다** (수동 확인 — `apply()` 수정 검증).
3. 같은 상태에서 Integrations 탭으로 이동해 트래커 1개를 실제로 연결할 수 있다 (수동 확인).
4. 미지원 페이지에서 패널을 연 뒤 주소창으로 `https://` 사이트로 이동하면, 조작 없이 캡처 진입 화면(`mode-element` 버튼)이 나타난다 (e2e).
5. 미지원 페이지에서 콘솔·네트워크 서브탭 트리거가 비활성이고 캡처 버튼 5개(`mode-element`·`mode-element-shot`·`mode-screenshot`·`mode-record`·`replay-button`)와 `[이슈 작성]`이 렌더되지 않는다 (e2e).
6. `activateTab`이 미지원 URL에서 `setOptions`+`open`을 **동기로** 호출한다 (단위 테스트 — user gesture 보존).
7. `sidepanel_opened`가 `page_supported` boolean을 실어 보낸다 (단위 테스트 — property 허용목록 통과 확인).
8. 신규 i18n 키 2개(ko/en 양쪽), 신규 권한 0개, 신규 analytics 이벤트 0개.
9. `pnpm test` 통과, `pnpm typecheck` 통과, 기존 e2e 스위트 green(수정된 2개 spec 포함).
10. (Phase 2) 동일 탭에서 지원 → `chrome://` 이동 시 activated set이 보존되고 패널이 유지된다 (e2e 단언 교체).

## 리뷰 반영 이력

`/feature-review` 1차(CPO·CDO·CTO·QA)에서 확정된 결정:

- Phase 경계 재조정 — `apply()` 수정을 Phase 1로 이동(Phase 1 단독으로 패널이 다시 닫히는 문제)
- 빈 `tab.url` = 미지원으로 규약 통일(S2·성공기준 1과 Task 3 검증이 양립 불가였음)
- `onUpdated`의 `info.url`이 미지원 전이에서 redact되는 문제 → `info.status` 경로에 `chrome.tabs.get` 폴백
- 미지원 전이 시 `setSub("issue")` 강제(stale 로그 화면에 갇혀 안내를 못 보는 문제)
- 신규 i18n 키 2개 허용(기존 문구가 목표 2를 부정)
- 목표 3을 `page_supported` property 추가로 검증 가능하게
- Phase 2의 구분자를 "미지원"이 아니라 "판독 가능 여부"로 분리 + `webNavigation`으로 URL 획득
- 30s Replay 폴링 게이트 추가, 교체 대상 버튼 4개 → 5개 정정
- `[이슈 작성]`을 `aria-disabled` 대신 렌더 제외
- `EmptyState` export + 순수 술어 추출로 테스트 실현성 확보
