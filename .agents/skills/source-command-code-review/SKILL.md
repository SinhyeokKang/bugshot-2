---
name: "source-command-code-review"
description: "변경된 코드를 시급도별로 보고. 리포트 전용 — fix·빌드·커밋 안 함."
---

# source-command-code-review

Use this skill when the user asks to run the migrated source command `code-review`.

## Command Template

큰 작업을 끝낸 뒤 "지금 변경한 코드"에 대한 객관적 리뷰가 필요할 때 호출한다. 4명의 전문 에이전트가 각자 전문 관점에서 병렬 리뷰한다. **리포트 전용 스킬** — 빌드/타입체크 안 돌리고, 자동 fix 안 하고, 커밋도 안 한다. 시급도 분류된 발견 리스트만 출력하고 끝.

## 사용

- `/code-review` — 4개 전문 에이전트 전부 병렬. `origin/main` 대비.
- `/code-review <agent> [agent...]` — 지정 에이전트만 실행.
- 마지막 인자가 에이전트 키워드가 아니면 **base**로 취급. 예: `/code-review HEAD~3`, `/code-review ui HEAD~3`.

| 키워드 | 에이전트 | 담당 카테고리 | 핵심 관심사 |
|---|---|---|---|
| `ui` | UI/UX | UI/디자인, i18n | shadcn/ui, IconButton, Tailwind, 다국어 동시 갱신, 패턴 일치 |
| `security` | Security | 인증, MV3/Side Panel | OAuth, 토큰 갱신, user gesture, MAIN world |
| `dataflow` | DataFlow | 세션 보존, picker/CSS, 이슈 구성 | tabId scope, 토큰 resolve, 섹션 구성, 마이그레이션 |
| `codehealth` | CodeHealth | 코드 스타일, 일반 | `@/` 경로, 데드 코드, race condition, 보안 |

예시:

```
/code-review                → 4개 에이전트 전부, origin/main 대비
/code-review ui             → UI/UX 에이전트만
/code-review security       → Security 에이전트만
/code-review ui dataflow    → UI/UX + DataFlow 병렬
/code-review HEAD~3         → 4개 전부, HEAD~3 대비
/code-review ui HEAD~3      → UI/UX만, HEAD~3 대비
```

## 다른 스킬과의 분리

- `/audit`: **전체 코드베이스** 대상. 축적된 문제를 찾는다.
- `/review`: GitHub PR 리뷰 (외부 협업).
- `/build`: 빌드 + 테스트 체크리스트.
- `/code-review` ← 여기. **로컬 변경 정적 리뷰만**.

## 절차

### 1. 변경 범위 확인 (병렬)

base 결정:
- 인자 없으면 `origin/main`. (먼저 `git fetch origin main` 해서 최신 상태 보장.)
- 인자 있으면 그 인자 그대로.

병렬 실행:
- `git status` — 미커밋 변경 표시
- `git diff <base> --stat` — base 대비 working tree 전체 변경 통계 (push된 commit + 미커밋 모두 포함)
- `git log <base>..HEAD --oneline` — 포함되는 commit 목록 (컨텍스트)

`git diff <base> --stat` 결과 0이면 즉시 종료: "리뷰할 변경 없음."

리뷰 대상 diff: `git diff <base>` (base..working-tree). 파일 단위로 필요 시 `git diff <base> -- <path>`.

### 2. 전문 에이전트 병렬 리뷰

활성화된 전문 에이전트를 **동시에** 실행한다 (`subagent_type: general-purpose`). 각 에이전트에게 다음을 전달:
- diff stat (변경 파일 목록 + 통계)
- AGENTS.md + ARCHITECTURE.md 핵심 컨벤션 (리뷰 기준)
- 담당 카테고리의 체크 가이드
- 하위 영역 에이전트 분배 지침

#### 2단계 구조

```
메인 스레드
├── UI/UX (general-purpose)
│   ├── Explore: sidepanel 변경 + 기존 동일 역할 컴포넌트
│   ├── Explore: i18n 변경 + 키 대칭 확인
│   └── Explore: content/lib 변경 + UI 컨텍스트
├── Security (general-purpose)
│   ├── Explore: background 변경 + OAuth 흐름 컨텍스트
│   ├── Explore: content 변경 + MV3 컨텍스트
│   └── Explore: sidepanel/lib 변경 + auth 컨텍스트
├── DataFlow (general-purpose)
│   ├── Explore: content 변경 + picker 컨텍스트
│   ├── Explore: sidepanel 변경 + session/issue 컨텍스트
│   └── Explore: store/lib/types 변경 + 데이터 흐름 컨텍스트
└── CodeHealth (general-purpose)
    ├── Explore: background + content 변경
    ├── Explore: sidepanel 변경
    └── Explore: store + lib + types 변경
```

각 전문 에이전트는:
1. diff stat에서 **자기 전문 영역에 해당하는 변경 파일** 식별
2. 해당 영역에 변경이 있으면 Explore 하위 에이전트를 **병렬** 생성
3. 각 하위 에이전트에게 **해당 영역의 diff + 패턴 비교용 참조 파일 경로** 전달
4. 하위 에이전트 결과를 수집·중복 제거
5. `파일:줄 — 요약 (근거)` 형식으로 메인 스레드에 보고

하위 Explore 에이전트는:
- `git diff <base> -- <해당 영역 파일>` 로 변경분 확인
- **참조 파일** (변경되지 않은 기존 코드)을 읽어 패턴 일치 여부 검증
- 담당 카테고리의 위반만 보고

**변경 파일이 한 영역에 집중되면 하위 에이전트 없이 직접 리뷰해도 무방.**

#### 공통 작업 원칙 (모든 에이전트에 전달)

- **더 단순한 방법이 있으면 제안**: 200줄을 50줄로 줄일 수 있으면 줄여라. 불필요한 추상화 금지.
- **외과적 변경**: 요청과 무관한 인접 코드 개선이 섞여 있으면 지적. 기존 스타일을 깨는 변경도 지적.
- **기존 패턴 일관성**: 같은 역할의 기존 코드와 size·variant·className·구조가 일치하는지 확인.

---

#### UI/UX 에이전트 (`ui`)

변경분에서 UI·디자인·다국어 이슈를 찾는다.

**하위 에이전트 분배 (변경이 있는 영역만):**

| 하위 에이전트 | 영역 diff | 참조 파일 (패턴 비교) | 체크 |
|---|---|---|---|
| sidepanel-ui | `src/sidepanel/**/*` | 같은 역할의 기존 컴포넌트 | shadcn/ui 우선, IconButton 사이즈 (패널/헤더 `h-8 w-8` vs Input 우측 `h-9 w-9`), Tailwind CSS 변수, `data-[state=inactive]:hidden`, 버튼 사이즈 (`xl`=h-11 전용), 같은 역할 패턴 일치 |
| i18n-keys | `src/i18n/*` | 대응 언어 파일 | ko/en 동시 갱신 여부, 키 이름 일관성, 새 키가 실제 사용되는지 |
| other-ui | `src/content/*`, `src/lib/*` | overlay UI 패턴 | 하드코딩 사용자 노출 텍스트, Shadow DOM UI 패턴 |

**전문가 통합 점검:**
- 새 UI 추가 시 기존 동일 역할 코드와 패턴 불일치
- i18n 키 추가/변경과 실제 사용처 정합성

---

#### Security 에이전트 (`security`)

변경분에서 인증·보안·MV3 lifecycle 이슈를 찾는다.

**하위 에이전트 분배 (변경이 있는 영역만):**

| 하위 에이전트 | 영역 diff | 참조 파일 (패턴 비교) | 체크 |
|---|---|---|---|
| bg-oauth | `src/background/*`, `oauth-proxy/*` | 기존 OAuth 흐름 파일 | discriminated union, OAuth proxy 경유 (client_secret 노출 금지), 토큰 갱신 흐름 (프리-리프레시 + 401 재시도), env 가드 (`isOAuthConfigured()`) |
| content-mv3 | `src/content/*` | 기존 content script entry | MAIN world 주입 함수 self-contained, `all_frames=false` 전제, 메시지 비동기 응답 패턴 |
| panel-lib-auth | `src/sidepanel/**/*`, `src/lib/*`, `src/types/*` | 기존 auth 타입/흐름 | user gesture 보존 (`chrome.sidePanel.open`은 await 직전 호출 금지), refresh hook 패턴, `Accounts` 타입 일관성 |

**전문가 통합 점검:**
- OAuth 흐름 end-to-end: background ↔ sidepanel ↔ lib 정합성
- user gesture 전파 체인 무결

---

#### DataFlow 에이전트 (`dataflow`)

변경분에서 세션·picker·이슈 구성 관련 데이터 흐름 이슈를 찾는다.

**하위 에이전트 분배 (변경이 있는 영역만):**

| 하위 에이전트 | 영역 diff | 참조 파일 (패턴 비교) | 체크 |
|---|---|---|---|
| content-picker | `src/content/*` | 기존 picker/CSS 코드 | 토큰 resolve 룰 (`--_*` 끝까지 펼침, public 첫 이름 멈춤), `ensureCssCacheLoaded()` 호출 위치, CSSOM shorthand cache, 메시지 비동기 응답 (`return true` + IIFE) |
| panel-session-issue | `src/sidepanel/**/*` | 기존 세션/이슈 코드 | `editor:${tabId}` 키, phase별 보존 룰 (styling 폐기 / drafting·previewing·done 보존), 4종 빌트인 섹션, POST_MEDIA 위치 룰, 마이그레이션 가드 멱등성, `(없음)` 빈 paragraph |
| store-lib-types | `src/store/*`, `src/lib/*`, `src/types/*` | 기존 store/타입 정의 | `chrome.storage.session` vs `local` 구분, session-keys 상수 ↔ 사용처, store 마이그레이션 체인, `PlatformId` union exhaustive, `BgRequest` union ↔ handler ↔ `BG_REQUEST_TYPES` 일치 |

**전문가 통합 점검:**
- 메시지 타입 정합성: 새 메시지 추가 시 union·handler·Set 3곳 동시 갱신
- 플랫폼 어댑터 대칭: 한 플랫폼만 변경했을 때 다른 플랫폼과 패턴 괴리

---

#### CodeHealth 에이전트 (`codehealth`)

변경분에서 코드 스타일·품질 이슈를 찾는다.

**하위 에이전트 분배 (변경이 있는 영역만):**

| 하위 에이전트 | 영역 diff | 참조 파일 (패턴 비교) | 체크 |
|---|---|---|---|
| bg-content | `src/background/*`, `src/content/*`, `oauth-proxy/*` | 인접 파일 스타일 | `@/` 경로, 주석 최소화 (WHY만 한 줄), 불필요한 추상화·shim, race condition, 보안 (XSS, 외부 fetch URL) |
| panel | `src/sidepanel/**/*` | 인접 컴포넌트 스타일 | `@/` 경로, 주석, 데드 코드 (미사용 import/컴포넌트), 중복 로직, `await`로 user gesture 소실 가능성 |
| store-lib-types | `src/store/*`, `src/lib/*`, `src/types/*`, `src/i18n/*` | 인접 파일 스타일 | `@/` 경로, export 정리, 타입 파일 관심사 분리, any/타입 단언 남발, 유틸 중복 |

**전문가 통합 점검:**
- import 경로 일관성: 변경 파일 내 `@/` vs 상대 경로 혼용
- feature flag·backwards-compat shim 금지 위반

### 3. 크로스 영역 통합 검사

활성 에이전트가 **2개 이상**일 때만 수행. 에이전트 결과가 돌아온 뒤, 메인 스레드에서 **에이전트를 가로지르는** 이슈를 추가 점검:

- **i18n 동시 갱신** (ui + dataflow/codehealth): 코드 변경에 대응하는 i18n 키 추가/수정 누락
- **메시지 타입 정합성** (security + dataflow): 새 메시지·핸들러 추가 시 union/handler/Set 3곳 일치
- **에이전트 간 중복 발견 합치기**

### 4. 시급도 분류 + 보고

각 발견을 라벨 하나로 분류해 그룹별로 출력:

- **🔴 심각** — 동작이 깨지는 버그, 데이터 손실, 보안 이슈, AGENTS.md의 명시적 게이트 위반 (예: user gesture 소실, manifest 권한 누락, OAuth secret 노출).
- **🟡 권장** — 컨벤션 위반, 향후 회귀 위험, 부분 일관성 깨짐 (예: i18n ko만 추가하고 en 누락, IconButton 32/36 혼용, 토큰 resolve 룰 위반).
- **⚪ 사소** — 스타일·취향·정리 거리 (예: 잉여 주석, 임시 변수 네이밍, 빈 줄, 미세한 중복).

시급도 그룹과 무관하게 **전체 연번**을 매긴다 (사용자가 "3번 고쳐" 식으로 지칭할 수 있도록).

에이전트가 복수 활성이면 각 항목에 출처 태그 `[에이전트]` 표기. 단일 에이전트면 태그 생략.

```
1. [ui] 파일:줄 — 한국어 한 줄 요약. (근거: AGENTS.md "X" 룰 / 패턴 Y 위반)
2. [security] 파일:줄 — …
```

코드 수정 제안은 한 줄까지만. **패치는 만들지 않는다.**

발견 0개면 "✅ 큰 문제 없음." 한 줄로 종료.

보고 마지막에 **통계 요약**:

```
---
리뷰 범위: <base> 대비 / <agent> [+ <agent>]
활성 에이전트: N개
변경 파일: N개
발견: 🔴 X · 🟡 Y · ⚪ Z (합계 N)
```

### 5. 종료

여기서 끝. 후속 질문·액션 없음. 사용자가 보고를 보고 직접 결정한다.

## 금지 사항

- **빌드 / typecheck 실행 금지** — 정적 진단만. `pnpm build`, `pnpm typecheck` 호출하지 않는다.
- **자동 fix 금지** — 발견을 리포트할 뿐 코드를 변경하지 않는다.
- **테스트 결과 묻지 않음** — 사용자에게 "테스트 통과했나요?" 같은 후속 질문 X.
- **"고칠까요?" 같은 후속 액션 제안 금지** — 다음 행동은 전적으로 사용자.
- **커밋 / staging 안 함**.
- **변경 범위 밖 파일 검토 금지** — 진단은 이번 변경분으로 한정. 참조 파일은 패턴 비교용으로만 읽는다.
- **추측성 발견 남발 금지** — 룰·패턴·AGENTS.md 근거를 댈 수 있는 것만 보고.
