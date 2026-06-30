# DESIGN.md

bugshot-2의 디자인 시스템·UI 컨벤션 단일 출처. 신규 화면·컴포넌트를 만들 때 여기 패턴을 먼저 본다. 권한·아키텍처는 [ARCHITECTURE.md](./ARCHITECTURE.md), 파일별 역할은 [DIRECTORY.md](./DIRECTORY.md) 참조.

> 이 문서는 코드베이스에서 역추출한 **현재 상태 스냅샷 + 권장 가이드**다. lint/test로 강제되는 규칙은 아니므로 "권장"으로 읽되, 합리적 이유 없이 벗어나지 않는다. 일부는 아직 코드가 따라오지 못한 **개선 후보(⚠)**로 표시한다. 컨벤션을 바꾸면 여기도 함께 갱신한다.

## 1. 기반 스택

- **Tailwind CSS v3** + **shadcn/ui** (style `new-york`, base color `slate`, CSS 변수 모드) — `components.json`
- **`@tailwindcss/container-queries`** — 좁은 사이드패널/다이얼로그 공용 컴포넌트의 컨테이너 기반 리플로우
- **`tailwindcss-animate`** — Radix data-state 진입/퇴장 애니메이션
- **lucide-react** — 일반 UI 아이콘 / **`@icons-pack/react-simple-icons`** — 플랫폼 브랜드 마크 (`Si{Name}`)
- **Pretendard Variable** — 본문 폰트 (`globals.css`에서 dynamic-subset import)
- 컴포넌트 정의: `src/components/ui/` (shadcn 생성물), 합성 컴포넌트: `src/sidepanel/components/`

UI 컴포넌트는 직접 스타일링하기보다 shadcn/ui를 우선 쓰고, 없으면 `npx shadcn@latest add <component>`로 설치한 뒤 `src/components/ui/`에 위치하는지 확인한다(shadcn이 `@/` 루트에 생성할 수 있음).

## 2. 색상 (디자인 토큰)

색상은 **semantic 토큰을 기본**으로 쓴다. `tailwind.config.js`가 다음 토큰을 `hsl(var(--X))`로 노출하고, `src/styles/globals.css`의 `:root`(light) / `.dark`(dark)가 값을 정의한다.

| 토큰 | 용도 |
|---|---|
| `background` / `foreground` | 페이지 바탕 / 기본 텍스트 |
| `primary` (+`-foreground`) | 주요 CTA·강조 |
| `secondary` (+`-foreground`) | 보조 버튼·탭 바 바탕 |
| `muted` (+`-foreground`) | 보조 텍스트·비활성 배경 |
| `accent` (+`-foreground`) | hover 강조 |
| `destructive` (+`-foreground`) | 삭제·위험 |
| `card` / `popover` (+`-foreground`) | 카드·팝오버 표면 |
| `border` / `input` / `ring` | 테두리 · 입력 테두리 · 포커스 링 |

- 커스텀 raw 색(`text-blue-600` 등)은 semantic 토큰으로 표현 못 하는 **상태/기능 색**에만 쓰고, 가능하면 `dark:` 짝을 함께 둔다. 현재 사용처:
  - 상태 배지 팔레트: `src/sidepanel/tabs/statusBadges/constants.ts` (new=slate, done=green, deleted=red … `bg`/`text`/`dark:bg`/`dark:text` 묶음)
  - 네트워크 메서드 색: `NetworkLogContent.tsx` (GET=blue, POST=green, DELETE=red, dark variant 동반)
  - 외부 링크: `text-blue-600 underline dark:text-blue-400` (`InlineLink.tsx`)
  - 주석(annotation) 색 팔레트: `src/sidepanel/components/annotation/presets.ts` (`ANNOTATION_COLORS` — 캔버스 그리기용 고정 5색 raw hex, `dark:` 짝 없음)
- ⚠ 상태 배지·기능 색의 light/dark 대비(WCAG AA)는 따로 검증돼 있지 않다. 새 raw 색 추가 시 대비를 눈으로라도 확인.

## 3. 다크 모드

- `darkMode: ["class"]` — `<html>`에 `.dark` 클래스 토글.
- 토글 로직: `src/sidepanel/hooks/useThemeEffect.ts`. theme(`light`|`dark`|`system`)을 `useSettingsUiStore`에서 읽어 `classList.toggle("dark", …)`, `system`이면 `matchMedia("(prefers-color-scheme: dark)")` 변화를 구독.
- 영속: `src/store/settings-ui-store.ts` (Zustand persist, key `bugshot-app-settings`).
- semantic 토큰을 쓰면 다크가 자동 대응되므로 `dark:` variant는 raw 색·invert 등 토큰으로 안 되는 경우에만.

## 4. 타이포그래피

- 폰트 스택: `font-sans` = Pretendard Variable → Pretendard → 시스템 한/영 폴백 (`tailwind.config.js`). body에 `font-feature-settings: "rlig" 1, "calt" 1`.
- 크기 관용: **`text-xs`·`text-sm`이 지배적**(UI 라벨·필드·보조 텍스트). `text-base`=본문, `text-lg`=섹션/빈 상태 제목, `text-xl`=큰 헤딩.
- 라벨 기본형: `text-xs text-muted-foreground` (FieldRow), 강조 라벨 `text-sm font-medium` (shadcn Label).

## 5. 간격 (Spacing)

Tailwind 4px 스케일을 그대로 쓴다. 자주 쓰는 값(관용):

| 맥락 | 값 |
|---|---|
| 라벨 ↔ 필드 (FieldRow) | `gap-1.5` |
| 아이콘 ↔ 텍스트 (인라인) | `gap-1.5` ~ `gap-2` |
| 섹션 세로 패딩 (`Section`) | `py-6` |
| 패널/탭 영역 가로 패딩 | `px-4` |
| 빈 상태 아이콘 원형 패딩 | `p-3` |

새 레이아웃은 이 값들을 먼저 재사용한다. 임의의 `gap-3.5` 같은 비표준 값은 이유가 있을 때만.

## 6. Radius & Elevation

**Radius** — `--radius: 0.75rem` 기준. `rounded-lg`=radius, `md`=−2px, `sm`=−4px. 표면 종류별 관용:

| 표면 | radius |
|---|---|
| 기본 컨트롤(버튼·인풋·select) | `rounded-md` |
| 카드·팝오버·콘텐츠 박스 | `rounded-lg` |
| 다이얼로그 | `rounded-2xl` |
| 토스트 | `rounded-xl` |
| 칩·스와치 등 작은 인라인 요소 | `rounded-sm` / `rounded-[3px]` |
| 원형(스위치 thumb·pill 배지·아바타) | `rounded-full` |

**Elevation (그림자)** — 표면이 떠 있을수록 강한 그림자. 단계:

| 단계 | 클래스 | 쓰임 |
|---|---|---|
| 1 | `shadow-sm` | 기본 컨트롤·인풋·outline/secondary 버튼 |
| 2 | `shadow` / `shadow-md` | default 버튼·팝오버·select 콘텐츠 |
| 3 | `shadow-lg` | 다이얼로그·토스트 |

## 7. Z-index 레이어

오버레이가 많은 확장이므로 레이어를 단순하게 유지한다.

- **Radix 오버레이(Dialog·Popover·Tooltip·Select)는 모두 `z-50` 공통.** 같은 평면에서 뒤에 열린 것이 위로 온다.
- 로컬 sticky/겹침은 `z-10` 수준.
- 그 위로 강제로 떠야 하는 예외는 `z-[60]` (현재 1곳). 새로 만들 땐 `z-50` 기준으로 잡고, 꼭 필요할 때만 `z-[60]`.
- content script의 picker·overlay·AnnotationOverlay 캔버스는 **페이지 쪽 shadow DOM**에서 별도 최상위 z로 뜬다 — 사이드패널 z축과 무관하니 헷갈리지 말 것.

## 8. 모션 & 트랜지션

- Radix data-state 진입/퇴장은 `tailwindcss-animate`(`data-[state=open]:animate-in` / `…animate-out` + `fade`/`zoom`/`slide`)로 처리.
- 현재 duration 관용: 다이얼로그 `duration-300`, accordion `0.2s`, shimmer `2s`(무한), hover 류는 `transition-colors` 기본.
- ⚠ **`prefers-reduced-motion` 미대응.** 새 애니메이션(특히 무한 루프인 shimmer류)을 추가할 땐 `motion-reduce:` variant로 줄이거나 끄는 것을 권장.

## 9. 접근성 (a11y)

- 키보드·역할·포커스 트랩은 **Radix 프리미티브**가 기본 제공한다(shadcn 컴포넌트를 쓰면 따라옴).
- 포커스 표시는 `focus-visible:ring-2 focus-visible:ring-ring` 컨벤션.
  - ⚠ **현재 `--ring`이 `--border`와 같은 값**이라(`globals.css`) 키보드 포커스 링이 잘 안 보인다. 개선 후보 — 별도 대비색으로 분리하면 좋다. 그 전까진 중요한 인터랙션에 포커스가 보이는지 직접 확인.
- **아이콘 전용 버튼**(`size="icon"`)은 텍스트가 없으므로 `aria-label`(또는 `sr-only` 텍스트)을 붙인다 — 안 그러면 스크린리더에서 무명 버튼.
- 보조 정보용 저대비 텍스트(`text-muted-foreground/70`)는 본문 핵심 정보에 쓰지 않는다.
- 다이얼로그를 **코드로(프로그램적으로) 열 때**는 `blurActiveElement()`(`App.tsx`)로 포커스를 먼저 떼야 Radix `aria-hidden` 경고를 피한다 — 새 전역 다이얼로그 추가 시 참고.

## 10. 버튼 & 사이즈

shadcn `Button` (`src/components/ui/button.tsx`, cva):

**variant**: `default`(primary) · `destructive` · `outline` · `secondary` · `ghost` · `link`
**size**: `default`(h-9 px-4) · `sm`(h-8 px-3 text-xs) · `lg`(h-10) · `xl`(h-11 px-10 text-base) · `icon`(h-9 w-9)
기본 `variant="default" size="default"`. 아이콘 기본 `[&_svg]:size-4 shrink-0`.

- **CTA는 `default`(h-9)로 통일** — 대개 `size` 생략(기본값이 h-9).
- `xl`은 랜딩/온보딩 같은 특수 CTA 전용.
- `sm`은 텍스트 포함 보조 버튼(복사·필터 등).
- 위험 동작은 `variant="destructive"` 또는 `className="text-destructive"`.

**아이콘 버튼(`size="icon"`) 두 사이즈**
- `h-8 w-8` (32px): 패널/섹션 헤더·행 액션의 기본.
- `h-9 w-9` (36px): Input/Textarea 우측에 직접 붙어 필드 높이(h-9)와 맞춰야 할 때. 항상 `shrink-0` 동반.

**관련 변형 컴포넌트**
- `Badge`: variant `default`/`secondary`/`destructive`/`outline`, size 없음, `[&>svg]:size-3`.
- `Toggle`/`ToggleGroup`: variant `default`/`outline`/`segment`/`underline`, size `sm`(h-8)/`default`(h-9)/`lg`(h-10).
- `ButtonGroup`: `orientation` `horizontal`/`vertical`.

## 11. 레이아웃 & 반응형

사이드패널은 폭이 좁고 가변(min 320px)이라 **컨테이너 기반·flex 오버플로우** 패턴을 기본으로 한다.

### 앱 셸 (`src/sidepanel/App.tsx`)
```
<div class="relative flex h-screen flex-col">     // relative = AI 로딩 오버레이 앵커
  <div class="flex min-h-0 flex-1 flex-col gap-0">
    <div class="border-b px-4 py-4"> … 탭 바(CollapsingTabsList) … </div>
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden" …> … 탭 콘텐츠 … </div>
  </div>
  … AlertDialog 모달들 … <Toaster/>
</div>
```
핵심 관용구:
- **`h-screen flex-col`**: side panel 전체 높이를 수직 스택으로.
- **`flex min-h-0 flex-1 flex-col`**: `min-h-0`이 있어야 flex 자식이 고유 높이를 넘겨 내부 스크롤이 생긴다(스크롤 영역 공식). 이 패턴은 `PageShell`/`PageScroll`/`PageFooter`(아래 §13)로 표준화돼 있어, raw 클래스 대신 그 조합을 기본으로 쓴다.
- **`min-w-0`**: 가로 flex 자식이 콘텐츠 최소 폭을 고집해 레이아웃이 깨지는 것 방지. 아이콘은 `shrink-0`, 텍스트는 절단.

### 탭 시스템
- `tabs.tsx` (Radix 래핑): `TabsList` = `inline-flex h-9 … bg-muted p-1`.
- **비활성 탭 콘텐츠 숨김은 두 가지 경우**가 있다:
  - Radix `Tabs`가 콘텐츠까지 감싸는 영역(DebugTab·SettingsTab·IntegrationsTab 등) → `TabsContent` 자신에 **`data-[state=inactive]:hidden`**.
  - App 최상위처럼 `Tabs`가 탭 바만 감싸는 구조 → 콘텐츠 `<div>`를 상태값으로 **수동 `hidden` 토글**(`App.tsx`). Radix data-state가 닿지 않기 때문.
  - 어느 쪽이든 비활성 탭을 언마운트하지 않고 숨겨 동시 렌더 버그를 피하는 게 의도.
- `collapsing-tabs.tsx` (`CollapsingTabsList`): ResizeObserver/MutationObserver로 폭을 감시해, 트리거가 넘치면 **모든 탭 라벨을 동시에 숨기고 아이콘+배지만** 남긴다. 측정 중엔 `group-data-[measuring]/tabs:inline`로 라벨을 강제 노출해 자연 폭 계산. 사용처: 메인 탭 바, 서브탭.

### 컨테이너 쿼리
부모 폭 기준 리플로우로, 같은 컴포넌트를 좁은 패널과 넓은 다이얼로그 양쪽에서 재사용한다.
- 예: `LogAttachmentCards.tsx` — `@container` 래퍼 + `grid-cols-1 @[35rem]:grid-cols-3`(35rem 미만 1열).

### 오버레이 컴포넌트
- **Dialog** (`dialog.tsx`): 기본 `DialogContent` = `rounded-2xl`, `w-full max-w-[calc(100%-2rem)]`, `duration-300`. 넓게 띄워야 하면 override(예: `SubmitFieldsDialog`의 `w-[80vw] max-w-[80vw] max-h-[80vh] rounded-3xl`). `DialogFooter`는 `flex-col-reverse sm:flex-row` + `rounded-b-2xl`.
- **Popover** (`popover.tsx`): 기본 `align=center sideOffset=4 collisionPadding=8`, `w-72`, 높이는 `--radix-popover-content-available-height`. 콤보박스에 다수 사용.
- **ScrollArea** (`scroll-area.tsx`): 로그 콘텐츠 패널 공통. 커스텀 스크롤바는 `globals.css`의 `::-webkit-scrollbar`(10px, thumb=border 색, hover 시 muted-foreground/0.5)와 일관.
- **Resizable** (`resizable.tsx`): 분할 레이아웃(주로 log-viewer 비디오+로그 패널).

## 12. 아이콘 & 브랜드

- **일반 UI 아이콘 = lucide-react.** 표준 `h-4 w-4`(인라인), 큰 아이콘 `h-6 w-6`. 색은 semantic(`text-muted-foreground` 등).
- **플랫폼 브랜드 = `@icons-pack/react-simple-icons`**, `Si{Name}` + **`color="default"`**(브랜드 색 유지). 크기는 className.
  - **GitHub·Notion만 `dark:invert`**(어두운 단색 마크). 동적 케이스는 `invertOnDark` 플래그 + `cn(…, invertOnDark && "dark:invert")`(`SubmitFieldsDialog`의 `PLATFORM_TABS`).
- **커스텀 SVG는 simple-icons가 미지원일 때만**. 현재 `src/components/icons/SlackIcon.tsx` 하나(simple-icons v13이 Slack 마크를 브랜드 가이드라인 사유로 삭제). className으로 크기 제어.

## 13. 공용 합성 컴포넌트 (`src/sidepanel/components/`)

레이아웃·반복 UI는 아래 합성 컴포넌트로 표준화한다. 새 폼/섹션은 이들을 조합한다.

| 컴포넌트 | 표준화 대상 |
|---|---|
| `PageShell`/`PageScroll`/`PageFooter` (`Section.tsx`) | 탭 페이지 골격 — Shell=`flex min-h-0 flex-1 flex-col`, Scroll=`min-h-0 flex-1 overflow-y-auto`(내부 스크롤 영역), Footer=`shrink-0 border-t bg-muted/50 p-4`(하단 고정 액션). 전 탭 공용 |
| `Section.tsx` | 섹션 구획 — `<section>` 래퍼에 `border-b`(섹션 간 구분선) + 헤더(title+action) + optional collapsible |
| `FieldRow.tsx` | 라벨+필드 쌍 — `grid gap-1.5`, 라벨 `text-xs text-muted-foreground`, `required` 시 빨간 별 |
| `InlineChip.tsx` | 인라인 텍스트 칩 — `muted`면 dashed/muted, 아니면 `border-primary`. `[box-decoration-break:clone]`로 줄바꿈 대응 |
| `InlineLink.tsx` | 외부 링크 — `target=_blank rel=noopener noreferrer`, `text-blue-600 underline dark:text-blue-400` |
| `LinkifiedText.tsx` | 로그 본문 텍스트 linkify — `tokenizeLogText`로 URL 토큰만 `InlineLink`로 렌더(클릭 시 행 토글 방지 stopPropagation). Console 로그 본문·stack 사용 |
| `ConnectedBadge.tsx` | 연결됨 상태 배지 — CircleCheck + green 톤 |
| `ColorSwatch.tsx` | 색/이미지 미리보기 — 12×12, `rounded-[3px] border`(picker 인스펙터와 시각 통일) |
| `DocTable.tsx` | 표 — `table-fixed`, `rounded-lg border`, 셀/헤더/행 클래스 상수(`docTableCell`/`docTableHead`/`docTableRow`) export |
| `DocSectionBody.tsx` | 이슈 섹션 본문 렌더 — 마크다운(`renderMarkdown`) 또는 orderedList |

### 폼 요소 (shadcn)
`Input`/`Textarea`/`Select`/`Checkbox`/`Switch`/`Label` 모두 shadcn 기본 치수(`Input` h-9, `Checkbox` h-4 w-4, `Switch` h-5 w-8 등). **라벨+필드는 `FieldRow`로 감싸는 것을 기본**으로 한다:
```tsx
<FieldRow label="프로젝트" required>
  <Select …>…</Select>
</FieldRow>
```

## 14. 상태 표현

- **토스트**: `sonner` (`src/components/ui/sonner.tsx`, theme 동기화). `toast.success/error/warning(t(...))`. 스타일은 토큰 기반(`bg-background … rounded-xl`).
- **툴팁**: `tooltip.tsx` (Radix). `TooltipProvider > Tooltip > TooltipTrigger asChild + TooltipContent`. 내용 `bg-primary text-primary-foreground text-xs`.
- **로딩 스피너**: lucide `Loader2` + `animate-spin`(`h-4 w-4` 또는 `h-3 w-3`). 오버레이는 `absolute inset-0 flex items-center justify-center`.
- **shimmer**: `tailwind.config.js`의 `shimmer` keyframe(`animate-shimmer`, 2s) — 그라데이션을 translateY로 흘리는 효과. 사용처는 **AI 로딩 전체 오버레이**(`App.tsx`, `absolute inset-0`, styling=teal / draft=purple 틴트).
- **빈 상태(empty state)** 관용형:
  ```tsx
  <div class="flex … items-center justify-center px-4 text-center">
    <div class="mb-3 rounded-full bg-muted p-3"><Inbox class="h-6 w-6 text-muted-foreground"/></div>
    <h3 class="text-lg font-semibold">…</h3>
  </div>
  ```
  콘텐츠 단위 빈 값은 `text-sm text-muted-foreground/70`.
- **인라인 에러**(폼 검증 등)는 `text-xs text-destructive`를 기본으로 한다.
- **로그 행 심각도/종류**: 본문은 중립색(`text-foreground`), 심각도(console level)·종류(action kind)·상태(network)는 **행 배경 틴트 + 좌측 아이콘**으로 신호하고 **URL은 파란 클릭 링크**(`InlineLink`/`LinkifiedText`). 본문 전체를 레벨색으로 칠하지 않는다(Console/Network/Action 통일 — Network가 레퍼런스). 다크 배경 틴트는 거의 검정이라 변별은 좌측 아이콘 색이 사실상 전담.

## 15. className & 변형

- **`cn()`** (`src/lib/utils.ts`) = `twMerge(clsx(...))`. 조건부 클래스 + Tailwind 충돌 해소. shadcn·합성 컴포넌트 **대부분**이 외부 `className`을 받아 `cn("기본…", className)`로 병합한다(일부 단순 컴포넌트는 템플릿 concat — 예 `InlineLink`).
- 변형이 많은 컴포넌트는 **cva**로 variant/size를 정의(button/badge/toggle/label 등 shadcn 표준).

---

## 빠른 체크리스트 (새 UI 만들 때)

1. shadcn 컴포넌트 우선, 없으면 `npx shadcn@latest add`.
2. 색은 semantic 토큰. raw 색은 상태/기능 색에만 + 가능하면 `dark:` 짝.
3. 간격·radius·그림자·z-index는 §5–7의 관용값 먼저 재사용.
4. CTA는 `Button`(기본 h-9). 아이콘 버튼은 `h-8 w-8`(헤더/행) 또는 `h-9 w-9`(필드 부착) + `aria-label`.
5. 스크롤 영역은 `flex min-h-0 flex-1 flex-col` + 내부 overflow. 가로 깨짐은 `min-w-0`.
6. 비활성 탭 콘텐츠 숨김: Radix 영역이면 `TabsContent`에 `data-[state=inactive]:hidden`, App 최상위형이면 수동 `hidden` 토글.
7. 좁은 폭 리플로우는 컨테이너 쿼리(`@container` + `@[…]:`).
8. 새 애니메이션엔 `motion-reduce:` 고려, 포커스가 보이는지 확인.
9. 알림은 `sonner` toast, 외부 className은 `cn()`로 병합.
