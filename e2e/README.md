# e2e 스위트 (Playwright)

Chrome 확장을 실제 브라우저에서 구동해 사용자 플로우를 검증하는 e2e 스위트. **무엇을 커버하는지·무엇이 빠졌는지·어떤 함정이 있는지의 단일 출처**다. 시나리오가 늘면 이 문서를 함께 갱신해 "어디에 뭐가 있나"를 재조사하지 않게 한다.

- **작성 절차·금지·실행-수정 루프는 `/e2e-write` 스킬**(`.claude/commands/e2e-write.md`)이 단일 출처 — 여기서 중복하지 않는다. 이 문서는 **커버리지 맵 · 수동 잔여 · 함정 · 헬퍼 참조**만 담는다.
- 빌드/실행: `pnpm build:e2e` → `pnpm test:e2e` (단일 spec: `pnpm test:e2e -- <이름 일부>`). dist-e2e는 **테스트 전용**(`<all_urls>` 포함, 수동 로드·스토어 업로드 금지).
- **창 깜빡임**: 확장 SW가 headless에선 안 깨어나 headed로만 돈다. 대신 브라우저 창을 화면 밖으로 보내 기본적으로 안 보인다. 디버깅으로 창을 직접 보려면 `E2E_SHOW=1 pnpm test:e2e`.

## 커버리지 맵

| spec | 시나리오 | 형태 |
|---|---|---|
| `activetab-broad-permission.spec.ts` | 광역 host 권한 보유 시 cross-origin 커버 URL 이동 → 패널 유지(세션만 정리·activated 보존) / 비커버 URL(chrome://) → deactivate / cross-origin 이동 후 `captureVisibleTab` 성공(<all_urls> 캡처 능력). bg storage(activated set·세션 키)·캡처 data URL을 SW로 판정 | 3 tests |
| `style-edit-flow.spec.ts` | 요소 선택 → 스타일 수정 → [다음] → drafting 진입 (next-step 경로 유일 커버) | 1 test |
| `style-changes-dialog.spec.ts` | 변경사항 다이얼로그 — 트리거 badge·요소별 카드·행/전체 초기화·세션 폐기 (16 체크 serial) | serial 16 |
| `style-changes-stacked.spec.ts` | 전 에디터 타입 스타일 누적 + shorthand collapse + class 편집 후 as-is baseline 보존 | serial 6 |
| `buffered-reselect-edit.spec.ts` | 버퍼 요소 재선택 → 편집 복원 → 추가 편집 후 재버퍼에 이전 편집 유지 | serial 2 |
| `dom-tree-nav.spec.ts` | DOM 트리 다이얼로그로 이동 시 현재 요소 편집이 버퍼에 유지 (회귀 — DomTree도 useBufferThenSwitch 경유) | 1 test |
| `capture.spec.ts` | screenshot 영역 드래그 캡처 / element-shot → drafting / element-shot previewing env DOM 행 (회귀) | 3 tests |
| `draft-resume.spec.ts` | to-preview(confirmDraft) 초안 저장 → 패널 재열기 → 이슈 목록 → DraftDetailDialog 내용 복원 | 1 test |
| `freeform-draft.spec.ts` | freeform 진입 → 제목·섹션 입력 → preview 렌더 → 마크다운 복사 페이로드(clipboard stub) | 1 test |
| `log-capture.spec.ts` | console·network 로그 수집 → 항목 표시 → network 상세 status → clear(양쪽) | serial 2 |
| `logs-cross-page.spec.ts` | same-origin 이동 후 로그 보존·누적(webNavigation 꼬리 sync) / reload 시 클리어 | serial 2 |
| `logs-iframe.spec.ts` | same-origin iframe 내부 console 로그 캡처 (all_frames + sentinel 경로) | 1 test |
| `logs-error-warn.spec.ts` | arm 중 page `console.error`/`console.warn` → error·warn 레벨 캡처 (`data-level` 단언) / iframe error 캡처 | serial 2 |
| `logs-origin-filter.spec.ts` | 127.0.0.1 top + localhost iframe cross-origin 로그 → OriginFilterBar 노출·필터링·해제 | 1 test |
| `onboarding.spec.ts` | 연동 0개 → integrations 탭 자동 진입 | 1 test |
| `picker-guard.spec.ts` | iframe 박스 선택 → 미지원 안내 다이얼로그 → picker idle 복귀 | 1 test |
| `replay-action-log.spec.ts` | 30s Replay 활성화 → 페이지 동작(click·input·hashchange) → Replay 캡처 → drafting(video) → action 로그 카드/다이얼로그(`data-kind` 단언) | serial 1 |
| `action-log-coverage.spec.ts` | Replay 캡처로 toggle(checkbox 직접·label[for]·radio)/select/keypress(Escape·Ctrl+K·Enter×2) 캡처 단언 + checkbox/label/radio click 이중기록 제거(click 0건) + 인쇄 문자 keypress 미발생(keypress 정확히 4) | serial 1 |
| `session.spec.ts` | 패널 닫기/재열기 세션 폐기 · 두 탭 독립 세션 (dialog spec test14/16 비중복분) | 2 tests |
| `settings-sections.spec.ts` | 이슈 섹션 토글(notes ON·expectedResult OFF) → drafting·preview 본문 반영 (finally로 기본값 복원) | 1 test |
| `attachments.spec.ts` | 파일 첨부 — 설정 토글(기본 OFF) 게이팅 → drafting 첨부 섹션 노출 / `setInputFiles` 다중 추가 → 카운터 갱신 / 개별 삭제 / 상한 10 도달 시 `10/10`+버튼 비활성 / 패널 재오픈 후 메타 복원 유지 / 토글 OFF 재숨김. settings 영속이라 afterAll OFF 복원 | serial 6 |
| `unsupported-url.spec.ts` | chrome:// 탭에서 mode 진입 → pickerUnavailable 다이얼로그 → idle 복귀 | 1 test |
| `ai-draft.spec.ts` | AI 초안(BYOK mock) — 선입력 텍스트가 요청 payload에 포함 + 이미지 없는 섹션 전체 교체 / inline 이미지 보존(상단 유지)+텍스트 교체 + payload에 `image_url` 포함 / 재생성 시 최신 선입력 반영. `panel.route("**/chat/completions")` mock + llm seed | serial 3 |
| `ai-styling.spec.ts` | AI 스타일링(BYOK mock) — element 선택 → AI 응답 `inlineStyle`이 페이지 DOM(`toHaveCSS`)·변경사항 다이얼로그(`changes-row`)에 적용 + 요청 발생 / payload에 선택 요소 스타일 컨텍스트 포함. ai-draft와 동일 mock 패턴(아래 함정) | serial 2 |

## 수동 잔여 (자동화 못 한 것 — 이유 포함)

스크립트로 판정 불가하거나 e2e 환경 제약으로 빠진 항목. 새로 자동화하면 위 맵으로 옮긴다.

- **picker unsupported URL 중 webstore 차단 호스트** — 실제 webstore 접근이 필요해 fixture 서버로 재현 불가 (미지원 *스킴* 가드는 `unsupported-url.spec.ts`가 chrome://로 커버).
- **수동 캡처 video 모드**(`mode-video`) — `getUserMedia`+`chrome.tabCapture` 의존이라 headed 자동화에서 fake media 없이는 불안정. (Replay 경로는 별개로 `replay-action-log.spec.ts`가 커버 — 아래 참고.)
- **단축키 4종**(`_execute_action`·capture-*) — Playwright는 확장 manifest commands를 발화할 수 없다(CDP 미지원).
- **permission-expired 다이얼로그** — activeTab 권한 만료 상태를 자동화로 재현하기 어렵다 (unsupported 분기만 커버).
- **광역 권한 보유 시 drafting cross-origin → deferred 만료 다이얼로그 부재** — 보존 세션 cross-origin은 keep(메시지 미발신)이라 "다이얼로그가 안 뜸"이라는 *부재* 단언이고, 가짜 패널 + deferred 메시지 broadcast는 SW로 관찰 불가. 분기 자체는 `resolveNavigationAction` 표 테스트(보존+커버→keep)와 `activetab-broad-permission.spec`의 비보존 keep 경로로 커버, 다이얼로그 부재는 tasks.md 수동 테스트로 검증.
- **광역 *미보유* 경로(닫힘·deferred)** — e2e 빌드는 `host_permissions: <all_urls>`라 `permissions.contains`가 항상 true → 미보유 분기 재현 불가. dev 빌드 + Replay 미승인 프로필로 수동 검증(tasks.md).
- **afterImage·캡처 썸네일 시각 정합** — 픽셀 비교라 스크립트 판정 불가. 행 수·색상 등으로 간접 단언만.
- **action 로그 필터 탭 376px 가로 오버플로** — `ActionLogContent`에 `min-w-0 overflow-x-auto` 래퍼로 처리(6종 동시 present 시 스크롤). e2e는 `--lang=ko`라 필터 라벨이 2자(클릭·이동·입력·키·토글·선택)라 376px에도 그냥 들어가 스크롤 경로를 의미 있게 타지 않음(라벨이 긴 en에서만 발생). 구조 픽스는 리뷰로 검증, 시각 확인은 수동(tasks.md).
- **CC 멘션 필드** — CC 콤보박스는 제출 다이얼로그(`SubmitFieldsDialog`/`IssueCreateModal`)의 플랫폼 `IssueFields` 안에만 존재하고, 그 다이얼로그는 플랫폼 OAuth 연결 account 전제라 e2e에서 진입 불가(플랫폼 필드 UI 전체가 동일 사유로 미커버). 멤버 목록도 실제 플랫폼 API 의존이라 fixture 서버로 재현 불가. 순수 로직(`cc @이름` 조립·이스케이프·Asana sentinel 치환)은 `ccMention.test.ts` 단위 테스트로 커버.
- **파일 첨부 — 실제 플랫폼 업로드·본문/네이티브 노출** — 6개 플랫폼 어댑터로의 첨부 업로드(GitHub/GitLab 본문 링크·Linear createAttachment·Notion file block·Jira/Asana 네이티브)는 OAuth 연결 account + 제출 다이얼로그 전제라 e2e 미진입(위 CC 항목과 동일 사유). 합류 로직은 `buildCaptureFiles.test.ts`(filename 고유화/displayName)·`attachmentLimits.test.ts` 단위 테스트로, IndexedDB rekey/정리는 수동(tasks.md). `attachments.spec.ts`는 drafting까지의 UI·세션 영속만 커버. **플랫폼 단건 한도 경고 배지(Notion 5MiB/GitLab 10MB 초과 시각)**도 한도 초과 파일 준비가 필요해 수동.

## 함정 (gotchas — 실전에서 밟은 것 누적)

새 spec 쓰기 전에 훑어 같은 함정을 반복하지 않는다.

- **spec 간 탭 누수**: worker fixture(persistent context)를 모든 spec이 공유한다. `beforeAll`로 연 탭/패널은 **반드시 `afterAll`로 닫는다**. 안 닫으면 후행 spec의 `fixtureTabId()`가 잔여 탭을 잡아 **실행 순서에 따라 실패**한다(파일명 알파벳 순 실행 — rename으로 순서가 바뀌면 드러난다).
- **`fixtureTabId` 모호성**: fixture 탭이 여러 개 열려 있으면 url 패턴을 명시한다 — `fixtureTabId("http://127.0.0.1/basic.html")`. 기본 패턴(`http://127.0.0.1/*`)은 첫 매칭 탭을 잡는다(chrome match pattern은 포트 무시).
- **`aria-disabled` 가드 버튼**: `next-step` 등은 `disabled`가 아니라 `aria-disabled`+클릭 가드다. Playwright actionability가 안 막으므로 클릭 전 `expect(btn).not.toHaveAttribute("aria-disabled","true")` 단언 필수 — 없으면 조용한 no-op.
- **Radix 팝오버·cmdk**: Escape가 중첩 팝오버에서 간헐 무시된다 → `closeAllPopovers`(Escape + outside-click 폴백)를 쓴다.
- **picker hover 타이밍**: hover 반영 전 클릭하면 빗나간다 → `pickElement`가 double rAF 후 클릭(내장).
- **repick 후 재선택**: repick 클릭 직후 바로 pick하지 말 것. 버퍼 스냅샷 캡처 완료(=`repick` 버튼 소실)를 기다린 뒤 pick한다.
- **로그 sync 타이밍**: 패널 마운트 시 레코더가 자동 활성화되지만 완료 신호가 없다. 로그 발생 + sync 주기(1500ms) 대기를 `expect(...).toPass()` polling으로 반복해 첫 캡처를 기다린다. **로그 탭은 `recording`/`drafting`/`previewing`/`done` phase(`logTabsLocked`)에서 비활성** — 로그 테스트는 idle에서. (`done`은 제출 후라 e2e 미도달 — OAuth 전제, 수동 잔여)
- **fresh 프로필 integrations 자동 전환**: 연동 0개면 integrations 탭으로 자동 전환되는 effect와 race가 난다. `enterDebug`가 `tab-debug` active 폴링으로 흡수한다 — 디버그 탭 진입은 이 헬퍼를 거친다. **다른 메인 탭(settings 등) 진입도 동일하게 클릭+active 폴링** 필요(settings-sections.spec의 `setSectionEnabled` 참고).
- **설정 영속 오염**: settings-ui-store는 chrome.storage에 영속돼 worker run 내 후행 spec까지 새어간다. 설정을 바꾸는 spec은 **`finally`로 기본값 복원**한다.
- **셀렉터**: `data-testid` 우선. 섹션 제목 등 i18n 텍스트 의존 금지. CSS prop 라벨(`color`/`padding`)만 하드코딩 허용. testid가 없으면 src에 **속성 추가만**(로직·구조 변경 금지) 후 `build:e2e` 재빌드. (예: 콘솔 엔트리 행은 `data-level`(log/info/warn/error/debug)을 노출 — 탭 필터 의존 없이 `[data-entry-id][data-level="error"]`로 레벨 단언.)
- **bg 패널 종료/유지(deactivatePanelIfCrossOrigin) 판정**: e2e 패널은 실제 side panel이 아니라 일반 Page라 `setOptions(enabled:false)`로 닫히지 않는다 → `waitForEvent("close")`로 판정 불가. 대신 bg가 유지하는 `sidePanel:activated`(number[]) / `editor:${tabId}` 세션 키를 SW `chrome.storage.session`으로 읽어 deactivate/keep을 판정한다(`activetab-broad-permission.spec`). 또한 이 분기는 **activated 탭에서만** 동작하는데(미활성 early-return), activated set은 액션 아이콘 클릭(activateTab)으로만 채워지고 Playwright는 확장 액션을 클릭할 수 없다 → SW로 직접 seed해 전제를 만든다. 탭 닫힘 시 `onRemoved`가 seed 키를 자동 정리하므로 후행 spec 누수 없음.
- **action 종류 단언은 `data-kind` + 리터럴 키 조합으로**: 행은 `data-kind`(click/input/navigation/keypress/toggle/select)를 노출하므로 종류별 `toHaveCount`로 센다. verb 문구는 i18n(ko)이라 텍스트 의존 금지지만, keypress의 **키 조합 값**(`Escape`·`Ctrl+K`·`Enter`)은 i18n 무관 리터럴이라 `hasText`로 안전하게 구분 가능. 이중기록 제거는 "그 동작만 수행하고 click을 0건으로 단언"하는 방식이 견고(action-log-coverage spec: 버튼·앵커 미클릭 → checkbox/label/radio click이 click으로 새면 0이 깨짐). 동작은 ready 확보 **후·캡처 직전**에 몰아 trim 윈도우(30s cap) 안에 확실히 넣는다.
- **30s Replay 캡처(action 로그 진입로)**: 수동 video(`getUserMedia`/`tabCapture`)와 달리 Replay는 `captureVisibleTab` 폴링이라 e2e `<all_urls>`로 동작한다(`replay-action-log.spec`). 세 가지 함정: ① **활성화** — 설정 issue 서브탭 `#replay-enabled` 스위치 토글. e2e는 `<all_urls>`라 `permissions.contains(BROAD_HOST_ORIGINS)`가 true → 프롬프트 없이 켜진다. chrome.storage 영속이므로 **`afterAll`로 off 복원**(설정 오염 함정). ② **버퍼 readiness** — Replay tick은 **fixture 탭이 active(front)**일 때만 `captureVisibleTab`한다. `fixture.bringToFront()`로 front를 잡고 ≥10프레임(600ms 간격) 쌓일 때까지 대기. 이때 패널은 백그라운드 탭이라 타이머가 throttle돼 프레임이 ~1/s로 느리게 쌓이니 ready 폴링 timeout을 넉넉히(≥45s). ready=`replay-button`의 `aria-disabled` 해제. ③ **action 캡처 타이밍** — 백그라운드 레코더가 idle 중 상시 action을 버퍼하고 `capture()`가 trim 윈도우(가드밴드 1500ms, 30s cap)로 잘라 첨부한다. 동작은 bringToFront 직후 수행하면 윈도우 안에 든다. 캡처→`encodeToMp4`(WebCodecs H.264, headed Chrome 동작 확인) 후 drafting(video) 전환 → action 로그 카드(`action-log-card`)/다이얼로그(행은 `data-kind` = click/input/navigation). **다이얼로그는 모달이라 열린 채 두면 후속 탭 전환 클릭이 오버레이에 막힌다 → 단언 후 Escape로 닫는다.**
- **`captureVisibleTab` rate-limit는 spec 경계를 넘는다**: Chrome은 `captureVisibleTab`에 `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`(~2회/초) quota를 건다. quota 초과 시 reject → 제품의 `captureAndCrop`이 `reset()`해 panel이 idle로 복귀(drafting 안 뜸). 이 quota는 **확장 전역**이라 한 spec의 캡처가 같은 run의 후행 spec까지 영향을 준다 — 알파벳 순서상 `action-log-coverage`·(이전) `activetab-broad-permission`의 캡처 폴링이 quota를 소진하면 뒤따르는 `capture.spec`이 간헐 red(단독 실행·repeat-each로는 재현 안 됨 — full-suite 부하에서만). 대응 두 가지: ① **캡처를 폴링하는 헬퍼는 버스트 금지** — `expect.poll`에 `intervals: [1000,...]`로 1초 간격 spaced 재시도 + throw를 ""로 흡수(`activetab-broad-permission`의 `captureVisibleTab`/`CAPTURE_POLL`). ② **캡처→drafting을 검증하는 spec은 quota 회복을 기다리는 재시도** — `captureUntilDrafting`(capture.spec)가 트리거(mode+선택)를 drafting 진입까지 1초+ 간격 `toPass`로 재시도(이미 drafting이면 재트리거 스킵). timeout 늘리기가 아니라 **간격을 quota 주기에 맞추는** 게 핵심.
- **패널 재오픈 후 탭은 비활성 — drafting-panel이 hidden**: 세션 복원 검증으로 `panel.close()` → `openPanel(tabId)` 하면 재오픈 패널의 기본 활성 탭이 debug가 아니라 drafting-panel이 `data-[state=inactive]:hidden`으로 숨는다(DOM엔 존재). 복원 확인 전 **`enterDebug(panel)`로 debug 탭을 다시 활성화**해야 visible 단언이 통과한다(`attachments.spec`). 또 닫기 전 session snapshot debounce(300ms)가 flush되도록 `waitForTimeout(400)` 후 닫는다.
- **`setInputFiles`는 hidden input에 직접 set + 비동기 반영**: 파일 첨부 `<input type=file>`은 `hidden`이지만 Playwright `setInputFiles`는 actionability를 우회해 그대로 set된다(디스크 파일 불필요 — `{name, mimeType, buffer}` 인라인). 단 `addAttachments`가 `saveAttachmentBlob`(IndexedDB) await 후 메타를 push하므로 추가 결과는 **`toHaveCount` polling**으로 기다린다(동기 단언 금지). 카운터는 버튼 라벨에 `n/10`으로 박혀 i18n 무관 숫자라 `toContainText("2/10")`로 안전하게 단언.
- **AI 기능 e2e는 BYOK mock으로만 — 빌트인 AI 불가**: Chrome 빌트인 AI(Gemini Nano)는 `globalThis.LanguageModel.availability()` 판정이라 Playwright 환경에서 항상 unavailable → AI 버튼 미노출. 대신 **BYOK(openai-compatible) 경로**를 쓴다(`ai-draft.spec`·`ai-styling.spec`): ① **llm seed** — `panel.evaluate(chrome.storage.local.set({"bugshot-app-settings": JSON.stringify({state:{llm:{baseUrl,apiKey:"",modelId}}, version:5})}))` 후 `panel.reload()`로 persist hydrate(`useAI`는 `llm.modelId`만 있으면 status=available, apiKey 무관). version은 settings-ui-store persist version(현재 5)과 일치시켜야 migration을 안 탄다. `baseUrl` hostname이 `api.anthropic.com`이 아니면 openai-compatible로 판정돼 `${baseUrl}/chat/completions`로 fetch. ② **응답 mock** — `panel.route("**/chat/completions", ...)`로 `{choices:[{message:{content: JSON.stringify(초안)}}]}` fulfill. **panel은 일반 Page라 `panel.route`가 확장 내부 fetch를 가로챈다**(extension page network). route 핸들러에서 `request().postDataJSON()`을 모아 요청 payload(선입력 텍스트=system content, 이미지=user content의 `image_url`)를 단언. ③ **route는 reload 후 설정** — reload 전에 걸면 무의미. apiKey obfuscation(`apiKeyObfuscatingStorage`)은 apiKey 필드만 deobfuscate하므로 seed에 `apiKey:""`면 그대로 통과(route가 키 검증 안 함).
- **inline 이미지 삽입은 유효한 PNG 버퍼 필수**: TiptapEditor 본문 이미지는 `section-image-input-<id>` file input에 `setInputFiles({name,mimeType:"image/png",buffer})`. 제품이 `createImageBitmap(file)`로 디코드하므로 **버퍼가 유효한 PNG여야** 한다(깨진 base64 → "The source image could not be decoded"로 img 미생성). 유효 1x1 PNG는 Python `zlib`+`struct`로 생성(spec 상단 상수). 삽입은 IndexedDB 저장 비동기라 `descEditor.locator("img")` `toBeVisible` polling으로 기다린다.
- **e2e 빌드 `<all_urls>` 중복 선언**: `BROAD_HOST_ORIGINS`가 `<all_urls>`로 바뀌면서 e2e 빌드는 `host_permissions`(manifest `isE2eBuild` 분기)와 `optional_host_permissions`(`BROAD_HOST_ORIGINS`) **둘 다**에 `<all_urls>`를 선언한다. Chrome은 이 중복을 합집합으로 허용 — 로드 에러·SW 미기동 없음(`activetab-broad-permission`·`replay-action-log` green으로 확인). 일반/store 빌드는 optional에만 `<all_urls>`라 무관. `permissions.contains(["<all_urls>"])`는 host의 `<all_urls>` 덕에 여전히 항상 true(미보유 분기 재현 불가 전제 유지).

## 헬퍼 · fixture 빠른 참조

전부 `fixtures/extension.ts`. 새 헬퍼를 추가하면 여기와 `DIRECTORY.md`에 반영한다.

- `ext` worker fixture — `fixtureUrl(page)` / `fixtureTabId(urlPattern?)` / `openPanel(tabId)` / `context`.
- `enterDebug(panel)` — 디버그 탭 진입(active 폴링).
- `enterDebugAndPick(fixture, panel, selector)` — 디버그 → element 모드 → 요소 선택 → `repick` 확인까지.
- `pickElement(fixture, panel, selector)` — bbox 중심 클릭(double rAF hover).
- `typeStyleValue(panel, label, value)` — ValueCombobox 팝오버 입력.
- `setQuadLinkedValue(panel, label, value)` — QuadProp(margin/padding) LinkToggle 4면 동일값.
- `setQuadSideValue(panel, label, sideIndex, value)` — QuadProp 개별 면(top/right/bottom/left) 입력.
- `selectStyleValue(panel, label, option)` — SelectProp(display/overflow 등) 옵션 텍스트 선택.
- `setAlignment(panel, label, idx)` — AlignmentProp(text-align) 탭 선택 (left0 center1 right2 justify3).
- `closeAllPopovers(panel)` — Escape + outside-click 폴백.

fixture 페이지(`fixtures/pages/`):

- `basic.html` — `#title`(color·padding 명시), `#card.card.box`, `#el1`–`#el3`(`.swatch` — 다요소 버퍼·재선택용), `#filler`(2000px).
- `second.html` — cross-page 세션 폐기 검증용(pageKey 상이).
- `iframe.html` — top frame + `#frame` iframe(src=basic.html, picker iframe 가드·iframe 로그 캡처용).
- `cross-origin.html` — `http://localhost:<port>/basic.html` iframe을 JS로 주입(동적 포트). 서버는 전 인터페이스 바인딩이라 localhost로도 접속돼 127.0.0.1 top과 origin이 갈라진다 — origin 필터용.
- `actions.html` — `#action-btn`(button) / `#action-input`(textbox, `aria-label`) / `#action-nav`(hashchange anchor) — action 레코더 click·input·navigation 입력 생성용(Replay action 로그 spec). 추가로 `#action-check`(checkbox 직접) / `#action-check-label`(`label[for]`) + `#action-check-labeled` / `#action-radio`(radio) / `#action-select`(select, `aria-label`) — toggle/select 및 click 이중기록 제거 검증용(action-log-coverage spec).

DOM 트리 다이얼로그: 요소 이름 헤더(`dom-tree-trigger`)로 열고, 트리 노드(`dom-tree-node` + `data-selector`)를 클릭해 이동.
