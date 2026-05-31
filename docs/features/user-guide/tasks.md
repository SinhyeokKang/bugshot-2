# User Guide 진입 배너 — 구현 태스크

## 선행 조건

- **GitBook 사이트 생성 + 퍼블리시**: 무료 플랜으로 BugShot 가이드 스페이스를 만들고 공개 URL(`https://<org>.gitbook.io/bugshot`) 확보. 이 URL이 `USER_GUIDE_URL` 상수의 실제 값. (가이드 본문 내용 작성은 이번 스코프 밖이나, 최소 1페이지라도 퍼블리시돼 있어야 링크가 안 깨짐.)
- **persist merge 동작 확인**: `useSettingsUiStore`에 신규 boolean 필드 추가 시 기존 영속 상태에서 누락 키가 초기값으로 채워지는지 단위 테스트로 검증(Task 1). 안 되면 version 6 + migrate 분기 추가.

## 태스크

### Task 1: settings-ui-store에 dismiss 상태 추가 (+ 테스트 먼저)
- **변경 대상**: `src/store/settings-ui-store.ts`, `src/store/__tests__/settings-ui-store.test.ts`
- **작업 내용**:
  - 테스트 먼저: `guideBannerDismissed` 초기값 false, `dismissGuideBanner()` 호출 후 true, 기존 persist 상태(키 누락)에서 hydrate 시 false로 채워지는지 케이스 추가.
  - `SettingsUiState`에 `guideBannerDismissed: boolean` + `dismissGuideBanner: () => void`.
  - 초기값 false, 액션 `set({ guideBannerDismissed: true })`.
  - 테스트가 누락 키 merge 실패를 잡으면 version 6 + `migrate`에 `state.guideBannerDismissed ??= false`.
- **검증**:
  - [ ] `pnpm test settings-ui-store` 통과
  - [ ] `pnpm typecheck` 무오류

### Task 2: 가이드 URL 상수 추가
- **변경 대상**: `src/lib/external-links.ts` (신규)
- **작업 내용**: `export const USER_GUIDE_URL = "<퍼블리시된 GitBook URL>";` 한 줄.
- **검증**:
  - [ ] import 시 타입 오류 없음
  - [ ] URL이 실제 퍼블리시 주소(placeholder 아님)

### Task 3: GuideBanner 컴포넌트 작성
- **변경 대상**: `src/sidepanel/components/GuideBanner.tsx` (신규)
- **작업 내용**:
  - `useSettingsUiStore`에서 `guideBannerDismissed`, `dismissGuideBanner` 구독. dismissed면 `null`.
  - 얇은 띠(16–20px): `border-b`, 은은한 배경(`bg-muted/50 text-muted-foreground`).
  - 좌측: 본문 버튼(`useT("app.guideBanner.cta")` 텍스트 + lucide `ChevronRight` h-3 w-3) → 클릭 시 `chrome.tabs.create({ url: USER_GUIDE_URL, active: true })`.
  - 우측: 닫기 버튼(lucide `X` h-3 w-3, aria-label `app.guideBanner.dismiss`, `h-5 w-5` — 배너 높이에 맞춘 사이즈 일탈, WHY 주석) → `dismissGuideBanner()`. 본문 클릭과 분리(별도 버튼).
  - shadcn `Button` variant `ghost`/`link` 사용. 직접 스타일링 최소화.
- **검증**:
  - [ ] dismissed=false일 때만 렌더, true면 null (수동/스토어 mock)
  - [ ] `pnpm typecheck` 무오류

### Task 4: i18n 키 추가 (ko/en 동시)
- **변경 대상**: `src/i18n/namespaces/app.ts`
- **작업 내용**: ko/en 각각 `app.guideBanner.cta`, `app.guideBanner.dismiss` 추가.
  - ko: "사용 방법이 궁금하다면? 가이드" / "배너 닫기"
  - en: "New to BugShot? Read the guide" / "Dismiss"
- **검증**:
  - [ ] Edit 저장 시 PostToolUse 훅(`locales.test.ts`) 통과 — ko/en 대칭·빈 값 없음
  - [ ] `pnpm test locales` 통과

### Task 5: App.tsx에 배너 마운트
- **변경 대상**: `src/sidepanel/App.tsx`
- **작업 내용**:
  - `GuideBanner` import.
  - 탭 헤더 `<div className="border-b px-4 py-4">` 바로 위에 `{settingsHydrated && <GuideBanner />}` 삽입.
- **검증**:
  - [ ] 모든 최상위 탭(debug/issue-list/integrations/settings)에서 배너 노출
  - [ ] hydrate 전 미렌더(플리커 없음)
  - [ ] `pnpm typecheck` 무오류

## 테스트 계획

- **단위 테스트** (`src/store/__tests__/settings-ui-store.test.ts`):
  - `guideBannerDismissed` 초기값 false.
  - `dismissGuideBanner()` 후 true.
  - (필요 시) 기존 영속 상태에서 키 누락 → hydrate 후 false.
- **수동 테스트** (Chrome, `pnpm dev` + 로드 언팩):
  - [ ] 사이드패널 열기 → 탭 헤더 위 배너 보임.
  - [ ] 4개 최상위 탭 전환해도 배너 유지.
  - [ ] 본문 클릭 → 새 탭에서 GitBook 가이드 열림, 사이드패널 유지.
  - [ ] X 클릭 → 배너 사라짐.
  - [ ] 사이드패널 닫았다 재오픈 → 배너 안 보임(영속).
  - [ ] 설정에서 ko↔en 전환 → 배너 문구 바뀜(dismiss 전 상태에서 확인).

## 구현 순서 권장

- Task 1 → Task 4는 독립적이라 **병렬 가능**(store / i18n).
- Task 2(상수)는 Task 3 전에. Task 3은 Task 1·2 완료 후.
- Task 5는 Task 3 완료 후 마지막.
- 권장: **1·2·4 먼저 → 3 → 5**.

> 문서 신선도: 신규 파일(`GuideBanner.tsx`, `external-links.ts`) 추가이므로 `/push` 시 DIRECTORY.md 갱신 대상. 새 외부 링크(GitBook)지만 manifest 권한·host_permissions 변화 없음(`chrome.tabs.create`는 기존 패턴, 신규 권한 불요) → privacy.md는 "외부 문서 링크 추가" 수준에서 대조만.
