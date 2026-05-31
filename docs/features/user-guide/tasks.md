# User Guide 진입 배너 — 구현 태스크

## 선행 조건

- **GitBook 사이트 + GitHub Sync 셋업** (Task 6에서 수행, 운영 축):
  1. GitBook 무료 스페이스 생성.
  2. 소스는 **이 repo `main` 브랜치의 `guide/`** (확정). repo 루트 `.gitbook.yaml`이 `root: ./guide`로 가리킴.
  3. GitBook GitHub Sync를 **repo → GitBook 단방향**으로 연결(GitBook UI 편집 미사용 → 봇 역커밋 없음).
  4. 공개 URL(`https://<org>.gitbook.io/bugshot`) 확보 → `USER_GUIDE_URL` 실제 값. (본문 콘텐츠 작성은 비목표나, 최소 1페이지는 퍼블리시돼야 링크가 안 깨짐.)
  5. **placeholder 머지 금지**: `USER_GUIDE_URL`이 실제 퍼블리시 주소로 확정되기 전에는 코드(Task 2/3/3b/5)를 main에 머지하지 않는다(깨진 링크 회귀 방지). GitBook 셋업 지연 시 코드는 dev에 보류. 무료 plan slug 변경 가능성도 인지(구버전 확장 깨진 링크 위험) — URL 안정성 확인 후 확정.
- **persist merge 동작 확인**: `useSettingsUiStore`에 신규 필드(`guideBannerDismissedVersion`) 추가 시 기존 영속 상태에서 누락 키가 초기값(null)으로 채워지는지 단위 테스트로 검증(Task 1). 안 되면 version 6 + migrate 분기 추가.

## 태스크

### Task 1: shouldShowGuideBanner 순수 함수 (+ 테스트 먼저)
- **변경 대상**: `src/lib/guide-banner.ts`(신규), `src/lib/__tests__/guide-banner.test.ts`(신규)
- **작업 내용**:
  - 테스트 먼저: `shouldShowGuideBanner(dismissed, current)` 케이스 —
    - `(null, "1.2.0")` → true (한 번도 안 닫음)
    - `("1.2.0", "1.3.0")` → true (minor 상승)
    - `("1.2.0", "2.0.0")` → true (major 상승)
    - `("1.2.0", "1.2.5")` → false (patch만)
    - `("1.2.0", "1.2.0")` → false (동일)
    - `("1.3.0", "1.2.0")` → false (하락)
    - `("1.2", "1.2.3.4", "x.y", "")` 등 비정상 current → false (단 dismissed null이면 true 우선)
    - `("1.2.0-beta", "1.3.0")` → true (prerelease 태그 무시하고 major.minor 파싱), `("1.2.0", "1.3.0-rc1")` → true
    - `("v1.2.0", "v1.3.0")` → true (`v` 접두 허용 또는 strip), `(" 1.2.0 ", " 1.3.0 ")` → 공백 trim 후 비교
    - **dismissed가 비정상(null 아님)일 때**: `("garbage", "1.3.0")` → **false**(fail-closed; dismissed 파싱 실패면 "닫은 상태로 간주"해 나그 방지. null이 아니므로 true 우선 규칙 미적용). 이 계약을 명세에 한 줄 박고 테스트로 고정.
  - 구현: `major.minor` 비교, **dismissed/current 어느 쪽이든 파싱 실패 시 fail-closed(false)**, 단 `dismissed === null`이면 true 우선.
- **검증**:
  - [ ] `pnpm test guide-banner` 통과
  - [ ] `pnpm typecheck` 무오류

### Task 1b: settings-ui-store에 dismiss 버전 상태 추가 (+ 테스트 먼저)
- **변경 대상**: `src/store/settings-ui-store.ts`, `src/store/__tests__/settings-ui-store.test.ts`
- **작업 내용**:
  - 테스트 먼저(**in-memory 액션만**): `guideBannerDismissedVersion` 초기값 null, `dismissGuideBanner("1.4.0")` 호출 후 `"1.4.0"`. 이 store 테스트는 persist/hydration(chrome.storage) 경로를 타지 않으므로(전역 chrome mock 없음) **"키 누락 hydrate → null"은 직접 테스트하지 않는다**. 대신 zustand 기본 shallowMerge 보강에 의존(CTO 검증: 이 store에 `merge`/`partialize` 없음 → 누락 키는 initialState의 null로 채워짐).
  - `SettingsUiState`에 `guideBannerDismissedVersion: string | null` + `dismissGuideBanner: (v: string) => void`.
  - 초기값 null, 액션 `set({ guideBannerDismissedVersion: v })`.
  - version 5 유지·migrate 불필요(별도 순수 migrate 함수 분리는 과잉 — migrate 자체가 없음). 만약 향후 `partialize`/`merge`가 추가되면 그때 누락 키 보강을 재검토.
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
- **작업 내용** (design.md 「배너 UX 상세」 준수):
  - **자체 hydrate 가드**: `useSettingsUiStore.persist.hasHydrated()` + `onFinishHydration`(또는 동등)으로 hydrate 완료 전 `null`. App.tsx `settingsHydrated`(다른 store)에 의존하지 않는다.
  - `useSettingsUiStore`에서 `guideBannerDismissedVersion`, `dismissGuideBanner` 구독.
  - `currentVersion = chrome.runtime.getManifest().version`. `shouldShowGuideBanner(dismissed, currentVersion)`가 false면 `null`.
  - 단일 행 띠: `px-3 text-xs`, `border-b`, 은은한 배경(`bg-muted/50 text-muted-foreground`). **높이는 버튼 표준 사이즈가 결정**(16–20px 픽셀 강제 안 함).
  - 좌측 CTA 버튼(raw `<button>`, `flex-1 min-w-0 truncate`, `useT("app.guideBanner.cta")`="유저 가이드 바로가기" + lucide `ChevronRight`) → `chrome.tabs.create({ url: USER_GUIDE_URL, active: true })`. (배너 유지)
  - 우측 닫기 버튼(raw `<button>`, lucide `X` `h-3.5 w-3.5`, aria-label `app.guideBanner.dismiss`, `rounded-sm p-0.5 shrink-0 ml-1 text-muted-foreground hover:text-foreground` — 기존 `ConsoleLogContent`/`IssueListTab` 인라인 닫기 선례 패턴, IconButton 표준 일탈은 검증된 선례 따른 것이라 WHY 주석) → `dismissGuideBanner(currentVersion)`. 별도 버튼으로 분리, 좌측 여백으로 hit-area 구분.
  - **shadcn `Button` 미사용**: base의 `[&_svg]:size-4`가 아이콘을 16px로 강제해 컴팩트 띠가 안 됨 → 선례대로 raw `<button>` + 직접 `focus-visible:ring`.
- **검증** (이 repo는 `.test.tsx`·testing-library·jsdom 부재 → 컴포넌트 렌더 자동 테스트 불가, **수동 강등**. 로직은 Task 1 `shouldShowGuideBanner` 단위 테스트로 커버):
  - [ ] (수동) `shouldShowGuideBanner` true면 렌더, false면 null
  - [ ] (수동) CTA 클릭 → 새 탭 열림(배너 유지), X 클릭 → 배너 사라짐
  - [ ] (수동) hydrate 전 미렌더(플리커 없음)
  - [ ] `pnpm typecheck` 무오류

### Task 3b: 설정 푸터 [개인정보 처리방침] → [유저 가이드] 교체
- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용**:
  - `GeneralSettingsContent` PageFooter 좌측 버튼(현 privacy, `SettingsTab.tsx:222`)을 가이드로 교체.
  - `onClick` → `chrome.tabs.create({ url: USER_GUIDE_URL, active: true })`, 라벨 → `t("settings.guide")`.
  - privacy 링크는 UI에서 제거(스토어 등록 정보엔 유지). `settings.privacy` 키가 고아가 되면 **ko/en 양쪽 모두 남겨둠**(외과 범위 + `locales.test.ts` ko/en 대칭 검사 통과 위해 한쪽만 지우면 안 됨).
- **검증**:
  - [ ] 설정 > 앱 설정 푸터에 [유저 가이드] 노출, 클릭 시 가이드 새 탭
  - [ ] privacy 버튼 사라짐
  - [ ] `pnpm typecheck` 무오류

### Task 4: i18n 키 추가 (ko/en 동시)
- **변경 대상**: `src/i18n/namespaces/app.ts`, `src/i18n/namespaces/settings.ts`
- **작업 내용**:
  - `app.ts` ko/en: `app.guideBanner.cta` ("유저 가이드 바로가기" / "Open user guide"), `app.guideBanner.dismiss` ("배너 닫기" / "Dismiss").
  - `settings.ts` ko/en: `settings.guide` ("유저 가이드" / "User Guide").
- **검증**:
  - [ ] Edit 저장 시 PostToolUse 훅(`locales.test.ts`) 통과 — ko/en 대칭·빈 값 없음
  - [ ] `pnpm test locales` 통과

### Task 5: App.tsx에 배너 마운트
- **변경 대상**: `src/sidepanel/App.tsx`
- **작업 내용**:
  - `GuideBanner` import.
  - **`flex min-h-0 flex-1 flex-col gap-0` 래퍼(App.tsx:191) 안, 탭 헤더 div(`border-b px-4 py-4`, :192) 바로 위**에 `<GuideBanner />` 삽입. (루트 첫 자식 아님 — AI 오버레이 아래.)
  - **인라인 가드 없이** 마운트(`{settingsHydrated && ...}` 쓰지 않음): App.tsx가 이미 L168에서 hydrate 전 전체 차단 + 배너 hydrate 가드는 GuideBanner 내부가 `useSettingsUiStore` 기준으로 담당.
- **검증**:
  - [ ] 모든 최상위 탭(debug/issue-list/integrations/settings)에서 배너 노출
  - [ ] hydrate 전 미렌더(플리커 없음) — GuideBanner 자체 가드로
  - [ ] AI shimmer 오버레이가 배너를 덮지 않음(래퍼 안 배치 확인)
  - [ ] `pnpm typecheck` 무오류

### Task 6: 가이드 소스 스캐폴딩 + GitBook sync 연결
- **변경 대상**: `.gitbook.yaml`(신규, repo 루트), `guide/SUMMARY.md`, `guide/README.md`, `guide/assets/`(신규)
- **작업 내용**:
  - `.gitbook.yaml`: `root: ./guide`, `structure.summary: SUMMARY.md`.
  - `guide/SUMMARY.md`: 목차(최소 첫 페이지 링크).
  - `guide/README.md`: 첫 페이지 최소 스캐폴딩(제목 + 빈 섹션 골격). 본문 전체 작성은 비목표.
  - `guide/assets/`: 이미지 디렉터리(placeholder `.gitkeep` 또는 첫 스크린샷). 마크다운에서 `![alt](assets/...)` 상대경로.
  - GitBook 대시보드에서 이 repo `main` 브랜치를 **repo→GitBook 단방향**으로 Sync 연결.
- **검증** (대부분 자동 테스트 불가 — 산출물 문서화로 검증 가능성 확보):
  - [ ] GitBook에 `guide/`가 렌더되어 공개 URL 접근 가능
  - [ ] `guide/assets/`의 이미지가 페이지에 표시됨
  - [ ] main에 GitBook 봇 역커밋이 발생하지 않음(단방향) — **1회가 아니라 첫 sync 후 며칠 관찰**해 확정. 단방향 설정값을 스크린샷/메모로 남김.

### Task 7: 워크플로우 신선도 검사에 guide 편입
- **변경 대상**: `CLAUDE.md`, `.claude/commands/push.md`
- **작업 내용**:
  - `CLAUDE.md` 「문서 신선도」 목록에 `guide/` 추가 — 사용자 노출 UX/기능 변경 시 대조, 커밋 prefix `docs(guide): ...`.
  - `.claude/commands/push.md` 신선도 체크리스트에 guide 항목 추가.
  - (선택) `CLAUDE.md` 작업 원칙에 "사용자 동작 변경 시 guide 갱신" 한 줄.
- **검증**:
  - [ ] `/push` 1회 드라이런으로 guide 신선도 항목이 체크리스트에 실제 나타남 확인
  - [ ] 문서 표현이 기존 신선도 섹션 톤과 일치

## 테스트 계획

- **단위 테스트** (이 repo의 자동 테스트는 순수 함수·store in-memory만 — 컴포넌트 렌더 테스트 인프라 부재):
  - `src/lib/__tests__/guide-banner.test.ts`: `shouldShowGuideBanner` 버전 비교 케이스(Task 1 목록 — prerelease·v접두·공백·dismissed 비정상 포함).
  - `src/store/__tests__/settings-ui-store.test.ts`: `guideBannerDismissedVersion` 초기값 null, `dismissGuideBanner(v)` 후 v 기록. (키 누락 hydrate는 persist 경로 미진입이라 직접 테스트 안 함 — zustand 기본 merge 의존.)
  - `GuideBanner.tsx`·`SettingsTab.tsx`·`App.tsx`는 컴포넌트 테스트 부재로 **수동 검증**(아래).
- **수동 테스트** (Chrome, `pnpm dev` + 로드 언팩):
  - [ ] 사이드패널 열기 → 탭 헤더 위 배너 보임.
  - [ ] 4개 최상위 탭 전환해도 배너 유지.
  - [ ] CTA 클릭 → 새 탭에서 GitBook 가이드 열림, 사이드패널·배너 유지.
  - [ ] X 클릭 → 배너 사라짐.
  - [ ] 사이드패널 닫았다 재오픈 → 배너 안 보임(영속).
  - [ ] (버전 모사) dismiss 후 manifest minor bump → 재노출 / patch bump → 미노출. (storage의 `guideBannerDismissedVersion`을 수동 편집해 확인 가능)
  - [ ] 설정 > 앱 설정 푸터 [유저 가이드] 노출·클릭 동작, privacy 버튼 사라짐 확인.
  - [ ] ko↔en 전환 → 배너·설정 버튼 문구 바뀜.

## 구현 순서 권장

- **운영(Task 6) 먼저**: GitBook 스캐폴딩 + sync로 공개 URL 확보 → Task 2의 `USER_GUIDE_URL` 실제 값이 나온다.
- 코드: Task 1(순수 함수) / Task 1b(store) / Task 4(i18n)는 독립 — **병렬 가능**. Task 2는 Task 6 후. Task 3은 Task 1·1b·2 후. Task 3b는 Task 2·4 후. Task 5는 Task 3 후 마지막.
- Task 7(거버넌스)은 독립 — 아무 때나.
- 권장: **6 → (1·1b·4 병렬) → 2 → 3 → (3b·5)**, 7은 병행.

> 문서 신선도: 신규 파일(`GuideBanner.tsx`, `external-links.ts`, `.gitbook.yaml`, `guide/`) 추가이므로 `/push` 시 DIRECTORY.md 갱신 대상. 새 외부 링크(GitBook)지만 manifest 권한·host_permissions 변화 없음(`chrome.tabs.create`는 기존 패턴, 신규 권한 불요) → privacy.md는 "외부 문서 링크 추가" 수준에서 대조만. Task 7로 `guide/` 자체가 향후 신선도 검사 대상에 편입됨.
