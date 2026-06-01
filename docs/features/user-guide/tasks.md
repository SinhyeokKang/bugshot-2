# User Guide 진입점 — 구현 태스크

> 구현 반영 갱신(2026-06-01): 초기 설계의 **배너 + dismiss/버전 재팝업 + store 영속 + `shouldShowGuideBanner` 순수 함수**는 **전부 폐기·제거**. 진입점은 **푸터 버튼 2곳**(설정 / 이슈 idle), 가이드는 **ko/en 양국어**(GitBook 별도 site). UI 라벨은 **"BugShot 가이드" / "BugShot Guide"**. 아래는 현재 구현 기준 태스크.

## 폐기된 태스크 (구현 후 제거)
- ~~GuideBanner 컴포넌트~~ (`src/sidepanel/components/GuideBanner.tsx` 삭제)
- ~~`shouldShowGuideBanner` 순수 함수 + 테스트~~ (`src/lib/guide-banner.ts`, `__tests__/guide-banner.test.ts` 삭제)
- ~~settings-ui-store `guideBannerDismissedVersion` / `dismissGuideBanner`~~ (제거, version 5 그대로)
- ~~`app.guideBanner.cta` / `app.guideBanner.dismiss` i18n~~ (제거)
- ~~App.tsx 배너 마운트~~ (제거)

## 태스크 (현재 구현)

### Task 1: 가이드 URL 상수 (locale별)
- **변경 대상**: `src/lib/external-links.ts` (신규)
- **내용**: `USER_GUIDE_URLS: Record<LocaleMode, string>` — ko `https://bugshot.gitbook.io/bugshot/`, en `https://bugshot.gitbook.io/bugshot-en/`.
- **검증**:
  - [x] import 시 타입 오류 없음
  - [x] 실제 퍼블리시 주소(placeholder 아님) — 두 site 렌더 확인

### Task 2: 설정 푸터 [BugShot 가이드] 버튼
- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`
- **내용**: `GeneralSettingsContent` PageFooter 좌측 [개인정보 처리방침] 버튼을 [BugShot 가이드]로 교체. `variant="outline"` + 좌측 `BookOpen` 아이콘 + `t("settings.guide")`, `onClick` → `chrome.tabs.create({ url: USER_GUIDE_URLS[locale], active: true })`. `locale`은 기존 구독 재사용. privacy 링크 UI에서 제거(`settings.privacy` 키는 ko/en 양쪽 잔존).
- **검증**:
  - [x] 푸터에 [BugShot 가이드] 노출, 클릭 시 가이드 새 탭 (수동)
  - [x] privacy 버튼 사라짐 (수동)
  - [x] `pnpm typecheck` 무오류

### Task 3: 이슈 작성 idle 푸터 [BugShot 가이드] 버튼
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx` (`EmptyState`)
- **내용**: PageFooter를 `justify-end` → `justify-between`. 좌측에 [BugShot 가이드] 버튼(동일 패턴: `outline` + `BookOpen` + `t("settings.guide")` + `USER_GUIDE_URLS[locale]`), 우측 freeform draft 버튼 유지. `EmptyState`에 `locale` 구독 추가.
- **검증**:
  - [x] 이슈 작성 진입(idle) 화면 푸터 좌측에 버튼 노출, 클릭 시 가이드 새 탭 (수동)
  - [x] 우측 freeform 버튼 유지, 양끝 배치 (수동)
  - [x] `pnpm typecheck` 무오류

### Task 4: i18n 키 (ko/en 동시)
- **변경 대상**: `src/i18n/namespaces/settings.ts`
- **내용**: `settings.guide` — ko "BugShot 가이드" / en "BugShot Guide".
- **검증**:
  - [x] PostToolUse 훅(`locales.test.ts`) 통과 — ko/en 대칭
  - [x] `pnpm test locales` 통과

### Task 5: 가이드 소스 스캐폴딩 + GitBook 양국어 sync
- **변경 대상**: `guide/ko/`, `guide/en/` (각 `.gitbook.yaml` + `SUMMARY.md` + `README.md` + `assets/`)
- **내용**: 각 디렉터리 `.gitbook.yaml`(`root: ./`, summary). 첫 페이지 제목 "BugShot 가이드"/"BugShot Guide" + 빈 섹션 골격. GitBook space 2개를 각각 Project directory `guide/ko`·`guide/en`로 GitHub Sync(단방향, 현재 dev 브랜치), 각 site publish.
- **검증**:
  - [x] 두 site publish, 공개 URL 렌더 확인 (ko `/bugshot/`, en `/bugshot-en/`)
  - [ ] (관찰) 단방향 — main에 GitBook 봇 역커밋 미발생 확인(첫 sync 후 며칠)
  - [ ] (관찰) 14일 트라이얼 만료 후 Free 강등 시 두 URL 유지 확인

### Task 6: 워크플로우 신선도 검사에 guide 편입
- **변경 대상**: `CLAUDE.md`, `.claude/commands/push.md`
- **내용**: 「문서 신선도」 목록에 `guide/`(ko/en 양쪽) 추가, 커밋 prefix `docs(guide): ...`.
- **검증**:
  - [x] 문서 표현이 기존 신선도 섹션 톤과 일치
  - [ ] `/push` 1회 드라이런으로 guide 항목 노출 확인

## 테스트 계획

- **단위 테스트**: 이번 구현은 순수 함수가 없다(URL 분기는 단순 객체 인덱싱, locale은 타입으로 강제). 컴포넌트 렌더 테스트 인프라 부재 → 버튼은 **수동 검증**. 기존 store 테스트는 dismiss 제거 반영(`settings-ui-store.test.ts`에서 해당 describe 삭제).
- **수동 테스트** (Chrome, `pnpm dev` + 로드 언팩):
  - [ ] 설정 > 앱 설정 푸터 [BugShot 가이드] 노출·클릭, privacy 버튼 사라짐.
  - [ ] 디버그 > 이슈 작성 진입(idle) 푸터 좌측 [BugShot 가이드] 노출·클릭, 우측 freeform 유지.
  - [ ] ko↔en 전환 → 두 버튼 문구 바뀜 + 각 언어 가이드 URL로 열림(ko `/bugshot/`, en `/bugshot-en/`).
  - [ ] 상단에 배너 없음(폐기 확인).

> 문서 신선도: 신규 파일(`external-links.ts`, `guide/{ko,en}/`) 추가 + 삭제(`GuideBanner.tsx`, `guide-banner.ts`) → DIRECTORY.md 갱신 완료. manifest 권한·host_permissions 변화 없음(`chrome.tabs.create`는 기존 패턴) → privacy.md 무관.
