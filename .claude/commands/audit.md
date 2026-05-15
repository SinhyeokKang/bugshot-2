---
description: 코드베이스 전체를 컨벤션·패턴 기준으로 감사. 리포트 전용 — fix·빌드·커밋 안 함.
---

최근 변경이 아닌 **코드베이스 전체**를 CLAUDE.md·ARCHITECTURE.md 컨벤션에 비추어 감사한다. 축적된 기술 부채, 패턴 불일치, 컨벤션 드리프트, 데드 코드, 보안 이슈를 찾는다. **리포트 전용 스킬** — 자동 fix 안 하고, 커밋도 안 한다. 무엇을 고칠지·언제 고칠지는 전적으로 사용자가 결정한다.

## 사용

- `/audit` — 전체 감사. 9개 차원 모두 검사.
- `/audit <dimension>` — 특정 차원만 집중 감사. 차원 키워드: `ui`, `i18n`, `session`, `picker`, `auth`, `issue`, `mv3`, `style`, `general`.

## 다른 스킬과의 분리

- `/code-review`: **변경분**(git diff) 대상 리뷰. 이번에 건드린 코드만.
- `/simplify`: review + 즉시 자동 fix. 의사결정이 묶임.
- `/review`: GitHub PR 리뷰 (외부 협업).
- `/audit` ← 여기. **전체 코드베이스** 대상. 변경 이력과 무관하게 축적된 문제를 찾는다.

## 절차

### 1. 컨벤션 로드

CLAUDE.md와 ARCHITECTURE.md를 읽어 감사 기준을 확립한다. 이 두 문서가 ground truth다.

dimension 인자가 있으면 해당 차원만 활성화. 없으면 전체.

### 2. 영역별 병렬 감사

4개의 Explore 에이전트를 **동시에** 실행한다. 각 에이전트에게 다음을 전달:
- 담당 영역의 파일 경로
- CLAUDE.md + ARCHITECTURE.md 핵심 컨벤션 (감사 기준)
- 활성화된 감사 차원 목록
- 아래 영역별 체크 가이드

각 에이전트는 담당 파일을 **전부 읽고** 활성 차원에 해당하는 위반을 찾는다. 발견마다 `파일:줄 — 요약 (근거)` 형식으로 보고.

#### 에이전트 A: Background (`src/background/*`, `oauth-proxy/*`)

- **auth**: discriminated union 일관성, OAuth proxy 경유 (client_secret 노출 금지), 토큰 갱신 흐름 (프리-리프레시 + 401 재시도), env 가드 (`isOAuthConfigured()` 계열), refresh hook 주입 패턴, `OAuthError` 직렬화 (정규식 매칭 금지)
- **mv3**: service worker lifecycle, 전역 sidePanel 비활성화, user gesture 보존, `chrome.scripting.executeScript` MAIN world 주입 함수 self-contained 여부
- **issue**: 메시지 네임스페이스 분기 exhaustive, `BG_REQUEST_TYPES` 등록 누락, API 응답 에러 처리 일관성
- **style**: `@/` 경로, 주석 최소화, 불필요한 추상화
- **general**: 데드 코드, race condition, 보안 (외부 입력 검증, fetch URL)

#### 에이전트 B: Content (`src/content/*`)

- **picker**: 토큰 resolve 룰 (`--_*` private alias 끝까지 펼침, public 토큰 첫 이름 멈춤), `ensureCssCacheLoaded()` 호출 위치, 메시지 비동기 응답 (`return true` + IIFE), overlay Shadow DOM
- **session**: cross-tab 메시지 격리, sentinel 기반 버퍼 관리, phase별 클리어
- **mv3**: MAIN world entry 실행 순서, `all_frames=false` 전제 일관성
- **style**: `@/` 경로, 주석 최소화
- **general**: 데드 코드, 메모리 cap 상수 일관성 (BODY_CAP, entry FIFO), race condition

#### 에이전트 C: Sidepanel (`src/sidepanel/**/*`)

- **ui**: shadcn/ui 우선 (커스텀 스타일링 여부), IconButton 사이즈 일관성 (패널/헤더 `h-8 w-8` vs Input 우측 `h-9 w-9`), Tailwind shadcn CSS 변수만, 탭 컨텐츠 `data-[state=inactive]:hidden` 누락, 버튼 사이즈 컨벤션, 같은 역할 코드 간 패턴 불일치
- **i18n**: `t()` / `useT()` 사용 일관성, 하드코딩된 사용자 노출 텍스트, 키 이름 컨벤션
- **session**: `editor:${tabId}` 키 패턴, phase별 보존 룰, hydration + debounced save
- **issue**: 4종 빌트인 섹션 구성, POST_MEDIA 위치 룰 일관성, 마이그레이션 가드 멱등성, `(없음)` 빈 paragraph 표기, `NormalizedSubmitResult` 통일
- **style**: `@/` 경로, 주석 최소화, 불필요한 추상화
- **general**: 데드 코드 (미사용 import/컴포넌트), 중복 로직, user gesture 소실 가능성

#### 에이전트 D: Store + Lib + Types + i18n (`src/store/*`, `src/lib/*`, `src/types/*`, `src/i18n/*`)

- **i18n**: ko/en 키 완전 대칭 여부 (누락·여분), 키 네임스페이스 일관성, 미사용 키
- **session**: `chrome.storage.session` vs `local` 사용 구분, session-keys 상수와 실제 사용처 일치
- **issue**: store 마이그레이션 체인 완전성, `PlatformId` union과 실제 분기 exhaustive, `IssueRecord` optional 필드 정합성
- **auth**: `Accounts` 타입과 실제 account 조작 API 일관성, discriminated union `kind` 판별자
- **style**: `@/` 경로, export 정리, 타입 파일 관심사 분리
- **general**: 데드 코드 (미사용 export/타입), 유틸 중복, 타입 안전성 (any, 타입 단언 남발)

### 3. 크로스 영역 통합 검사

4개 에이전트 결과가 돌아온 뒤, 메인 스레드에서 **영역을 가로지르는** 패턴 불일치를 추가 점검:

- **i18n 완전성**: `src/i18n/ko.ts`와 `src/i18n/en.ts`의 키 셋 diff
- **메시지 타입 정합성**: `BgRequest` union ↔ `messages.ts` handler ↔ `BG_REQUEST_TYPES` Set 3곳 일치
- **플랫폼 어댑터 대칭**: jira/github/linear/notion 4개 플랫폼이 동일 패턴을 따르는지 (connect form, api adapter, oauth, submit helper, issue fields)
- **import 경로**: 전체에서 `@/` 대신 상대 경로 쓰는 곳 (또는 반대)
- **에이전트 간 중복 발견 합치기**

### 4. 시급도 분류 + 보고

각 발견을 라벨 하나로 분류해 그룹별로 출력:

- **🔴 심각** — 동작이 깨지는 버그, 데이터 손실, 보안 이슈, CLAUDE.md의 명시적 게이트 위반 (예: user gesture 소실, OAuth secret 노출, MAIN world inject에서 클로저 참조, exhaustive switch 누락).
- **🟡 권장** — 컨벤션 위반, 향후 회귀 위험, 부분 일관성 깨짐 (예: i18n 비대칭, IconButton 사이즈 혼용, 토큰 resolve 룰 위반, `@/` 경로 불일치, 플랫폼 어댑터 비대칭).
- **⚪ 사소** — 스타일·정리 거리 (예: 잉여 주석, 미사용 import, 빈 줄, 미세한 중복, 미사용 i18n 키).

시급도 그룹과 무관하게 **전체 연번**을 매긴다 (사용자가 "3번 고쳐" 식으로 지칭할 수 있도록).

각 항목 형식:

```
1. 파일:줄 — 한국어 한 줄 요약. (근거: CLAUDE.md "X" 룰 / ARCHITECTURE.md "Y" 원칙 / 패턴 Z 위반 / …)
```

코드 수정 제안은 한 줄까지만. **패치는 만들지 않는다.**

발견 0개면 "✅ 큰 문제 없음." 한 줄로 종료.

보고 마지막에 **통계 요약**:

```
---
감사 범위: 전체 / <dimension>
검사 파일: N개
발견: 🔴 X · 🟡 Y · ⚪ Z (합계 N)
```

### 5. 종료

여기서 끝. 후속 질문·액션 없음. 사용자가 보고를 보고 직접 결정한다.

## 감사 차원 레퍼런스

| 키워드 | 차원 | 핵심 체크 포인트 |
|---|---|---|
| `ui` | UI / 디자인 | shadcn/ui 우선, IconButton 사이즈, Tailwind CSS 변수, `data-[state=inactive]:hidden`, 버튼 사이즈, 같은 역할 패턴 일치 |
| `i18n` | 다국어 | ko/en 키 대칭, 하드코딩 텍스트, 키 네이밍, 미사용 키 |
| `session` | 세션 보존 | tabId scope, `editor:${tabId}`, origin 변경 폐기, phase별 보존, `chrome.storage.session` 패턴 |
| `picker` | picker / CSS | 토큰 resolve 룰, CSSOM shorthand cache, `ensureCssCacheLoaded()`, DOM lazy load, 비동기 응답 패턴 |
| `auth` | 인증 | discriminated union, OAuth proxy, 토큰 갱신 흐름, env 가드, refresh hook 패턴 |
| `issue` | 이슈 구성 | 4종 섹션, POST_MEDIA 룰, 마이그레이션 가드, 빈 paragraph, 플랫폼 어댑터 대칭 |
| `mv3` | MV3 / Side Panel | user gesture 보존, tab-scope, sidePanel 전역 비활성화, MAIN world inject self-contained |
| `style` | 코드 스타일 | `@/` 경로, 주석 최소화, 불필요한 추상화·shim, export 정리 |
| `general` | 일반 | 데드 코드, 중복 로직, race condition, 보안, any/타입 단언, 미사용 import |

## 명시적 제외

- `src/components/ui/*` — shadcn 생성기 산출물. import 여부만 확인.
- `__tests__/*` — 테스트 코드 스타일은 대상 외. 테스트 커버리지 부족만 체크 (순수 함수에 테스트가 없는 경우).

## 금지 사항

- **빌드 / typecheck / test 실행 금지** — 정적 코드 읽기만. `pnpm build`, `pnpm typecheck`, `pnpm test` 호출하지 않는다.
- **자동 fix 금지** — 발견을 리포트할 뿐 코드를 변경하지 않는다.
- **"고칠까요?" 같은 후속 액션 제안 금지** — 다음 행동은 전적으로 사용자.
- **커밋 / staging 안 함**.
- **추측성 발견 남발 금지** — CLAUDE.md·ARCHITECTURE.md·코드 패턴에 근거를 댈 수 있는 것만 보고. "혹시 문제가 될 수 있다" 수준은 보고하지 않는다.
- **shadcn/ui 컴포넌트 파일 내부 감사 금지** — `src/components/ui/*`는 생성기 산출물.
