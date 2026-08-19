# CLAUDE.md

## 응답 스타일 (이 문서의 다른 모든 규칙보다 우선)

**한국어로, 간결하게.** 위반 시 답변을 다시 쓴다. 아래는 취향이 아니라 판정 기준이다.

- **첫 문장이 결론**: 서두·예고 금지 — "~해보겠습니다", "좋은 질문입니다", "확인해보니 다음과 같습니다" 류로 시작하지 않는다. 바로 답/결과부터.
- **꾸밈말 금지**: "완벽합니다", "훌륭한", "핵심적인", "말씀하신 대로" 같은 평가·동조 표현을 빼도 정보가 안 줄면 뺀다.
- **재진술 금지**: 방금 보여준 diff·명령 출력·파일 내용을 산문으로 다시 설명하지 않는다. 코드가 말하는 건 코드가 말하게 둔다.
- **길이 상한**: 단순 질문·확인 → 3줄 이내. 작업 완료 보고엔 줄 수 상한이 없다 — 필요한 정보를 줄이면서까지 짧게 만들지 않는다. 대신 위의 재진술·꾸밈말 금지로 군더더기만 덜어낸다.
- **미완·실패를 먼저**: 못 한 것·실패한 테스트·건너뛴 범위를 성공 요약보다 앞에 쓴다.
- **선택지 나열 금지**: 추천 하나를 고르고 그 이유 한 줄. 사용자 결정이 필요한 지점(작업 원칙의 "가정을 명시")만 예외.
- **예외**: 코드·커밋 메시지·PR title/body·GitHub Release notes는 영문(코드 컨벤션 참조). 문서(`docs/`·`guide/ko`)의 본문 톤은 각 문서 규칙을 따른다 — 이 섹션은 **대화 응답**에만 적용된다.

강제 장치는 2단이다: 이 섹션(두 런타임 공통 — Codex는 `AGENTS.md` 미러로 받는다)과, `.claude/settings.json`의 `UserPromptSubmit` 훅이 매 턴 같은 규칙 요약을 컨텍스트에 재주입하는 것(긴 세션에서 문서 앞쪽이 희석되는 걸 막는다). **훅은 Claude Code 전용이라 Codex 세션에선 이 섹션만 남는다.**

bugshot-2: Chrome MV3 Side Panel 버그 리포팅 확장. 웹 페이지의 버그를 요소 스타일 편집(before/after 비교)·스크린샷(영역/화면/페이지 전체/요소, 어노테이션)·영상 녹화(탭/화면, 30초 리플레이) 중 원하는 방식으로 캡처하고, 콘솔·네트워크·사용자 액션 로그를 자동 수집한다. 이렇게 만든 리포트를 Jira·GitHub·Linear·Notion·GitLab·Asana·ClickUp 이슈로 등록하거나 Slack 채널·DM으로 공유한다.

## 코어 밸류: Privacy (클라이언트 온리)

**BugShot의 코어 밸류이자 경쟁 우위 축.** 버그 리포트에는 프로덕션 세션의 가장 민감한 단면이 담긴다 — 스크린샷 속 고객 데이터, network 로그의 토큰과 페이로드, console에 찍힌 내부 식별자. 그래서 BugShot은 그걸 **가져가지 않는 쪽**을 택했다. 캡처 데이터(스크린샷·영상·console/network/action 로그·CSS diff·리포트 본문)는 BugShot 서버를 거치지 않고 **사용자 브라우저 → 사용자의 이슈 트래커/Slack으로 직행**한다. 사용자가 AI 기능을 실행하면 필요한 프롬프트·로그 요약·캡처/인라인 이미지는 **사용자가 선택한 LLM endpoint로 직접 전송**된다. BugShot 서버를 지나는 건 **OAuth 토큰 교환 프록시**(`VITE_OAUTH_PROXY_URL`)뿐이고, 익명 PostHog 집계는 설정된 분석 host로 직접 전송된다(`in.bug-shot.com` — BugShot 도메인이지만 CNAME이 PostHog Cloud를 직접 가리키는 리버스 프록시라 BugShot 서버는 이 경로에도 없다) — 어느 경로에도 캡처 데이터가 BugShot 서버를 거치지 않는다.

이건 정책이 아니라 구조다. "안 보겠다"는 약속이 아니라 **물리적으로 볼 수 없게** 만들어둔 것 — 규제·보안 민감 조직에게 약속과 구조의 차이는 검증 가능성의 차이다. 호스팅 저장소·워크스페이스를 두는 SaaS 모델은 필연적으로 이 구조를 깬다. 편의를 좇아 무서버·데이터 직행을 포기하는 건 기능 추가가 아니라 **제품 정체성 변경**으로 취급한다. 절대적 제약은 아니지만, 새 기능이 캡처 데이터를 외부 서버로 보내야 하면 이 밸류와 충돌하는지 먼저 따진다.

## 작업 원칙

- **가정을 명시**: 해석이 여러 개면 조용히 하나 고르지 말고 선택지를 제시. 불확실하면 물어라.
- **더 단순한 방법이 있으면 제안**: 200줄을 50줄로 줄일 수 있으면 줄여라. 요청하지 않은 유연성·설정 가능성·추상화 추가 금지.
- **외과적 변경**: 요청과 직접 관련 없는 인접 코드 개선·리팩터 금지. 기존 스타일 따르기. 기존 dead code는 언급만 하고 삭제하지 않는다 — 내 변경이 만든 고아만 제거.
- **검증 가능한 목표로 전환**: "버그 고쳐" → "재현 테스트 작성 후 통과시켜". 멀티스텝 작업은 단계별 검증 체크를 포함한 플랜을 먼저 제시.
- **테스트 우선**: 신규 인터페이스(함수·헬퍼·어댑터) 추가 시 테스트를 먼저 작성하고 구현한다. 기존 로직 변경 시에도 관련 순수 함수의 단위 테스트를 작성/갱신하고 `pnpm test` 통과를 확인한 뒤 작업을 마친다. 테스트 없이 코드만 변경하지 않는다.

## 스택

- React 18 + TypeScript + Vite (via `@crxjs/vite-plugin`)
- Tailwind CSS v3 + shadcn/ui + `@tailwindcss/container-queries`(플러그인 등록만 — `@container`·`@sm:` 류 사용처는 현재 0) (디자인 시스템·색상 토큰·UI 컨벤션 상세는 [DESIGN.md](./docs/DESIGN.md))
- Zustand + `chrome.storage` (session/local 혼용)
- Tiptap (ProseMirror) WYSIWYG 에디터 + `tiptap-markdown` 양방향 변환 + `markdown-it` (HTML/ADF/Notion 변환용 파서)
- 스크린샷 어노테이션: Konva + react-konva 캔버스(사이드패널 lazy 청크). 도형은 natural 좌표, 표시 배율은 CSS transform. 줌·팬 계산은 `sidepanel/components/annotation/viewport.ts` 순수 함수 단일 출처(fit-width 진입 / 전체 조망 / 사용자 배율을 `ZoomLevel`로 **의도 저장**). 드래그는 **window 리스너**로 구동 — pointer capture를 쓰지 않는다(상세·함정은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md))
- 요소 스타일 CSS 코드 뷰: CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-css` + `@codemirror/autocomplete` + `@codemirror/language` + `@lezer/highlight`, 사이드패널 전용 lazy 청크) — 편집/CSS 세그먼트 토글의 CSS 뷰
- 요소 스타일 캐스케이드 판정: `content/css-source-cache.ts`(raw CSS 확보) + `content/css-resolve.ts`(shorthand 수동 전개 + specificity 승자 판정). **`var()`가 낀 shorthand는 longhand가 CSSOM에서 전부 빈 문자열**이라 이 수동 전개가 specified의 유일한 출처다. 캐스케이드 문맥 불투명 판정은 열거가 아니라 **화이트리스트**(`@media`·`@supports`만 투명 — 열거하면 다음 at-rule에서 구멍). 브라우저 실동작이라 **유닛으로 못 고정하고** `e2e/style-shorthand-var.spec.ts`가 유일한 그물. **회고 상위 영역(13건/11%)이니 건드리기 전** [ARCHITECTURE.md](./docs/ARCHITECTURE.md) "CSSOM shorthand 한계 우회"를 읽는다
- 요소 selector 생성: **빌더가 둘이다.** 요소 선택은 `content/element-locator.ts`(`@medv/finder`를 안정성 훅/기본 2회 실행 → `(위치 유무, 단계, 길이)`로 선택), DOM Tree·`contextSelector`는 기존 `content/dom-describe.ts:buildSelector` 경량 경로. **그래서 `TreeNode.selector`와 `selection.selector`는 같은 문자열이 아니고**, 둘을 등가 비교하면 무음으로 죽는다(`DomTreeDialog`는 트리 응답 `ancestorPath` 꼬리로 비교). selector는 표시용이 아니라 rebind·편집 적용·캡처·`sameElementKey` dedup의 **실행 키**이며, 그 값이 이슈 본문·8개 플랫폼·LLM으로 나가므로 attribute·id 값은 `isHandWrittenIdentifier` 게이트를 통과해야 한다(이메일·전화·주문번호 거부 — 거부되면 compat 단계가 보전). 건드리기 전 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) "요소 selector 생성 (실행 키)"를 읽는다
- 영상: 탭 녹화(`tabCapture`+MediaRecorder) / 화면 녹화(`getDisplayMedia` — 웹 표준, 추가 manifest 권한 불필요·user gesture만 요구) / 30s Replay(`captureVisibleTab` 폴링 프레임 → WebCodecs `VideoEncoder`+`mp4-muxer` H.264 MP4). 캡처 모드(`CaptureMode`): element/screenshot/video/freeform + 30s replay. 탭 녹화·화면 녹화는 둘 다 `video` 모드이고 `RecordingSource`(tab/screen) 축으로 갈린다. **사용자 선택 축 말고 런타임 폴백 축이 하나 더 있다** — 탭 스트림 획득이 실패하면(cross-origin 이동으로 activeTab이 회수된 경우) user activation이 살아있는 동안 `startScreenCapture(tabId, { preferTab: true })`로 자동 전환한다(`sidepanel/video-capture.ts`). **정지 후 구간 자르기는 3경로 공용** — 같은 오버레이(`ReplayTrimDialog`)와 같은 로그 경계 헬퍼를 쓰고 `TrimSource`(frames=리플레이 프레임축 / recording=녹화 벽시계축)로만 갈린다. 녹화를 자르면 `sidepanel/30s-replay/encode-range.ts`가 `<video>` 배속 재생 + `requestVideoFrameCallback`으로 재디코드해 선택 구간만 WebCodecs로 재인코딩한다(전체 구간이면 원본 blob 유지). 상세는 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) "트리밍" 참조
- 재현 환경 `API Hosts` 자동 행: 네트워크 로그에서 페이지와 같은 registrable domain(`tldts` PSL)의 hostname을 파생해 `draft.environment`에 주입. 게이트는 `supportsConsoleNetworkLog`+`logsAttach` 단일 진입점(`sidepanel/lib/apiHostRow.ts` — **컴포넌트에 두면 element 누출이 green으로 통과한다**), 제출 직전 2차 방어는 `environmentForSubmit`(라이브·저장 draft 재제출·상세 표시 3경로 공용 — 안쪽 술어가 `stripApiHostsRows`). 상세·불변식은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) "API Hosts 자동 행"
- 스크린샷 캡처 방식 3축(영역/화면/페이지 전체): `CaptureMode`와 **직교** — 셋 다 `captureMode: "screenshot"`으로 수렴하고(종착점 `onAreaCaptured`) 방식 자체는 union 타입도 영속화도 없다. `capturing` phase 하단 툴바에서 고른다. 진입 화면의 **요소 캡처**(`mode-element-shot`)도 같은 `captureMode: "screenshot"`으로 수렴하지만 이 3축이 아니다 — phase가 `picking`이고 종착점이 `onAreaCaptured`가 아니라 `onElementShot`(`shotSelector` 저장)이다. 페이지 전체 캡처는 사이드패널 오케스트레이터(`sidepanel/scroll-capture.ts`)가 content executor(`content/scroll-capture.ts`)를 스크롤시키며 타일을 background `captureVisibleTab` 관문으로 찍어 canvas 스티칭(캡 3종은 `sidepanel/lib/scroll-capture-plan.ts` — 20타일·캔버스 32000px·출력 4M px). 첫 타일 이후 반복되는 `fixed`와 이미 전부 노출된 뒤 붙은 `sticky`를 `visibility`로 숨기고, 캡처 중 추가·position 변경된 후보도 추적한 뒤 원래 스타일·스크롤을 복원한다. 상세·불변식은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) "캡처 3축" 참조
- element 모드 before/after 캡처 범위: 요소 bbox+24px(`DEFAULT_MARGIN` — `sidepanel/capture.ts`)가 기본이고, 요소를 감싼 **의미 단위 조상 컨테이너**(다이얼로그·`tr`·`li`·`article` 등)가 게이트 4개(한 변이 0이 아님 / 뷰포트 완전 포함 / 요소 포함 / 뷰포트 면적 40% 이하)를 전부 통과할 때만 그쪽으로 넓혀 찍는다. 위 캡처 3축과 **직교**한다(3축은 screenshot 모드의 *방식* 축). 판정은 `content/capture-context.ts`·`sidepanel/lib/capture-basis.ts` 순수 함수 2벌 — picker/capture가 coverage 로직 스코프 제외라 거기 남기면 테스트로 못 고정한다. `form`·`fieldset`은 개인정보 노출 면적 때문에 후보 제외이고 이 범위는 docs/privacy에 공개돼 있다. 상세·불변식은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) 동명 섹션
- AI: Chrome Built-in AI 폴백 + BYOK OpenAI-compatible/Anthropic endpoint. AI 초안·재현 단계 자동채움·스타일링 요청에 필요한 컨텍스트만 사용자가 선택한 provider로 직접 전송
- AI 출력 언어: UI 로케일과 **독립된 축**(`aiLanguage`, 기본 `auto` = 호출 시점에 로케일로 해석 — 스냅샷 아님. **아래 이슈 본문 언어와도 별개 축**이라 본문만 영어로 둬도 초안은 화면 언어로 온다). 프리셋 9종은 `sidepanel/lib/aiLanguage.ts` 단일 출처이고 값이 프롬프트 지시문에 그대로 박히므로 `normalizeAiLanguage` 게이트를 통과해야 한다. **rich 경로 한정** — compact(`draftCompact.ts`)은 nano의 `outputLanguage: "en"` 하드코딩과 영어 few-shot 탓에 로케일에 묶인 채 남고, 설정 셀렉터도 `capabilities.promptStyle === "rich"`로 게이트해 compact 사용자에게 무음으로 무시되는 컨트롤을 안 보인다. 섹션 설명 테이블(`SECTION_DESC_BASE`·`MODE_HINTS`)은 **의도적으로 로케일 유지**(영어 스캐폴딩 + `Write in X`로 신규 언어 커버 — 언어별 번역본을 늘리지 않는다)
- 이슈 본문 언어: UI 로케일·AI 출력 언어와 **또 독립된 세 번째 축**(`bodyLocale`, 기본 `auto` = 호출 시점에 화면 언어로 해석). 복사·제출되는 본문의 섹션 헤딩·표 헤더·로그 요약 문장만 바꾸고 **사용자가 쓴 본문·AI 초안 내용·미리보기 화면은 화면 언어 그대로**다. 사전 조회라 옵션은 `LOCALES`(AI 프리셋 9종과 달리 임의 언어 불가). 구현은 전역 스왑(`i18n/index.ts:withLocale`)을 **빌더 진입점 9파일/11함수**에 두는 방식이고, 래핑 누락은 `builderLocaleWrap.test.ts` 소스 스캔이 red로 잡는다(파일 단위가 아니라 **export 진입점 단위**로 세고, `sidepanel/lib` 전체를 훑어 새 파일이 래핑·면제 어느 분류에도 없으면 red). background는 `currentLocale` 인스턴스가 별도라 submit payload에 `bodyLocale`을 실어 그 realm에서 다시 감싼다. 상세·불변식(**래핑 구간 안 store write 금지**)은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) "본문 언어 전역 스왑"
- 사용자 파일 첨부: 기본 off. IndexedDB에 pending tab owner로 저장 후 이슈 owner로 rekey, 최대 10개·합계 50MB, 플랫폼별 업로드
- 분석: PostHog (익명 이슈 제출·연동 집계 — `src/background/analytics.ts`. 코드는 `VITE_POSTHOG_KEY` 한 이름만 읽고 store/비-store 분기는 `vite.config.ts`의 define 치환이 한다 — store 빌드면 `VITE_POSTHOG_KEY_PROD` 값을 그 자리에 주입(GitHub client id도 같은 패턴); 선택된 키가 없으면 no-op)
- 본문 구성 순서 재정렬: `@dnd-kit/core`+`sortable`+`modifiers`+`utilities` (설정 탭 전용). 순서 배열은 `issueSections` 단일 출처이고 `arrayMove`는 스토어에 인라인 — 이 스토어가 background 번들에 들어가므로 dnd-kit을 그래프에 유입시키지 않는다. transform은 `CSS.Translate`만 적용(FLIP 보정 scaleY가 행 높이를 눌러서)
- 아이콘: lucide-react (UI 일반) + `@icons-pack/react-simple-icons` (플랫폼 브랜드), 폰트: Pretendard(본문) + Geist Mono(코드 표면 — `font-mono` 및 preflight 경유 `pre`/`code`. log-viewer는 별도 빌드라 latin subset만 `@font-face`로 임베드하고 non-latin(CJK·키릴 등)만 시스템 mono로 폴백) — 사용 컨벤션은 [DESIGN.md](./docs/DESIGN.md)
- MV3 service worker + content script + side panel

## 명령어

| 용도 | 명령 |
|---|---|
| 개발 서버 | `pnpm dev` |
| 빌드 미리보기 | `pnpm preview` (vite 기본 스크립트 — 확장 로드엔 쓰지 않는다) |
| 빌드 | `pnpm build` (첫 단계로 `build:log-viewer` 자동 실행 → `dist-log-viewer/index.html` 갱신 후 사이드패널이 그걸 inline) |
| 로그 뷰어만 빌드 | `pnpm build:log-viewer` (단독 실행. 일반 build/build:store는 이미 자동 포함) |
| 스토어 업로드용 빌드 | `pnpm build:store` (manifest `key` 제거. log-viewer도 자동 빌드) |
| e2e용 빌드 | `pnpm build:e2e` (`dist-e2e/` 분리 산출 — 테스트 전용) |
| e2e 테스트 | `pnpm test:e2e` (Playwright. 사전 `pnpm build:e2e` 필요) |
| 타입 체크만 | `pnpm typecheck` |
| 테스트 | `pnpm test` (pre-훅이 `build:log-viewer`를 먼저 돌린다 — `buildLogsHtml.ts`가 `dist-log-viewer/index.html`을 `?raw`로 import하는데 그건 gitignore된 산출물이라, 새 체크아웃에서 이게 없으면 3개 테스트 파일이 ENOENT로 죽는다. `test:coverage`도 동일) |
| 테스트 (watch) | `pnpm test:watch` |
| 커버리지 측정 | `pnpm test:coverage` (vitest v8 → `coverage/report/coverage-summary.json`) |
| 커버리지 리포트·비교 | `pnpm coverage:report` (베이스라인 대비 이전→지금 비교. 갱신: `pnpm coverage:update`) — `/coverage` 스킬이 래핑 |
| 회고 집계 | `pnpm postmortem:report` (영역·계열·그물 랭킹 + 반복 함정 교차. 형식 검사만: `pnpm postmortem:check`) |
| Codex 미러 동기화 | `pnpm sync:agents` (드리프트 검사만: `pnpm sync:agents:check`) |
| pre-arm 청크 검사 | `pnpm check:prearm` (빌드 후 `dist` 검사. `pnpm check:prearm dist-e2e`도 가능) |

**린터 없음** — ESLint/Prettier/Biome 미도입이라 `pnpm lint`는 존재하지 않는다. 스타일 게이트는 `pnpm typecheck` + `pnpm test`뿐이고, 린터 추가는 요청 없이 하지 않는다.

### CI (GitHub Actions)

구성·게이트·함정은 **[docs/CI.md](./docs/CI.md)** 참조 — **CI 워크플로우를 수정하거나 CI 실패를 진단할 때는 그 문서를 먼저 읽는다.** job은 `verify`·`e2e`(4샤드)·`e2e-gate`·`notify` 넷이고, main의 required status check는 **`verify` + `e2e-gate` 둘**이다. **e2e 차단 게이트는 CI 단독** — `/push`는 e2e를 안 돌리고 run URL만 안내하며(논블로킹), `/merge`가 dev HEAD의 CI 결론을 게이트로 쓴다.

**빌드는 자동 실행하지 않는다.** 사용자가 명시적으로 요청하거나 `/build` 스킬을 실행할 때만 돌린다. 타입 확인이 필요하면 `pnpm typecheck` 선호. 예외: `build:e2e`(dist-e2e)는 `/e2e-write`·`/e2e-run`에서 실행 허용 — 배포 산출물(dist)과 분리돼 있다.

`build:store`는 `BUGSHOT_STORE_BUILD=1`을 세팅해 `manifest.config.ts`에서 dev용 `key`를 생략한다. 로컬 dev/로드 언팩 시에는 `key`가 있어야 OAuth redirect URI(`chrome-extension://<ID>/...`)가 고정되므로 **기본 `pnpm build` 유지**.

### 의존성 보안 (pnpm-workspace.yaml)

공급망 공격 완화용 pnpm 설정. **새 의존성을 추가할 때 이 정책에 걸린다.**

- `minimumReleaseAge: 1440` — publish된 지 24시간 안 지난 패키지 버전은 설치 대상에서 제외(직전 버전 선택). 악성 버전이 발견·삭제되는 위험 창을 회피. lockfile에 이미 박힌 버전엔 영향 없고 신규 resolve 시점에만 적용. 긴급 보안 패치를 즉시 받아야 하면 `minimumReleaseAgeExclude`에 패키지명 추가하거나 값을 임시로 낮춘다.
- `onlyBuiltDependencies: [esbuild]` — 라이프사이클(install/postinstall) 스크립트 실행을 허용할 패키지 화이트리스트. pnpm 10은 빌드 스크립트를 기본 차단(악성 postinstall 차단). 현재 빌드 스크립트가 필요한 의존성은 esbuild뿐. `pnpm install` 시 *"Ignored build scripts"* 경고가 뜨면 그 패키지가 정말 필요한지 확인 후 `pnpm approve-builds`로 검토해 목록에 추가.

## 디렉터리 구조

파일별 역할은 **[DIRECTORY.md](./docs/DIRECTORY.md)** 참조.

## 디자인 / UI

디자인 시스템·UI 컨벤션(색상 토큰, 다크모드, 타이포그래피, 버튼·아이콘 사이즈, 레이아웃·반응형, 공용 합성 컴포넌트, 상태 표현, className 합성)은 **[DESIGN.md](./docs/DESIGN.md)** 참조. 새 화면·컴포넌트를 만들기 전 먼저 읽는다.

## 아키텍처 원칙

설계 상세(Side Panel 탭 스코프, user gesture, 세션 영속화, 8개 플랫폼 인증, 어댑터 패턴, 토큰 체인 resolve, CSSOM 캐시, DOM lazy load, 마크다운 복사, 이슈 섹션 구성, 마이그레이션)는 **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)** 참조.

## 릴리스 & 버전

### 버전 체계

semver(`MAJOR.MINOR.PATCH`). `package.json`의 `version`이 manifest에 자동 반영된다. Chrome 웹스토어는 업로드마다 버전이 올라가야 하므로 **`/merge` 단계에서 dev에 bump 커밋을 얹어 PR에 포함**시키고, squash로 main에 들어간 뒤 `/deploy`가 그 버전을 가리키는 tag만 별도 push한다.

```bash
pnpm version patch --no-git-tag-version   # 1.0.0 → 1.0.1 (버그 수정)
pnpm version minor --no-git-tag-version   # 1.0.0 → 1.1.0 (기능 추가)
pnpm version major --no-git-tag-version   # 1.0.0 → 2.0.0 (Breaking change)
```

`--no-git-tag-version`이 핵심. 자동 commit/tag를 막고 직접 commit 메시지를 통제하며, tag는 **dev HEAD가 아닌 main의 squash 커밋을 가리켜야 의미가 있으므로** `/deploy`에서 찍는다.

### 브랜치 정책

- 작업 브랜치: **`dev`** — 자유롭게 push (force push 허용).
- 메인 브랜치: **`main`** — 브랜치 프로텍션 적용. 직접 push 금지, PR squash 머지만 허용(linear history 강제). approval 0이라 1인 셀프 머지 OK. 버전 commit은 PR을 통해 들어오고 tag push는 ref 종류가 달라 보호 규칙과 무관하므로, **보호 우회가 필요한 시점이 없다**.

### 워크플로우 (스킬 라인업)

스킬 22개의 역할·단계별 게이트는 `.claude/commands/<name>.md`에 정의돼 있고(한 줄 설명은 세션 스킬 목록에 상시 노출된다), Codex 미러는 `.agents/skills/source-command-<name>/SKILL.md`다.

권장 흐름: `/feature` → `/feature-review` → `/tdd interface` → `/implement` → `/e2e-write` → `/code-review` → `/tdd regression` → `/refactor` → `/push`(논블로킹 — e2e는 CI가 검증) → `/merge`(dev HEAD의 CI 결론 확인 → PR CI 대기 → 머지). 사용자 노출 UX·기능을 건드렸으면 `/push` 전에 `/guide`로 ko/en 가이드를 맞추고(`/implement` 보고의 "가이드 영향" 플래그가 신호), 화면이 바뀌었으면 `/guide-shots`로 스크린샷까지 다시 찍는다(촬영은 확장 로드 + 특권 `chrome.*` API가 있는 런타임만 — 없으면 stale 탐지·리포트까지만 돈다). e2e 시나리오가 추가·변경됐으면 `/e2e-write`로 spec을 green까지(`/implement` 보고의 "e2e 영향" 플래그가 신호). `/tdd` 분류표(스킬 정의 안)에 따라 컴포넌트·OAuth·DOM 측정 같은 영역은 스킵 OK. e2e가 원리적으로 못 보는 축(실 cross-origin CSS·실 sticky 사이트·실 광고 iframe·픽셀 판정)을 건드렸으면 `/merge` 전에 `/manual-smoke`로 실사이트를 훑는다(리포트 전용·차단 안 함. 브라우저 제어 런타임에서만 돌고 시나리오는 `e2e/MANUAL-SMOKE.md`가 단일 출처). **회귀·버그를 잡아 고쳤으면 `/postmortem`으로 `docs/POSTMORTEM.md`에 회고를 남긴다**(같은 함정 재발 방지 — 실패 사후분석 회로). 역으로 `/implement`·`/refactor`·`/code-review`는 **착수 전 변경 영역으로 `docs/POSTMORTEM.md`를 grep**해 과거 함정을 소환한다(쓰기만 하고 안 읽으면 죽은 로그 — 소환 회로로 루프를 닫는다).

### 문서 신선도

`/push`가 **푸시될 diff에 걸린 문서만** 트라이아지한다 — 대상 목록·트리거·문서별 확인 항목은 `.claude/commands/push.md` 4단계. diff와 무관하게 누적된 stale은 `/doc-check`가 9개 문서 전문을 코드와 양방향 대조해 잡는다. 갱신은 문서별 별도 커밋(`docs(CLAUDE): ...` / `docs(ARCHITECTURE): ...` / `docs(privacy): ...` …)으로 묶는다. **아래 3개는 `/push` 미러가 없는 Codex 세션에서도 지켜야 하므로 여기 남긴다:**

- **`README.md`(en 원본) ↔ `README.ko.md`(ko 번역)** 는 항상 같은 내용이라 **한쪽을 고치면 같은 커밋에서 양쪽을 함께** 갱신한다(섹션 구성도 대칭 유지). ko가 링크를 한국어 리소스(`docs/privacy.ko.md`·`bug-shot.com/ko/…`·`guide/ko/assets/`)로 돌리는 건 의도된 로케일 차이다.
- **docs/privacy.{ko,en}.md는 권한 문자열이 아니라 실제 동작에 묶인다**: 새 기능이 *기존* 권한(`<all_urls>`·`activeTab`·`tabCapture`·`scripting` 등)을 새 목적으로 쓰거나 새 캡처·수집·저장·전송 동작을 추가하면 **manifest diff가 0이어도** 대조·갱신한다. diff에 `chrome.permissions.request`/`captureVisibleTab`/`tabCapture`/`chrome.scripting`/신규 외부 `fetch`/`chrome.storage`·IndexedDB write가 보이면 트리거. **ko가 원본, en은 번역이라 ko/en 양쪽 본문과 상단 시행일을 함께 갱신**한다. (30s Replay가 기존 optional 권한 재사용으로 이 검사를 빠져나가 심사 탈락한 전례 있음)
- 가이드(`guide/ko`·`guide/en`)를 쓰기 전 **`guide/AUTHORING.md`를 먼저 읽는다** — IA·톤·UI 라벨·footer·검증 규칙의 단일 출처. 가이드 작성 기준 자체(사실 스냅샷·플랫폼 표·지원 플랫폼)가 바뀌면 AUTHORING.md도 함께 갱신.

## 코드 컨벤션

- 스타일: `src/components/ui/` 이외에 주석 최소화. WHY가 비자명할 때만 한 줄.
- 경로: `@/` → `src/`. **같은 최상위 디렉터리 안에서는 상대경로를 쓴다** — `@/`는 디렉터리를 건널 때의 표기라, 자기 디렉터리를 `@/`로 가리키면 같은 모듈이 두 표기로 불려 grep·이동이 어긋난다. `src/lib/__tests__/import-convention.test.ts`가 `background`·`types`·`store`·`i18n` 넷을 소스 스캔으로 잠근다(지금 0건이라 래칫으로 걸 수 있는 곳만 넣었다). **`sidepanel`은 스캔 대상이 아니고 문면의 대상도 아니다** — 445건 혼용이라 즉시 red이고 예외 목록을 박으면 그물이 아니라 장부가 된다. 일괄 치환 전까지 그 디렉터리는 **`@/` 유지**가 지역 관례다(예: `FieldRow` 소비처 20곳이 전부 `@/sidepanel/components/FieldRow`). `components/`는 shadcn CLI 생성물이라 우리 컨벤션 밖. 별개로 `src/log-viewer/`가 `../i18n/locales`처럼 상대경로를 쓰는 건 컨벤션이 아니라 **강제 회피**다(`vite.log-viewer.config.ts`의 `@/i18n` alias가 prefix 매칭이라 `@/i18n/locales`가 깨진다)
- **UI·디자인 컨벤션**: UI 컴포넌트 직접 스타일링 금지 — shadcn/ui 우선 사용, 없으면 `npx shadcn@latest add <component>`. 색상 토큰·다크모드·버튼/아이콘 사이즈·레이아웃·합성 컴포넌트·탭 렌더 규칙 등 전체 컨벤션은 **[DESIGN.md](./docs/DESIGN.md)** 참조.
- 커밋 메시지·PR title/body·GitHub Release notes는 **영문**으로 작성
- **테스트**: 코드 변경 시 관련 테스트 작성 + `pnpm test` 통과 확인 필수. 대상과 같은 디렉터리의 `__tests__/`에 두고 Vitest를 쓴다. **2트랙**:
  - `*.test.ts` — node 환경. 순수 함수·헬퍼(기본 트랙).
  - `*.test.tsx` — **jsdom + @testing-library/react**(+ `@testing-library/user-event` — 인터랙션 시뮬레이션. `vitest.config.ts`의 `environmentMatchGlobs`가 확장자로 자동 분기, 셋업은 `src/test/setup-dom.ts` — cleanup + ResizeObserver·PointerCapture·scrollIntoView·`CSS.escape` 폴리필(마지막 것은 jsdom에 `CSS` 전역 자체가 없는데 `@medv/finder`가 무조건 호출해서 필요)). 렌더·인터랙션이 상태 전이를 좌우하는 컴포넌트(콤보박스 등)와, 실제 DOM이 필요한 비컴포넌트 검증(헤드리스 Tiptap 왕복·vanilla DOM 셸 등)에 쓴다. 단, **포인터 드래그·캔버스처럼 브라우저 실동작에 걸린 것은 jsdom으로도 못 잡는다** — e2e·수동이 유일한 안전망(docs/POSTMORTEM.md).
  - **커버리지**: `pnpm test:coverage`(vitest v8) → `/coverage` 스킬이 리포트. **주 지표는 "로직 스코프" 라인 %**(브라우저 전용·UI 코드를 분모에서 제외 — 전체 %는 의도적 0% 코드가 섞여 TDD 다이얼로 안 맞다). **로직 스코프** 제외 규칙의 단일 출처는 `scripts/coverage-report.mjs`의 `isBrowserBound()`(테스트 인프라 제외는 그 앞단 `vitest.config.ts`의 `coverage.exclude`가 맡는다) — 유닛테스트 불가능한 새 런타임 파일(content DOM·미디어·OAuth 런처·SW 엔트리)을 추가하면 여기 등록. 트렌드 베이스라인은 git-tracked `coverage/baseline.json`(리포트 본체는 `.gitignore`), 개선 시 `pnpm coverage:update`로 래칫.
- **Codex 미러 자동 동기화**: `CLAUDE.md`·`.claude/commands/*.md`·`.agents/PREAMBLE.md`를 Edit/Write하면 `.claude/settings.json`의 PostToolUse 훅이 `pnpm sync:agents`를 실행해 `AGENTS.md`·`.agents/skills/`를 재생성한다. 생성물이므로 직접 편집 금지 — 상세는 아래 "메모리 & 참고 문서" 참조.
- **i18n 자동 검사**: `src/i18n/` 파일을 Edit/Write하면 `.claude/settings.json`의 PostToolUse 훅이 `src/i18n/__tests__/locales.test.ts`(등록 로케일 전수 키 대칭·빈 값·placeholder 토큰 일치)를 자동 실행해 불일치 시 차단. 키 추가 시 등록된 모든 로케일을 함께 갱신할 것. **훅이 red를 차단하므로 `src/i18n/` 대상 TDD는 red 단계에서 계속 빨갛게 뜬다** — 쓰기 자체는 반영되니 구현 완료 후 green이면 된다.
  - **로케일 축은 `src/i18n/locales.ts`가 단일 출처**(`LOCALES`·`LocaleMode`·`BASE_LOCALE`·`DEFAULT_LOCALE`·`BCP47`·`normalizeLocale`·`detectLocale`·`matchLocaleTag`, 그리고 아래 규칙이 쓰는 `LocaleTable<T>`·`localeValue()`와 본문 언어 축 `BodyLocale`·`normalizeBodyLocale`·`resolveBodyLocale`). 이 파일은 **런타임 import가 0이어야 한다** — log-viewer가 `@/i18n` alias(prefix 매칭이라 `@/i18n/locales`는 깨진다)를 우회해 상대경로로 끌어가고 background SW도 같이 쓰므로, store가 딸려오면 양쪽이 죽는다. `locale-registry.test.ts`가 소스 스캔으로 강제한다.
  - **로케일별 테이블은 폴백 허용/금지를 구분한다.** 금지 5개(`locales`·`BCP47`·`LOCALE_AI_PRESET`·`LOCALE_LABELS`·log-viewer `DICTS`)는 `Record<LocaleMode, …>`를 유지해 컴파일러가 채우게 한다 — 폴백하면 t() 크래시·날짜 포맷 오류·무음 영어 초안·셀렉터 미노출·raw 키 노출로 샌다. 허용(프롬프트 스캐폴딩 `SECTION_DESC*`·`MODE_HINTS`·`EXPECTED_SPLIT_HINT`, 표시 스타일 `MONTH_STYLE`·`USER_GUIDE_URLS`)은 `LocaleTable<T>` + `localeValue()`로 en에 폴백한다. **새 로케일 테이블을 만들 때 어느 쪽인지 먼저 정한다** — 잘못 분류하면 타입도 테스트도 안 잡는다.
  - **키 축은 층위가 다르다.** 위 폴백 금지/허용은 *"이 로케일의 사전이 통째로 있는가"*(로케일 축)이고, *"사전은 있는데 그 안에 이 키가 없는가"*(키 축)의 게이트는 **타입**이다 — `TranslationKey`가 닫힌 union이라 정상 호출부에선 미정의 키가 불가능하고, `as TranslationKey`·`as Parameters<typeof t>[0]` **캐스트로 그걸 뚫지 않는다**(현재 src에 0건. 테이블은 `Record<string, TranslationKey>`로 값 쪽을 조이고, 키를 조립하는 헬퍼는 템플릿 리터럴 타입이 union과 대조되게 둔다 — 그래야 키 리네임이 `pnpm typecheck`에서 잡힌다). `t()`·`useT()`가 공유하는 `lookup()`의 "미정의 키 → DEV `console.error` + 키 문자열 반환"은 그 뒤의 안전망일 뿐 그물이 아니다(복제 사전의 `if (!text) return key`와 실패 모드를 맞춘 것).
  - **사전은 셋이다** — `src/i18n/namespaces/*.ts`(8파일) · `src/log-viewer/i18n.ts`(복제본) · **`public/_locales/<code>/messages.json`**(manifest `__MSG_` + 런타임 `chrome.i18n.getMessage`. TS 밖 JSON이라 컴파일이 못 보고 `manifest-locales.test.ts`가 유일한 그물이며, 값이 **웹스토어 등록정보로도 나간다**). 로케일 추가 시 셋을 모두 채운다.
  - **사전은 두 벌이다** — log-viewer는 별도 빌드라 `src/log-viewer/i18n.ts`에 `koDict`/`enDict` **복제 사전**을 따로 둔다. 훅 matcher가 `*src/i18n/*`라 이 파일엔 **안 걸리고**, 대신 `src/log-viewer/__tests__/i18n.test.ts`가 `LOCALES` 기반 N-way 대칭·placeholder·**메인 사전 레지스트리(`locales`) 전량과 교집합 키 값 일치**를 대조한다 — 즉 저장 즉시가 아니라 `pnpm test`에서 잡힌다. **대조 원본을 namespace로 열거하지 않는 게 규칙이다** — `[logs, editor]`로 손열거하던 시절 목록 밖의 `common.*` 3키가 무음으로 대조를 빠져나갔다(로케일 축에서 이미 걷어낸 열거를 namespace 축에도 두지 않는다). log-viewer가 재사용하는 공용 컴포넌트(NetworkLog·ConsoleLog·ActionLog·IssuePreview)에 키를 추가하면 **두 사전을 함께** 갱신할 것.

## 게이트웨이 (알아두면 유용)

- 매니페스트 `minimum_chrome_version: "116"` — sidePanel API 요구사항
- 지원 URL: `http:`, `https:`, `file:` 스킴만. 추가로 `chromewebstore.google.com` 전체와 `chrome.google.com`의 `/webstore` 및 그 하위 트리는 Chrome이 content script 주입을 차단해서 `src/lib/url-support.ts`의 `isSupportedUrl()`이 미지원으로 처리(prefix가 아니라 정확 일치 + `/webstore/` 하위라 `/webstoreAdmin` 류는 의도적으로 통과). **미지원 URL에서도 side panel은 연다** — `activateTab`은 URL을 보지 않고, `apply()`도 activation만 본다. 패널 표시 여부는 activation을 따르고 지원 여부는 **패널이 무엇을 그리는지만** 결정한다(무음 클릭 제거). 미지원이면 `useTabUnsupported`(`sidepanel/hooks/useTabSupport.ts`)가 판정해 Debug>이슈의 캡처 진입 화면을 `app.captureUnsupported.*` 안내로 바꾸고(캡처 버튼 5개는 안내로 교체, `[이슈 작성]`은 `aria-disabled`로 자리 유지), console/network 서브탭을 잠그고, 레코더 sync·30s Replay 폴링·영상 캡처를 게이트한다. 연동·설정·이슈 목록 탭은 미지원 페이지에서도 완전히 동작한다. 사용 중 race로 unsupported로 진입하면 picker가 `onPickerUnavailable` 이벤트를 발화해 안내 다이얼로그 노출. **판정은 2분기가 아니라 3분기다** — `classifyTabSupport()`가 `supported | permission-expired | unsupported`를 돌려주고, `tab.url`이 비면 content가 보고한 `contentUrl`로 **activeTab grant 만료를 미지원과 구분**한다(그 경우 `picker-control.ts`가 `onPickerUnavailable`이 아니라 `onPickerPermissionExpired`를 발화 — 안내 문구가 "이 페이지는 지원 안 함"이 아니라 "다시 열어라"여야 하기 때문).
- iframe 지원 (picker): picker content script(`picker.ts`, content_scripts[0])는 로그 레코더처럼 `all_frames: true`로 전 프레임에 주입 — **1-depth iframe** 내부 요소 선택·스타일링·캡처를 지원한다(cross-origin 포함). 자식 picker가 `picker.start`에 실린 frameToken으로 부모 registry에 등록(`frame-geometry.ts` postMessage 핸드셰이크 + token 검증 — **단 token은 자식이 `postMessage(..., "*")`로 보내 부모 페이지도 읽으므로 인증이 아니라 힌트다.** 상세·수용된 잔여 위험은 ARCHITECTURE.md "등록 핸드셰이크" 참조)되면 top blocker가 그 iframe 위에서만 pointerEvents 핸드오프. 캡처는 offset 핸드셰이크(arm 게이트 + registry 확인)로 top 좌표 합성. **미등록 iframe(중첩 2-depth+·sandbox)** 클릭은 기존 거부 경로 유지 — `picker.iframeUnsupported` → `onPickerIframeUnsupported` 안내 다이얼로그 + idle 복귀. 사이드패널 라우팅은 `sender.frameId` 기반(`send(tabId, msg, frameId)` required), 요소 식별은 selector+frameId 복합키(`@/lib/element-key.ts`의 `sameElementKey` 단일 출처).
- iframe 로그 커버리지: 로그 레코더는 picker와 분리된 별도 content_scripts 2개로 **모든 프레임**에 주입(`all_frames: true`) — `recorder-bridge.ts`(ISOLATED, sentinel 수신·data 중계)와 `recorders-entry.ts`(MAIN, console/network/action 후크). cross-origin iframe(Stripe·임베드 위젯 등)의 console/network 로그까지 캡처한다. `webNavigation.onCommitted`로 커밋된 iframe에 sentinel 재발행. origin은 entry의 `pageUrl`에서 `originOf()`로 런타임 파생 — cap evict 시 top-page-origin 우선 보존(`mergeLogItems`, console/network만 — action은 광고 폭증이 없어 순수 FIFO), 로그 탭에 origin 필터(`OriginFilterBar`, console/network/action 공용) 노출. picker DOM 선택은 위 항목대로 1-depth iframe까지 지원(중첩·sandbox 제외).
- pre-arm 버퍼링 (동기 IIFE 빌드 제약): `recorders-entry`는 self-contained 청크(외부 static import 0)여야 crxjs가 **동기 IIFE**로 emit → document_start 후크가 페이지 인라인 스크립트보다 먼저 깔린다. 그래야 `recorder-prearm.ts`의 sessionStorage 플래그(`__bugshot_recorder_active__`)를 읽어 active origin(한 번이라도 armed된 origin)이면 sentinel 도착 **전**부터 로그를 버퍼 적재(적재 게이트는 `capturing`, entry의 pre-arm 마킹 축은 `recording`으로 분리. **dispatch를 막는 건 `recording`이 아니라 sentinel 레지스트리가 비었는지다** — `if (!sentinels.list().length) return`). **pre-arm 적재는 무기한이 아니다** — `PREARM_GRACE_MS`(60초 — 단일 상수가 아니라 `action`·`console`·`network` 레코더에 **로컬 상수로 복제**돼 있다. 값을 바꾸려면 3곳) 안에 arm이 안 오면 `armedOnce` 래치를 보고 `capturing`을 끄고 버퍼를 비운다(페이지가 sessionStorage 플래그를 위조해 적재를 영구히 켜두는 걸 막는 상한. 해제를 `clearTimeout`에 안 맡기는 건 페이지가 그걸 no-op으로 바꾸면 정당하게 arm된 세션이 죽기 때문이고, 상한이 60초인 건 재arm이 페이지 **load 완료**에 걸려 있어서다). **레코더 전용으로 묶어둬야 하는 `src/content/` 모듈은 넷**(`log-throttle.ts`·`recorder-globals.ts`·`sentinel-registry.ts`·`recorder-prearm.ts`) — 사이드패널·background가 이 중 하나라도 import하면 공유 청크가 생겨 async loader로 되돌아가 pre-arm이 무력화된다. 수신부가 필요하면 복제본을 둔다(`sidepanel/lib/trailing-throttle.ts`가 그 사례). `sentinel-registry`는 순수 함수·범용 이름이라 재사용 유혹이 `log-throttle`이 겪은 것과 같은 형태이고, `pnpm check:prearm`은 빌드 후에만 도는 사후 그물이라 이 규칙이 앞단이다(리팩터 시 회귀 주의).
- 단축키: `_execute_action`(`Cmd/Ctrl+Shift+E`, 사이드패널 토글) 1개만 등록. Chrome이 `action.onClicked`로 내부 처리하므로 별도 `onCommand` 리스너 불필요. (캡처 단축키 3개는 제거됨 — manifest 전용이라 영속 데이터·마이그레이션 없이 무손실. 캡처는 진입 화면 버튼으로만.)
- permissions: `sidePanel`, `activeTab`, `scripting`, `storage`, `commands`, `contextMenus`, `identity`, `tabCapture`, `webNavigation` (메인 프레임 네비게이션 커밋 직전 로그 꼬리 sync — cross-page 로그 누적)
- host_permissions: **`<all_urls>` 단일** (required) — picker·로그 레코더 주입, `captureVisibleTab`(cross-origin 네비게이션에서 activeTab 회수돼도 캡처 유지), cross-origin stylesheet 원문 fetch(`css.fetchSheets` — 스타일 값 보강, SSRF 가드 경유), BYOK LLM·GitLab self-managed·8개 플랫폼 REST/OAuth·OAuth proxy fetch를 전부 커버한다. 설치 시 "모든 사이트" 경고 상시, 런타임 권한 프롬프트 없음(코드에 host별 `permissions.contains` 체크 없음). 사용처 전수·라이프사이클은 [PERMISSION.md](./docs/PERMISSION.md) §11–13, 트래픽 대상은 [privacy.ko.md](./docs/privacy.ko.md)
- (`<all_urls>`는 required — 과거 optional + 런타임 `chrome.permissions.request()` 모델은 폐기. BYOK/GitLab의 `requestHostPermission` 호출은 코드에 남아있으나 이미 보유라 즉시 grant, 프롬프트 없음)
- OAuth 관련 env: `VITE_ATLASSIAN_CLIENT_ID`, `VITE_GITHUB_CLIENT_ID` (dev), `VITE_GITHUB_CLIENT_ID_PROD` (store build 시 치환), `VITE_LINEAR_CLIENT_ID` (단일 client — dev/store redirect URI 둘 다 한 앱에 등록), `VITE_NOTION_CLIENT_ID`, `VITE_GITLAB_CLIENT_ID`, `VITE_ASANA_CLIENT_ID` (단일 client — dev/store redirect URI 둘 다 한 앱에 등록), `VITE_CLICKUP_CLIENT_ID` (단일 client — dev/store redirect URI 둘 다 한 앱에 등록), `VITE_SLACK_CLIENT_ID` (단일 client — OAuth 전용, dev/store redirect URI 둘 다 한 앱에 등록), `VITE_OAUTH_PROXY_URL` — 누락 시 해당 플랫폼 OAuth UI 자동 비활성화 (`background/oauth/config.ts`의 `OAUTH_CONFIG` 테이블 + `isConfigured()` 판정 — messages.ts `*.oauth.available` 단일 경로)
- 분석 env: `VITE_POSTHOG_KEY` (dev), `VITE_POSTHOG_KEY_PROD` (store build 시 치환), `VITE_POSTHOG_HOST` (`https://in.bug-shot.com` — PostHog 관리형 리버스 프록시. 광고차단·DNS 차단 리스트에 오른 `us.i.posthog.com`을 우회하려는 것이다. `vite.config.ts`가 define으로 값을 박고, env가 비어도 코드 폴백(`resolvePostHogHost`)이 같은 프록시라 **PostHog Cloud로 직행하는 경로가 없다** — docs/privacy가 이 host 하나만 명시하므로 폴백을 바꾸면 그 문서가 거짓이 된다) — 키 누락 시 PostHog 집계 no-op
- `BUGSHOT_STORE_BUILD=1`: 스토어 업로드용 빌드 (manifest `key` 제거)
- `BUGSHOT_E2E_BUILD=1`: e2e 전용 빌드 — `dist-e2e/` 분리 산출. dev `key` 유지. (`<all_urls>`는 이제 prod·e2e 공통 required라 e2e 빌드가 권한을 별도 추가하지 않음 — 분리 이유는 outDir 격리와 e2e 전용 빈 확장 페이지 `e2e-eval.html` emit뿐.) **dist-e2e는 테스트 전용 — Chrome 수동 로드·스토어 업로드 금지.** 배포 산출물(dist)은 무오염(분리 outDir)
- **store는 `sidepanel/tabs`를 import하지 않는다** — store가 컴포넌트 그래프를 끌어들이면 순환·번들 오염이 생긴다. store가 필요로 하는 순수 로직은 `sidepanel/lib/`으로 승격한다. 사례: `initialJiraFields`(Jira 필드 prefill 단일 출처 — `editor-store.confirmDraft`가 쓰므로 `tabs/jiraFields/`가 아니라 `lib/`에 둔다. 다른 플랫폼의 `initial*Fields`는 store가 안 써서 각 `*IssueFields.tsx`에 콜로케이션) · `annotationDefaults`(어노테이션 기본값 — `components/annotation/presets`가 여기서 re-export해 기존 소비처 4곳은 무변경). **떼어낼 때 그 함수가 쓰는 module-level 공유 상태를 같이 내린다** — `clearPicker`만 옮기고 `tabFrameTokens` Map을 두면 Map이 둘로 갈려 clear 후에도 토큰이 살아 유령 blocker가 재주입된다(typecheck·테스트 green인 채로). 그래서 `picker-clear.ts`는 `chrome.tabs`를 쓰는 browser-bound라 `lib/`가 아니라 `sidepanel/` 루트 leaf다(커버리지 `BROWSER_BOUND_EXACT` 등재 필수).
- **역방향도 같다 — 사이드패널·store는 `@/background/*`를 value import하지 않는다.** 끌면 OAuth 런처·설정 저장소가 패널 번들 그래프에 딸려온다. 양쪽이 함께 쓰는 순수 술어는 `src/lib/` leaf로 승격한다(`lib/jira-sprint.ts:isActiveSprint` — 사이드패널 sticky 검증과 background가 같은 화이트리스트를 써야 해서 뗐다). 예외는 상수만 든 leaf(`buildIssueAdf.ts → @/background/lib/adf-logs-link`). **typecheck는 이 경계를 안 잡는다**(둘 다 green인 채로 번들만 커진다) — 그물은 `src/store/__tests__/bundleBoundary.test.ts`의 소스 스캔뿐이고, 그건 store 방향만 본다. 사이드패널→background 방향은 여전히 무방비다.
- `chrome.scripting.executeScript({..., func})`: 직렬화·재평가라 **클로저가 안 살아남는다**(world와 무관 — `files:` 형태 주입은 규칙 무관). 주입 함수는 self-contained, 헬퍼는 nested로 inline. `func` 형태 사용처는 `github-upload.ts:pageBatchUploadFn`·`picker-control.ts:getTopViewport` 둘뿐이고 **리팩터 시 실제 탭 회귀 필수**. 상세: [ARCHITECTURE.md](./docs/ARCHITECTURE.md) 동명 섹션

## 메모리 & 참고 문서

- `docs/PERMISSION.md` — Chrome 권한 전체 레퍼런스 (activeTab 라이프사이클, OAuth 토큰 흐름, optional permission 등)
- `docs/CI.md` — GitHub Actions 구성·게이트·함정 (job 4개·e2e 샤딩·xvfb depth 24·nightly notify). **CI 워크플로우를 수정하거나 CI 실패를 진단할 때 먼저 읽는다.** `/doc-check ci`가 `.github/workflows/ci.yml`과 대조
- `AGENTS.md` · `.agents/skills/` — CLAUDE.md·`.claude/commands/`의 **Codex 호환 미러**. `scripts/sync-agents.mjs`(`pnpm sync:agents`)가 만드는 **순수 생성물이라 손으로 편집하지 않는다** — 고칠 건 원본에서 고친다. 본문은 치환 없이 그대로 복제하므로 미러가 `CLAUDE.md`·`.claude/commands/`를 가리켜도 그 경로가 맞다. Codex 런타임 차이(훅 부재·미제공 스킬·커밋 트레일러)만 `.agents/PREAMBLE.md`에 손으로 관리해 AGENTS.md 상단에 붙는다.
  - **역할 분담**: Codex는 **작업 → 커밋까지**, 원격으로 나가는 건 Claude Code 단일 창구. `/push`·`/merge`·`/deploy`·`/sync`는 미러하지 않는다(스크립트 `EXCLUDE`) — 릴리스 게이트(원격 CI 결론 조회, 버전 bump, tag)가 두 창구에서 경쟁하면 깨지기 때문. 나머지 17개가 미러 대상이고, 원본이 없어진 미러 디렉터리는 sync가 지운다. `/ship`은 미러하되 **Codex에선 11단계(마지막 커밋)까지만** 돌고 12·13단계(`/push`·`/build`)를 인계한다 — 이 분기는 `ship.md` 본문("push 권한 / 런타임별 종착점")에 박혀 있어 미러에 그대로 따라간다.
  - **드리프트 방지 2단**: ① `.claude/settings.json`의 PostToolUse 훅이 `CLAUDE.md`·`.claude/commands/*.md`·`.agents/PREAMBLE.md` 편집 시 sync를 자동 실행 ② `/push`가 `pnpm sync:agents:check`로 최종 차단. **훅은 Claude Code 전용이라 Codex 세션에선 안 돈다** — Codex가 원본을 고쳤으면 `pnpm sync:agents`를 손으로 돌린다.
- `docs/POSTMORTEM.md` — 회귀·버그 사후분석 회고 누적 (git 공유). `/postmortem` 스킬이 픽스마다 비자명 함정·재발방지를 한 항목씩 추가. 항목엔 **영역·계열·그물 3축 태그**가 붙고 `pnpm postmortem:report`가 반복 함정을 집계한다(vocab 단일 출처 `scripts/postmortem-report.mjs`) — 기록만 하고 안 세면 개별 회고에서 끝나므로 집계까지가 한 회로다
- `docs/features/DROPPED.md` — **기획까지 갔다가 안 하기로 한 것들의 사유 기록** (git 공유). **기획을 접기로 결정하면 `docs/features/<slug>/`를 그냥 지우지 말고 여기 항목을 남긴다 — `/feature` 세션이 아니어도, 일반 대화에서 결정했어도 마찬가지다**(실제로 대부분 그렇다). 항목마다 *왜 안 하는지* + *무엇이 바뀌면 다시 볼 만한지*를 쓴다("지금은 안 한다"와 "영원히 안 한다"는 다르다). 역으로 새 기능을 기획하기 전 이 파일을 기능 키워드로 grep해 과거 판단을 소환한다(`/feature` 0단계 — 쓰기만 하고 안 읽으면 죽은 로그, `POSTMORTEM`과 같은 회로). 판정 기준 4개: **브라우저·기존 도구가 이미 하는가 / 페이지에 무언가를 심어야 하는가 / 사정거리가 이름값보다 좁은가 / 검증 수단이 있는가**
- `docs/privacy.ko.md` · `docs/privacy.en.md` — 개인정보처리방침 (ko 원본 + en 번역, 항상 동기화). bug-shot.com/{ko,en}/privacy로 서빙
- 사용자 개인 메모리: `~/.claude/projects/<저장소 절대경로의 `/`를 `-`로 바꾼 슬러그>/memory/`에 있음. **머신마다 홈 디렉터리가 달라 경로를 박지 않는다** (머신 로컬, git에 안 올라감)
