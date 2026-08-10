# audit-refactor-5 — 기술 설계

## 개요

**국소 수정 20여 건을 6개 소주제로 묶어 처리한다.** 소주제별로 성격이 다르다 — 접근성(A)과 문서(F)는 서로 독립적이고 순수 추가라 병렬 가능하고, shadcn 이행(B)과 색상 토큰(C)은 **시각 회귀 위험**이 있어 수동 확인이 게이트다. overlay theme(D)만 유일하게 새 데이터 흐름(메시지 필드 추가)을 만들고, i18n 타입 안전(E)은 **타입을 조이는 게 본체고 런타임 폴백은 안전망**이라는 순서가 중요하다.

아키텍처 관점의 공통 원칙: **DESIGN.md의 관용구는 코드를 따라오는 스냅샷이므로, 코드를 관용구에 맞추거나(A~D) 관용구를 실측에 맞추거나(F) 둘 중 하나로 수렴시킨다.** 어느 쪽인지를 항목마다 명시적으로 정한다.

---

## 소주제 A — 접근성 (🟡19·20·21·22·23 + ⚪85)

### 근거 (DESIGN.md)

§10:
> 토글류(`aria-pressed`)도 off의 아이콘은 `foreground`(검정). … ① **약대비** `data-active={active||undefined}` + `aria-pressed` + `cn(..., active && "bg-muted")` … 그 외 텍스트 pill은 `OriginFilterBar`·`NetworkLogContent`

§9:
> **아이콘 전용 버튼**(`size="icon"`)은 텍스트가 없으므로 `aria-label`(또는 `sr-only` 텍스트)을 붙인다 — 안 그러면 스크린리더에서 무명 버튼. … `title`-only는 레거시(`AnnotationToolbar`의 액션부·`IssueRow` 등 — 접근명은 `title`이 대체하나 개선 후보)

§14:
> **진행 중 잠금**: `disabled` 대신 **`aria-disabled` + 핸들러 early-return 가드**를 쓴다 … 스타일은 `aria-disabled:cursor-not-allowed aria-disabled:opacity-50`

§15:
> **`cn()`** (`src/lib/utils.ts`) = `twMerge(clsx(...))`. 조건부 클래스 + Tailwind 충돌 해소.

### 변경 범위

| 파일 | 현재 | 변경 |
|---|---|---|
| `src/sidepanel/components/OriginFilterBar.tsx:27-32` | 템플릿 concat + `data-active`만 | `cn()` 전환 + `aria-pressed={value === k}` |
| `src/sidepanel/components/NetworkLogContent.tsx:634-639` | 동일 | `cn()` 전환 + `aria-pressed={dir === d}` |
| `src/sidepanel/tabs/StyleEditorPanel.tsx:527-529` | 잠금 없음 | `aria-disabled={aiStylingLoading}` + 잠금 클래스 + 핸들러 early-return |
| `src/sidepanel/components/OrderedListEditor.tsx:91-99` | `title`만 | `aria-label={t("common.delete")}` 추가(`title` 유지) |
| `src/sidepanel/components/AnnotationOverlay.tsx:664-666` | 라벨 전무 | `aria-label` 추가 |

**🟡21의 잠금 플래그는 이미 존재한다** — `src/store/editor-store.ts:198`의 `aiStylingLoading`(setter `:563`, `App.tsx:122`가 이미 구독해 AI 로딩 오버레이 표면 판정에 쓴다). `StyleEditorPanel`만 구독하지 않고 있었다. 즉 **새 상태를 만들지 않고 기존 store 값을 구독**한다.

```tsx
// StyleEditorPanel.tsx
const aiStylingLoading = useEditorStore((s) => s.aiStylingLoading);
…
<button
  data-testid="ai-styling-trigger"
  className="… aria-disabled:cursor-not-allowed aria-disabled:opacity-50 …"
  aria-disabled={aiStylingLoading}
  onClick={() => {
    if (aiStylingLoading) return;
    (document.activeElement as HTMLElement)?.blur?.();
    setAiDialogOpen(true);
  }}
>
```

**🟡23의 라벨 문구**: 신규 i18n 키 `annotation.textInput`(ko `텍스트 입력` / en `Text input`)을 `src/i18n/namespaces/editor.ts`에 ko/en 동시 추가한다(§CLAUDE.md의 i18n 훅이 자동 검사). **placeholder는 넣지 않는다** — R12대로 캔버스 위 빈 텍스트 박스에 문구가 보이면 도형처럼 읽힌다.

### 형태 유지 주의

`aria-pressed` 추가는 **시각 변화 0이어야 한다.** shadcn `Button` base cva에 `aria-pressed` 셀렉터가 없으므로 부작용이 없다(확인: `src/components/ui/button.tsx`에 `aria-pressed:` variant 없음 — 구현 시 재확인).

---

## 소주제 B — shadcn 이행 (🟡24·25 + ⚪83)

### 근거 (DESIGN.md)

§1:
> UI 컴포넌트는 직접 스타일링하기보다 shadcn/ui를 우선 쓰고, 없으면 `npx shadcn@latest add <component>`로 설치한 뒤 `src/components/ui/`에 위치하는지 확인한다.

§13:
> `SingleLazyCombobox.tsx` / `CcMultiCombobox.tsx` — 플랫폼 필드 콤보박스 … **새 플랫폼 필드는 직접 만들지 말고 이 둘을 조합한다**

### B-1. `LinkToggle` (🟡24) — `StylePropEditors.tsx:186`

현재는 raw `<button>`으로 `h-9 w-9 rounded-md border` + §10 관용구 ②(강대비)를 손복제한다. `aria-pressed`·`aria-label`·`title`은 **이미 있다**(감사 지적은 shadcn 미사용뿐).

**채택: `Button size="icon" variant="outline"` + `cn()` 오버라이드.** `TooltipIconButton`은 쓰지 않는다 — 그건 §13 표대로 `h-8 w-8` 툴바 전용이고, 여기는 인접 `Input`(h-9)에 붙는 컨트롤이라 §10의 "`h-9 w-9`: Input/Textarea 우측에 직접 붙거나, 인접한 h-9 컨트롤과 높이를 맞춰야 할 때"에 해당한다.

```tsx
<Button
  type="button"
  size="icon"
  variant="outline"
  onClick={onToggle}
  aria-pressed={linked}
  aria-label={linked ? t("prop.editIndividual") : t("prop.editTogether")}
  title={linked ? t("prop.editIndividual") : t("prop.editTogether")}
  className={cn(
    "h-9 w-9 shrink-0",
    linked && "border-foreground bg-foreground text-background hover:bg-foreground/80 hover:text-background",
  )}
>
```

**R8 대응**: `variant="outline"` base는 `bg-background hover:bg-accent hover:text-accent-foreground`다. off 상태의 원래 idiom은 `hover:bg-muted`인데 `--accent == --muted`(§2)라 **결과 색이 같다** — off는 base를 그대로 쓴다. on 상태는 `hover:text-background`를 반드시 함께 주지 않으면 base의 `hover:text-accent-foreground`가 이겨 글자가 사라진다(§10 위험 동작 항목이 `variant="outline" className="text-destructive"`에서 지적한 것과 **같은 함정**).

`h-9 w-9`는 `size="icon"` 기본값과 동일하지만 명시적으로 남긴다(§10 표의 두 사이즈 중 어느 쪽인지 코드가 말하게).

### B-2. `ValueCombobox` 트리거 (🟡25) — `ValueCombobox.tsx:203`

형제 `SingleLazyCombobox`·`CcMultiCombobox`는 `Button variant="outline"`을 쓴다. 여기만 raw `<button>`이다.

**채택: `Button variant="outline"` + `cn()`.** 단 **R7의 `min-w-0` 주석 제약을 반드시 이관**한다:

```tsx
<PopoverTrigger asChild>
  <Button
    type="button"
    variant="outline"
    className={cn(
      // min-w-0: grid item(FieldRow/quad 4-col)의 automatic minimum size를 풀어야
      // 안쪽 TokenChip의 truncate가 살아난다 — 없으면 버튼이 트랙을 뚫는다.
      // (Button base cva엔 min-w-0이 없으므로 raw <button> 시절 주석을 그대로 이관한다.)
      "h-9 w-full min-w-0 justify-start px-2 text-sm font-normal",
      compact && "gap-1 px-1.5",
    )}
    title={…}
  >
```

base cva와의 차이를 하나씩 확인한다:
- `justify-center` → **`justify-start`로 덮어야** 한다(원본은 `flex … items-center`만 있고 콘텐츠가 왼쪽 정렬).
- `font-medium` → **`font-normal`로 덮어야** 한다(원본에 font-weight 지정 없음 = 400).
- `rounded-md border` → base가 이미 제공(`variant="outline"`).
- `hover:bg-muted/50` → base는 `hover:bg-accent`. §2대로 `--accent == --muted`라 **투명도만 다르다**(50% vs 100%). 원본 의도(더 옅은 hover)를 지키려면 `hover:bg-muted/50`을 명시적으로 덮는다.
- `focus-visible:ring-2 focus-visible:ring-ring` → base가 이미 제공(`focus-visible:ring-1 ring-ring` — **ring 굵기가 2→1로 줄 수 있으니** 구현 시 `button.tsx`를 읽고 확인. 다르면 `focus-visible:ring-2`를 명시).
- `outline-none` → base가 `focus-visible:outline-none` 제공.
- `shadow-sm` → base `outline`에 있다. **원본엔 없었으므로 시각 변화가 생긴다** — §6 표는 "기본 컨트롤·인풋·outline/secondary 버튼 = `shadow-sm`"이라 오히려 관용구에 맞는 방향이다. 그대로 둔다.

### B-3. 트리 chevron 공용화 (⚪83)

`JsonTreeViewer.tsx:146`과 `DomTreeDialog.tsx:259`의 className이 바이트 동일하다. **먼저 두 차이를 결정한다**(PRD "어긋난 6곳" 6번):

1. **`aria-expanded`**: JsonTreeViewer만 갖는다 → **둘 다 갖는다**(접근성은 더 강한 쪽으로 수렴).
2. **i18n 키**: `common.expand/collapse` vs `dom.expand/collapse` → **호출부가 라벨을 주입**하게 해 둘 다 보존한다(DOM 트리는 "하위 요소 펼치기" 같은 도메인 문구를 유지할 여지가 있고, `dom.*` 키를 지우면 log-viewer 복제 사전 대조[⚪86 참조]와 얽힌다).

신규 파일 `src/sidepanel/components/TreeChevronButton.tsx`:

```tsx
export function TreeChevronButton({
  open, onToggle, label,
}: {
  open: boolean;
  onToggle: (e: React.MouseEvent) => void;
  label: string;
}): JSX.Element;
```

- 위치 근거: `DomTreeDialog`(tabs)와 `JsonTreeViewer`(components) 양쪽이 쓰므로 `components/`. **`sidepanel/tabs`가 아니어야** log-viewer가 `JsonTreeViewer`를 재사용하는 경로가 안 깨진다(CLAUDE.md: store·log-viewer가 `sidepanel/tabs`를 끌어들이면 안 된다).
- 내부는 raw `<button>`을 유지한다. `Button size="icon"`의 최소 크기(h-8/h-9)가 `h-4 w-4` 슬롯에 안 들어가고, 이건 §10이 이미 인정한 예외 계열이다("입력 필드 안에 얹히는 클리어 어포던스 … `Button`의 최소 사이즈가 필드 안에 안 들어가 결국 직접 스타일링이 되고").

**`DomTreeDialog.tsx:70`의 raw 버튼은 손대지 않는다.** 감사가 "`Button variant="ghost"` 대체 가능"이라 했으나, 실제 코드는 `block w-full truncate text-center text-2xl font-semibold`인 **다이얼로그 제목 트리거**다. `Button` base의 `inline-flex`·`h-9`·`px-4`·`text-sm`을 전부 덮어야 해서 이행이 오히려 복잡해진다. 비목표로 뺀다.

---

## 소주제 C — 색상 단일 출처 (🟡26·27·28 + ⚪78·79·80·84)

### 근거 (DESIGN.md)

§2:
> 로그 semantic 색(console 레벨·network 메서드·action 톤): `src/lib/log-colors.ts` **단일 출처**. `TONE_TEXT`(…) + `TONE_BG`(행 배경 틴트 → `bg-<c>-100 dark:bg-<c>-950/50`, `consoleLevelBgClass` 포함)

> 커스텀 raw 색(`text-blue-600` 등)은 semantic 토큰으로 표현 못 하는 **상태/기능 색**에만 쓰고, 가능하면 `dark:` 짝을 함께 둔다.

§6:
> 칩·스와치 등 작은 인라인 요소 | `rounded-sm` / `rounded-[3px]`

### C-1. `TONE_BG`에 강조 단계를 추가한다 (🟡26·27)

**값을 내리지 않는다**(R4). 감사의 지적은 "제3 스케일이 로컬에 있다"이지 "값이 틀렸다"가 아니다. 실제로 `-200`/`-950/70`은 **필요한 단계**다 — 선택 행과 hover 행, 그리고 이미 틴트된 행 안의 코드블럭을 구분하려면 base보다 진해야 한다(§2가 "로그 행 tint는 비교 대상이 페이지 배경이 아니라 이웃 행"이라 인정한 축).

따라서 **단일 출처를 확장**한다. `src/lib/log-colors.ts`:

```ts
// base 위 한 단계 강조 — 선택 행·행 안 코드블럭처럼 "이미 틴트된 면 위에서 다시 떠야"
// 하는 표면용. 이웃 행(TONE_BG)과 구별되도록 한 스텝 진하다.
export const TONE_BG_STRONG: Record<LogTone, string> = {
  red: "bg-red-200 dark:bg-red-950/70",
  amber: "bg-amber-200 dark:bg-amber-950/70",
  blue: "bg-blue-200 dark:bg-blue-950/70",
  green: "bg-green-200 dark:bg-green-950/70",
  neutral: "bg-muted", // R5: neutral의 강조는 semantic 토큰(TONE_BG.neutral은 빈 문자열)
};

// hover 단계 — base와 strong 사이. NetworkLogContent가 유일 소비처.
export const TONE_BG_HOVER: Record<LogTone, string> = {
  red: "hover:bg-red-200/70 dark:hover:bg-red-950/70",
  …
  neutral: "",
};

export function consoleLevelBgStrongClass(level: string): string {
  return TONE_BG_STRONG[CONSOLE_LEVEL_TONE[level] ?? "neutral"];
}
```

**`neutral: "bg-muted"`가 이 설계의 핵심 판단이다**(R5). `TONE_BG.neutral`은 빈 문자열이라 그대로 참조하면 콘솔 log/debug 코드블럭 배경이 **사라진다**. `TONE_BG_STRONG`은 "면이 반드시 있어야 하는 자리"용이므로 neutral도 값을 갖는다. 두 표의 neutral이 비대칭인 이유를 주석으로 남긴다.

소비처 변경:
- `ConsoleLogContent.tsx:38-46` — `levelCodeBg` 함수 삭제, `consoleLevelBgStrongClass(entry.level)` 호출로 교체(:250·:258 두 곳).
- `NetworkLogContent.tsx:50-62` — `rowBg`가 `TONE_BG`/`TONE_BG_HOVER`/`TONE_BG_STRONG` 조합만 참조. `active && !isError && !isPending` 분기의 `bg-accent`/`hover:bg-accent/50`은 **semantic 토큰이라 그대로 둔다**(neutral 행은 log-colors 축이 아니라 shadcn 선택 관용구).

> **결과적으로 시각 변화는 0이다.** 값을 옮기기만 한다. PRD 상단 표의 "한 단계 옅어진다"는 **채택하지 않은 대안**(TONE_BG로 하향)의 결과이므로, 구현 시 PRD 표의 🟡26·27 행을 "시각 변화 없음(값 이동만)"으로 정정한다.

### C-2. amber 표면 통일 (🟡28)

`StyleCssView.tsx:110`의 배너: `border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200`.

§2 등재 amber 관용구는 두 종류다:
- **AI 배너 명도 쌍**: light `bg-<c>-100/80 text-<c>-700` / dark `bg-<c>-950 text-<c>-300`
- **`IntegrationsCta`**: 배경은 위와 같고 글자만 `text-amber-600`/`dark:text-amber-400`

**채택: AI 배너 명도 쌍**(`bg-amber-100/80 text-amber-700` / `dark:bg-amber-950 dark:text-amber-300`). 근거 — `StyleCssView`의 amber는 CTA(클릭 유도)가 아니라 **상태 경고**(`role="status" aria-live="polite"`)라 `IntegrationsCta`의 CTA 문법보다 배너 문법에 가깝고, 다크 배경은 이미 `bg-amber-950`으로 일치한다. `border-amber-300`/`dark:border-amber-800`은 §2가 다루지 않는 축이라 **그대로 유지**한다(경계선은 배너 관용구에 정의가 없다).

§2가 못박은 제약 하나를 지킨다:
> ⚠ **다크 배너 배경에 알파를 얹지 말 것**(`bg-<c>-950/50`이었다가 뺐다).

현재 코드가 이미 `dark:bg-amber-950`(불투명)이라 위반이 아니다 — 유지.

### C-3. AI 배너 그라디언트 (⚪78)

`DraftingPanel.tsx:477`(purple↔indigo)·`StyleEditorPanel.tsx:534`(teal↔cyan)의 그라디언트에 §2 미등재 색(indigo·cyan)이 섞여 있다.

**채택: 코드를 안 고치고 DESIGN.md §2에 등재한다.** 근거 — 그라디언트의 두 번째 정지점은 **기능색이 아니라 시각 효과**이고, 단색으로 내리면 배너 글자가 평평해져 의도한 "AI 표면" 인상이 약해진다(§2가 AI 액센트를 "4개 슬롯을 관통하는 기능 색"으로 정의한 것과 층위가 다르다). 대신 §2의 AI 액센트 항목에 **"배너 텍스트 그라디언트는 액센트색 → 인접 색상(purple→indigo / teal→cyan)"** 한 줄을 추가해 다음 사람이 임의의 색을 넣지 않게 한다. → 소주제 F.

### C-4. 나머지 (⚪79·80·84)

| 항목 | 판정 | 근거 |
|---|---|---|
| ⚪79 `SubmitSuccessView:19` green / `TiptapEditor:836` sky / `NetworkLogContent:351` blue / `IssueTab:627` red | **코드 유지 + DESIGN.md 등재**(→F) | 넷 다 `dark:` 짝이 **이미 있다**(실측 확인). §2 요구("가능하면 `dark:` 짝을 함께 둔다")를 만족하므로 결함이 아니라 **문서 누락**이다. |
| ⚪80 `NetworkLogContent:502` 상태 dot | **코드 수정** | `bg-amber-500`/`bg-red-500`/`bg-green-500`에 `dark:` 짝이 없는 **유일한** 케이스. `dark:bg-<c>-400`을 추가한다(§2의 `TONE_TEXT` 원리 — "흰 배경엔 진한, 검은 배경엔 밝은"). |
| ⚪84 `rounded-[4px]` 2곳 | **코드 수정** | `HighlightedText.tsx:18`·`ChannelIcon.tsx:16`. §6 등재값은 `rounded-sm`/`rounded-[3px]`. `--radius: 0.75rem` 기준 `rounded-sm` = 12−4 = **8px**이라 4px과 차이가 크므로 → **`rounded-[3px]`**로 통일한다(1px 차, 시각 무영향). |

---

## 소주제 D — content script overlay (🟡29·30 + ⚪88·89)

### 근거 (DESIGN.md)

§3:
> 토글 로직: `src/sidepanel/hooks/useThemeEffect.ts`. theme(`light`|`dark`|`system`)을 `useSettingsUiStore`에서 읽어 `classList.toggle("dark", …)`, `system`이면 `matchMedia("(prefers-color-scheme: dark)")` 변화를 구독.

§2:
> **토큰 표는 세 벌이다** — `src/styles/globals.css`(사이드패널), `src/log-viewer/styles.css`(…), `src/content/overlay.ts`(picker 인스펙터 카드 — 페이지에 주입되는 Shadow DOM이라 CSS 변수를 못 받고 `hsl()` 리터럴로 복제). **한쪽만 고치면 사이드패널·첨부 logs.html·페이지 오버레이가 서로 다른 톤으로 갈린다.**

§2가 "세 표가 갈리면 안 된다"고 못박았는데, 세 번째 표는 **다른 신호원(OS)** 을 따라 켜진다. 값은 같은데 **켜지는 조건이 다르다** — 그래서 OS 다크 + 앱 라이트 조합에서 사이드패널은 흰데 페이지 카드만 검다.

### D-1. theme 전달 (🟡29) — **이 배치에 포함한다**

포함 판정 근거: 변경 표면이 6파일·순수 추가이고, 새 권한·새 저장소·새 라이프사이클이 없다. 유일한 위험(R1: `tokens.test.ts` 파서)이 **명확히 특정돼** 있어 통제 가능하다.

**메시지 확장** — `src/types/picker.ts:102`:

```ts
// theme: 사이드패널이 해석한 최종 다크 여부(useSettingsUiStore.theme + system 시 matchMedia).
// content script는 사이드패널 store를 못 읽고, OS 설정만 보면 앱 설정(기본 light)과 갈린다.
// 미전달(구버전 content script·재전송 누락)이면 라이트가 기본이므로 undefined 안전.
| { type: "picker.start"; frameToken?: string; theme?: "light" | "dark" }
```

**판정 헬퍼 승격** — 신규 `src/sidepanel/lib/resolveDark.ts`:

```ts
import type { ThemeMode } from "@/store/settings-ui-store"; // 실제 타입명 확인 필요

export function resolveDark(theme: ThemeMode, prefersDark: boolean): boolean {
  return theme === "dark" || (theme === "system" && prefersDark);
}
```

`useThemeEffect.ts`의 인라인 판정도 이 함수를 쓰게 바꾼다 — **판정이 두 곳으로 갈리면 사이드패널과 페이지 카드가 다시 어긋난다.** `sidepanel/lib/`에 두는 근거는 CLAUDE.md의 "store가 필요로 하는 순수 로직은 `sidepanel/lib/`으로 승격" 규칙과 같은 계열(순수 함수 + 유닛 테스트 대상).

**송신부 3곳** — `src/sidepanel/picker-control.ts`:

| 위치 | 맥락 |
|---|---|
| `:227` | 요소 선택 picker 시작 |
| `:297` | 커밋된 iframe에 재전송(R3 — 여기를 빠뜨리면 iframe 카드만 갈린다) |
| `:633` | element shot 시작 |

세 곳이 같은 값을 쓰도록 모듈 로컬 헬퍼를 하나 둔다:

```ts
function currentTheme(): "light" | "dark" {
  const dark = resolveDark(
    useSettingsUiStore.getState().theme,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  return dark ? "dark" : "light";
}
```

**수신부** — `src/content/picker.ts:213`:

```ts
case "picker.start":
  handleStart(msg.frameToken, msg.theme);
  break;
```

`handleStart`가 overlay handle에 theme을 넘겨 **shadow host(또는 `labelEl`)에 `data-theme` 속성**을 세팅한다. 인스펙터 카드가 `labelEl` 하나이므로 `labelEl.dataset.theme = theme ?? "light"`이 가장 국소적이다.

**CSS 전환** — `src/content/overlay.ts:201-206`:

```css
/* before */
@media (prefers-color-scheme: dark) {
  .picker-label[data-mode="inspector"] { --popover: hsl(0 0% 3.9%); … }
}

/* after — 앱 theme 설정을 따른다(OS 설정이 아니라). §3·DESIGN.md */
.picker-label[data-theme="dark"][data-mode="inspector"] { --popover: hsl(0 0% 3.9%); … }
```

라이트는 기본 블록(`:119`)에 그대로 남으므로 **`data-theme` 미설정 = 라이트**가 되어 R2를 만족한다.

**`tokens.test.ts` 동반 수정 (R1 — 필수)** — `src/styles/__tests__/tokens.test.ts:15-26`의 `parseOverlayTokens`가 `"@media (prefers-color-scheme: dark)"` 문자열로 영역을 가른다. 새 앵커로 바꾼다:

```ts
const DARK_ANCHOR = '.picker-label[data-theme="dark"][data-mode="inspector"]';
const darkStart = src.indexOf(DARK_ANCHOR);
if (darkStart === -1) throw new Error("overlay.ts에 다크 인스펙터 블록이 없다");
```

라이트 영역 추출(`region.indexOf('.picker-label[data-mode="inspector"]')`)은 `darkStart` 이전 슬라이스에서 하므로 **그대로 동작**한다(다크 셀렉터가 `[data-theme="dark"]`를 앞에 달아 라이트 앵커 문자열과 접두가 다르다 — 오탐 없음). 이 그물이 살아있음을 R1대로 한 번 증명한다.

### D-2. gap 채움색 (🟡30)

실측 대조:

| 축 | 채움(SVG fill) | 라벨(text fill) | 계열 일치 |
|---|---|---|---|
| margin | `rgba(246, 178, 107, 0.35)` (:352) | `#b45309` (amber-700, :215) | 주황 ↔ amber — OK |
| padding | `rgba(147, 196, 125, 0.4)` (:359) | `#15803d` (green-700, :216) | 초록 ↔ green — OK |
| gap | `rgba(236, 72, 153, 0.3)` (:366) | `#7c3aed` (violet-600, :217) | **분홍 ↔ violet — 불일치** |

**채택: 채움을 라벨에 맞춘다**(violet 계열). 라벨 색이 §2에 준하는 "의미색"이고 채움은 그 영역의 반투명 표시이므로, 의미를 정한 쪽을 기준으로 삼는다. `violet-500` = `#8b5cf6` → `rgba(139, 92, 246, 0.3)`. 알파는 기존 0.3 유지.

> 확인 필요: DevTools의 box-model 관용색과 다르다는 반론이 가능하다(Chrome DevTools도 gap을 보라 계열로 칠한다 — 오히려 일치 방향). 구현 시 실제 페이지에서 flex/grid gap이 있는 요소를 hover해 라벨과 채움이 같은 계열로 읽히는지 눈으로 확정한다.

### D-3. 죽은 CSS 훅 (⚪88)

`overlay.ts:704-706`이 `<span class="pl-tag">`·`<span class="pl-class">`를 렌더하는데 `OVERLAY_CSS`에 두 셀렉터가 **없다**(실측: CSS에 정의된 `pl-*`은 `pl-selector`·`pl-selector-text`·`pl-selector-size`·`pl-extra`·`pl-row`·`pl-key`·`pl-val`·`pl-text`·`pl-swatch` 9종).

**채택: 클래스 속성을 제거하지 않고 유지한다.** 근거 — 이건 "죽은 코드"라기보다 **구조 마크업**이고, 지우면 `selectorHtml`이 `<span>` 없는 평문이 되어 나중에 태그/클래스를 색으로 구분하고 싶을 때 훅이 사라진다. 대신 **주석 한 줄**로 의도를 남긴다(`// 현재 스타일 규칙 없음 — 태그/클래스 구분 훅으로 유지`). 코드 삭제보다 정보 추가가 외과적이다.

> **대안**: 정말 제거하려면 `escapeHtml(info.tag)` 직접 연결로 span 2종을 없앨 수 있다. 스코프 밖으로 두고 audit-refactor-6(데드 코드)에 넘길 수도 있다 — 구현 시 사용자 판단.

### D-4. 폰트 스택 (⚪89)

실측 5벌: `:75`(banner 12px)·`:116`(11px)·`:132`(14px)·`:211`(box-label 10px)·`:235`(11px). 전부 `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.

**채택: 코드 유지 + DESIGN.md §4 등재.** Shadow DOM `all: initial`이라 `font-sans` 토큰을 못 받는 게 원인이고, §2가 이미 overlay를 "불가피한 사본"으로 인정했다. 5벌을 CSS 변수(`--overlay-font-stack`)로 묶는 건 가능하지만 **`:host { all: initial }` 안에서 변수를 선언·참조하는 게 브라우저마다 다르게 동작할 여지**가 있어 유닛으로 못 고정한다(§2의 "브라우저 실동작이라 유닛으로 못 고정" 계열). 이득 대비 위험이 커서 문서화만 한다. → 소주제 F.

---

## 소주제 E — i18n 타입 안전 (🟡32·33·34 + ⚪60·72·86·87·91)

### E-1. 항목 32 결론 — **폴백은 넣되, 그게 그물이 아니다**

먼저 현재 타입이 무엇을 막는지 확정했다:

- `src/i18n/ko.ts:21`: `export type TranslationKey = keyof typeof ko;` — 875개 키의 **닫힌 union**.
- `src/i18n/index.ts:33-38`: `t(key: TranslationKey, params?)`.

즉 **정상 호출부에서 미정의 키는 원천적으로 불가능하다.** 런타임 실패는 오직 두 escape hatch에서만 나온다:

1. `as Parameters<typeof t>[0]` 캐스트 — `LinearStatusBadge.tsx:31`·`LinearSubmittedBadge.tsx:85`(🟡33)
2. `as TranslationKey` 캐스트 — `settings-ui-store.ts:80,83,86,89`(⚪60)

**결론: 실패 모드 선택보다 escape hatch 제거가 먼저다.** 폴백만 넣으면 미정의 키가 **무음으로 키 문자열을 렌더**해 오히려 발견이 늦어진다(감사 지적대로). 캐스트를 없애면 키 리네임이 `pnpm typecheck`에서 즉시 잡히고, 폴백은 그때부터 **"이론상 도달 불가한 자리의 안전망"** 역할만 한다.

**채택 형태 — DEV는 시끄럽게, 프로덕션은 조용히 안전하게:**

```ts
function lookup(locale: LocaleMode, key: TranslationKey): string {
  const text = locales[locale][key];
  if (text === undefined) {
    // 타입상 도달 불가(TranslationKey는 닫힌 union). 여기 오면 캐스트가 뚫렸다는 뜻이라
    // 개발 중엔 콘솔로 알리고, 프로덕션에선 undefined 렌더/TypeError 대신 키를 노출한다.
    if (import.meta.env.DEV) console.error(`[i18n] missing key: ${key}`);
    return key;
  }
  return text;
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return interpolate(lookup(currentLocale, key), params);
}
// useT()의 클로저도 같은 lookup을 쓴다 — 두 경로가 갈리면 훅 경유만 폴백이 없다.
```

**`throw`를 쓰지 않는 이유**: 개발 중에 드물게 도달하는 분기 하나가 화면 전체를 흰 화면으로 만든다. `console.error`로 충분히 시끄럽고, 진짜 게이트는 tsc다. **복제 사전(`log-viewer/i18n.ts:282`)의 `return key`와 동작이 같아져** 두 사전의 실패 모드도 수렴한다(감사가 지적한 비대칭 해소).

**`import.meta.env.DEV` 가용성 확인 필요**: `src/i18n/index.ts`는 사이드패널·background 양쪽 번들에 들어간다. Vite가 두 진입 모두에서 `import.meta.env`를 치환하는지 구현 시 확인하고, 안 되면 조건 없이 `console.error`로 단순화한다(프로덕션 콘솔 노이즈는 도달 불가 자리라 무해).

### E-2. 캐스트 제거 (🟡33·⚪60)

**🟡33** — `src/sidepanel/tabs/statusBadges/constants.ts:41`:

```ts
import type { TranslationKey } from "@/i18n/ko"; // type-only

export const LINEAR_STATE_I18N: Record<string, TranslationKey> = {
  backlog: "issueList.linear.backlog",
  …
};
```

소비처 2곳(`LinearStatusBadge.tsx:31`·`LinearSubmittedBadge.tsx:85`)에서 `as Parameters<typeof t>[0]`를 삭제한다. `Record<string, …>`(열린 키)는 유지 — Linear API의 `state.type`이 열린 집합이라 `undefined` 가능성이 실재하고, 두 소비처가 이미 `| undefined`로 받아 처리한다.

**⚪60** — `src/store/settings-ui-store.ts:80-90`: `as TranslationKey`를 **그냥 지운다.**

```ts
export function sectionLabelKey(id: IssueSectionId): TranslationKey {
  return `section.${id}`;   // 캐스트 없음
}
```

TS는 반환 위치의 컨텍스트 타입으로 템플릿 리터럴 표현식을 `` `section.${IssueSectionId}` `` 템플릿 리터럴 타입으로 추론하고, 이를 `TranslationKey` union과 대조한다. **id union의 모든 멤버에 대응 키가 있어야 통과**한다 — 그게 목적이다. 4개 헬퍼 모두 동일(`md.section.${id}` / `draft.${id}Placeholder` / `section.${id}.help`).

**R9 대응**: 캐스트를 지우면 지금까지 가려져 있던 누락이 typecheck red로 나올 수 있다. 그때 판단 규칙:
- 실제로 UI에 렌더되는 조합이면 → **키를 ko/en 양쪽에 추가**한다.
- 렌더되지 않는 조합(예: 특정 섹션에 help가 없음)이면 → **id 파라미터 타입을 좁힌다**(`TextSectionId` 하위 union 신설). 캐스트를 되살리지 않는다.

### E-3. drift 그물 (🟡34)

`src/log-viewer/__tests__/i18n.test.ts:169`:

```ts
// before
const MAIN_NAMESPACES = [logs, editor];
// after
const MAIN_NAMESPACES = [logs, editor, common];
```

복제 사전이 실제로 갖는 `common.*` 3키(`common.expand`·`common.collapse`·`common.clearSearch` — `log-viewer/i18n.ts:274-276` 실측)가 대조 범위에 들어온다. **R10대로 값 불일치가 이미 있으면 먼저 값을 맞춘 뒤 테스트를 확장**한다(테스트가 red인 채로 커밋하지 않는다).

> 더 근본적인 대안(namespace를 하드코딩하지 않고 메인 dict 전체와 대조)은 **채택하지 않는다** — `logViewer.*` 38키처럼 log-viewer 전용 키가 메인에 없는 게 정상이라, 전체 대조는 "메인에 있는 키만 값 비교"라는 현재 로직과 결과가 같으면서 import만 늘린다. `MAIN_NAMESPACES` 배열을 유지하되 **주석에 "복제 사전에 키를 추가하면 그 namespace를 여기 등록"을 명시**해 다음 사람이 같은 구멍을 안 만들게 한다.

### E-4. dead 키 (⚪86) — **⚪34와 함께 설계**

두 그룹의 성격이 다르다.

| 그룹 | 실측 | 판정 |
|---|---|---|
| `networkLog.dialog.title` · `consoleLog.dialog.title` · `actionLog.dialog.title` (ko/en 6줄) | 코드 참조 **0**(`grep` 확인, i18n 파일 자신 제외) | **삭제** |
| `actionLog.role.*` 7키 (ko/en 14줄) | 메인 dict 경로 참조 0. 실소비는 `log-viewer/markers.ts:108`의 복제 사전 | **유지** |

`actionLog.role.*`을 지우면 안 되는 이유가 E-3과 맞물린다: `MAIN_NAMESPACES`에 `logs`가 있으므로 이 7키는 **복제 사전 값의 대조 원본**이다. 메인에서 지우면 대조 상대가 사라져 log-viewer 쪽 값이 아무렇게나 drift해도 그물에 안 걸린다. **주석으로 역할을 명시**한다:

```ts
// actionLog.role.*: 메인 dict 소비처는 없다(실소비는 log-viewer/markers.ts의 복제 사전).
// drift 테스트(log-viewer/__tests__/i18n.test.ts)의 대조 원본이므로 지우지 말 것.
```

`*.dialog.title` 3키 삭제 시 확인: 복제 사전에도 같은 키가 있으면 대조 상대가 사라지므로 **함께 확인**한다(현재 `log-viewer/i18n.ts`에 있는지 구현 시 grep).

### E-5. 열린 집합 role (⚪91)

`src/log-viewer/markers.ts:106-109`:

```ts
const roleKey = e.role ? `actionLog.role.${e.role}` : "";
const rw = roleKey ? t(roleKey) : "";
const target = rw && rw !== roleKey ? `"${name}" ${rw}` : `"${name}"`;
```

`rw !== roleKey` 가드가 있으므로 **미등재 role은 단어를 무음 생략**한다(raw 키 노출은 안 됨). 즉 이미 안전하고, 남는 건 "생략된다는 사실을 아무도 모른다"는 점.

**채택: 코드 유지 + 주석.** 근거 — role은 DOM `role` 속성이라 진짜 열린 집합이고(ARIA role 100+종), 전량 등재는 사전만 부풀린다. 등재된 7개(button/link/checkbox/radio/tab/menuitem/textbox)가 액션 로거가 실제로 기록하는 주요 role인지 **`src/content/action-recorder.ts`(경로 확인 필요)의 role 추출 로직을 읽고 대조**해, 기록되는데 등재 안 된 role이 있으면 그것만 추가한다.

### E-6. 빈 값 문구 (⚪72)

3표면의 현재 값:

| 표면 | 키 | ko | en |
|---|---|---|---|
| 프리뷰(`PreviewPanel:396` → `IssuePreviewView`) | `common.empty` | `비어 있음` | `Empty` |
| log-viewer Report 탭(`App.tsx:204` → 같은 `IssuePreviewView`) | `logViewer.report.empty` | `비어 있음` | `Empty` |
| 제출 본문(8개 빌더) | `md.noValue` | `(없음)` | `(none)` |

**채택: 갈린 채로 둔다 — 코드 변경 없이 DESIGN.md에 근거를 남긴다.**

근거: 두 문구는 **독자가 다르다.** `common.empty`(`비어 있음`)는 사이드패널 UI 안에서 사용자에게 "여기가 비었다"고 알리는 **상태 표시**이고 `text-muted-foreground/70`으로 렌더된다(§14 "콘텐츠 단위 빈 값" 관용구). `md.noValue`(`(없음)`)는 **이슈 트래커로 나가는 본문 텍스트**라 괄호로 감싼 플레이스홀더 관용을 따른다 — Jira/GitHub 이슈에 "비어 있음"이라는 문장이 단독으로 들어가면 사람이 쓴 내용처럼 읽힌다.

정말로 통일하려면 프리뷰가 **제출 결과를 미리 보여주는 화면**이라는 점에서 `md.noValue` 쪽이 맞다는 반론이 성립한다. 그러나 그러면 `DocSectionBody.tsx:31,44`·`DraftDetailDialog.tsx:904`(편집 화면)까지 `common.empty`가 남아 **같은 사이드패널 안에서 두 문구가 공존**한다 — 지금보다 나빠진다. → **비목표로 격하하고 DESIGN.md §14에 두 문구의 경계를 명문화**한다(→F).

### E-7. namespace 잡동사니 (⚪87)

PRD "어긋난 6곳" 5번대로 실측치를 확정했다: 총 키 **875**, top-level prefix **52**, 리프이자 prefix인 키 **34**, `logViewer.*` 소유권 2/38 분산, `viewerLogin`/`viewerUsername`/`viewerName` 3이명(github·linear가 `viewerLogin`, gitlab이 `viewerUsername`, asana·clickup·slack이 `viewerName`), `annotation.thickness.S/M/L`만 대문자 리프.

**채택: 재편하지 않는다**(PRD 비목표). 다만 두 가지는 **저비용으로 정리 가능**하므로 구현 시 판단한다:

- `viewer*` 3이명 — 각 플랫폼 API의 실제 필드명(`login`/`username`/`name`)을 따른 것이므로 **의도된 발산**일 가능성이 높다. 값이 ko/en 모두 `사용자`/`User`로 동일하니 **`platform.viewer` 단일 키로 수렴** 가능. 단 6개 플랫폼 폼을 건드려야 하므로 audit-refactor-6 소관.
- `annotation.thickness.S/M/L` 대문자 — `presets.ts:12`의 `ThicknessKey = "S" | "M" | "L"`가 **키 그 자체**라 소문자로 바꾸면 코드에서 `.toLowerCase()`가 필요해진다. **유지**가 맞다.

---

## 소주제 F — DESIGN.md 문서 갱신 (⚪92 + 79·89 + C-3·E-6 결론)

**코드가 아니라 문서를 실측에 맞춘다.** 갱신 대상과 정확한 내용:

| 절 | 현재 문구 | 갱신 |
|---|---|---|
| §2 raw 색 사용처 | 등재 8종 | **+4종 추가** — 제출 완료 아이콘 green(`SubmitSuccessView.tsx`), Tiptap 드래그오버 sky(`TiptapEditor.tsx`), 로그 패널 리사이저 hover blue(`NetworkLogContent.tsx`), 녹화 중 화면 red(`IssueTab.tsx`). 넷 다 `dark:` 짝 보유 명시. |
| §2 AI 액센트 항목 | 배너 명도 쌍만 규정 | **+1줄** — "배너 텍스트는 액센트색 → 인접 색 그라디언트(purple→indigo / teal→cyan). 임의 색을 추가하지 않는다." (C-3) |
| §2 세 표 항목 | "`src/content/overlay.ts`(picker 인스펙터 카드 …)" | **켜지는 조건**을 추가 — "다크 전환은 OS가 아니라 `picker.start`로 전달된 앱 theme(`data-theme` 속성)을 따른다"(D-1). `tokens.test.ts`의 파싱 앵커가 그 셀렉터임도 명시. |
| §4 타이포그래피 | overlay 폰트 스택 언급 없음 | **+1줄** — "content script 오버레이(`overlay.ts`)는 Shadow DOM `all: initial`이라 `font-sans` 토큰을 못 받아 시스템 sans 스택을 5벌 하드코딩한다(banner/label/box-label). 불가피한 사본." (⚪89) |
| §9 title-only 레거시 목록 | "`AnnotationToolbar`의 액션부·`IssueRow` 등" | 목록 자체를 **정리**한다 — 이번에 `OrderedListEditor`가 `aria-label`을 갖게 되므로(A) 그 사례는 목록에 넣지 않는다. 목록이 실측과 맞는지 구현 시 `grep -rn 'size="icon"' src/`로 재확인하고, 남은 title-only만 남긴다. |
| §13 FieldRow 행 | "동일 마크업을 raw `div.flex flex-col gap-1.5` + `<label>`로 42곳 반복" | **"동일 마크업 42곳(그중 `<label>` 동반 필드 쌍 34곳)"** — 두 수치가 세는 대상이 다름을 명시(PRD "어긋난 6곳" 4번). |
| §14 진행 중 잠금 | "잠금 클래스 상수(`lockedClass`/`LOCK_CLASS`)가 `IssueTab`·`DraftingPanel`·`annotation/ZoomControl` **3곳에 복제**" | **"명명 상수 3곳 + 인라인 리터럴 7곳(`IssueTab.tsx:375,422,505`·`tabs/ReplayTrimDialog.tsx:394,407`·`tabs/styleEditor/StyleChangesDialog.tsx:310`·`DraftingPanel.tsx:471`) + `opacity-50` 없는 축약형 19곳"** — 경로 2건 정정 포함. |
| §14 빈 상태 | "콘텐츠 단위 빈 값은 `text-sm text-muted-foreground/70`" | **+1줄** — "문구는 표면에 따라 갈린다: 사이드패널 UI 안은 `common.empty`(`비어 있음`), 이슈 트래커로 나가는 본문은 `md.noValue`(`(없음)`). 통일하지 않는다 — 독자가 다르다." (E-6) |
| §10 토글 관용구 ① | 선례로 `OriginFilterBar`·`NetworkLogContent` 지목 | 변경 불필요(A에서 코드가 문서를 따라온다). |

**주의**: DESIGN.md 갱신은 `docs(DESIGN): …` **별도 커밋**으로 묶는다(CLAUDE.md 문서 신선도 규칙).

---

## 데이터 흐름

새로 생기는 흐름은 D-1 하나뿐이다.

```
[사이드패널]                                   [content script (all frames)]
useSettingsUiStore.theme ("light"|"dark"|"system")
        │
        ├─ matchMedia("(prefers-color-scheme: dark)").matches
        ▼
resolveDark(theme, prefersDark) : boolean        (sidepanel/lib/resolveDark.ts — 신규)
        │                                         ※ useThemeEffect도 같은 함수를 쓴다
        ▼
picker-control.ts  currentTheme() → "light"|"dark"
        │
        ├─ :227  chrome.tabs.sendMessage({type:"picker.start", frameToken, theme})
        ├─ :297  (iframe 재전송) 같은 메시지 ─────────────►  picker.ts:213 handleStart(frameToken, theme)
        └─ :633  (element shot) 같은 메시지                        │
                                                                   ▼
                                              overlay handle: labelEl.dataset.theme = theme ?? "light"
                                                                   │
                                                                   ▼
                                    OVERLAY_CSS: .picker-label[data-theme="dark"][data-mode="inspector"]
                                                 → --popover / --popover-foreground / --muted-foreground / --border
```

나머지 소주제는 **렌더 시점의 클래스 문자열 계산**만 바뀌므로 새 상태·메시지·스토리지가 없다.

---

## 인터페이스 설계

```ts
// src/types/picker.ts (변경)
| { type: "picker.start"; frameToken?: string; theme?: "light" | "dark" }

// src/sidepanel/lib/resolveDark.ts (신규)
export function resolveDark(theme: ThemeMode, prefersDark: boolean): boolean;

// src/lib/log-colors.ts (추가)
export const TONE_BG_STRONG: Record<LogTone, string>;
export const TONE_BG_HOVER: Record<LogTone, string>;
export function consoleLevelBgStrongClass(level: string): string;

// src/sidepanel/components/TreeChevronButton.tsx (신규)
export function TreeChevronButton(props: {
  open: boolean;
  onToggle: (e: React.MouseEvent) => void;
  label: string;
}): JSX.Element;

// src/sidepanel/tabs/statusBadges/constants.ts (타입 강화)
export const LINEAR_STATE_I18N: Record<string, TranslationKey>;

// src/store/settings-ui-store.ts (캐스트 제거 — 시그니처 불변)
export function sectionLabelKey(id: IssueSectionId): TranslationKey;
export function sectionMdLabelKey(id: IssueSectionId): TranslationKey;
export function sectionPlaceholderKey(id: TextSectionId): TranslationKey;
export function sectionHelpKey(id: TextSectionId): TranslationKey;

// src/content/picker.ts (내부 시그니처)
function handleStart(frameToken?: string, theme?: "light" | "dark"): void;
```

신규 i18n 키(ko/en 동시):

```ts
// src/i18n/namespaces/editor.ts
"annotation.textInput": "텍스트 입력" / "Text input"
```

---

## 기존 패턴 준수

- **i18n ko/en 동시 갱신** — CLAUDE.md: `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`(키 대칭·빈 값·placeholder 토큰 일치)를 자동 실행해 불일치를 차단한다. 신규 키 `annotation.textInput`은 ko/en 양쪽에 넣는다.
- **사전은 두 벌** — CLAUDE.md: log-viewer는 `src/log-viewer/i18n.ts`에 복제 사전을 따로 둔다. 훅 matcher(`*src/i18n/*`)에 안 걸리고 `pnpm test`가 잡는다. E-3·E-4가 이 규칙의 그물 자체를 손대는 작업이다.
- **`sidepanel/tabs` 격리** — CLAUDE.md: store·log-viewer가 `sidepanel/tabs`를 import하면 안 된다. `TreeChevronButton`을 `components/`에 두는 근거(B-3), `resolveDark`를 `sidepanel/lib/`에 두는 근거(D-1)가 여기서 온다.
- **`cn()` 사용** — DESIGN §15. A의 pill 2종을 템플릿 concat에서 전환.
- **테스트 2트랙** — CLAUDE.md: `*.test.ts`(node, 순수 함수) / `*.test.tsx`(jsdom + @testing-library/react). aria 속성 존재는 후자로 고정 가능하고, 색상 대비·오버레이 렌더는 **jsdom으로도 못 잡는다**("포인터 드래그·캔버스처럼 브라우저 실동작에 걸린 것" 계열).
- **`chrome.scripting.executeScript({func})` 제약과 무관** — D-1은 `chrome.tabs.sendMessage` 경로라 직렬화 제약이 다르다(메시지는 구조화 복제, 클로저 문제 없음).

---

## 대안 검토

### 대안 1 — 🟡26·27을 `TONE_BG`로 **하향** 통일 (기각)

감사 문구를 문자 그대로 따르면 `bg-red-200 dark:bg-red-950/70`을 전부 `TONE_BG.red`(=`bg-red-100 dark:bg-red-950/50`)로 바꾸는 게 된다.

**기각 근거**: R4대로 **3단계 대비가 2단계로 붕괴**한다. `NetworkLogContent.rowBg`는 기본/hover/선택을 base·`-200/70`·`-200`으로 구분하는데, 선택을 base로 내리면 선택 행과 비선택 행이 같은 색이 된다. 콘솔 코드블럭도 이미 틴트된 행 배경 **위에** 얹히므로 같은 값이면 사라진다. 단일 출처 위반의 본질은 "값이 로컬에 있다"이지 "값이 크다"가 아니므로, **값을 단일 출처로 옮기는** 쪽(C-1)이 문제를 정확히 겨눈다.

### 대안 2 — 🟡29를 content script가 `chrome.storage`를 직접 읽어 해결 (기각)

`useSettingsUiStore`는 Zustand persist(key `bugshot-app-settings`, §3)라 content script도 `chrome.storage.local`로 같은 값을 읽을 수 있다. 메시지 필드를 안 늘려도 된다.

**기각 근거**: ① content script가 앱 설정 스토리지 스키마에 직접 의존하게 되어 결합이 늘어난다(persist 포맷 변경 시 조용히 깨진다). ② `system` 해석을 content script 쪽에서 다시 하게 되어 **판정 로직이 두 벌**이 되고, 그게 정확히 이 버그의 원인 구조다. ③ 모든 프레임(1-depth iframe 포함)이 각자 storage를 읽어야 해 호출이 늘고 비동기가 끼어 카드가 **잘못된 색으로 한 프레임 깜빡**한다. 메시지에 실으면 `picker.start` 도착과 동시에 확정된다.

### 대안 3 — 🟡29를 이번 배치에서 제외 (기각, 조건부)

프롬프트가 허용한 선택지다. **기각 근거**: 변경 표면이 6파일이고 전부 순수 추가(필드 추가·헬퍼 추출·CSS 셀렉터 교체)이며, 최대 위험(R1 `tokens.test.ts` 파서)이 **한 함수·한 문자열**로 특정돼 있다. audit-refactor-6(대)로 미루면 그 배치가 더 커지기만 한다.

**단, 구현 중 다음 중 하나라도 발생하면 이 태스크만 분리해 별도 배치로 뺀다**: ① `parseOverlayTokens` 수정만으로 `tokens.test.ts`가 green이 되지 않는다 ② iframe 재전송 경로(`:297`)에서 theme 전달이 프레임 등록 핸드셰이크(`frame-geometry.ts`)와 얽힌다 ③ `resolveDark` 추출이 `useThemeEffect`의 `matchMedia` 구독 라이프사이클을 건드려야 한다.

### 대안 4 — `t()`에 `throw` 폴백 (기각)

미정의 키를 개발 중 즉시 크래시로 드러내는 가장 시끄러운 형태.

**기각 근거**: E-1대로 **진짜 게이트는 tsc**이고, 캐스트를 제거한 뒤엔 런타임 도달 자체가 이론상 불가능해진다. 그 자리에 throw를 두면 "일어날 리 없는 일"이 일어났을 때 화면 전체를 날리는 대가만 남는다. 게다가 `pnpm test`에서 `import.meta.env.DEV`가 true라 기존 테스트가 미정의 키를 넘기는 순간 전부 red가 된다(복제 사전 테스트가 이미 `t("this.key.does.not.exist" as any)`를 하고 있다 — 별 dict지만 같은 패턴이 메인에 있을 수 있다).

### 대안 5 — ⚪81(statusBadges 7개)을 이번 배치에서 처리 (기각)

**기각 근거**: PRD "어긋난 6곳" 1번 — Radix `PopoverTrigger asChild`가 `aria-haspopup`·`aria-expanded`를 이미 주입하므로 **접근성 결함이 없다**. 남는 건 순수 중복이고, 그건 audit-refactor-6의 주제다. 접근성 배치에서 중복 제거를 하면 배치 경계가 흐려진다.

---

## 위험 요소

### 시각 회귀 (이 배치 고유 위험)

1. **색상 통일이 대비를 낮출 수 있다** — C-1이 `TONE_BG`로 하향하지 않고 `TONE_BG_STRONG`을 신설하는 이유가 이것이다. 그럼에도 리팩터 중 `neutral` 분기(빈 문자열)를 잘못 연결하면 콘솔 log/debug 코드블럭 배경이 **소리 없이 사라진다**(R5). §2가 경고한 "다크에선 사람 눈이 색조를 거의 구분 못 해 배경에 묻힌다"가 그대로 재현된다.
2. **B의 shadcn 이행이 치수를 바꾼다** — `Button` base cva는 `h-9 px-4 text-sm font-medium justify-center shadow-sm`을 깔고, 원본 raw 버튼은 그중 일부만 갖고 있었다. 덮어야 할 항목을 B-1·B-2에 나열했지만 **`button.tsx`를 실제로 읽고 대조**해야 한다(cva 내용이 문서 §10 요약과 다를 수 있다).
3. **§2의 hover 함정** — "`--accent` == `--secondary` == `--muted`가 라이트·다크 모두 같은 값이다. … shadcn `outline` 버튼의 `bg-background → hover:bg-accent`는 `background` 표면 위를 전제한 관용구라, muted 표면으로 옮기면 방향이 뒤집힌다." `LinkToggle`(B-1)의 on 상태가 `bg-foreground`(어두운 면)이므로 base의 `hover:bg-accent`/`hover:text-accent-foreground`가 그대로 적용되면 **on 상태 hover에서 글자가 사라진다**. B-1의 `hover:text-background` 명시가 필수다.
4. **다크에서만 깨지는 조합** — 색 변경 항목(C 전체, D-2)은 라이트에서 멀쩡한 채 다크만 무너지는 게 §2가 기록한 반복 패턴이다. 모든 시각 확인은 **라이트·다크 두 번** 한다.

### 그물 손상

5. **`tokens.test.ts` 하드 실패** (R1) — D-1이 미디어쿼리 문자열을 지우면 `throw new Error("overlay.ts에 다크 미디어쿼리가 없다")`. 파서를 함께 안 고치면 즉시 red라 "조용히 죽는" 유형은 아니지만, **급히 파서를 느슨하게 고쳐 그물이 무력화되는 것**이 진짜 위험이다. 수정 후 R1의 "일부러 틀리게 하면 red" 증명을 반드시 한다.
6. **drift 테스트 확장이 기존 불일치를 드러낸다** (R10) — E-3이 `common`을 추가하는 순간 이미 갈린 값이 있으면 red. 테스트를 먼저 넣지 말고 **값 대조를 수동으로 먼저** 돌린다.
7. **⚪86 삭제의 부수효과** — `actionLog.role.*`을 지우면 drift 대조 원본이 사라진다(E-4). 감사 원문도 이걸 경고했다. 삭제 대상은 `*.dialog.title` 3키뿐이다.

### 타입 게이트

8. **캐스트 제거가 typecheck를 깰 수 있다** (R9) — ⚪60의 4개 헬퍼가 참조하는 키 중 하나라도 없으면 red. 이건 **의도된 red**지만, 급히 `as TranslationKey`를 되살리면 원점이다. E-2의 판단 규칙(키 추가 vs id union 좁히기)을 따른다.
9. **`import.meta.env.DEV` 가용성** — `src/i18n/index.ts`가 background 번들에도 들어가므로 치환 여부를 확인해야 한다(E-1). 안 되면 조건 없는 `console.error`로 단순화.

### 메시지 경로

10. **iframe 재전송 누락** (R3) — `picker.start`를 보내는 3곳 중 `:297`(iframe 재전송)이 가장 잊기 쉽다. 이걸 빠뜨리면 **1-depth iframe 안에서 요소를 고를 때만** 카드 색이 갈린다 — 재현 조건이 좁아 발견이 늦다.
11. **구버전 content script** (R2) — 확장 리로드 없이 열려 있던 탭에서는 `theme` 필드를 모르는 content script가 돈다. `data-theme` 미설정 = 라이트 폴백 구조라 **깨지지 않고 이전 동작(라이트 고정)** 이 되는지 확인.

### 스코프 침식

12. **"어차피 여는 김에" 유혹** — 이 배치는 파일 수가 많고 각 변경이 작아서, 인접 코드를 함께 손대기 쉽다. CLAUDE.md의 **외과적 변경** 원칙대로 감사 항목이 지목한 줄만 건드린다. 특히 `NetworkLogContent.tsx`는 이 배치에서 **4개 항목**(20·27·79·80·85)이 걸리므로 변경 지점을 미리 특정하고 들어간다.
