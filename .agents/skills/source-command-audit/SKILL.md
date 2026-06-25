---
name: "source-command-audit"
description: "코드베이스 전체를 컨벤션·패턴 기준으로 감사. 리포트 전용 — fix·빌드·커밋 안 함."
---

# source-command-audit

Use this skill when the user asks to run the migrated source command `audit`.

## Command Template

최근 변경이 아닌 **코드베이스 전체**를 AGENTS.md·ARCHITECTURE.md 컨벤션에 비추어 감사한다. 4명의 전문 에이전트가 각자 담당 차원에 집중하여 병렬 감사한다. **리포트 전용 스킬** — 자동 fix 안 하고, 커밋도 안 한다. 무엇을 고칠지·언제 고칠지는 전적으로 사용자가 결정한다.

## 사용

- `/audit` — 4개 전문 에이전트 전부 병렬 실행.
- `/audit <agent> [agent...]` — 지정 에이전트만 실행. 공백 구분으로 복수 선택 가능.

| 키워드 | 에이전트 | 담당 차원 | 핵심 관심사 |
|---|---|---|---|
| `ui` | UI/UX | ui, i18n | shadcn/ui, Tailwind, IconButton, 다국어 키, 하드코딩 텍스트 |
| `security` | Security | auth, mv3 | OAuth, 토큰, SW lifecycle, user gesture, MAIN world |
| `dataflow` | DataFlow | session, picker, issue | 세션 보존, CSSOM, 메시지 패싱, 어댑터, 마이그레이션 |
| `codehealth` | CodeHealth | style, general | 경로·주석 컨벤션, 데드 코드, 타입 안전, race condition |

예시:

```
/audit              → 4개 에이전트 전부 병렬
/audit ui           → UI/UX 에이전트만
/audit security     → Security 에이전트만
/audit ui dataflow  → UI/UX + DataFlow 병렬
```

## 다른 스킬과의 분리

- `/code-review`: **변경분**(git diff) 대상 리뷰. 이번에 건드린 코드만.
- `/review`: GitHub PR 리뷰 (외부 협업).
- `/audit` ← 여기. **전체 코드베이스** 대상. 변경 이력과 무관하게 축적된 문제를 찾는다.

## 절차

### 1. 컨벤션 로드

AGENTS.md와 ARCHITECTURE.md를 읽어 감사 기준을 확립한다. 이 두 문서가 ground truth다.

에이전트 인자가 있으면 해당 에이전트만 활성화. 없으면 전체 4개.

### 2. 전문 에이전트 병렬 감사

활성화된 전문 에이전트를 **동시에** 실행한다 (`subagent_type: general-purpose`). 각 에이전트에게 다음을 전달:
- AGENTS.md + ARCHITECTURE.md 핵심 컨벤션 (감사 기준)
- 담당 차원의 체크 가이드 (아래 정의)
- 하위 영역 에이전트 분배 지침

#### 2단계 구조

```
메인 스레드
├── UI/UX (general-purpose)        ← 전문가 코디네이터
│   ├── Explore: sidepanel UI
│   ├── Explore: i18n 키
│   └── Explore: content + lib UI
├── Security (general-purpose)
│   ├── Explore: background OAuth
│   ├── Explore: content MV3
│   └── Explore: sidepanel + lib auth
├── DataFlow (general-purpose)
│   ├── Explore: content picker
│   ├── Explore: sidepanel session/issue
│   └── Explore: store + lib + types
└── CodeHealth (general-purpose)
    ├── Explore: background + content
    ├── Explore: sidepanel
    └── Explore: store + lib + types + i18n
```

각 전문 에이전트는:
1. 하위 Explore 에이전트를 **병렬** 생성 (`subagent_type: Explore`)
2. 각 하위 에이전트에게 **담당 영역 경로 + 체크 차원**을 전달
3. 하위 에이전트 결과를 수집·중복 제거
4. 전문가 차원에서 **영역 간 일관성** 추가 점검
5. 통합 결과를 `파일:줄 — 요약 (근거)` 형식으로 메인 스레드에 보고

하위 Explore 에이전트는 배정된 영역의 파일을 **전부 읽고** 해당 차원 위반만 찾는다. `src/components/ui/*`는 제외.

---

#### UI/UX 에이전트 (`ui`)

UI·디자인·다국어 이슈 전문.

**하위 에이전트 분배:**

| 하위 에이전트 | 영역 | 체크 |
|---|---|---|
| sidepanel-ui | `src/sidepanel/**/*` | shadcn/ui 우선, IconButton 사이즈 (패널/헤더 `h-8 w-8` vs Input 우측 `h-9 w-9`), Tailwind CSS 변수, `data-[state=inactive]:hidden`, 버튼 사이즈, 같은 역할 패턴 일치, `t()`/`useT()` 일관성, 하드코딩 텍스트 |
| i18n-keys | `src/i18n/*` | ko/en 키 완전 대칭 (누락·여분), 키 네임스페이스 일관성, 미사용 키 |
| other-ui | `src/content/*`, `src/lib/*`, `src/store/*` | overlay Shadow DOM UI 패턴, 공유 유틸의 UI 연관 이슈, 하드코딩 텍스트 |

**전문가 통합 점검:**
- sidepanel 내 같은 역할 컴포넌트 간 패턴 불일치 (connect form, issue form 등)
- i18n 키 사용처와 정의의 정합성 (정의됐지만 미사용, 사용되지만 미정의)

---

#### Security 에이전트 (`security`)

인증·보안·MV3 lifecycle 전문.

**하위 에이전트 분배:**

| 하위 에이전트 | 영역 | 체크 |
|---|---|---|
| bg-oauth | `src/background/*`, `oauth-proxy/*` | discriminated union, OAuth proxy 경유 (client_secret 노출 금지), 토큰 갱신 흐름 (프리-리프레시 + 401 재시도), env 가드 (`isOAuthConfigured()` 계열), `OAuthError` 직렬화, SW lifecycle, 전역 sidePanel 비활성화, `BG_REQUEST_TYPES` 등록 |
| content-mv3 | `src/content/*` | MAIN world 주입 함수 self-contained 여부, `chrome.scripting.executeScript` 사용, `all_frames=false` 전제, entry 실행 순서, 메시지 비동기 응답 패턴 |
| panel-lib-auth | `src/sidepanel/**/*`, `src/lib/*`, `src/types/*` | user gesture 보존 경로, refresh hook 주입 패턴, `Accounts` 타입과 실제 API 일관성, discriminated union `kind` 판별자 |

**전문가 통합 점검:**
- OAuth 흐름 end-to-end: background token ↔ sidepanel refresh hook ↔ lib 타입 정합성
- user gesture 전파 경로: sidepanel 클릭 → background sidePanel.open → content inject 체인 무결

---

#### DataFlow 에이전트 (`dataflow`)

세션·picker·이슈 데이터 흐름 전문.

**하위 에이전트 분배:**

| 하위 에이전트 | 영역 | 체크 |
|---|---|---|
| content-picker | `src/content/*` | 토큰 resolve 룰 (`--_*` 끝까지 펼침, public 첫 이름 멈춤), `ensureCssCacheLoaded()` 호출 위치, overlay Shadow DOM, 메시지 비동기 응답 (`return true` + IIFE), cross-tab 메시지 격리, sentinel 버퍼 관리 |
| panel-session-issue | `src/sidepanel/**/*` | `editor:${tabId}` 키 패턴, phase별 보존 룰, hydration + debounced save, 4종 빌트인 섹션, POST_MEDIA 위치 룰, 마이그레이션 가드 멱등성, `(없음)` 빈 paragraph, `NormalizedSubmitResult` 통일 |
| store-lib-types | `src/store/*`, `src/lib/*`, `src/types/*` | `chrome.storage.session` vs `local` 구분, session-keys 상수 ↔ 사용처 일치, store 마이그레이션 체인 완전성, `PlatformId` union exhaustive, `IssueRecord` optional 필드, `BgRequest` union ↔ handler ↔ `BG_REQUEST_TYPES` 3곳 일치 |

**전문가 통합 점검:**
- 메시지 타입 정합성: background handler ↔ content sender ↔ types 정의 3곳 일치
- 플랫폼 어댑터 대칭: jira/github/linear/notion이 동일 패턴 (connect form, api adapter, oauth, submit helper, issue fields)

---

#### CodeHealth 에이전트 (`codehealth`)

코드 스타일·품질·기술 부채 전문.

**하위 에이전트 분배:**

| 하위 에이전트 | 영역 | 체크 |
|---|---|---|
| bg-content | `src/background/*`, `src/content/*`, `oauth-proxy/*` | 데드 코드, `@/` 경로, 주석 최소화, 불필요한 추상화, race condition, 보안 (외부 입력 검증, fetch URL) |
| panel | `src/sidepanel/**/*` | 데드 코드 (미사용 import/컴포넌트), 중복 로직, `@/` 경로, 주석, user gesture 소실 가능성, any/타입 단언 |
| store-lib-types-i18n | `src/store/*`, `src/lib/*`, `src/types/*`, `src/i18n/*` | 데드 export/타입, 유틸 중복, `@/` 경로, export 정리, 타입 파일 관심사 분리, any 남발, 메모리 cap 상수 일관성 (BODY_CAP, entry FIFO) |

**전문가 통합 점검:**
- import 경로 일관성: 전체에서 `@/` vs 상대 경로 혼용 지점
- 영역 간 중복 유틸·헬퍼 함수

### 3. 크로스 영역 통합 검사

활성 에이전트가 **2개 이상**일 때만 수행. 에이전트 결과가 돌아온 뒤, 메인 스레드에서 **영역을 가로지르는** 패턴 불일치를 추가 점검:

- **i18n 완전성** (ui 활성 시): `src/i18n/ko.ts`와 `src/i18n/en.ts`의 키 셋 diff
- **메시지 타입 정합성** (dataflow 활성 시): `BgRequest` union ↔ `messages.ts` handler ↔ `BG_REQUEST_TYPES` Set 3곳 일치
- **플랫폼 어댑터 대칭** (dataflow 활성 시): jira/github/linear/notion 4개 플랫폼이 동일 패턴을 따르는지
- **import 경로** (codehealth 활성 시): 전체에서 `@/` 대신 상대 경로 쓰는 곳 (또는 반대)
- **에이전트 간 중복 발견 합치기**

### 4. 시급도 분류 + 보고

각 발견을 라벨 하나로 분류해 그룹별로 출력:

- **🔴 심각** — 동작이 깨지는 버그, 데이터 손실, 보안 이슈, AGENTS.md의 명시적 게이트 위반 (예: user gesture 소실, OAuth secret 노출, MAIN world inject에서 클로저 참조, exhaustive switch 누락).
- **🟡 권장** — 컨벤션 위반, 향후 회귀 위험, 부분 일관성 깨짐 (예: i18n 비대칭, IconButton 사이즈 혼용, 토큰 resolve 룰 위반, `@/` 경로 불일치, 플랫폼 어댑터 비대칭).
- **⚪ 사소** — 스타일·정리 거리 (예: 잉여 주석, 미사용 import, 빈 줄, 미세한 중복, 미사용 i18n 키).

시급도 그룹과 무관하게 **전체 연번**을 매긴다 (사용자가 "3번 고쳐" 식으로 지칭할 수 있도록).

에이전트가 복수 활성이면 각 항목에 출처 태그 `[에이전트]` 표기. 단일 에이전트면 태그 생략.

```
1. [ui] 파일:줄 — 한국어 한 줄 요약. (근거: AGENTS.md "X" 룰 / ARCHITECTURE.md "Y" 원칙)
2. [security] 파일:줄 — …
```

코드 수정 제안은 한 줄까지만. **패치는 만들지 않는다.**

발견 0개면 "✅ 큰 문제 없음." 한 줄로 종료.

보고 마지막에 **통계 요약**:

```
---
감사 범위: 전체 / <agent> [+ <agent>]
활성 에이전트: N개
검사 파일: N개
발견: 🔴 X · 🟡 Y · ⚪ Z (합계 N)
```

### 5. 종료

여기서 끝. 후속 질문·액션 없음. 사용자가 보고를 보고 직접 결정한다.

## 에이전트 체크 레퍼런스

| 에이전트 | 차원 | 핵심 체크 포인트 |
|---|---|---|
| `ui` | ui | shadcn/ui 우선, IconButton 사이즈, Tailwind CSS 변수, `data-[state=inactive]:hidden`, 버튼 사이즈, 같은 역할 패턴 일치 |
| `ui` | i18n | ko/en 키 대칭, 하드코딩 텍스트, 키 네이밍, 미사용 키 |
| `security` | auth | discriminated union, OAuth proxy, 토큰 갱신 흐름, env 가드, refresh hook 패턴 |
| `security` | mv3 | SW lifecycle, 전역 sidePanel 비활성화, user gesture, MAIN world self-contained |
| `dataflow` | session | tabId scope, `editor:${tabId}`, origin 변경 폐기, phase별 보존, `chrome.storage.session` 패턴 |
| `dataflow` | picker | 토큰 resolve 룰, CSSOM shorthand cache, `ensureCssCacheLoaded()`, DOM lazy load, 비동기 응답 |
| `dataflow` | issue | 4종 섹션, POST_MEDIA 룰, 마이그레이션 가드, 빈 paragraph, 플랫폼 어댑터 대칭 |
| `codehealth` | style | `@/` 경로, 주석 최소화, 불필요한 추상화·shim, export 정리 |
| `codehealth` | general | 데드 코드, 중복 로직, race condition, 보안, any/타입 단언, 미사용 import |

## 명시적 제외

- `src/components/ui/*` — shadcn 생성기 산출물. import 여부만 확인.
- `__tests__/*` — 테스트 코드 스타일은 대상 외. 테스트 커버리지 부족만 체크 (순수 함수에 테스트가 없는 경우).

## 금지 사항

- **빌드 / typecheck / test 실행 금지** — 정적 코드 읽기만. `pnpm build`, `pnpm typecheck`, `pnpm test` 호출하지 않는다.
- **자동 fix 금지** — 발견을 리포트할 뿐 코드를 변경하지 않는다.
- **"고칠까요?" 같은 후속 액션 제안 금지** — 다음 행동은 전적으로 사용자.
- **커밋 / staging 안 함**.
- **추측성 발견 남발 금지** — AGENTS.md·ARCHITECTURE.md·코드 패턴에 근거를 댈 수 있는 것만 보고. "혹시 문제가 될 수 있다" 수준은 보고하지 않는다.
- **shadcn/ui 컴포넌트 파일 내부 감사 금지** — `src/components/ui/*`는 생성기 산출물.
