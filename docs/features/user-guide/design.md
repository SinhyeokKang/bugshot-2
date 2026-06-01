# User Guide 진입점 — 기술 설계

> 구현 반영 갱신(2026-06-01): 초기 설계의 **GuideBanner 컴포넌트 + `shouldShowGuideBanner` 순수 함수 + `guideBannerDismissedVersion` store 영속**은 **전부 제거**. 진입점을 **푸터 버튼 2곳**으로 단순화하고, 가이드를 **ko/en 양국어**(GitBook 별도 site, space 분기)로 운영한다. 아래는 현재 구현 기준.

## 개요

사용 가이드(GitBook) 진입점을 **두 PageFooter 버튼**으로 제공한다:
1. **설정 > 앱 설정 푸터**(`SettingsTab.tsx`의 `GeneralSettingsContent`) 좌측 버튼 — 기존 [개인정보 처리방침] 버튼을 [BugShot 가이드]로 교체.
2. **이슈 작성 진입(idle) 화면**(`IssueTab.tsx`의 `EmptyState`) 푸터 좌측 버튼 — 우측 freeform draft 버튼과 `justify-between` 배치.

두 버튼 모두 shadcn `Button`(variant `outline`) + 좌측 `BookOpen` 아이콘 + `t("settings.guide")` 라벨이며, `chrome.tabs.create({ url: USER_GUIDE_URLS[locale], active: true })`로 현재 locale(`useSettingsUiStore.locale`)에 맞는 가이드를 새 탭으로 연다. 닫기·영속·버전 재팝업 로직은 없다.

## 문서 관리 / 유지보수 (in-repo 마크다운 + 양국어 단방향 GitBook sync)

확장 코드 밖의 운영 축이지만 **바이브 코딩 워크플로우 안에서 코드로 관리**한다.

### 동기화 구조
```
bugshot-2 repo (현재 dev 브랜치 sync)
├ guide/
│   ├ ko/                       ← ko 가이드 소스
│   │   ├ .gitbook.yaml         ← root: ./, structure.summary: SUMMARY.md
│   │   ├ SUMMARY.md            ← 목차
│   │   ├ README.md             ← 첫 페이지
│   │   └ assets/               ← 이미지(![alt](assets/foo.png) 상대경로)
│   └ en/                       ← en 가이드 소스 (동일 구조)
└ docs/                         ← 기존 Jekyll(privacy) — guide/와 분리, 충돌 없음
        │
        ├ GitBook space(ko), Project directory = guide/ko → site: bugshot.gitbook.io/bugshot/
        └ GitBook space(en), Project directory = guide/en → site: bugshot.gitbook.io/bugshot-en/
                                 (각각 repo → GitBook 단방향)
                                      ▲
            확장의 두 푸터 버튼이 locale에 맞는 URL을 새 탭으로 오픈
```

- **양국어 = 별도 site 2개(space 분기).** GitBook content variants(단일 site 다국어)는 유료(Premium+)라 미채택. 무료 plan은 "unlimited basic sites"라 site 2개를 무료로 publish 가능.
- **monorepo 디렉터리 분리**: 각 space의 GitBook **Project directory**를 `guide/ko`·`guide/en`로 지정. GitBook이 그 디렉터리의 `.gitbook.yaml`(`root: ./`)을 찾아 해당 폴더만 그 site 콘텐츠로 렌더.
- **단방향**: Git Sync 초기 동기화를 **GitHub 쪽 콘텐츠** 기준으로. GitBook UI 편집을 안 쓰면 live edit이 잠겨 봇 역커밋이 안 생김 → dev/main 흐름이 깨끗.
- **sync 브랜치**: 현재 **dev**. 정식 운영 시 main 머지 후 sync 브랜치를 main으로 전환 가능(main에 `guide/`가 있어야 함).

### 이미지
- `guide/{ko,en}/assets/`에 커밋하고 마크다운에서 상대경로 참조. GitBook이 synced root 내부 상대경로 이미지를 그대로 호스팅.

### 워크플로우 편입 (신선도 + 작성)
- **CLAUDE.md 「문서 신선도」**: 검사 대상에 `guide/` 추가 — "사용자 노출 UX·기능 변경 시 `guide/ko`·`guide/en` 양쪽 대조·갱신, 커밋 `docs(guide): ...`".
- **`push` 스킬 정의(`.claude/commands/push.md`)**: 신선도 체크리스트에 guide 항목 추가(ko/en 양쪽).

### 유지보수 비용
- **일상(콘텐츠 수정)**: `guide/{ko,en}/*.md` 편집 + push → GitBook 자동 퍼블리시. **확장 재배포 불필요.**
- **확장 코드 변경 시점**: URL slug가 바뀔 때만. `external-links.ts` 수정 + 릴리스.

## 변경 범위 (현재 구현)

### 1. `src/lib/external-links.ts` (신규)
- locale별 가이드 URL 상수.
```ts
import type { LocaleMode } from "@/store/settings-ui-store";
export const USER_GUIDE_URLS: Record<LocaleMode, string> = {
  ko: "https://bugshot.gitbook.io/bugshot/",
  en: "https://bugshot.gitbook.io/bugshot-en/",
};
```

### 2. `src/sidepanel/tabs/SettingsTab.tsx` (변경)
- `GeneralSettingsContent`의 PageFooter 좌측 [개인정보 처리방침] 버튼을 [BugShot 가이드]로 교체.
  - `<BookOpen className="h-4 w-4" />` + `t("settings.guide")`, `onClick` → `chrome.tabs.create({ url: USER_GUIDE_URLS[locale], active: true })`.
  - `locale`은 이미 이 컴포넌트가 구독 중(`useSettingsUiStore((s) => s.locale)`).
- privacy 링크는 UI에서 제거. `settings.privacy` 키는 ko/en 양쪽 남겨둠(고아 키는 `locales.test.ts` 대칭 검사 무관, 외과 범위라 삭제 안 함).

### 3. `src/sidepanel/tabs/IssueTab.tsx` (변경)
- `EmptyState`(이슈 작성 idle 진입 화면)의 PageFooter를 `justify-end` → `justify-between`으로 바꾸고, 좌측에 [BugShot 가이드] 버튼 추가. 우측 freeform draft 버튼은 유지.
  - 동일 패턴: `variant="outline"` + `<BookOpen className="h-4 w-4" />` + `t("settings.guide")` + `USER_GUIDE_URLS[locale]`.
  - `EmptyState`에 `const locale = useSettingsUiStore((s) => s.locale)` 추가.

### 4. `src/i18n/namespaces/settings.ts` (변경)
- `settings.guide`: ko "BugShot 가이드" / en "BugShot Guide". (이 키 하나만 추가 — 배너용 `app.guideBanner.*`는 없음.) review/contact 라벨도 함께 변경: `settings.review` ko "후기 남기기"/en "Leave a Review", `settings.contact` ko "문의하기"/en "Contact Us".

### 5. `guide/ko` + `guide/en` + 각 `.gitbook.yaml` (신규, 콘텐츠/설정)
- 각 디렉터리: `.gitbook.yaml`(`root: ./`) + `SUMMARY.md` + `README.md`(첫 페이지 골격) + `assets/.gitkeep`. 본문 전체 작성은 비목표.

### 6. `CLAUDE.md` + `.claude/commands/push.md` (변경, 거버넌스)
- 「문서 신선도」 검사 대상에 `guide/`(ko/en 양쪽) 추가, 커밋 prefix `docs(guide): ...`.

## 기존 패턴 준수

- **외부 링크 열기**: `chrome.tabs.create({ url, active: true })` — 기존 `SettingsTab`/`IssueRow` 패턴 동일.
- **푸터 버튼**: shadcn `Button` variant `outline` + lucide 아이콘 — `EmptyState`의 freeform 버튼, 설정 푸터 버튼과 동일한 결.
- **i18n 동시 갱신**: ko/en 양쪽, PostToolUse 훅 자동 검사.
- **locale 분기**: `useSettingsUiStore.locale` 재사용(theme/locale select와 같은 store).

## 대안 검토

1. **상단 전역 배너(+ dismiss/버전 재팝업)** — 초기 설계. 가이드 본문이 미완숙인 동안 모든 탭 상단을 상시 점유하는 부담이 크고, dismiss/버전 영속/순수 함수까지 코드 표면적이 넓다. 가이드가 완숙되면 재도입을 검토하되, 현재는 **푸터 버튼 2곳으로 충분**하다고 판단해 제거. (관련 로직 `GuideBanner.tsx`/`guide-banner.ts`/store 키/`app.guideBanner.*` i18n 전부 삭제.)
2. **GitBook content variants(단일 site 다국어)** — URL 1개 + 언어 picker로 더 깔끔하나 **유료(Premium+)**. 무료 운영을 위해 **별도 site 2개(space 분기)** 채택 → 확장이 locale로 URL을 직접 분기.
3. **확장 내부 standalone 가이드(log-viewer식)** — 오프라인·버전 고정 장점이 있으나 문서 갱신마다 재배포 필요. 코드 무관하게 갱신 가능한 외부 GitBook이 운영상 우월 → 기각.

## 위험 요소

- **GitBook 무료 plan URL slug 고착**: `bugshot.gitbook.io/{bugshot,bugshot-en}` slug가 plan·조직에 묶여 추후 변경 가능성. 변경 시 이미 배포된 구버전 확장은 깨진 링크(자동 업데이트 전까지). URL 안정성 확인 후 확정, 바뀌면 `external-links.ts` 갱신.
- **GitBook Ultimate 트라이얼 만료**: 신규 가입 시 14일 Ultimate 트라이얼이 자동 적용. 만료 시 Free로 강등되며, 우리가 쓰는 GitHub Sync + basic published site는 Free 포함이라 유지되지만, 트라이얼 중 custom domain·variants 등 유료 기능을 켜두면 그때 깨질 수 있음 → 켜지 않는다. 만료 후 두 URL 유지 여부 1회 확인.
- **privacy 접근성**: 앱 내 privacy 링크 제거는 의도된 결정. 스토어 등록 정보의 privacy URL이 유지되어야 정책 위반 아님 — 배포 체크리스트에 "스토어 privacy URL 유효" 확인.
