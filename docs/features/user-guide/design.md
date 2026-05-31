# User Guide 진입 배너 — 기술 설계

## 개요

사이드패널 루트(`App.tsx`)의 탭 헤더 위에 얇은 전역 배너 컴포넌트를 추가한다. 배너 본문 클릭은 기존 `chrome.tabs.create({ url })` 패턴으로 GitBook 가이드 URL을 새 탭으로 연다. dismiss는 기존 `useSettingsUiStore`(zustand + `chrome.storage.local` 영속)에 **닫은 시점의 확장 버전**을 저장하고, 이후 **minor+ 업데이트** 시 재팝업한다(순수 함수 `shouldShowGuideBanner`로 판정). 배너 상태가 사는 store가 `useSettingsUiStore`이므로 **GuideBanner는 이 store의 hydrate를 자체적으로 가드**한다(App.tsx의 기존 `settingsHydrated`는 별개 store인 `useSettingsStore`/accounts를 추적하므로 재사용 불가 — 위험 요소 절 참조). 보조 진입점으로 **설정 > 앱 설정 푸터의 [개인정보 처리방침] 버튼을 [유저 가이드]로 교체**한다(항상 노출, dismiss와 무관). 가이드 URL은 상수 한 곳에 둔다. 신규 i18n 키를 ko/en에 추가한다. 가이드 콘텐츠는 **in-repo 마크다운 + GitBook 호스팅**으로 관리(아래 절).

## 문서 관리 / 유지보수 (in-repo 마크다운 + 단방향 GitBook sync)

확장 코드 밖의 운영 축이지만, **바이브 코딩 워크플로우 안에서 코드로 관리**한다.

### 동기화 구조
```
bugshot-2 repo (main)
├ guide/                       ← 가이드 소스 (Claude가 작성, git 관리)
│   ├ SUMMARY.md               ← 목차/사이드바
│   ├ assets/                  ← 스크린샷 등 이미지 (repo에 커밋)
│   │   └ *.png
│   └ *.md                     ← 페이지 (![alt](assets/foo.png) 상대경로 참조)
├ .gitbook.yaml                ← root: ./guide  (GitBook이 이 경로만 읽음)
└ docs/                        ← 기존 Jekyll(privacy) — guide/와 분리, 충돌 없음
        │
        └ GitBook GitHub Sync (repo → GitBook 단방향) → https://<org>.gitbook.io/bugshot
                                                                    ▲
                                            확장 배너가 이 URL을 새 탭으로 오픈
```
- **단방향**: `guide/*.md`를 코드로만 편집 → GitBook이 렌더·퍼블리시. GitBook UI 편집은 쓰지 않음 → main에 봇 역커밋이 안 생겨 dev→main squash 흐름 유지.
- 구조는 repo 루트 `.gitbook.yaml`(`root: ./guide`, `structure.summary: SUMMARY.md`) + `guide/SUMMARY.md`(목차)로 GitBook 규약을 따른다.
- `docs/`(Jekyll)와 `guide/`(GitBook)는 별도 트리라 빌드 충돌 없음.

### 이미지 (스크린샷)
- 사용자가 캡처한 이미지를 `guide/assets/`에 커밋하고, 마크다운에서 **상대경로**로 참조: `![설명](assets/element-picker.png)`.
- GitBook GitHub Sync는 synced root(`./guide`) 내부의 상대경로 이미지를 그대로 해석·호스팅한다. 별도 CDN/업로드 불필요.
- 주의: PNG 스크린샷은 용량이 커 repo가 무거워질 수 있음 → 캡처를 적당히 압축(권장 폭 ~1280px, PNG/WebP). 소규모 가이드 수준에선 무시 가능한 비용.
- alt 텍스트는 접근성·검색용으로 채운다(가이드는 ko 중심이라 ko 캡션 OK — 본문 자체가 단일 언어, i18n 비대상).

### 워크플로우 편입 (신선도 검사 + 작성)
가이드가 코드와 같은 repo에 있으므로 기존 문서 거버넌스에 그대로 얹는다:
- **CLAUDE.md 「문서 신선도」**: 검사 대상 목록에 `guide/` 추가 — "사용자 노출 UX·기능 추가/변경 시 `guide/*.md` 대조·갱신, 별도 커밋 `docs(guide): ...`".
- **`push` 스킬 정의(`.claude/commands/push.md`)**: 신선도 체크리스트에 guide 항목 추가.
- **CLAUDE.md 작업 원칙(선택)**: 기능 구현 시 사용자 동작이 바뀌면 `guide/` 갱신을 같은 작업에 포함.
- 효과: 기능 PR마다 "가이드도 고쳤나?"가 `/push`에서 강제됨. 가이드가 코드 옆에서 함께 진화.

### 유지보수 비용
- **일상(콘텐츠 수정)**: `guide/*.md` 편집 + 커밋 → GitBook 자동 퍼블리시. **확장 재배포 불필요.**
- **확장 코드 변경 시점**: `USER_GUIDE_URL`이 바뀔 때만(도메인 유료 전환·slug 변경 등). `external-links.ts` 1줄 수정 + 릴리스.

> 참고: 모든 게 in-repo 마크다운 + 코드 관리이므로, GitBook이 기존 Jekyll Pages 대비 더 주는 것은 **깔끔한 UI**뿐(렌더러·호스팅 역할). 외부 sync 1겹을 UI를 위해 감수하는 구조 — GitBook 확정에 따른 trade-off. (Jekyll `just-the-docs` 테마로도 유사 UI가 외부 의존 0으로 가능하나 채택 안 함.)

## 변경 범위

### 1. `src/store/settings-ui-store.ts` (변경)
- 현재 역할: 테마·로케일·이슈 섹션·LLM·replay 등 UI 설정을 zustand persist(`chrome.storage.local`, name `bugshot-app-settings`)로 보존.
- 변경 내용:
  - `SettingsUiState`에 `guideBannerDismissedVersion: string | null` 상태와 `dismissGuideBanner: (currentVersion: string) => void` 액션 추가.
  - 초기값 `guideBannerDismissedVersion: null` (한 번도 안 닫음 → 노출).
  - `dismissGuideBanner: (v) => set({ guideBannerDismissedVersion: v })` — 닫는 시점의 확장 버전을 기록.
  - persist `version`은 그대로(5 유지). 이 store는 `merge`/`partialize`가 없어 zustand 기본 shallowMerge(`{...initialState, ...persisted}`)가 적용되므로, 기존 사용자 상태에 누락된 신규 키는 `initialState`의 `null`로 자동 보강된다(검증 완료) → version bump·migrate 불필요.
  - 테스트는 **in-memory 액션만** 검증한다(초기값 null, `dismissGuideBanner(v)` 후 v 기록). 이 store 테스트는 persist/hydration(chrome.storage) 경로를 타지 않으므로(전역 chrome mock·setup 없음) "키 누락 hydrate → null"을 직접 테스트하지 않고 zustand 기본 merge 동작에 의존한다 — 별도 순수 migrate 함수 분리는 과잉(migrate 자체가 없음).

### 1b. `src/lib/guide-banner.ts` (신규, 순수 함수)
- 역할: 재팝업 판정 로직을 store/컴포넌트에서 분리해 테스트 가능한 순수 함수로.
- `shouldShowGuideBanner(dismissedVersion: string | null, currentVersion: string): boolean`
  - `dismissedVersion == null` → `true` (한 번도 안 닫음).
  - `currentVersion`의 `major.minor` > `dismissedVersion`의 `major.minor` → `true` (기능 추가 릴리스 → 재팝업).
  - patch만 오르거나 같거나 낮으면 → `false` (계속 닫힌 상태 유지).
  - 버전 파싱 실패 등 비정상 입력은 `false`(나그 방지, fail-closed). 단 dismissed가 null이면 우선 true.
  - `currentVersion`은 호출부에서 `chrome.runtime.getManifest().version` 주입(순수성 유지 위해 인자로 받음).

### 2. `src/lib/external-links.ts` (신규)
- 역할: 외부 링크 URL 상수 모음. 현재 privacy/review/store URL이 `SettingsTab.tsx`에 하드코딩돼 있는데, **이번 변경 범위는 가이드 URL만** 여기에 둔다(기존 URL 이전은 외과적 범위 밖 — 손대지 않음).
- 내용: `export const USER_GUIDE_URL = "https://<org>.gitbook.io/bugshot";` (실제 GitBook 퍼블리시 후 URL로 확정).

> 대안: 상수 파일 신설 없이 배너 컴포넌트 내부에 URL을 두는 방법도 있으나, "magic URL을 컴포넌트에 박지 않는다"는 가독성 차원에서 1줄 상수 파일을 둔다. 단일 상수라 과한 추상화 아님.

### 3. `src/sidepanel/components/GuideBanner.tsx` (신규)
- 역할: 전역 진입 배너. store에서 dismissed 버전을 읽고 `shouldShowGuideBanner`로 렌더 여부를 결정하는 self-contained 컴포넌트. (상세 인터랙션은 아래 「배너 UX 상세」 절.)
- 동작 요약:
  - **자체 hydrate 가드**: `useSettingsUiStore.persist.hasHydrated()` + `onFinishHydration` 구독(또는 동등 패턴)으로 hydrate 완료 전에는 `null` 반환 → 플리커/오노출 방지. App.tsx의 `settingsHydrated`에 의존하지 않는다(다른 store).
  - `useSettingsUiStore`에서 `guideBannerDismissedVersion`, `dismissGuideBanner` 구독.
  - `currentVersion = chrome.runtime.getManifest().version`.
  - `shouldShowGuideBanner(guideBannerDismissedVersion, currentVersion) === false`면 `null` 반환.
  - 본문 클릭: `chrome.tabs.create({ url: USER_GUIDE_URL, active: true })`.
  - X 클릭: `dismissGuideBanner(currentVersion)` (이벤트 버블 차단해 본문 클릭과 분리).
  - 텍스트 `app.guideBanner.cta`("유저 가이드 바로가기"), 닫기 aria-label `app.guideBanner.dismiss` (`useT()`).

### 3b. 배너 UX 상세

**위치/형태**
- `App.tsx`의 **`flex min-h-0 flex-1 flex-col` 래퍼(탭 헤더를 감싸는 컨테이너)의 첫 자식 = 탭 헤더 div 바로 위**, full-width. 모든 탭 공통 노출. (루트 `flex h-screen flex-col`의 첫 자식이 아님 — 거긴 AI shimmer 오버레이 `absolute inset-0 z-50`가 있어 배너를 덮음. App.tsx 실제 구조 절 참조.)
- 단일 행 띠. 컴팩트 패딩(`px-3` + `text-xs`). `border-b`로 헤더와 구분. **높이는 표준 컴포넌트(아래 버튼)가 결정 — 16–20px 픽셀 타깃을 엄격히 강제하지 않는다**(아이콘·버튼 표준 사이즈 우선).
- 배경 은은하게(`bg-muted/50`), 기본 텍스트 `text-muted-foreground`. 커스텀 색상 금지(shadcn 변수만).

**레이아웃 (한 행)**
```
┌────────────────────────────────────────────────┐
│ 유저 가이드 바로가기  ›                      ✕ │
│ └──── CTA 버튼(좌, 클릭 시 새 탭) ────┘  └닫기┘ │
└────────────────────────────────────────────────┘
```
- 좌측 **CTA 버튼**: 텍스트(`app.guideBanner.cta` = "유저 가이드 바로가기") + `ChevronRight`. 영역 전체 클릭 가능, `flex-1 min-w-0`로 폭 차지, 텍스트 길면 `truncate`(짧은 문구라 잘림 위험 낮음).
- 우측 **닫기 버튼**: `X` 아이콘. 기존 인라인 닫기 선례(`ConsoleLogContent.tsx`, `IssueListTab.tsx`)와 동일한 **소형 패턴 — raw `<button>` + `rounded-sm p-0.5 text-muted-foreground hover:text-foreground` + 아이콘 `h-3.5 w-3.5`**, `shrink-0` + 좌측 여백(`ml-1`/`ml-2`)으로 CTA와 hit-area 분리. (CLAUDE.md IconButton 표준 h-8/h-9에서 일탈하지만, 이는 코드베이스의 검증된 인라인 닫기 패턴을 그대로 따른 것 — shadcn Button base의 `[&_svg]:size-4` 강제를 피하려고 선례도 raw button을 쓴다.)
- 버튼 중첩 금지: CTA와 X는 형제 `<button>`. X 클릭이 CTA로 새지 않게 별도 버튼으로 분리(이벤트 버블 자연 분리).

**인터랙션**
- CTA 클릭/Enter/Space → `chrome.tabs.create({ url: USER_GUIDE_URL, active: true })`. 새 탭이 활성화되고 **사이드패널은 그대로 유지**(닫히지 않음). dismiss 아님 — 다음에도 배너 유지.
- X 클릭 → `dismissGuideBanner(currentVersion)` → 컴포넌트 즉시 `null` 재렌더로 사라짐 → `chrome.storage.local` 영속.
- hover/focus: CTA·X 모두 raw `<button>`이므로 hover(`hover:text-foreground`)·`focus-visible:ring`을 직접 부여(shadcn Button에 의존 안 함). X는 좌측 여백으로 CTA hover 영역과 시각적 구분. cursor-pointer.

**재노출 (dismiss 정책)**
- 닫은 뒤에는 `shouldShowGuideBanner`가 false라 숨김 유지.
- 확장이 **minor+ 버전**으로 업데이트되면(`major.minor` 상승) 다음 패널 오픈 시 다시 노출. patch 릴리스(버그픽스)는 재노출 안 함.
- 재노출된 배너를 또 닫으면 새 버전이 기록되어 다음 minor+까지 다시 숨김.
- 영구 숨김 경로는 없음. 단, 닫은 사용자도 **설정 푸터의 [유저 가이드] 버튼**(아래 4b)으로 항상 가이드에 접근 가능.

**접근성**
- CTA·X 모두 키보드 포커스 가능한 `<button>`. X는 `aria-label`(`app.guideBanner.dismiss`). 텍스트 CTA라 별도 aria 불요.

### 4. `src/sidepanel/App.tsx` (변경)
- 현재 역할: 사이드패널 루트. 실제 구조: `root(relative flex h-screen flex-col, L183)` → AI shimmer 오버레이(`absolute inset-0 z-50`, L184) → `div.flex min-h-0 flex-1 flex-col gap-0(L191)` → 탭 헤더(`border-b px-4 py-4`, L192) → 탭 컨텐츠 → AlertDialog 6종 + Toaster. (`useSettingsHydrated()` 훅 정의는 L42, 호출은 L60 — design 본문의 "line 60 정의"는 오기였음.)
- 변경 내용:
  - `GuideBanner` import.
  - **`flex min-h-0 flex-1 flex-col gap-0` 래퍼(L191) 안, 탭 헤더 div(L192) 바로 위**에 `<GuideBanner />` 삽입. (루트 첫 자식이 아니라 이 래퍼의 첫 자식 — AI 오버레이 아래라 z-index 충돌 없음.)
  - **인라인 hydrate 가드 불필요**: App.tsx는 이미 `if (!editorHydrated || !settingsHydrated) return null`(L168)로 전체 트리를 hydrate 전 차단하므로 `{settingsHydrated && ...}` 인라인 가드는 항상 true라 무의미. 또한 그 가드가 추적하는 store(`useSettingsStore`)는 배너 상태가 사는 store(`useSettingsUiStore`)와 다르다. 따라서 hydrate 가드는 **GuideBanner 내부에서 `useSettingsUiStore` 기준으로 자체 처리**하고, App.tsx는 `<GuideBanner />`를 무가드로 마운트한다.
  - 배너는 탭 헤더 위 흐름에 들어가 모든 탭에서 공통 노출(탭 컨텐츠는 그 아래 `flex-1`이 차지).

### 4b. `src/sidepanel/tabs/SettingsTab.tsx` (변경) — 보조 진입점
- 현재 역할: `GeneralSettingsContent`의 `PageFooter`(`SettingsTab.tsx:218-239`)에 좌측 [개인정보 처리방침] / 우측 [리뷰][문의] 버튼 배치. 좌측 버튼은 `chrome.tabs.create({ url: "https://sinhyeokkang.github.io/bugshot-2/privacy" })`.
- 변경 내용: 좌측 [개인정보 처리방침] 버튼을 **[유저 가이드] 버튼으로 완전 교체**.
  - `onClick` → `chrome.tabs.create({ url: USER_GUIDE_URL, active: true })`.
  - 라벨 → `t("settings.guide")`.
  - `t("settings.privacy")` 사용처가 이 버튼뿐이면 키는 남겨두되(고아 i18n 키 삭제는 외과 범위 밖) UI에서만 제거. **고아 키는 ko/en 양쪽 모두 남겨야** `locales.test.ts`의 ko/en 대칭 검사를 통과한다(미사용 키 자체는 검사 무관).
- 결정 사항(확정): privacy 링크는 앱에서 제거하고 **스토어 등록 정보의 privacy URL에만 존재**. (privacy 문서 자체는 GitHub Pages에 그대로 유지.)
- 배너 dismiss와 무관하게 **항상 노출**되는 보조 진입점 — 배너 닫은 사용자의 가이드 접근 경로.

### 5. `src/i18n/namespaces/app.ts` + `src/i18n/namespaces/settings.ts` (변경)
- `app.ts` ko/en 각각:
  - `"app.guideBanner.cta"`: ko "유저 가이드 바로가기" / en "Open user guide"
  - `"app.guideBanner.dismiss"`: ko "배너 닫기" / en "Dismiss"
- `settings.ts` ko/en 각각:
  - `"settings.guide"`: ko "유저 가이드" / en "User Guide"
- i18n PostToolUse 훅이 ko/en 대칭을 자동 검사하므로 양쪽 동시 갱신 필수. (`settings.guide`가 실제 settings 네임스페이스에 있는지는 구현 시 기존 `settings.privacy` 위치 확인.)

### 6. `guide/` + `.gitbook.yaml` (신규, 콘텐츠/설정)
- `.gitbook.yaml`(repo 루트): `root: ./guide`, `structure: { summary: SUMMARY.md }`.
- `guide/SUMMARY.md`: 목차(최소 1개 페이지 링크).
- `guide/README.md`(또는 `getting-started.md`): 가이드 첫 페이지 — 스코프상 최소 1페이지만 스캐폴딩(본문 전체 작성은 비목표).
- `guide/assets/`: 스크린샷 디렉터리.

### 7. `CLAUDE.md` + `.claude/commands/push.md` (변경, 워크플로우 거버넌스)
- `CLAUDE.md` 「문서 신선도」: 검사 대상에 `guide/` 추가 — 사용자 노출 UX/기능 변경 시 `guide/*.md` 대조, 커밋 prefix `docs(guide): ...`.
- `.claude/commands/push.md`: 신선도 체크리스트에 guide 항목 추가.
- (선택) `CLAUDE.md` 작업 원칙에 "사용자 동작 변경 시 guide 갱신" 한 줄.

## 데이터 흐름

```
[App 마운트]
  └ useSettingsHydrated() → hydrated?
       └ true → <GuideBanner/>
                  └ v = chrome.runtime.getManifest().version
                  └ dv = useSettingsUiStore.guideBannerDismissedVersion
                  └ shouldShowGuideBanner(dv, v)?
                       ├ true → 배너 렌더
                       │    ├ CTA click → chrome.tabs.create({url: USER_GUIDE_URL, active:true})  → 새 탭 (배너 유지)
                       │    └ X click → dismissGuideBanner(v) → set({guideBannerDismissedVersion:v})
                       │                                          └ persist → chrome.storage.local("bugshot-app-settings")
                       └ false → null (미렌더)

[설정 > 앱 설정 푸터]
  └ [유저 가이드] 버튼 click → chrome.tabs.create({url: USER_GUIDE_URL})  (dismiss 무관, 항상)
```

영속: dismiss한 버전이 `chrome.storage.local`에 저장 → 재오픈·재시작 후에도 유지. minor+ 업데이트로 `major.minor` 상승 시 `shouldShowGuideBanner`가 true가 되어 재노출.

## 인터페이스 설계

```ts
// src/store/settings-ui-store.ts — SettingsUiState 확장
interface SettingsUiState {
  // ...기존 필드
  guideBannerDismissedVersion: string | null;
  dismissGuideBanner: (currentVersion: string) => void;
}

// src/lib/guide-banner.ts (신규, 순수 함수)
export function shouldShowGuideBanner(
  dismissedVersion: string | null,
  currentVersion: string,
): boolean;

// src/lib/external-links.ts (신규)
export const USER_GUIDE_URL = "https://<org>.gitbook.io/bugshot";

// src/sidepanel/components/GuideBanner.tsx (신규)
export function GuideBanner(): JSX.Element | null;
```

## 기존 패턴 준수

- **외부 링크 열기**: `chrome.tabs.create({ url, active: true })` — `SettingsTab.tsx:222`, `IssueRow.tsx:49`와 동일.
- **설정 영속화**: 신규 dismiss 플래그를 별도 store 신설 없이 기존 `useSettingsUiStore`에 추가 — replay·theme 등과 같은 패턴.
- **hydrate 가드**: `useSettingsHydrated()` 재사용 — persist hydrate 전 렌더 플리커 방지(기존 App 패턴).
- **i18n 동시 갱신**: ko/en 양쪽 키 추가, PostToolUse 훅 자동 검사.
- **UI 컴포넌트**: shadcn `Button`(variant `ghost`/`link`) + lucide 아이콘. 직접 스타일링 최소화, shadcn CSS 변수만 사용.
- **주석 최소화**: 배너 높이/닫기 버튼 사이즈가 표준(h-8 등)에서 벗어나는 부분만 WHY 한 줄.

## 대안 검토

1. **확장 내부 standalone 가이드 페이지(log-viewer식)** — `dist-guide/index.html` 빌드 후 `chrome.runtime.getURL`로 새 탭. 오프라인 동작·버전 고정 장점이 있으나, 빌드 타깃·별도 i18n·콘텐츠를 코드에 묶어 문서 갱신마다 재배포 필요. 사용 가이드는 빈번히 고쳐지므로 **코드 무관하게 갱신 가능한 외부 GitBook**이 운영상 우월 → 기각.
2. **설정 푸터 버튼만으로 진입(배너 없이)** — 발견성이 낮아(설정까지 들어가야 함) "전역 진입점" 목표와 어긋남. → 배너를 주 진입점으로 두되, 설정 푸터 [유저 가이드]를 **보조 진입점**으로 병행(배너 dismiss 후 접근 경로). 둘 다 채택.
   - dismiss 정책 대안: ① 영구(가이드 갱신 반영 못 함) ② 모든 버전 변경 재팝업(patch마다 떠 나그) ③ 시간 기반(새 내용 없어도 뜸) — 모두 기각. **minor+ 재팝업**이 "새 기능 = 새 가이드" 시점과 일치해 나그 최소 → 채택.
3. **GitBook URL을 컴포넌트에 인라인** — 상수 파일 없이. 단일 값이라 가능하나 "URL은 한 곳에서"라는 가독성 위해 1줄 상수 파일 채택.

## 위험 요소

- **persist merge 동작 확인**: 기존 사용자(version 5 상태에 `guideBannerDismissedVersion` 키 없음)에서 zustand가 누락 키를 초기값(null)으로 채우는지 단위 테스트로 보장. 안 되면 `version` 6 + migrate에서 `state.guideBannerDismissedVersion ??= null`. — **선행 검증 항목**.
- **버전 파싱 엣지**: `shouldShowGuideBanner`가 `"1.2"`, `"1.2.3.4"`, 비숫자 등 비정상 버전에 안전해야. 순수 함수라 단위 테스트로 케이스 고정(파싱 실패 → false, dismissed null → true). manifest 버전은 항상 정상 형식이나 방어.
- **privacy 접근성**: 앱 내 privacy 링크 제거는 의도된 결정. 스토어 등록 정보의 privacy URL은 유지되어야 정책 위반 아님 — 배포 체크리스트에 "스토어 privacy URL 유효" 항목 확인.
- **레이아웃 높이 압박**: 사이드패널은 세로 공간이 빠듯하다. 배너가 16–20px라 영구적으로 컨텐츠 높이를 깎음. dismiss 후 사라지므로 영구 비용은 아니나, 닫기 전까지는 탭 컨텐츠 `flex-1`이 그만큼 줄어듦 — 의도된 trade-off.
- **잘못된 hydrate store 추적(핵심)**: App.tsx의 `settingsHydrated`(`useSettingsHydrated()` → `useSettingsStore`/accounts)는 배너 상태가 사는 `useSettingsUiStore`와 **별개 store**라 재사용 불가. 또 App.tsx가 이미 전체를 hydrate 전 차단해 인라인 가드는 무의미. → GuideBanner가 `useSettingsUiStore` 기준 자체 hydrate 가드를 가져야 dismiss한 사용자에게 배너가 깜빡이지 않는다. — **구현 선행 확인 항목**.
- **URL 확정 전 placeholder**: `USER_GUIDE_URL`은 GitBook 퍼블리시 후 실제 URL 확정 필요. 구현 시 placeholder로 두면 클릭이 깨진 링크로 감 — **placeholder 상태로는 코드(Task 2/3/3b/5)를 main에 머지하지 않는다**(tasks 선행 조건에 명시).
- **GitBook 무료 plan URL 고착**: `<org>.gitbook.io/bugshot` slug가 조직명·plan에 묶여 추후 변경 가능성이 있고, 변경 시 **이미 배포된 구버전 확장 사용자는 깨진 링크**(자동 업데이트 전까지). 이번 스코프는 위험 인지 + URL 안정화 후 확정으로 처리(자체 리다이렉트 도메인은 비목표). 배포 전 URL 안정성 확인을 체크리스트에.
- **클릭 영역 모호**: 본문 버튼과 X 버튼이 한 줄에 붙으므로, X 클릭이 본문 클릭으로 새지 않게 `stopPropagation` 또는 별도 버튼 분리.
