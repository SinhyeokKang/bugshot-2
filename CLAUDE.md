# CLAUDE.md

## 응답 스타일 (이 문서의 다른 모든 규칙보다 우선)

**한국어로, 간결하게.** 위반 시 답변을 다시 쓴다. 아래는 취향이 아니라 판정 기준이다.

- **첫 문장이 결론**: 서두·예고 금지 — "~해보겠습니다", "좋은 질문입니다", "확인해보니 다음과 같습니다" 류로 시작하지 않는다. 바로 답/결과부터.
- **꾸밈말 금지**: "완벽합니다", "훌륭한", "핵심적인", "말씀하신 대로" 같은 평가·동조 표현을 빼도 정보가 안 줄면 뺀다.
- **재진술 금지**: 방금 보여준 diff·명령 출력·파일 내용을 산문으로 다시 설명하지 않는다. 코드가 말하는 건 코드가 말하게 둔다.
- **길이 상한**: 단순 질문·확인 → 3줄 이내. 작업 완료 보고 → 10줄 이내(변경 파일 목록 제외). 넘길 거면 왜 넘기는지 먼저 밝힌다.
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
- Tailwind CSS v3 + shadcn/ui + `@tailwindcss/container-queries` (디자인 시스템·색상 토큰·UI 컨벤션 상세는 [DESIGN.md](./docs/DESIGN.md))
- Zustand + `chrome.storage` (session/local 혼용)
- Tiptap (ProseMirror) WYSIWYG 에디터 + `tiptap-markdown` 양방향 변환 + `markdown-it` (HTML/ADF/Notion 변환용 파서)
- 스크린샷 어노테이션: Konva + react-konva 캔버스(사이드패널 lazy 청크). 도형은 natural 좌표, 표시 배율은 CSS transform. 줌·팬 계산은 `sidepanel/components/annotation/viewport.ts` 순수 함수 단일 출처(fit-width 진입 / 전체 조망 / 사용자 배율을 `ZoomLevel`로 **의도 저장**). 드래그는 **window 리스너**로 구동 — pointer capture를 쓰지 않는다(상세·함정은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md))
- 요소 스타일 CSS 코드 뷰: CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-css` + `@codemirror/autocomplete` + `@codemirror/language` + `@lezer/highlight`, 사이드패널 전용 lazy 청크) — 편집/CSS 세그먼트 토글의 CSS 뷰
- 영상: 탭 녹화(`tabCapture`+MediaRecorder) / 화면 녹화(`getDisplayMedia` — 웹 표준, 추가 manifest 권한 불필요·user gesture만 요구) / 30s Replay(`captureVisibleTab` 폴링 프레임 → WebCodecs `VideoEncoder`+`mp4-muxer` H.264 MP4). 캡처 모드(`CaptureMode`): element/screenshot/video/freeform + 30s replay. 탭 녹화·화면 녹화는 둘 다 `video` 모드이고 `RecordingSource`(tab/screen) 축으로 갈린다. **정지 후 구간 자르기는 3경로 공용** — 같은 오버레이(`ReplayTrimDialog`)와 같은 로그 경계 헬퍼를 쓰고 `TrimSource`(frames=리플레이 프레임축 / recording=녹화 벽시계축)로만 갈린다. 녹화를 자르면 `30s-replay/encode-range.ts`가 `<video>` 배속 재생 + `requestVideoFrameCallback`으로 재디코드해 선택 구간만 WebCodecs로 재인코딩한다(전체 구간이면 원본 blob 유지). 상세는 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) "트리밍" 참조
- 재현 환경 `API Hosts` 자동 행: 네트워크 로그에서 페이지와 같은 registrable domain(`tldts` PSL)의 hostname을 파생해 `draft.environment`에 주입. 게이트는 `supportsConsoleNetworkLog`+`logsAttach` 단일 진입점(`sidepanel/lib/apiHostRow.ts` — **컴포넌트에 두면 element 누출이 green으로 통과한다**), 제출 직전 2차 방어는 `stripApiHostsRows`. 상세·불변식은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) "API Hosts 자동 행"
- 스크린샷 캡처 방식 3축(영역/화면/페이지 전체): `CaptureMode`와 **직교** — 셋 다 `captureMode: "screenshot"`으로 수렴하고(종착점 `onAreaCaptured`) 방식 자체는 union 타입도 영속화도 없다. `capturing` phase 하단 툴바에서 고른다. 페이지 전체 캡처는 사이드패널 오케스트레이터(`sidepanel/scroll-capture.ts`)가 content executor(`content/scroll-capture.ts`)를 스크롤시키며 타일을 background `captureVisibleTab` 관문으로 찍어 canvas 스티칭(캡: 20타일·캔버스 32000px·출력 4M px). 첫 타일 이후 반복되는 `fixed`와 이미 전부 노출된 뒤 붙은 `sticky`를 `visibility`로 숨기고, 캡처 중 추가·position 변경된 후보도 추적한 뒤 원래 스타일·스크롤을 복원한다. 상세·불변식은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) "캡처 3축" 참조
- element 모드 before/after 캡처 범위: 요소 bbox+24px가 기본이고, 요소를 감싼 **의미 단위 조상 컨테이너**(다이얼로그·`tr`·`li`·`article` 등)가 게이트 3개(뷰포트 완전 포함 / 요소 포함 / 뷰포트 면적 40% 이하)를 전부 통과할 때만 그쪽으로 넓혀 찍는다. 위 캡처 3축과 **직교**한다(3축은 screenshot 모드의 *방식* 축). 판정은 `content/capture-context.ts`·`sidepanel/lib/capture-basis.ts` 순수 함수 2벌 — picker/capture가 coverage 로직 스코프 제외라 거기 남기면 테스트로 못 고정한다. `form`·`fieldset`은 개인정보 노출 면적 때문에 후보 제외이고 이 범위는 docs/privacy에 공개돼 있다. 상세·불변식은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) 동명 섹션
- AI: Chrome Built-in AI 폴백 + BYOK OpenAI-compatible/Anthropic endpoint. AI 초안·재현 단계 자동채움·스타일링 요청에 필요한 컨텍스트만 사용자가 선택한 provider로 직접 전송
- 사용자 파일 첨부: 기본 off. IndexedDB에 pending tab owner로 저장 후 이슈 owner로 rekey, 최대 10개·합계 50MB, 플랫폼별 업로드
- 분석: PostHog (익명 이슈 제출·연동 집계 — `src/background/analytics.ts`. store는 `VITE_POSTHOG_KEY_PROD`, 비-store는 `VITE_POSTHOG_KEY`; 선택된 키가 없으면 no-op)
- 본문 구성 순서 재정렬: `@dnd-kit/core`+`sortable`+`modifiers`+`utilities` (설정 탭 전용). 순서 배열은 `issueSections` 단일 출처이고 `arrayMove`는 스토어에 인라인 — 이 스토어가 background 번들에 들어가므로 dnd-kit을 그래프에 유입시키지 않는다. transform은 `CSS.Translate`만 적용(FLIP 보정 scaleY가 행 높이를 눌러서)
- 아이콘: lucide-react (UI 일반) + `@icons-pack/react-simple-icons` (플랫폼 브랜드), 폰트: Pretendard(본문) + Geist Mono(코드 표면 — `font-mono` 및 preflight 경유 `pre`/`code`. log-viewer는 `@font-face`가 없어 시스템 mono로 의도적 폴백) — 사용 컨벤션은 [DESIGN.md](./docs/DESIGN.md)
- MV3 service worker + content script + side panel

## 명령어

| 용도 | 명령 |
|---|---|
| 개발 서버 | `pnpm dev` |
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

스킬 20개의 역할·단계별 게이트는 `.claude/commands/<name>.md`에 정의돼 있고(한 줄 설명은 세션 스킬 목록에 상시 노출된다), Codex 미러는 `.agents/skills/source-command-<name>/SKILL.md`다.

권장 흐름: `/feature` → `/feature-review` → `/tdd interface` → `/implement` → `/e2e-write` → `/code-review` → `/tdd regression` → `/refactor` → `/push`(논블로킹 — e2e는 CI가 검증) → `/merge`(dev HEAD의 CI 결론 확인 → PR CI 대기 → 머지). 사용자 노출 UX·기능을 건드렸으면 `/push` 전에 `/guide`로 ko/en 가이드를 맞춘다(`/implement` 보고의 "가이드 영향" 플래그가 신호). e2e 시나리오가 추가·변경됐으면 `/e2e-write`로 spec을 green까지(`/implement` 보고의 "e2e 영향" 플래그가 신호). `/tdd` 분류표(스킬 정의 안)에 따라 컴포넌트·OAuth·DOM 측정 같은 영역은 스킵 OK. **회귀·버그를 잡아 고쳤으면 `/postmortem`으로 `docs/POSTMORTEM.md`에 회고를 남긴다**(같은 함정 재발 방지 — 실패 사후분석 회로). 역으로 `/implement`·`/refactor`·`/code-review`는 **착수 전 변경 영역으로 `docs/POSTMORTEM.md`를 grep**해 과거 함정을 소환한다(쓰기만 하고 안 읽으면 죽은 로그 — 소환 회로로 루프를 닫는다).

### 문서 신선도

`/push`가 **푸시될 diff에 걸린 문서만** 트라이아지한다 — 대상 목록·트리거·문서별 확인 항목은 `.claude/commands/push.md` 4단계. diff와 무관하게 누적된 stale은 `/doc-check`가 9개 문서 전문을 코드와 양방향 대조해 잡는다. 갱신은 문서별 별도 커밋(`docs(CLAUDE): ...` / `docs(ARCHITECTURE): ...` / `docs(privacy): ...` …)으로 묶는다. **아래 3개는 `/push` 미러가 없는 Codex 세션에서도 지켜야 하므로 여기 남긴다:**

- **`README.md`(en 원본) ↔ `README.ko.md`(ko 번역)** 는 항상 같은 내용이라 **한쪽을 고치면 같은 커밋에서 양쪽을 함께** 갱신한다(섹션 구성도 대칭 유지). ko가 링크를 한국어 리소스(`docs/privacy.ko.md`·`bug-shot.com/ko/…`·`guide/ko/assets/`)로 돌리는 건 의도된 로케일 차이다.
- **docs/privacy.{ko,en}.md는 권한 문자열이 아니라 실제 동작에 묶인다**: 새 기능이 *기존* 권한(`<all_urls>`·`activeTab`·`tabCapture`·`scripting` 등)을 새 목적으로 쓰거나 새 캡처·수집·저장·전송 동작을 추가하면 **manifest diff가 0이어도** 대조·갱신한다. diff에 `chrome.permissions.request`/`captureVisibleTab`/`tabCapture`/`chrome.scripting`/신규 외부 `fetch`/`chrome.storage`·IndexedDB write가 보이면 트리거. **ko가 원본, en은 번역이라 ko/en 양쪽 본문과 상단 시행일을 함께 갱신**한다. (30s Replay가 기존 optional 권한 재사용으로 이 검사를 빠져나가 심사 탈락한 전례 있음)
- 가이드(`guide/ko`·`guide/en`)를 쓰기 전 **`guide/AUTHORING.md`를 먼저 읽는다** — IA·톤·UI 라벨·footer·검증 규칙의 단일 출처. 가이드 작성 기준 자체(사실 스냅샷·플랫폼 표·지원 플랫폼)가 바뀌면 AUTHORING.md도 함께 갱신.

## 코드 컨벤션

- 스타일: `src/components/ui/` 이외에 주석 최소화. WHY가 비자명할 때만 한 줄.
- 경로: `@/` → `src/`
- **UI·디자인 컨벤션**: UI 컴포넌트 직접 스타일링 금지 — shadcn/ui 우선 사용, 없으면 `npx shadcn@latest add <component>`. 색상 토큰·다크모드·버튼/아이콘 사이즈·레이아웃·합성 컴포넌트·탭 렌더 규칙 등 전체 컨벤션은 **[DESIGN.md](./docs/DESIGN.md)** 참조.
- 커밋 메시지·PR title/body·GitHub Release notes는 **영문**으로 작성
- **테스트**: 코드 변경 시 관련 테스트 작성 + `pnpm test` 통과 확인 필수. 대상과 같은 디렉터리의 `__tests__/`에 두고 Vitest를 쓴다. **2트랙**:
  - `*.test.ts` — node 환경. 순수 함수·헬퍼(기본 트랙).
  - `*.test.tsx` — **jsdom + @testing-library/react**(+ `@testing-library/user-event` — 인터랙션 시뮬레이션. `vitest.config.ts`의 `environmentMatchGlobs`가 확장자로 자동 분기, 셋업은 `src/test/setup-dom.ts` — cleanup + ResizeObserver·PointerCapture·scrollIntoView 폴리필). 렌더·인터랙션이 상태 전이를 좌우하는 컴포넌트(콤보박스 등)와, 실제 DOM이 필요한 비컴포넌트 검증(헤드리스 Tiptap 왕복·vanilla DOM 셸 등)에 쓴다. 단, **포인터 드래그·캔버스처럼 브라우저 실동작에 걸린 것은 jsdom으로도 못 잡는다** — e2e·수동이 유일한 안전망(docs/POSTMORTEM.md).
  - **커버리지**: `pnpm test:coverage`(vitest v8) → `/coverage` 스킬이 리포트. **주 지표는 "로직 스코프" 라인 %**(브라우저 전용·UI 코드를 분모에서 제외 — 전체 %는 의도적 0% 코드가 섞여 TDD 다이얼로 안 맞다). **로직 스코프** 제외 규칙의 단일 출처는 `scripts/coverage-report.mjs`의 `isBrowserBound()`(테스트 인프라 제외는 그 앞단 `vitest.config.ts`의 `coverage.exclude`가 맡는다) — 유닛테스트 불가능한 새 런타임 파일(content DOM·미디어·OAuth 런처·SW 엔트리)을 추가하면 여기 등록. 트렌드 베이스라인은 git-tracked `coverage/baseline.json`(리포트 본체는 `.gitignore`), 개선 시 `pnpm coverage:update`로 래칫.
- **Codex 미러 자동 동기화**: `CLAUDE.md`·`.claude/commands/*.md`·`.agents/PREAMBLE.md`를 Edit/Write하면 `.claude/settings.json`의 PostToolUse 훅이 `pnpm sync:agents`를 실행해 `AGENTS.md`·`.agents/skills/`를 재생성한다. 생성물이므로 직접 편집 금지 — 상세는 아래 "메모리 & 참고 문서" 참조.
- **i18n 자동 검사**: `src/i18n/` 파일을 Edit/Write하면 `.claude/settings.json`의 PostToolUse 훅이 `src/i18n/__tests__/locales.test.ts`(ko/en 키 대칭·빈 값·placeholder 토큰 일치)를 자동 실행해 불일치 시 차단. 키 추가 시 ko/en 양쪽을 함께 갱신할 것.
  - **사전은 두 벌이다** — log-viewer는 별도 빌드라 `src/log-viewer/i18n.ts`에 `koDict`/`enDict` **복제 사전**을 따로 둔다. 훅 matcher가 `*src/i18n/*`라 이 파일엔 **안 걸리고**, 대신 `src/log-viewer/__tests__/i18n.test.ts`가 ko/en 대칭·placeholder·**메인 테이블(`logs`·`editor`) 값 일치**를 대조한다 — 즉 저장 즉시가 아니라 `pnpm test`에서 잡힌다. log-viewer가 재사용하는 공용 컴포넌트(NetworkLog·ConsoleLog·ActionLog·IssuePreview)에 키를 추가하면 **두 사전을 함께** 갱신할 것.

## 게이트웨이 (알아두면 유용)

- 매니페스트 `minimum_chrome_version: "116"` — sidePanel API 요구사항
- 지원 URL: `http:`, `https:`, `file:` 스킴만. 추가로 `chromewebstore.google.com` 전체와 `chrome.google.com/webstore/*` 트리는 Chrome이 content script 주입을 차단해서 `src/lib/url-support.ts`의 `isSupportedUrl()`이 미지원으로 처리. **미지원 URL에서도 side panel은 연다** — `activateTab`은 URL을 보지 않고, `apply()`도 activation만 본다. 패널 표시 여부는 activation을 따르고 지원 여부는 **패널이 무엇을 그리는지만** 결정한다(무음 클릭 제거). 미지원이면 `useTabUnsupported`(`sidepanel/hooks/useTabSupport.ts`)가 판정해 Debug>이슈의 캡처 진입 화면을 `app.captureUnsupported.*` 안내로 바꾸고(캡처 버튼 5개는 안내로 교체, `[이슈 작성]`은 `aria-disabled`로 자리 유지), console/network 서브탭을 잠그고, 레코더 sync·30s Replay 폴링·영상 캡처를 게이트한다. 연동·설정·이슈 목록 탭은 미지원 페이지에서도 완전히 동작한다. 사용 중 race로 unsupported로 진입하면 picker가 `onPickerUnavailable` 이벤트를 발화해 안내 다이얼로그 노출.
- iframe 지원 (picker): picker content script(`picker.ts`, content_scripts[0])는 로그 레코더처럼 `all_frames: true`로 전 프레임에 주입 — **1-depth iframe** 내부 요소 선택·스타일링·캡처를 지원한다(cross-origin 포함). 자식 picker가 `picker.start`에 실린 frameToken으로 부모 registry에 등록(`frame-geometry.ts` postMessage 핸드셰이크 + token 검증 — **단 token은 자식이 `postMessage(..., "*")`로 보내 부모 페이지도 읽으므로 인증이 아니라 힌트다.** 상세·수용된 잔여 위험은 ARCHITECTURE.md "등록 핸드셰이크" 참조)되면 top blocker가 그 iframe 위에서만 pointerEvents 핸드오프. 캡처는 offset 핸드셰이크(arm 게이트 + registry 확인)로 top 좌표 합성. **미등록 iframe(중첩 2-depth+·sandbox)** 클릭은 기존 거부 경로 유지 — `picker.iframeUnsupported` → `onPickerIframeUnsupported` 안내 다이얼로그 + idle 복귀. 사이드패널 라우팅은 `sender.frameId` 기반(`send(tabId, msg, frameId)` required), 요소 식별은 selector+frameId 복합키(`@/lib/element-key.ts`의 `sameElementKey` 단일 출처).
- iframe 로그 커버리지: 로그 레코더는 picker와 분리된 별도 content_scripts 2개로 **모든 프레임**에 주입(`all_frames: true`) — `recorder-bridge.ts`(ISOLATED, sentinel 수신·data 중계)와 `recorders-entry.ts`(MAIN, console/network/action 후크). cross-origin iframe(Stripe·임베드 위젯 등)의 console/network 로그까지 캡처한다. `webNavigation.onCommitted`로 커밋된 iframe에 sentinel 재발행. origin은 entry의 `pageUrl`에서 `originOf()`로 런타임 파생 — cap evict 시 top-page-origin 우선 보존(`mergeLogItems`, console/network만 — action은 광고 폭증이 없어 순수 FIFO), 로그 탭에 origin 필터(`OriginFilterBar`, console/network/action 공용) 노출. picker DOM 선택은 위 항목대로 1-depth iframe까지 지원(중첩·sandbox 제외).
- pre-arm 버퍼링 (동기 IIFE 빌드 제약): `recorders-entry`는 self-contained 청크(외부 static import 0)여야 crxjs가 **동기 IIFE**로 emit → document_start 후크가 페이지 인라인 스크립트보다 먼저 깔린다. 그래야 `recorder-prearm.ts`의 sessionStorage 플래그(`__bugshot_recorder_active__`)를 읽어 active origin(한 번이라도 armed된 origin)이면 sentinel 도착 **전**부터 로그를 버퍼 적재(적재 게이트 `capturing` vs dispatch 게이트 `recording` 분리, sentinel 없으면 전송 no-op). 레코더는 `content/log-throttle.ts`, 사이드패널 수신부는 복제본 `sidepanel/lib/trailing-throttle.ts`를 쓰는 분리가 이 제약 때문 — 청크에 외부 static import가 유입되면 async loader로 되돌아가 pre-arm이 무력화된다(리팩터 시 회귀 주의).
- 단축키: `_execute_action`(`Cmd/Ctrl+Shift+E`, 사이드패널 토글) 1개만 등록. Chrome이 `action.onClicked`로 내부 처리하므로 별도 `onCommand` 리스너 불필요. (캡처 단축키 3개는 제거됨 — manifest 전용이라 영속 데이터·마이그레이션 없이 무손실. 캡처는 진입 화면 버튼으로만.)
- permissions: `sidePanel`, `activeTab`, `scripting`, `storage`, `commands`, `contextMenus`, `identity`, `tabCapture`, `webNavigation` (메인 프레임 네비게이션 커밋 직전 로그 꼬리 sync — cross-page 로그 누적)
- host_permissions: **`<all_urls>` 단일** (required) — picker·로그 레코더 주입, `captureVisibleTab`(cross-origin 네비게이션에서 activeTab 회수돼도 캡처 유지), cross-origin stylesheet 원문 fetch(`css.fetchSheets` — 스타일 값 보강, SSRF 가드 경유), BYOK LLM·GitLab self-managed·8개 플랫폼 REST/OAuth·OAuth proxy fetch를 전부 커버한다. 설치 시 "모든 사이트" 경고 상시, 런타임 권한 프롬프트 없음(코드에 host별 `permissions.contains` 체크 없음). 사용처 전수·라이프사이클은 [PERMISSION.md](./docs/PERMISSION.md) §11–13, 트래픽 대상은 [privacy.ko.md](./docs/privacy.ko.md)
- (`<all_urls>`는 required — 과거 optional + 런타임 `chrome.permissions.request()` 모델은 폐기. BYOK/GitLab의 `requestHostPermission` 호출은 코드에 남아있으나 이미 보유라 즉시 grant, 프롬프트 없음)
- OAuth 관련 env: `VITE_ATLASSIAN_CLIENT_ID`, `VITE_GITHUB_CLIENT_ID` (dev), `VITE_GITHUB_CLIENT_ID_PROD` (store build 시 치환), `VITE_LINEAR_CLIENT_ID` (단일 client — dev/store redirect URI 둘 다 한 앱에 등록), `VITE_NOTION_CLIENT_ID`, `VITE_GITLAB_CLIENT_ID`, `VITE_ASANA_CLIENT_ID` (단일 client — dev/store redirect URI 둘 다 한 앱에 등록), `VITE_CLICKUP_CLIENT_ID` (단일 client — dev/store redirect URI 둘 다 한 앱에 등록), `VITE_SLACK_CLIENT_ID` (단일 client — OAuth 전용, dev/store redirect URI 둘 다 한 앱에 등록), `VITE_OAUTH_PROXY_URL` — 누락 시 해당 플랫폼 OAuth UI 자동 비활성화 (`background/oauth/config.ts`의 `OAUTH_CONFIG` 테이블 + `isConfigured()` 판정 — messages.ts `*.oauth.available` 단일 경로)
- 분석 env: `VITE_POSTHOG_KEY` (dev), `VITE_POSTHOG_KEY_PROD` (store build 시 치환), `VITE_POSTHOG_HOST` (`https://in.bug-shot.com` — PostHog 관리형 리버스 프록시. 광고차단·DNS 차단 리스트에 오른 `us.i.posthog.com`을 우회하려는 것이고, 코드 기본값은 그 `us.i.posthog.com`이라 env 누락 시 조용히 옛 호스트로 나간다) — 키 누락 시 PostHog 집계 no-op
- `BUGSHOT_STORE_BUILD=1`: 스토어 업로드용 빌드 (manifest `key` 제거)
- `BUGSHOT_E2E_BUILD=1`: e2e 전용 빌드 — `dist-e2e/` 분리 산출. dev `key` 유지. (`<all_urls>`는 이제 prod·e2e 공통 required라 e2e 빌드가 권한을 별도 추가하지 않음 — 분리 이유는 outDir 격리뿐.) **dist-e2e는 테스트 전용 — Chrome 수동 로드·스토어 업로드 금지.** 배포 산출물(dist)은 무오염(분리 outDir)
- **store는 `sidepanel/tabs`를 import하지 않는다** — store가 컴포넌트 그래프를 끌어들이면 순환·번들 오염이 생긴다. store가 필요로 하는 순수 로직은 `sidepanel/lib/`으로 승격한다. 사례: `initialJiraFields`(Jira 필드 prefill 단일 출처 — `editor-store.confirmDraft`가 쓰므로 `tabs/jiraFields/`가 아니라 `lib/`에 둔다. 다른 플랫폼의 `initial*Fields`는 store가 안 써서 각 `*IssueFields.tsx`에 콜로케이션).
- `chrome.scripting.executeScript({..., func})`: 직렬화·재평가라 **클로저가 안 살아남는다**(world와 무관 — `files:` 형태 주입은 규칙 무관). 주입 함수는 self-contained, 헬퍼는 nested로 inline. `func` 형태 사용처는 `github-upload.ts:pageBatchUploadFn`·`picker-control.ts:getTopViewport` 둘뿐이고 **리팩터 시 실제 탭 회귀 필수**. 상세: [ARCHITECTURE.md](./docs/ARCHITECTURE.md) 동명 섹션

## 메모리 & 참고 문서

- `docs/PERMISSION.md` — Chrome 권한 전체 레퍼런스 (activeTab 라이프사이클, OAuth 토큰 흐름, optional permission 등)
- `docs/CI.md` — GitHub Actions 구성·게이트·함정 (job 4개·e2e 샤딩·xvfb depth 24·nightly notify). **CI 워크플로우를 수정하거나 CI 실패를 진단할 때 먼저 읽는다.** `/doc-check ci`가 `.github/workflows/ci.yml`과 대조
- `AGENTS.md` · `.agents/skills/` — CLAUDE.md·`.claude/commands/`의 **Codex 호환 미러**. `scripts/sync-agents.mjs`(`pnpm sync:agents`)가 만드는 **순수 생성물이라 손으로 편집하지 않는다** — 고칠 건 원본에서 고친다. 본문은 치환 없이 그대로 복제하므로 미러가 `CLAUDE.md`·`.claude/commands/`를 가리켜도 그 경로가 맞다. Codex 런타임 차이(훅 부재·미제공 스킬·커밋 트레일러)만 `.agents/PREAMBLE.md`에 손으로 관리해 AGENTS.md 상단에 붙는다.
  - **역할 분담**: Codex는 **작업 → 커밋까지**, 원격으로 나가는 건 Claude Code 단일 창구. `/push`·`/merge`·`/deploy`·`/sync`는 미러하지 않는다(스크립트 `EXCLUDE`) — 릴리스 게이트(원격 CI 결론 조회, 버전 bump, tag)가 두 창구에서 경쟁하면 깨지기 때문. 나머지 16개가 미러 대상이고, 원본이 없어진 미러 디렉터리는 sync가 지운다. `/ship`은 미러하되 **Codex에선 11단계(마지막 커밋)까지만** 돌고 12·13단계(`/push`·`/build`)를 인계한다 — 이 분기는 `ship.md` 본문("push 권한 / 런타임별 종착점")에 박혀 있어 미러에 그대로 따라간다.
  - **드리프트 방지 2단**: ① `.claude/settings.json`의 PostToolUse 훅이 `CLAUDE.md`·`.claude/commands/*.md`·`.agents/PREAMBLE.md` 편집 시 sync를 자동 실행 ② `/push`가 `pnpm sync:agents:check`로 최종 차단. **훅은 Claude Code 전용이라 Codex 세션에선 안 돈다** — Codex가 원본을 고쳤으면 `pnpm sync:agents`를 손으로 돌린다.
- `docs/POSTMORTEM.md` — 회귀·버그 사후분석 회고 누적 (git 공유). `/postmortem` 스킬이 픽스마다 비자명 함정·재발방지를 한 항목씩 추가. 항목엔 **영역·계열·그물 3축 태그**가 붙고 `pnpm postmortem:report`가 반복 함정을 집계한다(vocab 단일 출처 `scripts/postmortem-report.mjs`) — 기록만 하고 안 세면 개별 회고에서 끝나므로 집계까지가 한 회로다
- `docs/privacy.ko.md` · `docs/privacy.en.md` — 개인정보처리방침 (ko 원본 + en 번역, 항상 동기화). bug-shot.com/{ko,en}/privacy로 서빙
- 사용자 개인 메모리: `~/.claude/projects/<저장소 절대경로의 `/`를 `-`로 바꾼 슬러그>/memory/`에 있음. **머신마다 홈 디렉터리가 달라 경로를 박지 않는다** (머신 로컬, git에 안 올라감)
