# 연동 CTA 배너 — 기술 설계

## 개요

`App.tsx`의 자동 탭 전환 `useEffect`를 삭제하고, 그 자리를 공용 배너 컴포넌트 `IntegrationsCta` 하나로 대체한다. 배너는 3곳(`IssueTab`의 `EmptyState`, `PreviewPanel`, `DraftDetailDialog`)에서 렌더되며, 클릭 시 기존 `TabNavContext`의 `navTo("integrations")`를 호출한다. 새 상태·스토리지·메시지는 도입하지 않는다 — 렌더 조건은 전부 기존 셀렉터(`connectedPlatforms`, `submittablePlatforms`)로 계산된다.

배너의 시각 스펙은 기존 AI 배너 두 개(`DraftingPanel`의 purple, `StyleEditorPanel`의 teal)에서 확립된 패턴을 따른다: 스크롤 영역 다음·footer 바로 위에 붙는 `rounded-t-lg` 버튼.

세 호출부의 구조가 같다는 점이 핵심이다. `PageFooter`(`Section.tsx:37`)는 `border-t bg-muted/50`이고, shadcn `DialogFooter`(`dialog.tsx:70`)도 같은 `border-t border-border bg-muted/50`를 갖는다(전체 클래스는 `flex flex-col-reverse gap-2 -mx-6 -mb-6 border-t border-border bg-muted/50 p-6 rounded-b-2xl sm:flex-row sm:justify-end`). 따라서 다이얼로그에서도 `rounded-t-lg` 접합이 그대로 성립하며, 배너 형태를 분기할 필요가 없다.

## 변경 범위

### `src/sidepanel/components/IntegrationsCta.tsx` (신규)

공용 배너 컴포넌트. 3개 호출부가 공유한다. 형태 분기(variant) 없이 한 벌이며, 호출부별 여백 보정만 `className`으로 주입한다.

렌더 조건 판정은 **컴포넌트 밖**에서 한다. 호출부마다 조건식이 다르기 때문이다(아래 "데이터 흐름" 참조).

### `src/sidepanel/App.tsx`

- **삭제**: `102-106`의 자동 전환 `useEffect` 전체.
- **삭제**: `85`의 `const accounts = useSettingsStore((s) => s.accounts);` — 위 effect 외 사용처가 없어 고아가 된다.
- **수정**: `20`의 import에서 `connectedPlatforms` 제거. `useSettingsStore`는 `57`·`60`(hydration)에서 계속 쓰므로 유지.
- `settingsHydrated`는 `176`의 렌더 가드에서 계속 쓰므로 유지.
- `navTo`(`90-93`)와 `TabNavContext.Provider`(`182`)는 그대로. 추가 배선 불필요.

### `src/sidepanel/tabs/IssueTab.tsx`

`EmptyState` 컴포넌트(`171-235`)에 배너를 추가한다. 위치는 `</div>`(캡처 버튼 컨테이너) 다음, `<PageFooter>`(`219`) 직전. 여백 보정 불필요(`className` 미주입).

`EmptyState`는 `PageScroll`을 쓰지 않고 `flex-1` div를 직접 쓰지만, `PageFooter` 바로 위라는 위치는 동일하다.

`useTabNav`는 `IssueTab.tsx:20`에 이미 import되어 있으나 `240`의 다른 컴포넌트에서 호출된다. `EmptyState` 안에서 별도로 `useTabNav()`를 호출한다.

노출 조건: `connectedPlatforms(accounts).length === 0`.

### `src/sidepanel/tabs/PreviewPanel.tsx`

- **삭제**: `387-393`의 `noPlatformConnected ? <Alert .../> : null` 블록.
- **추가**: `</PageScroll>`(`385`) 다음, `<PageFooter>`(`386`) 직전에 배너. 여백 보정 불필요.
- **주의 — 제자리 교체가 아니라 위치 이동이다.** 기존 Alert는 `<PageFooter>`의 **자식**이고(`386`이 오픈 태그, `387-393`이 그 안), 배너는 `PageFooter`의 **형제**로 승격되어 footer 위에 온다. Alert가 갖고 있던 `className="mb-2"`는 버린다.
- `noPlatformConnected`(`74-77`)는 배너 노출 조건으로 그대로 재사용한다.
- `useTabNav` import 추가.
- import 정리: `Alert`/`AlertDescription`/`AlertTitle`(`4`)과 `Info`(`2`)가 이 파일에서 고아가 되면 제거. `Download`는 다른 곳에서 쓰므로 유지.

### `src/sidepanel/tabs/DraftDetailDialog.tsx`

- **삭제**: `943-949`의 `available.length === 0 ? <Alert .../> : null` 블록.
- **추가**: 같은 위치에 배너. `className="-mx-6 -mt-5 -mb-5"`.
- 배너 위치는 `DialogContent`(`870`) 직계 자식이고, 바로 위(`875`)가 `flex-1 overflow-y-auto` 스크롤 영역, 바로 아래(`951`)가 `DialogFooter`다. 즉 `PageScroll → 배너 → PageFooter`와 동일한 3층 구조다.
- **여백 보정 근거**: `DialogContent`는 `flex flex-col gap-5 p-6`이다(`870` — `gap-5`는 shadcn 기본 `gap-4`를 오버라이드한 값). flex column에서 인접 아이템 간격은 `margin-bottom(위) + gap + margin-top(아래)`이므로:
  - `-mx-6` — `DialogContent`가 `p-6`이고 `DialogFooter`는 `-mx-6`로 가장자리까지 넓다. 배너도 같이 밀어야 폭이 맞아 접합된다.
  - `-mb-5` — 배너와 `DialogFooter` 사이의 `gap-5`(20px)를 상쇄한다. 배너 하단이 footer 상단에 닿는다.
  - `-mt-5` — 스크롤 영역과 배너 사이의 `gap-5`(20px)를 상쇄한다. **이것이 없으면 배너 위만 20px 뜨고 아래만 붙는 비대칭이 된다.** 사이드패널의 AI 배너는 `PageShell`이 gap 없는 flex column이라 위아래 모두 flush인데, 다이얼로그만 다르게 보이면 "AI 배너 패턴 준수"라는 설계 전제가 깨진다.
- 노출 조건은 `available.length === 0` 유지 (PRD S4 참조 — Slack-preserved 엣지를 의도적으로 포함). 이 값은 `useMemo` 내부 삼항식이다: `issue ? submittablePlatforms(issue, accounts) : connectedPlatforms(accounts)` (`156-159`). 다이얼로그는 `issue`가 항상 존재하므로 실질적으로 늘 `submittablePlatforms` 분기다.
- 클릭 핸들러는 `onOpenChange(false)` 후 `navTo("integrations")`. 다이얼로그를 닫지 않으면 탭이 바뀌어도 다이얼로그가 위를 덮는다. `onOpenChange(false)` 패턴은 `974`의 닫기 버튼과 동일.
- `useTabNav` import 추가.
- import 정리: `Alert` 계열과 `Info`가 고아가 되면 제거.

### `src/sidepanel/tabs/DraftingPanel.tsx` · `src/sidepanel/tabs/StyleEditorPanel.tsx`

기존 AI 배너 버튼(`DraftingPanel.tsx:388`, `StyleEditorPanel.tsx:489`)에 `focus-visible` 클래스만 추가한다. 그 외 일절 변경 없음. 위 "focus 링 소급 적용" 참조.

### `src/i18n/namespaces/app.ts`

**추가** (ko/en 동시):

| 키 | ko | en |
|---|---|---|
| `platform.cta.body` | 플랫폼을 추가해 이슈를 등록하세요. | Add a platform to start filing issues. |
| `platform.cta.action` | 플랫폼 추가 | Add platform |

값은 기존 `platform.add.empty.body` / `platform.subtab.add`와 동일하지만 **키를 새로 판다**. 기존 키는 각각 연동 탭 빈 상태(`ConnectedEmpty`)와 서브탭 라벨에 묶여 있어, 공유하면 한쪽 문구만 고치려 할 때 다른 쪽이 딸려 바뀐다. 맥락이 다르므로(연동 탭에서의 빈 상태 vs 캡처 화면에서의 미완 상태) 분리한다.

**삭제**: `platform.empty.body` (ko `38` / en `91`). `PreviewPanel`·`DraftDetailDialog`의 Alert가 유일한 사용처였으므로 이번 변경이 만든 고아다.

**유지**: `platform.empty.title`. `IssueCreateModal.tsx:556`이 disabled 제출 버튼 툴팁으로 계속 쓴다.

### `e2e/onboarding.spec.ts`

기존 테스트 "연동 0개 → integrations 탭 자동 진입"은 이번 변경으로 **정반대 동작을 검증**하게 된다. 파일을 새 동작 기준으로 다시 쓴다. 상세는 `tasks.md` Task 6.

## 데이터 흐름

새 상태 없음. 배너 노출은 기존 store 셀렉터의 파생값이다.

```
useSettingsStore(s => s.accounts)
  │
  ├─ IssueTab/EmptyState      → connectedPlatforms(accounts).length === 0
  ├─ PreviewPanel             → noPlatformConnected (= connectedPlatforms 기반, :74-77)
  └─ DraftDetailDialog        → available.length === 0
                                 (= submittablePlatforms(issue, accounts), :157)
                                    ├─ Slack-preserved 이슈 → promotableTargets (Slack 제외)
                                    └─ 그 외                → connectedPlatforms
```

세 조건이 통일되지 않는 것은 의도다. 다이얼로그는 "이 이슈를 제출할 수 있는 대상이 있는가"를 묻고, 나머지 둘은 "연동이 하나라도 있는가"를 묻는다.

클릭 시 흐름:

```
배너 클릭
  ├─ (다이얼로그) onOpenChange(false)
  └─ navTo("integrations")  →  TabNavContext  →  App.setTab("integrations")
```

## 인터페이스 설계

```ts
// src/sidepanel/components/IntegrationsCta.tsx
export function IntegrationsCta({
  onNavigate,
  className,
}: {
  onNavigate: () => void;
  className?: string;
}): JSX.Element;
```

`onNavigate`를 prop으로 받는 이유: `DraftDetailDialog`는 `navTo` 앞에 `onOpenChange(false)`를 끼워야 하므로, 컴포넌트가 `useTabNav()`를 직접 호출하면 그 합성이 불가능하다.

`className`은 호출부 여백 보정 전용이다(`DraftDetailDialog`의 `-mx-6 -mt-5 -mb-5`). 형태·색상은 분기하지 않는다.

배너 마크업 (AI 배너 패턴 준수 — `DraftingPanel.tsx:386-402` / `StyleEditorPanel.tsx:487-504`):

```tsx
<button
  type="button"
  data-testid="integrations-cta"
  className={cn(
    "flex items-center justify-between rounded-t-lg px-3.5 py-2.5 transition-colors",
    "bg-amber-100/80 text-amber-700 hover:bg-amber-100",
    "dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
    className,
  )}
  onClick={onNavigate}
>
  <span className="min-w-0 truncate text-sm">{t("platform.cta.body")}</span>
  <span className="flex shrink-0 items-center gap-1 text-sm font-medium">
    <Blocks className="h-4 w-4" />
    {t("platform.cta.action")}
  </span>
</button>
```

- **좌측 아이콘 없음.** 문구가 곧장 나온다. (초안은 대체되는 Alert의 `Info` 아이콘을 승계했으나, AI 배너의 `Badge` 자리를 아이콘으로 채우면 좌·우 아이콘이 좁은 폭에서 몰려 오히려 산만했다. 제거.) 좌측 문구가 truncate될 때 우측과 붙지 않도록 컨테이너에 `gap-2`를 준다 — 아이콘이 겸하던 간격의 대체다.
- 우측 아이콘 `Blocks` — 연동 탭 빈 상태(`IntegrationsTab.tsx:208`)가 쓰는 아이콘. 목적지를 가리킨다.
- 텍스트 색은 `text-amber-600 dark:text-amber-400`. AI 배너의 `-700`/`-300` 대비 한 단계 낮춘 값으로, amber는 채도가 높아 `-700`이면 배경 위에서 과하게 진하다.
- AI 배너의 gradient text(`bg-clip-text text-transparent`)는 쓰지 않는다. 담백한 톤 요구.
- `focus-visible:ring-inset` — 배너가 footer에 접합되고 다이얼로그에서는 `-mx-6`로 가장자리까지 밀리므로, 바깥으로 뻗는 링은 잘린다. 안쪽 링을 쓴다. 링 색은 토큰 `ring`을 쓴다(amber 하드코딩 아님).

### focus 링 소급 적용

기존 AI 배너 두 개(`DraftingPanel.tsx:388`, `StyleEditorPanel.tsx:489`)는 `hover:` 클래스만 있고 focus 스타일이 없다. 셋 다 같은 슬롯·같은 형태의 배너 버튼이므로 **동일한 `focus-visible` 클래스를 세 곳에 함께 적용한다**. CTA에만 넣으면 같은 자리의 형제 배너가 서로 다르게 동작한다.

이는 "외과적 변경" 원칙의 예외로, 이번 변경이 만든 불일치를 해소하는 최소 조치다. 마크업 구조·색·동작은 건드리지 않고 focus 클래스만 추가한다.

## 기존 패턴 준수

- **i18n 동시 갱신**: `src/i18n/` 편집 시 `.claude/settings.json`의 PostToolUse 훅이 `locales.test.ts`(ko/en 키 대칭)를 자동 실행한다. 신규 키 2개를 ko/en 양쪽에 함께 추가하지 않으면 차단된다.
- **UI 컴포넌트 직접 스타일링 금지**: 배너는 shadcn `Button`이 아니라 raw `<button>`이다. 이는 기존 AI 배너 두 개가 이미 확립한 예외 패턴을 따르는 것이며, `Button` variant로는 이 형태(footer 접합 + 양끝 정렬 + 커스텀 컬러)를 표현할 수 없다.
- **색상 토큰**: amber는 `log-colors.ts`에서 warn 톤으로 쓰이지만 그 사용처는 전부 로그 탭 내부이고 이 배너와 한 화면에 뜨지 않는다. purple(AI 초안)·teal(AI 스타일링)과 구분되면서 `PageFooter`의 `bg-muted/50` 위에서 묻히지 않는 색이 필요하다.
- **다크모드**: AI 배너와 동일한 `dark:` 대응 (`bg-*-950/50`, `text-*-300`, `hover:bg-*-900`).
- **`data-testid`**: e2e가 배너를 잡을 수 있도록 `integrations-cta` 부여. 3곳 공용이라 한 화면에 하나만 뜬다.

## 대안 검토

**대안 1 — 자동 전환을 남기고 "1회만" 실행.** `chrome.storage`에 `onboardingSeen` 플래그를 두고 최초 1회만 리다이렉트. 반복 노출 문제는 풀리지만 핵심 문제(가치 경험 전 비용 청구)는 그대로다. 게다가 영속 상태와 마이그레이션이 추가된다. 기각.

**대안 2 — `IssueCreateModal`의 disabled 제출 버튼을 CTA로 전환.** 전환 의도가 가장 높은 지점인 건 맞지만, 그 지점에 도달하려면 이미 `previewing` 배너를 지나쳐야 한다. 배너가 먼저 잡으므로 중복이고, disabled 버튼을 클릭 가능하게 만들면 "제출"이라는 라벨과 실제 동작이 어긋난다. 이번 스코프에서 제외(PRD 비목표).

**대안 3 — 배너를 gray/muted로.** `PageFooter`가 이미 `bg-muted/50`(`Section.tsx:37`)이라 배너가 footer에 녹아 경계선 하나로만 구분된다. 눈에 띄라고 넣는 요소인데 목적을 배신한다. 또한 선택적 부가 기능(AI 배너)이 컬러를 갖고 핵심 경로(연동)가 gray면 위계가 역전된다. 기각.

**대안 4 — `DraftDetailDialog`는 Alert 유지.** 최소 변경이지만 같은 상태("연동 없음 + 완성된 리포트")에 진입 경로에 따라 두 UI가 뜬다. 다이얼로그 배선은 `onOpenChange(false)` 한 줄이라 비용이 낮아 통일하기로 결정.

**대안 5 — 다이얼로그용 `standalone` variant(`rounded-lg` 독립 배너).** 초기 설계였으나 오판에 기반했다. `DialogFooter`가 배경 없는 영역이라 접합이 불가능하다고 봤는데, 실제로는 `dialog.tsx:70`에서 `border-t bg-muted/50`을 이미 갖고 있다. 실제 장애물은 배경이 아니라 `gap-5` 갭과 `-mx-6` 폭 불일치였고, 둘 다 여백 유틸로 상쇄된다. variant를 없애 컴포넌트를 한 벌로 유지한다.

## 위험 요소

- **e2e 회귀**: `e2e/onboarding.spec.ts`가 현재 동작을 고정하고 있어 반드시 함께 수정해야 한다. 수정하지 않으면 `/push`·`/merge`의 e2e 게이트에서 빨간불로 막힌다.
- **`DraftDetailDialog` 닫기 순서**: `navTo`를 먼저 호출하고 `onOpenChange(false)`를 나중에 하면, 탭은 바뀌었는데 다이얼로그가 한 프레임 남을 수 있다. 닫기를 먼저 한다.
- **`-mt-5 -mb-5` 하드코딩**: `DialogContent`의 `gap-5`(`DraftDetailDialog.tsx:870`)에 묶인 값이다. 그 클래스가 바뀌면 배너 위아래에 갭이 생기거나 겹친다. 세 값이 같이 움직여야 한다.
- **`EmptyState`의 배너 위 여백**: `EmptyState`는 `PageScroll` 없이 `flex-1 justify-center` div를 쓴다(`IssueTab.tsx:179`). 따라서 배너 위쪽이 스크롤 경계가 아니라 **중앙 정렬된 캡처 버튼 묶음과 배너 사이의 빈 공간**이다. 같은 `rounded-t-lg` 접합인데도 "footer에 붙은 탭"이 아니라 "화면 하단에 뜬 바"처럼 보일 수 있다. 수동 확인 후 어색하면 배너를 `PageFooter` 내부 첫 자식(`gap-2` 활용)으로 옮기는 것이 백업안이다.
- **`previewing` 화면의 신호 중복**: 배너(안내)와 `IssueCreateModal`의 disabled 제출 버튼+툴팁(차단)이 한 화면에 함께 보인다. 목적이 달라 의도한 것이며 PRD 목표 4의 "안내 UI 일원화"와 모순되지 않는다(PRD 목표 4 각주 참조).
- **`DialogFooter` 하단 라운드**: 기본값이 `rounded-b-2xl`(`dialog.tsx:70`)인데 이 다이얼로그는 `rounded-3xl`이다(`870`). 기존부터 어긋나 있던 부분이며 이번 스코프 밖이다. 배너 접합과는 무관(배너는 상단에 붙는다).
- **`EmptyState` 레이아웃**: 캡처 버튼 컨테이너가 `flex-1 justify-center`라 배너를 추가하면 수직 중앙 정렬 기준이 바뀐다. 배너가 `flex-1` 바깥·`PageFooter` 위에 오므로 중앙 정렬은 남은 공간 기준으로 재계산된다. 시각 확인 필요(수동 테스트 항목).
- **좁은 사이드패널 폭**: 배너는 좌측 문구 `truncate` + 우측 액션 `shrink-0`이다. ko "플랫폼을 추가해 이슈를 등록하세요."는 en보다 길어 좁은 폭에서 먼저 잘린다. 최소 폭에서 우측 액션이 살아남는지 확인 필요(수동 테스트 항목).
- **`platform.empty.body` 삭제**: `IssueCreateModal.tsx:556`이 쓰는 것은 `title`이지 `body`가 아니다. 삭제 전 `grep -rn "platform.empty.body" src/ e2e/`로 사용처 0을 재확인한다.
- **기존 Slack-preserved 버그**: `DraftDetailDialog`에서 Slack만 연동한 사용자에게 "연결된 플랫폼이 없습니다"가 뜨던 문제는 배너 전환으로 부수적으로 해소된다. 의도된 개선이며, 배너 노출 조건을 `connectedPlatforms` 기준으로 "정정"하면 오히려 그 사용자가 안내를 못 받게 되므로 `available` 기준을 유지할 것.
