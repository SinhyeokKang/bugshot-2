---
description: 변경된 코드를 시급도별로 보고. 리포트 전용 — fix·빌드·커밋 안 함.
---

큰 작업을 끝낸 뒤 "지금 변경한 코드"에 대한 객관적 리뷰가 필요할 때 호출한다. **리포트 전용 스킬** — 빌드/타입체크 안 돌리고, 자동 fix 안 하고, 커밋도 안 한다. 시급도 분류된 발견 리스트만 출력하고 끝. 무엇을 고칠지·언제 고칠지·재빌드 여부는 전적으로 사용자가 결정한다.

## 사용

- `/code-review` — **`origin/main` 대비 working tree 전체** (push된 commit + 미커밋 변경 모두). 작업 사이클 단위 점검 기본값.
- `/code-review <base>` — 임의 base 대비 (예: `HEAD~3`, 특정 SHA, `dev` 등). 특정 작업 맥락만 좁혀서 보고 싶을 때.

## 다른 스킬과의 분리

- `/simplify`: review + 즉시 자동 fix. 의사결정이 묶임.
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

### 2. 리뷰 실행

변경 파일들의 diff를 CLAUDE.md 컨벤션·아키텍처 원칙에 비추어 검토. 카테고리:

- **UI / 디자인**: shadcn/ui 우선 (커스텀 스타일링 금지), IconButton 32 vs 36 구분 (패널/섹션 헤더 = 32, Input·Textarea 우측 = 36), Tailwind shadcn CSS 변수만, 커스텀 색상 남발 금지, 탭 컨텐츠 `data-[state=inactive]:hidden`, 버튼 사이즈 컨벤션 (`xl` = h-11 px-10).
- **i18n**: ko/en 동시 갱신 여부, 사용자 노출 텍스트 누락, 키 이름 일관성.
- **세션 보존**: tabId scope, `editor:${tabId}` 키, origin 변경 시 폐기, phase별 보존 룰 (styling 폐기 / drafting·previewing·done 보존), `chrome.storage.session` 사용 패턴.
- **picker / CSS**: 토큰 resolve 룰 (`--_*` private alias 끝까지 펼침, public 토큰은 첫 이름에서 멈춤), CSSOM shorthand cache (`getRawDeclarationsFor` 우선), DOM 트리 lazy load, 메시지 비동기 응답 (`return true` + IIFE 패턴), `await ensureCssCacheLoaded()` 호출 위치.
- **Jira / 인증**: discriminated union (`JiraAuth = JiraApiKeyAuth | JiraOAuthAuth`), OAuth proxy 경유 (client_secret 노출 금지), 토큰 갱신 흐름 (프리-리프레시 + 401 재시도), env 가드 (`isOAuthConfigured()`).
- **이슈 구성**: 4종 빌트인 섹션 (description / stepsToReproduce / expectedResult / notes), POST_MEDIA 위치 룰, 3중 마이그레이션 가드 (issues-store v3, app-settings-store v2, useEditorSessionSync), `(없음)` 빈 paragraph 표기.
- **MV3 / Side Panel**: user gesture 보존 (`chrome.sidePanel.open`은 await 직전 호출 금지), `chrome.action.onClicked` 패턴, `default_path` race 안전성.
- **코드 스타일**: `@/` 경로, 주석 최소화 (WHY가 비자명할 때만 한 줄, WHAT/현재 작업 언급 금지), 불필요한 추상화·feature flag·backwards-compat shim 금지, 입력 검증은 시스템 경계에서만.
- **일반**: 데드 코드, 중복 로직, race condition, 보안 (XSS / 입력 검증 / 외부 페치), `await`로 user gesture 소실 가능성.

### 3. 시급도 분류 + 보고

각 발견을 라벨 하나로 분류해 그룹별로 출력:

- **🔴 심각** — 동작이 깨지는 버그, 데이터 손실, 보안 이슈, CLAUDE.md의 명시적 게이트 위반 (예: user gesture 소실, manifest 권한 누락, OAuth secret 노출).
- **🟡 권장** — 컨벤션 위반, 향후 회귀 위험, 부분 일관성 깨짐 (예: i18n ko만 추가하고 en 누락, IconButton 32/36 혼용, 토큰 resolve 룰 위반).
- **⚪ 사소** — 스타일·취향·정리 거리 (예: 잉여 주석, 임시 변수 네이밍, 빈 줄, 미세한 중복).

각 항목 형식:

```
- 파일:줄 — 한국어 한 줄 요약. (근거: CLAUDE.md "X" 룰 / 패턴 Y 위반 / …)
```

코드 수정 제안은 한 줄까지만 (예: "`@/` 경로로 교체 권장"). **패치는 만들지 않는다.**

발견 0개면 "✅ 큰 문제 없음." 한 줄로 종료.

### 4. 종료

여기서 끝. 후속 질문·액션 없음. 사용자가 보고를 보고 직접 결정한다.

## 금지 사항

- **빌드 / typecheck 실행 금지** — 정적 진단만. `pnpm build`, `pnpm typecheck` 호출하지 않는다.
- **자동 fix 금지** — 발견을 리포트할 뿐 코드를 변경하지 않는다.
- **테스트 결과 묻지 않음** — 사용자에게 "테스트 통과했나요?" 같은 후속 질문 X.
- **"고칠까요?" 같은 후속 액션 제안 금지** — 다음 행동은 전적으로 사용자.
- **커밋 / staging 안 함**.
- **변경 범위 밖 파일 검토 금지** — 진단은 이번 변경분으로 한정.
- **추측성 발견 남발 금지** — 룰·패턴·CLAUDE.md 근거를 댈 수 있는 것만 보고.
