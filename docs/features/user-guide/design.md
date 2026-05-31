# User Guide 진입 배너 — 기술 설계

## 개요

사이드패널 루트(`App.tsx`)의 탭 헤더 위에 얇은 전역 배너 컴포넌트를 추가한다. 배너 본문 클릭은 기존 `chrome.tabs.create({ url })` 패턴으로 GitBook 가이드 URL을 새 탭으로 연다. dismiss 상태는 기존 `useSettingsUiStore`(zustand + `chrome.storage.local` 영속)에 boolean 필드 하나로 보존한다. 가이드 URL은 상수 한 곳에 둔다. 신규 i18n 키 2개(본문·닫기 aria-label)를 ko/en에 추가한다.

## 변경 범위

### 1. `src/store/settings-ui-store.ts` (변경)
- 현재 역할: 테마·로케일·이슈 섹션·LLM·replay 등 UI 설정을 zustand persist(`chrome.storage.local`, name `bugshot-app-settings`)로 보존.
- 변경 내용:
  - `SettingsUiState`에 `guideBannerDismissed: boolean` 상태와 `dismissGuideBanner: () => void` 액션 추가.
  - 초기값 `guideBannerDismissed: false`.
  - `dismissGuideBanner: () => set({ guideBannerDismissed: true })`.
  - persist `version`은 그대로(5 유지). 신규 필드는 기본값이 있어 zustand persist의 기본 shallow merge로 기존 사용자 상태에 자동 보강됨(누락 키 → 초기값 false). 별도 migrate 분기 불필요.

### 2. `src/lib/external-links.ts` (신규)
- 역할: 외부 링크 URL 상수 모음. 현재 privacy/review/store URL이 `SettingsTab.tsx`에 하드코딩돼 있는데, **이번 변경 범위는 가이드 URL만** 여기에 둔다(기존 URL 이전은 외과적 범위 밖 — 손대지 않음).
- 내용: `export const USER_GUIDE_URL = "https://<org>.gitbook.io/bugshot";` (실제 GitBook 퍼블리시 후 URL로 확정).

> 대안: 상수 파일 신설 없이 배너 컴포넌트 내부에 URL을 두는 방법도 있으나, "magic URL을 컴포넌트에 박지 않는다"는 가독성 차원에서 1줄 상수 파일을 둔다. 단일 상수라 과한 추상화 아님.

### 3. `src/sidepanel/components/GuideBanner.tsx` (신규)
- 역할: 전역 진입 배너. 자체적으로 store에서 dismissed 상태를 읽어 렌더 여부를 결정하는 self-contained 컴포넌트.
- 동작:
  - `useSettingsUiStore`에서 `guideBannerDismissed`, `dismissGuideBanner` 구독.
  - hydrate 가드: 부모(App)에서 `settingsHydrated`가 true일 때만 마운트하므로 컴포넌트 자체는 hydrate 체크 불필요(아래 4 참고). 또는 prop으로 받지 않고 App에서 조건부 렌더.
  - `guideBannerDismissed === true`면 `null` 반환.
  - 레이아웃: 높이 약 18px(`h-[18px]` 또는 `py-1`로 16–20px), `border-b`, 좌측 본문 버튼(텍스트 + chevron) / 우측 닫기 X.
  - 본문 클릭: `chrome.tabs.create({ url: USER_GUIDE_URL, active: true })`.
  - X 클릭: `dismissGuideBanner()`.
  - 텍스트는 `useT()`로 `app.guideBanner.cta` / 닫기 aria-label은 `app.guideBanner.dismiss`.
  - 아이콘: chevron은 lucide `ChevronRight`(h-3 w-3), 닫기는 lucide `X`(h-3 w-3). 닫기 버튼은 작은 IconButton 톤(기존 컨벤션 대비 배너가 얇으므로 `h-5 w-5` 정도, WHY 주석으로 사이즈 일탈 사유 명시).
  - 색상: shadcn 변수 사용. `bg-muted/50 text-muted-foreground` 같은 은은한 톤(헤더와 시각적으로 구분되되 강하지 않게). 커스텀 색상 금지.

### 4. `src/sidepanel/App.tsx` (변경)
- 현재 역할: 사이드패널 루트. `flex h-screen flex-col` 안에 AI 오버레이 + 탭 헤더(`border-b px-4 py-4`) + 탭 컨텐츠 + AlertDialog 6종 + Toaster.
- 변경 내용:
  - `GuideBanner` import.
  - 탭 헤더 `<div className="border-b px-4 py-4">` **바로 위**에 `{settingsHydrated && <GuideBanner />}` 삽입.
  - `settingsHydrated`는 이미 존재(`useSettingsHydrated()` 훅, line 60)하므로 재사용. hydrate 전 미렌더로 플리커 방지.
  - 배너는 `flex h-screen flex-col`의 첫 자식 흐름에 들어가 모든 탭에서 공통 노출(탭 컨텐츠는 그 아래 `flex-1`이 차지).

### 5. `src/i18n/namespaces/app.ts` (변경)
- ko/en 각각에 키 2개 추가:
  - `"app.guideBanner.cta"`: ko "사용 방법이 궁금하다면? 가이드" / en "New to BugShot? Read the guide"
  - `"app.guideBanner.dismiss"`: ko "배너 닫기" / en "Dismiss"
- i18n PostToolUse 훅이 ko/en 대칭을 자동 검사하므로 양쪽 동시 갱신 필수.

## 데이터 흐름

```
[App 마운트]
  └ useSettingsHydrated() → hydrated?
       └ true → <GuideBanner/>
                  └ useSettingsUiStore: guideBannerDismissed
                       ├ false → 배너 렌더
                       │    ├ 본문 click → chrome.tabs.create({url: USER_GUIDE_URL})  → 새 탭
                       │    └ X click → dismissGuideBanner() → set({guideBannerDismissed:true})
                       │                                          └ persist → chrome.storage.local("bugshot-app-settings")
                       └ true → null (미렌더)
```

영속: dismiss는 `chrome.storage.local`에 저장되어 사이드패널 재오픈·브라우저 재시작 후에도 유지.

## 인터페이스 설계

```ts
// src/store/settings-ui-store.ts — SettingsUiState 확장
interface SettingsUiState {
  // ...기존 필드
  guideBannerDismissed: boolean;
  dismissGuideBanner: () => void;
}

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
2. **배너 대신 설정 탭 내 "가이드 보기" 버튼** — privacy/review 버튼 옆. 발견성이 낮아(설정까지 들어가야 함) "전역 진입점" 목표와 어긋남 → 기각. (단, 추후 보조 진입점으로 추가 여지는 있음 — 이번 비목표.)
3. **GitBook URL을 컴포넌트에 인라인** — 상수 파일 없이. 단일 값이라 가능하나 "URL은 한 곳에서"라는 가독성 위해 1줄 상수 파일 채택.

## 위험 요소

- **persist merge 동작 확인**: 기존 사용자(version 5 상태에 `guideBannerDismissed` 키 없음)에서 zustand가 누락 키를 초기값(false)으로 채우는지 단위 테스트로 보장. 만약 merge가 기대대로 안 되면(드묾) `version` 6 + migrate에서 `state.guideBannerDismissed ??= false` 추가. — **선행 검증 항목**.
- **레이아웃 높이 압박**: 사이드패널은 세로 공간이 빠듯하다. 배너가 16–20px라 영구적으로 컨텐츠 높이를 깎음. dismiss 후 사라지므로 영구 비용은 아니나, 닫기 전까지는 탭 컨텐츠 `flex-1`이 그만큼 줄어듦 — 의도된 trade-off.
- **URL 확정 전 placeholder**: `USER_GUIDE_URL`은 GitBook 퍼블리시 후 실제 URL 확정 필요. 구현 시 placeholder로 두면 클릭이 깨진 링크로 감 — tasks 선행 조건에 명시.
- **클릭 영역 모호**: 본문 버튼과 X 버튼이 한 줄에 붙으므로, X 클릭이 본문 클릭으로 새지 않게 `stopPropagation` 또는 별도 버튼 분리.
