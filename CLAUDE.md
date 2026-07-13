# CLAUDE.md

bugshot-2: Chrome MV3 Side Panel 버그 리포팅 확장. 웹 페이지의 버그를 요소 스타일 편집(before/after 비교)·스크린샷(영역/화면/페이지 전체/요소, 어노테이션)·영상 녹화(탭/화면, 30초 리플레이) 중 원하는 방식으로 캡처하고, 콘솔·네트워크·사용자 액션 로그를 자동 수집한다. 이렇게 만든 리포트를 Jira·GitHub·Linear·Notion·GitLab·Asana·ClickUp 이슈로 등록하거나 Slack 채널·DM으로 공유한다.

사용자는 한국어로 간결한 답변을 선호한다. 불필요한 꾸밈말·서두 금지.

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
- 요소 스타일 CSS 코드 뷰: CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-css` + `@codemirror/autocomplete` + `@codemirror/language` + `@lezer/highlight`, 사이드패널 전용 lazy 청크) — 편집/CSS 세그먼트 토글의 CSS 뷰
- 영상: 탭 녹화(`tabCapture`+MediaRecorder) / 화면 녹화(`getDisplayMedia` — 웹 표준, 추가 manifest 권한 불필요·user gesture만 요구) / 30s Replay(`captureVisibleTab` 폴링 프레임 → WebCodecs `VideoEncoder`+`mp4-muxer` H.264 MP4). 캡처 모드(`CaptureMode`): element/screenshot/video/freeform + 30s replay. 탭 녹화·화면 녹화는 둘 다 `video` 모드이고 `RecordingSource`(tab/screen) 축으로 갈린다
- 스크린샷 캡처 방식 3축(영역/화면/페이지 전체): `CaptureMode`와 **직교** — 셋 다 `captureMode: "screenshot"`으로 수렴하고(종착점 `onAreaCaptured`) 방식 자체는 union 타입도 영속화도 없다. `capturing` phase 하단 툴바에서 고른다. 페이지 전체 캡처는 사이드패널 오케스트레이터(`sidepanel/scroll-capture.ts`)가 content executor(`content/scroll-capture.ts`)를 스크롤시키며 타일을 background `captureVisibleTab` 관문으로 찍어 canvas 스티칭(캡: 20타일·캔버스 32000px·출력 4M px). 상세·불변식은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) "캡처 3축" 참조
- 분석: PostHog (익명 이슈 제출·연동 집계 — `src/background/analytics.ts`. store 빌드만 키 주입, dev/e2e는 키 부재로 no-op)
- 아이콘: lucide-react (UI 일반) + `@icons-pack/react-simple-icons` (플랫폼 브랜드), 폰트: Pretendard — 사용 컨벤션은 [DESIGN.md](./docs/DESIGN.md)
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
| 테스트 | `pnpm test` |
| 테스트 (watch) | `pnpm test:watch` |

**빌드는 자동 실행하지 않는다.** 사용자가 명시적으로 요청하거나 `/build` 스킬을 실행할 때만 돌린다. 타입 확인이 필요하면 `pnpm typecheck` 선호. 예외: `build:e2e`(dist-e2e)는 `/e2e-write`·`/e2e-run`·`/push`/`/merge` e2e 게이트에서 실행 허용 — 배포 산출물(dist)과 분리돼 있다.

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

```
/feature        → 기능 아이디어 → PRD·기술 설계·태스크 문서 산출 (코딩 안 함)
/feature-review → feature 산출물을 CPO·CDO·CTO·QA 4명이 병렬 검수 (선택 호출 가능) → 피드백 수렴 → 문서 수정
/tdd            → 테스트만 작성 (구현·픽스·커밋 안 함). interface 모드(신규 헬퍼 시그니처) / regression 모드(리뷰 발견 회귀 테스트)
/implement      → tasks/테스트 기반 구현 (메인 단일) → 영역별 4관점 자체 검증 → CTO 최종 게이트 → 🔴🟡 자체 수정. 빌드·커밋 안 함 (보고에 "가이드 영향"·"e2e 영향" 플래그)
/e2e-write      → e2e 시나리오 → spec 작성 + build:e2e + 실행-수정 루프(최대 8회) → green + 1회 재실행. src 수정은 data-testid 추가만
/e2e-run        → build:e2e + test:e2e 실행 + 리포트 전용 (fix 금지). green & 클린 트리면 e2e/.last-green에 해시 기록
/pull           → dev 최신 받고 작업 맥락 브리핑
/build          → pnpm build + 테스트 체크리스트 (작업 중 검증)
/code-review    → 변경 코드를 ui·security·dataflow·codehealth 4개 에이전트가 병렬 리뷰 (선택 호출 가능). 리포트 전용
/audit          → 코드베이스 전체를 ui·security·dataflow·codehealth 4개 에이전트가 병렬 감사 (선택 호출 가능). 리포트 전용
/refactor       → audit·code-review 리포트의 지정 항목 수정 (메인 단일). 회귀 재현 테스트 먼저(TDD red) → 수정으로 green → 4관점 자체 검증 → CTO 게이트. 회귀 위험 항목은 강행 전 확인. 빌드·커밋 안 함
/postmortem     → 직전에 잡은 버그/회귀를 docs/POSTMORTEM.md에 회고 항목으로 추가 (비자명 함정만, 재발방지 grep/전수 대상 명시). 코드·빌드·커밋 안 함
/guide          → guide/ko·en 사용자 가이드 작성·갱신. AUTHORING.md 규칙 로드 → 코드 대조 stale 탐지 → ko/en 동시 갱신 + 검증. 빌드·커밋 안 함
/doc-check      → 8개 저장소 문서(CLAUDE/DIRECTORY/ARCHITECTURE/DESIGN/README/PERMISSION/privacy/AUTHORING)를 문서별 전담 에이전트가 병렬로 diff 무관 코드 양방향 대조(Pass1 문서→코드 사실오류 + Pass2 코드→문서 누락 커버리지) → 통합 리포트 → 항목별 확인 → 수정. /push 신선도 검사보다 깊다(diff에 안 걸린 누적 stale·섹션 내부 누락까지). guide/ko·en 본문은 제외(/guide 전담, AUTHORING은 검사). 빌드 안 함
/push           → dev push (main에서 호출 차단) + CLAUDE.md/docs/DIRECTORY.md/docs/ARCHITECTURE.md/README.md/docs/PERMISSION.md/docs/privacy.{ko,en}.md/guide(+AUTHORING.md) 신선도 검사 + e2e 게이트(.last-green == HEAD면 스킵 / 빨강이면 푸시 중단)
/merge          → dev에서 e2e 게이트 교차(통상 /push 기록 해시로 스킵 / 빨강이면 중단) → 버전 bump 커밋 + dev → main squash PR 생성 + 자동 머지
/deploy         → main 한정. tag push → 스토어 빌드 → zip → GitHub Release draft → 심사 요청 안내
/sync           → dev를 origin/main으로 hard reset + force push (배포/머지 후)
```

권장 흐름: `/feature` → `/feature-review` → `/tdd interface` → `/implement` → `/e2e-write` → `/code-review` → `/tdd regression` → `/refactor` → `/push`(e2e 게이트) → `/merge`(게이트 교차). 사용자 노출 UX·기능을 건드렸으면 `/push` 전에 `/guide`로 ko/en 가이드를 맞춘다(`/implement` 보고의 "가이드 영향" 플래그가 신호). e2e 시나리오가 추가·변경됐으면 `/e2e-write`로 spec을 green까지(`/implement` 보고의 "e2e 영향" 플래그가 신호). `/tdd` 분류표(스킬 정의 안)에 따라 컴포넌트·OAuth·DOM 측정 같은 영역은 스킵 OK. **회귀·버그를 잡아 고쳤으면 `/postmortem`으로 `docs/POSTMORTEM.md`에 회고를 남긴다**(같은 함정 재발 방지 — 실패 사후분석 회로). 역으로 `/implement`·`/refactor`·`/code-review`는 **착수 전 변경 영역으로 `docs/POSTMORTEM.md`를 grep**해 과거 함정을 소환한다(쓰기만 하고 안 읽으면 죽은 로그 — 소환 회로로 루프를 닫는다).

각 단계 게이트는 `.claude/commands/` 스킬 정의에 명시.

### 문서 신선도

`/push`는 항상 CLAUDE.md / docs/DIRECTORY.md / docs/ARCHITECTURE.md / README.md / docs/PERMISSION.md / docs/privacy.{ko,en}.md / guide/ (`guide/AUTHORING.md` 포함) 신선도 검사를 거친다 — 단, **푸시될 diff에 걸린 문서만** 트라이아지하는 2차 안전망이다. diff와 무관하게 누적된 stale(예: 오래 방치된 docs/ARCHITECTURE.md 섹션)을 잡으려면 `/doc-check`로 8개 문서 전문을 코드와 직접 대조한다. 아래 중 하나라도 해당하면 문서 갱신을 별도 커밋(`docs(CLAUDE): ...` / `docs(DIRECTORY): ...` / `docs(ARCHITECTURE): ...` / `docs(README): ...` / `docs(PERMISSION): ...` / `docs(privacy): ...` / `docs(guide): ...`)으로 묶어 함께 푸시:

- 새 디렉터리·파일 추가/삭제 (특히 `src/` 하위 구조 변화)
- `package.json` scripts 변경
- `manifest.config.ts` 변경 (권한·명령어·스킴)
- 새 하위 시스템·아키텍처 핵심 파일 큰 변경
- 새 컨벤션·게이트웨이 도입
- 기능 추가/삭제로 README의 사용법·기능 설명이 어긋남
- 사용자 노출 UX·기능 추가/변경 → `guide/ko`·`guide/en`(사용 가이드, ko/en 양쪽) 대조·갱신 (`docs(guide): ...`). **가이드 작성·수정 전 `guide/AUTHORING.md`를 먼저 읽고 그 규칙(IA·톤·UI 라벨·footer·검증)대로 한다 — 가이드 작업의 단일 출처.**
- 가이드 작성 기준 자체(IA·운영 방식·톤·UI 라벨 규칙·사실 스냅샷·플랫폼 표·지원 플랫폼)가 바뀜 → `guide/AUTHORING.md` 대조·갱신 (`docs(guide): ...`). 새 플랫폼 연동·단축키/로그 정책/본문 섹션 변경·새 페이지 추가가 트리거.
- 워크플로우/스킬 라인업 변경
- `manifest.config.ts`의 permissions·host_permissions 변경, 또는 새 플랫폼/연동·데이터 수집·외부 API 엔드포인트 추가
- **docs/privacy.{ko,en}.md는 권한 문자열이 아니라 실제 동작에 묶인다**: 새 기능이 *기존* 권한(광역 `https://*/*`·`activeTab`·`tabCapture`·`scripting` 등)을 새 목적으로 쓰거나 새 캡처·수집·저장·전송 동작을 추가하면 **manifest diff가 0이어도** privacy를 대조·갱신한다. **ko가 원본, en은 그 번역이라 항상 같은 내용을 담아야 하므로 ko/en 양쪽 본문과 상단 시행일을 함께 갱신**한다(한쪽만 고치면 즉시 stale). diff에 `chrome.permissions.request`/`captureVisibleTab`/`tabCapture`/`chrome.scripting`/신규 외부 `fetch`/`chrome.storage`·IndexedDB write가 보이면 트리거. (30s Replay가 기존 optional 권한 재사용으로 이 검사를 빠져나가 심사 탈락한 전례 있음)

## 코드 컨벤션

- 스타일: `src/components/ui/` 이외에 주석 최소화. WHY가 비자명할 때만 한 줄.
- 경로: `@/` → `src/`
- **UI·디자인 컨벤션**: UI 컴포넌트 직접 스타일링 금지 — shadcn/ui 우선 사용, 없으면 `npx shadcn@latest add <component>`. 색상 토큰·다크모드·버튼/아이콘 사이즈·레이아웃·합성 컴포넌트·탭 렌더 규칙 등 전체 컨벤션은 **[DESIGN.md](./docs/DESIGN.md)** 참조.
- 커밋 메시지·PR title/body·GitHub Release notes는 **영문**으로 작성
- **테스트**: 코드 변경 시 관련 순수 함수의 단위 테스트 작성 + `pnpm test` 통과 확인 필수. 테스트 파일은 대상과 같은 디렉터리의 `__tests__/*.test.ts`에 위치. Vitest 사용.
- **i18n 자동 검사**: `src/i18n/` 파일을 Edit/Write하면 `.claude/settings.json`의 PostToolUse 훅이 `src/i18n/__tests__/locales.test.ts`(ko/en 키 대칭·빈 값·placeholder 토큰 일치)를 자동 실행해 불일치 시 차단. 키 추가 시 ko/en 양쪽을 함께 갱신할 것.

## 게이트웨이 (알아두면 유용)

- 매니페스트 `minimum_chrome_version: "116"` — sidePanel API 요구사항
- 지원 URL: `http:`, `https:`, `file:` 스킴만. 추가로 `chromewebstore.google.com` 전체와 `chrome.google.com/webstore/*` 트리는 Chrome이 content script 주입을 차단해서 `src/lib/url-support.ts`의 `isSupportedUrl()`이 미지원으로 처리. 그 외 페이지에서는 side panel을 enable하지 않고, 사용 중 race로 unsupported로 진입하면 picker가 `onPickerUnavailable` 이벤트를 발화해 안내 다이얼로그 노출.
- iframe 지원 (picker): picker content script(`picker.ts`, content_scripts[0])는 로그 레코더처럼 `all_frames: true`로 전 프레임에 주입 — **1-depth iframe** 내부 요소 선택·스타일링·캡처를 지원한다(cross-origin 포함). 자식 picker가 `picker.start`에 실린 frameToken으로 부모 registry에 등록(`frame-geometry.ts` postMessage 핸드셰이크, token 검증으로 페이지 위조 차단)되면 top blocker가 그 iframe 위에서만 pointerEvents 핸드오프. 캡처는 offset 핸드셰이크(arm 게이트 + registry 확인)로 top 좌표 합성. **미등록 iframe(중첩 2-depth+·sandbox)** 클릭은 기존 거부 경로 유지 — `picker.iframeUnsupported` → `onPickerIframeUnsupported` 안내 다이얼로그 + idle 복귀. 사이드패널 라우팅은 `sender.frameId` 기반(`send(tabId, msg, frameId)` required), 요소 식별은 selector+frameId 복합키(`@/lib/element-key.ts`의 `sameElementKey` 단일 출처).
- iframe 로그 커버리지: 로그 레코더는 picker와 분리된 별도 content_scripts 2개로 **모든 프레임**에 주입(`all_frames: true`) — `recorder-bridge.ts`(ISOLATED, sentinel 수신·data 중계)와 `recorders-entry.ts`(MAIN, console/network/action 후크). cross-origin iframe(Stripe·임베드 위젯 등)의 console/network 로그까지 캡처한다. `webNavigation.onCommitted`로 커밋된 iframe에 sentinel 재발행. origin은 entry의 `pageUrl`에서 `originOf()`로 런타임 파생 — cap evict 시 top-page-origin 우선 보존(`mergeLogItems`, console/network만 — action은 광고 폭증이 없어 순수 FIFO), 로그 탭에 origin 필터(`OriginFilterBar`, console/network/action 공용) 노출. picker DOM 선택은 위 항목대로 1-depth iframe까지 지원(중첩·sandbox 제외).
- pre-arm 버퍼링 (동기 IIFE 빌드 제약): `recorders-entry`는 self-contained 청크(외부 static import 0)여야 crxjs가 **동기 IIFE**로 emit → document_start 후크가 페이지 인라인 스크립트보다 먼저 깔린다. 그래야 `recorder-prearm.ts`의 sessionStorage 플래그(`__bugshot_recorder_active__`)를 읽어 active origin(한 번이라도 armed된 origin)이면 sentinel 도착 **전**부터 로그를 버퍼 적재(적재 게이트 `capturing` vs dispatch 게이트 `recording` 분리, sentinel 없으면 전송 no-op). 레코더는 `content/log-throttle.ts`, 사이드패널 수신부는 복제본 `sidepanel/lib/trailing-throttle.ts`를 쓰는 분리가 이 제약 때문 — 청크에 외부 static import가 유입되면 async loader로 되돌아가 pre-arm이 무력화된다(리팩터 시 회귀 주의).
- 단축키: `_execute_action`(`Cmd/Ctrl+Shift+E`, 사이드패널 토글) 1개만 등록. Chrome이 `action.onClicked`로 내부 처리하므로 별도 `onCommand` 리스너 불필요. (캡처 단축키 3개는 제거됨 — manifest 전용이라 영속 데이터·마이그레이션 없이 무손실. 캡처는 진입 화면 버튼으로만.)
- permissions: `sidePanel`, `activeTab`, `scripting`, `storage`, `commands`, `contextMenus`, `identity`, `tabCapture`, `webNavigation` (메인 프레임 네비게이션 커밋 직전 로그 꼬리 sync — cross-page 로그 누적)
- host_permissions: **`<all_urls>` 단일** (required). 모든 페이지 picker·로그 레코더 주입 + `captureVisibleTab`(화면·페이지 전체 캡처 + 30s Replay, cross-origin 네비게이션에서 activeTab 회수돼도 캡처 유지) + BYOK LLM·GitLab self-managed 임의 origin fetch + cross-origin stylesheet 원문 fetch(`css.fetchSheets` — 스타일 값 보강, SSRF 가드 경유) + **8개 플랫폼 REST/OAuth host + OAuth proxy origin fetch**까지 전부 `<all_urls>`가 커버한다. 설치 시 "모든 사이트" 경고 상시, 런타임 권한 프롬프트 없음. (과거엔 `*.atlassian.net`·`api.github.com`·`gitlab.com`·`VITE_OAUTH_PROXY_URL` origin 등 구체 host를 함께 나열했으나 전부 `<all_urls>` 중복이라 제거 — 코드에 host별 `permissions.contains` 체크 없고 OAuth authorize는 launchWebAuthFlow라 host 불요. 어느 플랫폼·proxy로 트래픽이 나가는지는 docs/PERMISSION.md·docs/privacy.ko.md 참조.)
- (`<all_urls>`는 required — 과거 optional + 런타임 `chrome.permissions.request()` 모델은 폐기. BYOK/GitLab의 `requestHostPermission` 호출은 코드에 남아있으나 이미 보유라 즉시 grant, 프롬프트 없음)
- OAuth 관련 env: `VITE_ATLASSIAN_CLIENT_ID`, `VITE_GITHUB_CLIENT_ID` (dev), `VITE_GITHUB_CLIENT_ID_PROD` (store build 시 치환), `VITE_LINEAR_CLIENT_ID` (단일 client — dev/store redirect URI 둘 다 한 앱에 등록), `VITE_NOTION_CLIENT_ID`, `VITE_GITLAB_CLIENT_ID`, `VITE_ASANA_CLIENT_ID` (단일 client — dev/store redirect URI 둘 다 한 앱에 등록), `VITE_CLICKUP_CLIENT_ID` (단일 client — dev/store redirect URI 둘 다 한 앱에 등록), `VITE_SLACK_CLIENT_ID` (단일 client — OAuth 전용, dev/store redirect URI 둘 다 한 앱에 등록), `VITE_OAUTH_PROXY_URL` — 누락 시 해당 플랫폼 OAuth UI 자동 비활성화 (`background/oauth/config.ts`의 `OAUTH_CONFIG` 테이블 + `isConfigured()` 판정 — messages.ts `*.oauth.available` 단일 경로)
- 분석 env: `VITE_POSTHOG_KEY` (dev), `VITE_POSTHOG_KEY_PROD` (store build 시 치환), `VITE_POSTHOG_HOST` (기본 `us.i.posthog.com`) — 누락 시 PostHog 집계 no-op
- `BUGSHOT_STORE_BUILD=1`: 스토어 업로드용 빌드 (manifest `key` 제거)
- `BUGSHOT_E2E_BUILD=1`: e2e 전용 빌드 — `dist-e2e/` 분리 산출. dev `key` 유지. (`<all_urls>`는 이제 prod·e2e 공통 required라 e2e 빌드가 권한을 별도 추가하지 않음 — 분리 이유는 outDir 격리뿐.) **dist-e2e는 테스트 전용 — Chrome 수동 로드·스토어 업로드 금지.** 배포 산출물(dist)은 무오염(분리 outDir)
- `chrome.scripting.executeScript({world:"MAIN", func})`: 직렬화·재평가라 클로저가 안 살아남는다. 주입 함수는 self-contained(헬퍼는 nested로 inline). **func 직렬화 형태**의 현재 사용처 `github-upload.ts:pageBatchUploadFn`(`files:` 형태 주입은 `picker-control.ts:ensureMainWorldRecorders` — 규칙 무관) — 리팩터 시 실제 탭 회귀 필수. 상세: docs/ARCHITECTURE.md 동명 섹션.

## 메모리 & 참고 문서

- `docs/PERMISSION.md` — Chrome 권한 전체 레퍼런스 (activeTab 라이프사이클, OAuth 토큰 흐름, optional permission 등)
- `AGENTS.md` · `.agents/skills/` — CLAUDE.md·`.claude/commands/`의 **Codex 호환 미러**(경로만 치환된 사본). **원본만 편집**하고 미러는 동기화 대상으로만 취급 — 미러를 직접 고치면 조용히 드리프트한다.
- `docs/POSTMORTEM.md` — 회귀·버그 사후분석 회고 누적 (git 공유). `/postmortem` 스킬이 픽스마다 비자명 함정·재발방지를 한 항목씩 추가
- `docs/privacy.ko.md` · `docs/privacy.en.md` — 개인정보처리방침 (ko 원본 + en 번역, 항상 동기화). bug-shot.com/{ko,en}/privacy로 이관 예정(기존 GitHub Pages 폐지)
- 사용자 개인 메모리: `~/.claude/projects/-Users-sinhyeokkang-code-bugshot-2/memory/`에 있음 (머신 로컬, git에 안 올라감)
