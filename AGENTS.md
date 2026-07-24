# AGENTS.md

> **이 파일은 자동 생성물이다.** 원본은 [CLAUDE.md](./CLAUDE.md)이고 `pnpm sync:agents`가 아래 본문을 그대로 복제한다.
> 고칠 내용이 있으면 **CLAUDE.md를 고치고** `pnpm sync:agents`를 돌려라 — 이 파일을 직접 편집하면 다음 sync에서 덮어써진다.
> 같은 규칙이 `.agents/skills/`(= `.claude/commands/` 미러)에도 적용된다. 이 프리앰블만 예외로 `.agents/PREAMBLE.md`에서 손으로 관리한다.
> 본문이 `CLAUDE.md`·`.claude/commands/`를 가리키면 **그 원본 경로가 맞다** — 치환 없이 복제하므로 그대로 읽으면 된다.

## Codex 런타임 차이 (이 프리앰블 전용)

Claude Code에만 있는 자동 안전망이 Codex 세션에는 없다. 아래는 **직접** 챙긴다.

- **스킬 호출 매핑** — 본문이 `/<name>`으로 부르는 스킬은 Codex에선 `source-command-<name>` 스킬로 로드한다.
- **미제공 스킬 (역할 분담)** — `/push`·`/merge`·`/deploy`·`/sync`는 미러하지 않는다. **Codex는 작업 → 커밋까지, 원격으로 나가는 건 Claude Code**가 단일 창구로 맡는다 — 릴리스 파이프라인 게이트(`e2e/.last-green`의 HEAD 해시 캐시, `/merge`의 버전 bump, `/deploy`의 tag)가 두 창구에서 경쟁하면 깨지기 때문이다. 이 스킬들이 필요해지면 사용자에게 Claude Code 세션에서 실행하라고 안내하고 멈춘다.
- **`/ship`은 12단계까지** — `source-command-ship`은 미러돼 있고 `/tdd`~`/e2e-run`(12단계)까지 전부 돈다. 13·14단계(`/push`·`/build`)는 **수행하지 않고** "push 대기 — Claude Code에서 `/push` 실행"을 리포트에 남기고 종료한다. 12단계 green이 `e2e/.last-green`에 HEAD를 기록해두므로 이어지는 `/push`의 e2e 게이트는 재실행 없이 통과한다. 상세는 스킬 본문의 "push 권한 / 런타임별 종착점".
- **i18n ko/en 대칭 훅 없음** — Claude Code는 `.claude/settings.json`의 PostToolUse 훅이 `src/i18n/` 편집 시 대칭 검사를 자동 실행해 불일치를 차단한다. Codex엔 이 훅이 없으니 `src/i18n/` 또는 `src/log-viewer/i18n.ts`(복제 사전)를 건드렸으면 손으로 돌린다:
  `pnpm test --run src/i18n/__tests__/locales.test.ts src/log-viewer/__tests__/i18n.test.ts`
- **미러 sync 훅 없음** — Claude Code는 `CLAUDE.md`·`.claude/commands/*.md` 편집 시 훅이 `sync:agents`를 자동 실행한다. Codex엔 없다. 애초에 **Codex는 원본을 편집하지 않는 게 규칙**이고, 부득이 고쳤으면 `pnpm sync:agents`를 직접 돌려 미러를 함께 커밋한다.
- **개인 메모리 없음** — 본문 말미의 `~/.claude/projects/.../memory/`는 Claude Code 전용 저장소다. Codex는 이 경로를 읽지 않는다.
- **커밋 트레일러** — Codex 세션에서 만든 커밋은 마지막 줄에 `Co-Authored-By: Codex <noreply@openai.com>`를 붙인다(Claude Code의 `Co-Authored-By: Claude ...`와 대칭 — 어느 에이전트가 만든 커밋인지 히스토리에서 구분되게). 커밋 메시지의 scope는 **바뀐 파일 기준**이라 그대로다 — CLAUDE.md를 고쳤으면 Codex가 커밋해도 `docs(CLAUDE): ...`다.

---

bugshot-2: Chrome MV3 Side Panel 버그 리포팅 확장. 웹 페이지의 버그를 요소 스타일 편집(before/after 비교)·스크린샷(영역/화면/페이지 전체/요소, 어노테이션)·영상 녹화(탭/화면, 30초 리플레이) 중 원하는 방식으로 캡처하고, 콘솔·네트워크·사용자 액션 로그를 자동 수집한다. 이렇게 만든 리포트를 Jira·GitHub·Linear·Notion·GitLab·Asana·ClickUp 이슈로 등록하거나 Slack 채널·DM으로 공유한다.

## 코어 밸류: Privacy (클라이언트 온리)

**BugShot의 코어 밸류이자 경쟁 우위 축.** 버그 리포트에는 프로덕션 세션의 가장 민감한 단면이 담긴다 — 스크린샷 속 고객 데이터, network 로그의 토큰과 페이로드, console에 찍힌 내부 식별자. 그래서 BugShot은 그걸 **가져가지 않는 쪽**을 택했다. 캡처 데이터(스크린샷·영상·console/network/action 로그·CSS diff·리포트 본문)는 BugShot 서버를 거치지 않고 **사용자 브라우저 → 사용자의 이슈 트래커/Slack으로 직행**한다. 사용자가 AI 기능을 실행하면 필요한 프롬프트·로그 요약·캡처/인라인 이미지는 **사용자가 선택한 LLM endpoint로 직접 전송**된다. BugShot 서버를 지나는 건 **OAuth 토큰 교환 프록시**(`VITE_OAUTH_PROXY_URL`)뿐이고, 익명 PostHog 집계는 설정된 PostHog host로 직접 전송된다 — 어느 경로에도 캡처 데이터가 BugShot 서버를 거치지 않는다.

이건 정책이 아니라 구조다. "안 보겠다"는 약속이 아니라 **물리적으로 볼 수 없게** 만들어둔 것 — 규제·보안 민감 조직에게 약속과 구조의 차이는 검증 가능성의 차이다. 호스팅 저장소·워크스페이스를 두는 SaaS 모델은 필연적으로 이 구조를 깬다. 편의를 좇아 무서버·데이터 직행을 포기하는 건 기능 추가가 아니라 **제품 정체성 변경**으로 취급한다. 절대적 제약은 아니지만, 새 기능이 캡처 데이터를 외부 서버로 보내야 하면 이 밸류와 충돌하는지 먼저 따진다.

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
- 스크린샷 어노테이션: Konva + react-konva 캔버스(사이드패널 lazy 청크). 도형은 natural 좌표, 표시 배율은 CSS transform. 줌·팬 계산은 `sidepanel/components/annotation/viewport.ts` 순수 함수 단일 출처(fit-width 진입 / 전체 조망 / 사용자 배율을 `ZoomLevel`로 **의도 저장**). 드래그는 **window 리스너**로 구동 — pointer capture를 쓰지 않는다(상세·함정은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md))
- 요소 스타일 CSS 코드 뷰: CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-css` + `@codemirror/autocomplete` + `@codemirror/language` + `@lezer/highlight`, 사이드패널 전용 lazy 청크) — 편집/CSS 세그먼트 토글의 CSS 뷰
- 영상: 탭 녹화(`tabCapture`+MediaRecorder) / 화면 녹화(`getDisplayMedia` — 웹 표준, 추가 manifest 권한 불필요·user gesture만 요구) / 30s Replay(`captureVisibleTab` 폴링 프레임 → WebCodecs `VideoEncoder`+`mp4-muxer` H.264 MP4). 캡처 모드(`CaptureMode`): element/screenshot/video/freeform + 30s replay. 탭 녹화·화면 녹화는 둘 다 `video` 모드이고 `RecordingSource`(tab/screen) 축으로 갈린다
- 스크린샷 캡처 방식 3축(영역/화면/페이지 전체): `CaptureMode`와 **직교** — 셋 다 `captureMode: "screenshot"`으로 수렴하고(종착점 `onAreaCaptured`) 방식 자체는 union 타입도 영속화도 없다. `capturing` phase 하단 툴바에서 고른다. 페이지 전체 캡처는 사이드패널 오케스트레이터(`sidepanel/scroll-capture.ts`)가 content executor(`content/scroll-capture.ts`)를 스크롤시키며 타일을 background `captureVisibleTab` 관문으로 찍어 canvas 스티칭(캡: 20타일·캔버스 32000px·출력 4M px). 첫 타일 이후 반복되는 `fixed`와 이미 전부 노출된 뒤 붙은 `sticky`를 `visibility`로 숨기고, 캡처 중 추가·position 변경된 후보도 추적한 뒤 원래 스타일·스크롤을 복원한다. 상세·불변식은 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) "캡처 3축" 참조
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
| 테스트 | `pnpm test` |
| 테스트 (watch) | `pnpm test:watch` |
| 커버리지 측정 | `pnpm test:coverage` (vitest v8 → `coverage/coverage-summary.json`) |
| 커버리지 리포트·비교 | `pnpm coverage:report` (베이스라인 대비 이전→지금 비교. 갱신: `pnpm coverage:update`) — `/coverage` 스킬이 래핑 |
| Codex 미러 동기화 | `pnpm sync:agents` (드리프트 검사만: `pnpm sync:agents:check`) |

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
/coverage       → pnpm test:coverage → 로직 스코프(브라우저/UI 코드 제외) 라인 % 를 주 지표로 베이스라인 대비 이전→지금 비교 + 회귀 래칫 경고 + 개선 후보 랭킹. 개선 시 baseline 갱신 제안. fix·빌드·커밋 안 함
/refactor       → audit·code-review 리포트의 지정 항목 수정 (메인 단일). 회귀 재현 테스트 먼저(TDD red) → 수정으로 green → 4관점 자체 검증 → CTO 게이트. 회귀 위험 항목은 강행 전 확인. 빌드·커밋 안 함
/postmortem     → 직전에 잡은 버그/회귀를 docs/POSTMORTEM.md에 회고 항목으로 추가 (비자명 함정만, 재발방지 grep/전수 대상 명시). 코드·빌드·커밋 안 함
/guide          → guide/ko·en 사용자 가이드 작성·갱신. AUTHORING.md 규칙 로드 → 코드 대조 stale 탐지 → ko/en 동시 갱신 + 검증. 빌드·커밋 안 함
/doc-check      → 8개 저장소 문서(CLAUDE/DIRECTORY/ARCHITECTURE/DESIGN/README/PERMISSION/privacy/AUTHORING)를 문서별 전담 에이전트가 병렬로 diff 무관 코드 양방향 대조(Pass1 문서→코드 사실오류 + Pass2 코드→문서 누락 커버리지) → 통합 리포트 → 항목별 확인 → 수정. /push 신선도 검사보다 깊다(diff에 안 걸린 누적 stale·섹션 내부 누락까지). guide/ko·en 본문은 제외(/guide 전담, AUTHORING은 검사). 빌드 안 함
/push           → dev push (main에서 호출 차단) + CLAUDE.md/docs/DIRECTORY.md/docs/ARCHITECTURE.md/README.md/docs/PERMISSION.md/docs/privacy.{ko,en}.md/guide(+AUTHORING.md) 신선도 검사 + Codex 미러 게이트(sync:agents:check — 드리프트면 재생성 커밋) + e2e 게이트(.last-green == HEAD면 스킵 / 빨강이면 푸시 중단)
/merge          → dev에서 e2e 게이트 교차(통상 /push 기록 해시로 스킵 / 빨강이면 중단) → 버전 bump 커밋 + dev → main squash PR 생성 + 자동 머지
/deploy         → main 한정. tag push → 스토어 빌드 → zip → GitHub Release draft → 심사 요청 안내
/sync           → dev를 origin/main으로 hard reset + force push (배포/머지 후)
/ship           → 작은·외과적 변경 하나를 /tdd→/implement→커밋→/code-review→/refactor→(/e2e-write)→(/guide)→(/doc-check)→(/postmortem)→/e2e-run→/push→/build로 자동 오케스트레이션. 단계별 게이트 통과 시 진행, 하드 실패·사용자 결정 지점(회귀위험·doc stale·e2e red)에선 즉시 중단+리포트. guide·doc-check은 영향 플래그 게이팅. 호출이 곧 push 지시. 큰·다영역·신규기능(feature 문서 필요)은 스코프 가드로 거부. Codex 런타임은 /e2e-run까지만 돌고 /push·/build를 Claude Code에 인계
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
- **테스트**: 코드 변경 시 관련 테스트 작성 + `pnpm test` 통과 확인 필수. 대상과 같은 디렉터리의 `__tests__/`에 두고 Vitest를 쓴다. **2트랙**:
  - `*.test.ts` — node 환경. 순수 함수·헬퍼(기본 트랙).
  - `*.test.tsx` — **jsdom + @testing-library/react**(+ `@testing-library/user-event` — 인터랙션 시뮬레이션. `vitest.config.ts`의 `environmentMatchGlobs`가 확장자로 자동 분기, 셋업은 `src/test/setup-dom.ts` — cleanup + ResizeObserver·PointerCapture·scrollIntoView 폴리필). 렌더·인터랙션이 상태 전이를 좌우하는 컴포넌트(콤보박스 등)와, 실제 DOM이 필요한 비컴포넌트 검증(헤드리스 Tiptap 왕복·vanilla DOM 셸 등)에 쓴다. 단, **포인터 드래그·캔버스처럼 브라우저 실동작에 걸린 것은 jsdom으로도 못 잡는다** — e2e·수동이 유일한 안전망(docs/POSTMORTEM.md).
  - **커버리지**: `pnpm test:coverage`(vitest v8) → `/coverage` 스킬이 리포트. **주 지표는 "로직 스코프" 라인 %**(브라우저 전용·UI 코드를 분모에서 제외 — 전체 %는 의도적 0% 코드가 섞여 TDD 다이얼로 안 맞다). 제외 규칙 단일 출처는 `scripts/coverage-report.mjs`의 `isBrowserBound()` — 유닛테스트 불가능한 새 런타임 파일(content DOM·미디어·OAuth 런처·SW 엔트리)을 추가하면 여기 등록. 트렌드 베이스라인은 git-tracked `coverage/baseline.json`(리포트 본체는 `.gitignore`), 개선 시 `pnpm coverage:update`로 래칫.
- **Codex 미러 자동 동기화**: `CLAUDE.md`·`.claude/commands/*.md`·`.agents/PREAMBLE.md`를 Edit/Write하면 `.claude/settings.json`의 PostToolUse 훅이 `pnpm sync:agents`를 실행해 `AGENTS.md`·`.agents/skills/`를 재생성한다. 생성물이므로 직접 편집 금지 — 상세는 아래 "메모리 & 참고 문서" 참조.
- **i18n 자동 검사**: `src/i18n/` 파일을 Edit/Write하면 `.claude/settings.json`의 PostToolUse 훅이 `src/i18n/__tests__/locales.test.ts`(ko/en 키 대칭·빈 값·placeholder 토큰 일치)를 자동 실행해 불일치 시 차단. 키 추가 시 ko/en 양쪽을 함께 갱신할 것.
  - **사전은 두 벌이다** — log-viewer는 별도 빌드라 `src/log-viewer/i18n.ts`에 `koDict`/`enDict` **복제 사전**을 따로 둔다. 훅 matcher가 `*src/i18n/*`라 이 파일엔 **안 걸리고**, 대신 `src/log-viewer/__tests__/i18n.test.ts`가 ko/en 대칭·placeholder·**메인 테이블(`logs`·`editor`) 값 일치**를 대조한다 — 즉 저장 즉시가 아니라 `pnpm test`에서 잡힌다. log-viewer가 재사용하는 공용 컴포넌트(NetworkLog·ConsoleLog·ActionLog·IssuePreview)에 키를 추가하면 **두 사전을 함께** 갱신할 것.

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
- **store는 `sidepanel/tabs`를 import하지 않는다** — store가 컴포넌트 그래프를 끌어들이면 순환·번들 오염이 생긴다. store가 필요로 하는 순수 로직은 `sidepanel/lib/`으로 승격한다. 사례: `initialJiraFields`(Jira 필드 prefill 단일 출처 — `editor-store.confirmDraft`가 쓰므로 `tabs/jiraFields/`가 아니라 `lib/`에 둔다. 다른 플랫폼의 `initial*Fields`는 store가 안 써서 각 `*IssueFields.tsx`에 콜로케이션).
- `chrome.scripting.executeScript({world:"MAIN", func})`: 직렬화·재평가라 클로저가 안 살아남는다. 주입 함수는 self-contained(헬퍼는 nested로 inline). **func 직렬화 형태**의 현재 사용처 `github-upload.ts:pageBatchUploadFn`(유일한 `world:"MAIN"`)·`picker-control.ts:getTopViewport`(`world` 미지정이라 ISOLATED — 직렬화 규칙은 world와 무관하게 걸린다. 인라인 화살표라 클로저 없음 — 규칙 준수)(같은 파일의 `files:` 형태 주입 `picker-control.ts:ensureMainWorldRecorders`는 규칙 무관) — 리팩터 시 실제 탭 회귀 필수. 상세: docs/ARCHITECTURE.md 동명 섹션.

## 메모리 & 참고 문서

- `docs/PERMISSION.md` — Chrome 권한 전체 레퍼런스 (activeTab 라이프사이클, OAuth 토큰 흐름, optional permission 등)
- `AGENTS.md` · `.agents/skills/` — CLAUDE.md·`.claude/commands/`의 **Codex 호환 미러**. `scripts/sync-agents.mjs`(`pnpm sync:agents`)가 만드는 **순수 생성물이라 손으로 편집하지 않는다** — 고칠 건 원본에서 고친다. 본문은 치환 없이 그대로 복제하므로 미러가 `CLAUDE.md`·`.claude/commands/`를 가리켜도 그 경로가 맞다. Codex 런타임 차이(훅 부재·미제공 스킬·커밋 트레일러)만 `.agents/PREAMBLE.md`에 손으로 관리해 AGENTS.md 상단에 붙는다.
  - **역할 분담**: Codex는 **작업 → 커밋까지**, 원격으로 나가는 건 Claude Code 단일 창구. `/push`·`/merge`·`/deploy`·`/sync`는 미러하지 않는다(스크립트 `EXCLUDE`) — 릴리스 게이트(`e2e/.last-green` HEAD 해시 캐시, 버전 bump, tag)가 두 창구에서 경쟁하면 깨지기 때문. 나머지 16개가 미러 대상이고, 원본이 없어진 미러 디렉터리는 sync가 지운다. `/ship`은 미러하되 **Codex에선 12단계(`/e2e-run`)까지만** 돌고 13·14단계(`/push`·`/build`)를 인계한다 — 이 분기는 `ship.md` 본문("push 권한 / 런타임별 종착점")에 박혀 있어 미러에 그대로 따라간다.
  - **드리프트 방지 2단**: ① `.claude/settings.json`의 PostToolUse 훅이 `CLAUDE.md`·`.claude/commands/*.md`·`.agents/PREAMBLE.md` 편집 시 sync를 자동 실행 ② `/push`가 `pnpm sync:agents:check`로 최종 차단. **훅은 Claude Code 전용이라 Codex 세션에선 안 돈다** — Codex가 원본을 고쳤으면 `pnpm sync:agents`를 손으로 돌린다.
- `docs/POSTMORTEM.md` — 회귀·버그 사후분석 회고 누적 (git 공유). `/postmortem` 스킬이 픽스마다 비자명 함정·재발방지를 한 항목씩 추가
- `docs/privacy.ko.md` · `docs/privacy.en.md` — 개인정보처리방침 (ko 원본 + en 번역, 항상 동기화). bug-shot.com/{ko,en}/privacy로 서빙
- 사용자 개인 메모리: `~/.claude/projects/-Users-sinhyeok-code-bugshot-2/memory/`에 있음 (머신 로컬, git에 안 올라감)
