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
- `focus-visible:ring-2 focus-visible:ring-ring` → base가 이미 **`focus-visible:ring-2 focus-visible:ring-ring`**이다(2026-08-14 실측). ~~ring 굵기가 2→1로 줄 수 있다~~는 우려는 근거가 없었다. **명시 불필요.**
- **`[&_svg]:size-3.5` → override 필요 여부: 하지 않기로 결정(2026-08-14).** base가 `[&_svg]:size-4`(16px)를 깔고, 이건 **자손 셀렉터라 특이도 (0,1,1)**로 아이콘 자기 클래스 `h-3.5 w-3.5`(0,1,0)를 이긴다. twMerge는 다른 엘리먼트라 중재하지 못한다. 즉 `LinkToggle`(`StylePropEditors.tsx:198-202`)과 `ValueCombobox`의 `icon` prop(`:219`) 아이콘이 **14 → 16px로 커진다.** shadcn 기본값을 따르기로 했으므로 override를 넣지 않고, 대신 **prd.md 가시 변화 표에 명시**한다. quad 셀 4개에 동시에 나타나고 셀당 폭 예산을 2px씩 갉아먹는다는 점은 인지하고 수용한다.
- **`gap-0`(또는 의도값) → override 필요.** base가 `gap-2`를 깐다. 현재 raw 버튼은 gap 미지정(0)이고 `compact && "px-1.5 gap-1"`로 compact에만 gap을 준다. 제안 className이 compact만 덮으면 **non-compact 3곳(`StylePropEditors.tsx:231,286,643`)에 base `gap-2`가 그대로 남아** 아이콘↔값 간격이 0 → 8px이 된다.
- `outline-none` → base가 `focus-visible:outline-none` 제공.
- `shadow-sm` → **base가 아니라 `outline` variant(`button.tsx:18`)에 있다**(2026-08-14 정정 — 아래 위험 2의 "base cva가 `shadow-sm`을 깐다"는 서술은 틀렸다). `variant="outline"`을 쓰므로 결과는 같다: **원본엔 없었으므로 시각 변화가 생긴다.** §6 표가 "기본 컨트롤·인풋·outline/secondary 버튼 = `shadow-sm`"이라 관용구에 맞는 방향이므로 그대로 둔다.
- **`variant="outline"` base가 off 상태에 둘을 더 얹는다(2026-08-14 추가).** ① `bg-background` — 현재 off는 배경 투명(`border`만)이라, 얹히는 표면이 `background`가 아닌 자리면 면이 새로 생긴다. ② `hover:text-accent-foreground` — 현재 off hover는 글자색이 안 변하는데(`text-foreground` 유지), `--accent-foreground`(222.2 47.4% 11.2%) ≠ `--foreground`(222.2 84% 4.9%)라 hover 시 글자가 미세하게 옅어진다. §2가 `--accent == --muted`라 **배경**은 같다고 한 것과는 별개 축이다. POSTMORTEM 2026-07-17(`:794`)이 정확히 이 이식에서 터진 건이므로 착수 전 읽는다.

### B-3. 트리 chevron 공용화 (⚪83)

`JsonTreeViewer.tsx:146`과 `DomTreeDialog.tsx:267`의 className이 바이트 동일하다. **먼저 두 차이를 결정한다**(PRD "어긋난 6곳" 6번):

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

**채택(2026-08-14 수정): 배경만 통일하고 글자는 `text-amber-800`을 유지한다** — `bg-amber-100/80 text-amber-800` / `dark:bg-amber-950 dark:text-amber-300`.

> **왜 글자를 안 바꾸나**: 원안(`text-amber-700`)이면 대비가 **6.84:1 → 4.61:1**로 떨어진다. AA(4.5:1)는 통과하지만 여유가 0.11pp뿐이고, 배경을 순수 `bg-amber-100`(등재 관용구)으로 쓰면 **4.51:1**로 사실상 하한이다. DESIGN §2가 "새 raw 색 추가 시 대비를 눈으로라도 확인"을 규칙으로 두는데 이 항목은 색을 **교체**하면서 계산도 확인 항목도 없었다. 배경만 맞춰도 "표면 2종" 문제는 해소된다.

~~원안: `bg-amber-100/80 text-amber-700`~~ 근거 — `StyleCssView`의 amber는 CTA(클릭 유도)가 아니라 **상태 경고**(`role="status" aria-live="polite"`)라 `IntegrationsCta`의 CTA 문법보다 배너 문법에 가깝고, 다크 배경은 이미 `bg-amber-950`으로 일치한다. `border-amber-300`/`dark:border-amber-800`은 §2가 다루지 않는 축이라 **그대로 유지**한다(경계선은 배너 관용구에 정의가 없다).

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
| ⚪84 `rounded-[4px]` 2곳 | **코드 수정 취소 → DESIGN §6에 4px 등재** (2026-08-14) | `HighlightedText.tsx:18`·`ChannelIcon.tsx:16`(실경로 `src/sidepanel/tabs/slackFields/`). ~~`rounded-[3px]`로 통일~~하지 않는다 — 저장소의 유일한 `rounded-[3px]` 선례 `ColorSwatch.tsx:28`은 **주석으로 overlay `.pl-swatch`(`overlay.ts:197`, `border-radius:3px`)와의 cross-file 앵커임을 못박아둔 값**이다. 무관한 두 표면(`<mark>` 하이라이트·16px Slack 아바타)을 같은 값으로 끌어오면 그 앵커의 의미가 희석된다. §6에 4px을 별도 등재하는 쪽이 정직하다. |

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

> **⚠ 2026-08-14 — `handleStart` 인자로만 세팅하면 재생성 경로 2곳을 놓친다.** `createOverlay()` 호출은 **3곳**인데 `picker.start`를 타는 건 `handleStart`(`:601`) 하나뿐이다. `handleSelectByPath`(`:1229` — 패널 재오픈·rebind 복귀)와 area-select(`:1264`)는 overlay를 새로 만들면서 `data-theme`을 잃는다. 후자는 인스펙터 카드를 안 띄워 실피해가 낮지만 전자는 **패널을 닫았다 여는 흔한 경로**다.
>
> **채택: `picker.start`가 실어온 theme을 모듈 로컬 변수에 보관하고 `createOverlay()` 직후 적용한다** — 세 경로가 한 번에 덮인다.
>
> **배치 4와의 분담(2026-08-14 확정).** 배치 4 항목 14(`setOnCacheReloaded` 재등록 + priming)가 같은 `handleSelectByPath` 재생성 블록을 고쳤고 **이미 dev에 들어갔다**. 한때 theme 축까지 배치 4 Task 7로 합쳐 뒀으나, 그 전제(`picker.start`의 `theme` 필드·`resolveDark.ts`·overlay CSS)가 전부 이 배치 산출물이라 거기선 실행 불가였다 — **theme은 이 배치가 단독으로 처리한다.** 배치 4가 복원해 둔 4단 블록은 theme 적용의 착지점이다.

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

**⚠ 2026-08-14 정정 — 이 지시는 불완전했고, 그대로 구현하면 다크 추출이 throw한다.**

파일은 `src/styles/__tests__/tokens.test.ts`다(문서가 적었던 `src/content/__tests__/`가 아니다). 파서는 앵커를 **둘** 쓴다:

```ts
:17  const darkStart = src.indexOf("@media (prefers-color-scheme: dark)");   // ① 영역 분할
:19  const region = scope === "dark" ? src.slice(darkStart) : src.slice(0, darkStart);
:20  const start = region.indexOf('.picker-label[data-mode="inspector"]');    // ② 블록 위치
```

- **라이트는 산다** — `slice(0, darkStart)` 안에 `:119`의 라이트 블록이 그대로 있어 ②가 찾는다. 이 부분에 한해 원안의 "그대로 동작한다"는 맞다.
- **다크는 죽는다** — 다크 블록이 `.picker-label[data-theme="dark"][data-mode="inspector"]`가 되면 ②의 리터럴은 **부분문자열이 아니고**(`[data-theme="dark"]`가 사이에 끼어 연속 매칭이 깨진다), `:202`가 파일의 마지막 occurrence라 뒤에도 없다 → `-1` → `:21` throw.

**따라서 ①·② 두 줄 모두 scope별로 분기해야 한다:**

```ts
const LIGHT_ANCHOR = '.picker-label[data-mode="inspector"]';
const DARK_ANCHOR  = '.picker-label[data-theme="dark"][data-mode="inspector"]';
const start = region.indexOf(scope === "dark" ? DARK_ANCHOR : LIGHT_ANCHOR);
```

**다크 블록이 라이트 블록보다 뒤에 있어야 한다는 것도 파서의 전제**다(앞으로 옮기면 라이트마저 -1). 설계에 못박는다. 이 그물이 살아있음을 R1대로 한 번 증명한다 — 그리고 증명 대상 줄은 `--border`(`:207`)이므로 인용 범위를 `:201-209`로 읽는다(`:201-206`은 그 줄을 자른다).

**아래 §658의 분리 트리거 ①("파서 수정만으로 green이 안 되면 분리")은 이 정정으로 무력화됐다** — 두 줄을 고치면 green이므로 트리거로 쓰지 않는다.

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

### E-0. 전제 — "폴백 금지"는 **로케일 축**의 원칙이고, 항목 32는 **키 축**이다

이 배치가 감사된 뒤 `src/i18n/locales.ts`(로케일 레지스트리 단일 출처)가 신설되면서 **폴백에 대한 명시적 원칙이 코드에 박혔다.** 항목 32를 읽는 다음 사람이 "폴백 금지라 했으니 32는 폐기"로 오독하지 않도록 층위를 먼저 갈라 둔다.

`locales.ts`가 세운 구분은 이렇다.

| 구분 | 형태 | 대상 | 목적 |
|---|---|---|---|
| **폴백 금지 테이블** | `Record<LocaleMode, T>` (`Partial` 금지) | `locales`(`i18n/index.ts:8`) · `BCP47`(`locales.ts:17`) · `LOCALE_AI_PRESET` 등 | 로케일을 추가하면 **컴파일러가 여기를 채우라고 지목**한다. 안 채우면 조회가 `undefined`가 되어 `t()`가 죽거나 **무음으로 영어가 누출**된다. |
| **폴백 허용 테이블** | `LocaleTable<T>` = `Partial<Record<LocaleMode,T>> & Record<typeof DEFAULT_LOCALE, T>` + `localeValue()`(`locales.ts:58-63`) | 프롬프트 섹션 설명(`SECTION_DESC_BASE`·`MODE_HINTS`) 등 | **"영어 스캐폴딩 + `Write in X`"가 설계인 표**에만 쓴다. 여기서의 en 폴백은 결함이 아니라 의도다. |

**항목 32가 다루는 건 이 둘 중 어느 쪽도 아니다.** 폴백 금지/허용은 *"이 로케일의 사전이 통째로 있는가"* 를 가르는 **로케일 축**의 규칙이고, 항목 32는 *"사전은 있는데 그 안에 이 키가 없는가"* 를 다루는 **키 축**이다. `locales`가 폴백 금지 테이블인 덕분에 `locales[currentLocale]`은 항상 존재하지만, `locales[currentLocale][key]`는 캐스트가 뚫린 만큼 `undefined`일 수 있다 — `t()`에 폴백이 없어 그 값이 그대로 `interpolate`에 들어간다(`index.ts:39`).

따라서 두 원칙은 충돌하지 않고 **같은 방향**이다. 로케일 축의 해법이 "타입으로 강제하고 폴백을 금지한다"였듯, 키 축의 해법도 **타입 강제가 본체**(E-2의 캐스트 제거)이고 런타임 `return key`는 도달 불가 자리의 안전망이다. 실제로 `DEFAULT_LOCALE = "en"`(미지 *로케일* 값이 떨어질 곳)과 `return key`(미지 *키* 가 떨어질 곳)는 같은 설계 습관의 두 적용이다 — 어느 쪽도 "조용히 잘못된 문자열"을 만들지 않는다.

> 한 줄 요약: **로케일이 없으면 en으로, 키가 없으면 키 문자열로.** 전자는 사용자에게 읽히는 폴백이라 타입으로 봉하고, 후자는 개발자에게 보이라고 있는 폴백이라 DEV `console.error`를 얹는다.

### E-1. 항목 32 결론 — **폴백은 넣되, 그게 그물이 아니다**

먼저 현재 타입이 무엇을 막는지 확정했다:

- `src/i18n/ko.ts:21`: `export type TranslationKey = keyof typeof ko;` — 875개 키의 **닫힌 union**.
- `src/i18n/index.ts:35-40`: `t(key: TranslationKey, params?)`. 훅 경로 `useT()`는 `:47-51`에 **같은 `interpolate` 호출을 복제**하고 있다(폴백을 넣을 때 두 경로를 함께 고쳐야 하는 이유).

즉 **정상 호출부에서 미정의 키는 원천적으로 불가능하다.** 런타임 실패는 오직 두 escape hatch에서만 나온다:

1. `as Parameters<typeof t>[0]` 캐스트 — `LinearStatusBadge.tsx:31`·`LinearSubmittedBadge.tsx:85`(🟡33)
2. `as TranslationKey` 캐스트 — `settings-ui-store.ts:84,87,90,93`(⚪60)

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

**`throw`를 쓰지 않는 이유**: 개발 중에 드물게 도달하는 분기 하나가 화면 전체를 흰 화면으로 만든다. `console.error`로 충분히 시끄럽고, 진짜 게이트는 tsc다. **복제 사전(`log-viewer/i18n.ts:293`)의 `if (!text) return key;`와 동작이 같아져** 두 사전의 실패 모드도 수렴한다(감사가 지적한 비대칭 해소).

~~**`import.meta.env.DEV` 가용성 확인 필요**~~ — **확인 완료, 조문 삭제(2026-08-14).** `background/analytics.ts:137`이 background 번들에서 이미 실사용 중이고 `src/i18n/index.ts`는 `background/index.ts:1` → `@/i18n` 경로로 SW 번들에 실제로 들어간다. 치환된다.

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

**⚪60** — `src/store/settings-ui-store.ts:83-93`: `as TranslationKey`를 **그냥 지운다.**

```ts
export function sectionLabelKey(id: IssueSectionId): TranslationKey {
  return `section.${id}`;   // 캐스트 없음
}
```

TS는 반환 위치의 컨텍스트 타입으로 템플릿 리터럴 표현식을 `` `section.${IssueSectionId}` `` 템플릿 리터럴 타입으로 추론하고, 이를 `TranslationKey` union과 대조한다. **id union의 모든 멤버에 대응 키가 있어야 통과**한다 — 그게 목적이다. 4개 헬퍼 모두 동일(`md.section.${id}` / `draft.${id}Placeholder` / `section.${id}.help`).

**R9 대응**: 캐스트를 지우면 지금까지 가려져 있던 누락이 typecheck red로 나올 수 있다. 그때 판단 규칙:
- 실제로 UI에 렌더되는 조합이면 → **키를 ko/en 양쪽에 추가**한다.
- 렌더되지 않는 조합(예: 특정 섹션에 help가 없음)이면 → **id 파라미터 타입을 좁힌다**(`TextSectionId` 하위 union 신설). 캐스트를 되살리지 않는다.

### E-3. drift 그물 (🟡34) — **결론이 바뀌었다: `common` 추가가 아니라 열거 자체를 없앤다**

감사 시점의 처방은 "`MAIN_NAMESPACES`에 `common`을 더한다"였다. 그 사이 이 파일이 **N-way로 전면 재작성**되면서(로케일 축의 하드코딩 제거 — `koDict`/`enDict` 2자 비교 → `DICTS`·`LOCALES` 순회 + `@/test/locale-parity`) 판단 근거가 달라졌다.

현재 상태(`src/log-viewer/__tests__/i18n.test.ts:155`):

```ts
const MAIN_NAMESPACES: Record<string, Record<string, string>>[] = [logs, editor];
```

**로케일 축은 레지스트리가 돌게 고쳐놓고 namespace 축은 여전히 손으로 열거한다.** 항목 34는 정확히 그 열거의 구멍이다 — `common`이 빠진 게 원인이지, `common`만 특별한 게 아니다. 같은 그물에서 로케일 축은 "열거하면 다음 것에서 구멍"이라 판단해 걷어냈으므로, namespace 축도 같은 판단을 적용하는 게 일관된다.

**채택: 대조 원본을 메인 사전 레지스트리 전체로 바꾼다.**

```ts
// before
const MAIN_NAMESPACES: Record<string, Record<string, string>>[] = [logs, editor];
//   → LOCALES × MAIN_NAMESPACES 이중 순회

// after — 메인 i18n의 폴백 금지 레지스트리를 그대로 진실로 쓴다.
import { locales } from "@/i18n";
//   → LOCALES 순회. 각 로케일에서 locales[locale]이 곧 메인 사전 전체다.
//   판정은 그대로 "복제 사전 키 중 메인에도 있는 것만 값 비교".
```

**넓어지는 범위는 실측으로 0이다** — 복제 사전 **130키** 중 메인과 겹치는 건 **96키**이고, 그 96키가 `logs`+`editor`+`common` 3 namespace로 정확히 소진된다(`logs`+`editor`만이면 93키, `common` 3키가 나머지). **2026-08-14 재측정치다 — 이전 판의 122/88/85는 v1.7.21 이전 값이라 셋 다 틀렸다.** 결론은 그대로 성립한다: 지금 시점에서 이 변경은 **`common` 추가와 결과가 동일하고**, 겹치는 96키 전부에 대해 **ko/en drift는 0**이다(기획 중 실측 — 그대로 green이어야 한다). 차이는 미래에만 있다: 복제 사전에 새 namespace 키가 들어와도 배열을 갱신하지 않아 생기는 무음 구멍이 **구조적으로 사라진다.**

- 남는 34키(`logViewer.*` 19키 등)는 메인에 대응이 없는 log-viewer 전용이라 값 대조 대상이 아니다 — 판정 로직이 `k in table`로 이미 걸러낸다.
- `@/i18n` import는 vitest에서 `src/i18n/index.ts`로 해석된다(log-viewer 전용 alias는 `vite.log-viewer.config.ts`에만 있다). 그 파일이 `useSettingsUiStore`를 끌어오지만 `src/i18n/__tests__/locales.test.ts`가 이미 같은 import로 node 환경에서 green이므로 통과가 기대값이다.
- **폴백 대안**: 위 import가 node 환경에서 문제가 되면 `MAIN_NAMESPACES`를 유지하되 **8개 namespace를 전량 나열**(`common, app, issue, editor, integrations, settings, logs, ai`)하고, 배열 위에 "namespace를 추가하면 여기 등록" 주석을 단다. 감사 처방(`common`만 추가)으로 내리지는 않는다 — 그건 지금 아는 구멍 하나만 막고 구조는 그대로 두는 것이다.

**R10대로 값 불일치가 이미 있으면 먼저 값을 맞춘 뒤 테스트를 확장**한다(테스트가 red인 채로 커밋하지 않는다). 복제 사전의 `common.*` 3키 위치는 `log-viewer/i18n.ts:140-142`(ko)·`:273-275`(en)다.

### E-4. dead 키 (⚪86) — **⚪34와 함께 설계**

두 그룹의 성격이 다르다.

| 그룹 | 실측 | 판정 |
|---|---|---|
| `networkLog.dialog.title` · `consoleLog.dialog.title` · `actionLog.dialog.title` (ko/en 6줄) | 코드 참조 **0**(`grep` 확인, i18n 파일 자신 제외) | **삭제** |
| `actionLog.role.*` 7키 (ko/en 14줄) | 메인 dict 경로 참조 0. 실소비는 `log-viewer/markers.ts:108`의 복제 사전 | **유지** |

`actionLog.role.*`을 지우면 안 되는 이유가 E-3과 맞물린다: drift 대조가 메인 사전을 원본으로 삼으므로 이 7키는 **복제 사전 값의 대조 원본**이다(E-3의 어느 형태를 택하든 `logs` namespace는 대조 범위 안이다). 메인에서 지우면 대조 상대가 사라져 log-viewer 쪽 값이 아무렇게나 drift해도 그물에 안 걸린다. **주석으로 역할을 명시**한다:

```ts
// actionLog.role.*: 메인 dict 소비처는 없다(실소비는 log-viewer/markers.ts의 복제 사전).
// drift 테스트(log-viewer/__tests__/i18n.test.ts)의 대조 원본이므로 지우지 말 것.
```

`*.dialog.title` 3키 삭제 시 확인: 복제 사전에도 같은 키가 있으면 대조 상대가 사라지므로 **함께 확인**한다(현재 `log-viewer/i18n.ts`에 있는지 구현 시 grep).

### E-5. 열린 집합 role (⚪91)

`src/log-viewer/markers.ts:108-110`:

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

PRD "어긋난 6곳" 5번대로 실측치를 확정했다(N-way 인프라 도입 후 재측정에도 **동일**): 총 키 **875**, top-level prefix **52**, 리프이자 prefix인 키 **34**, `logViewer.*` 소유권 **1키(메인) / 19키(복제 사전)** 분산, `viewerLogin`/`viewerUsername`/`viewerName` 3이명(github·linear가 `viewerLogin`, gitlab이 `viewerUsername`, asana·clickup·slack이 `viewerName`), `annotation.thickness.S/M/L`만 대문자 리프.

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
| §9 title-only 레거시 목록 | "`AnnotationToolbar`의 액션부·`IssueRow` 등" | **목록을 삭제한다(2026-08-14 확정).** 실측 결과 `size="icon"` 45곳 중 title-only는 `OrderedListEditor:93` **1곳뿐이고 그건 이 배치의 소주제 A가 고친다** — 즉 갱신 후 목록은 **공집합**이다. `AnnotationToolbar`·`IssueRow`는 이미 `aria-label`+`title` 병기다. 레거시 목록 대신 "현재 title-only 0곳" + 관용구 분포(aria-label+title 병기 38곳 / aria-label만 6곳)를 남긴다. |
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

- **i18n 로케일 동시 갱신** — CLAUDE.md: `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행해 불일치를 차단한다. 그 검사는 이제 ko/en 2자 비교가 아니라 **`LOCALES` 순회 N-way**이고, 판정기 본체는 `src/test/locale-parity.ts`의 `findParityViolations`(키 누락·잉여·빈 값·placeholder 토큰 대칭)·`findUncovered`·`findExtraneous`다. 신규 키 `annotation.textInput`은 등록된 전 로케일(현재 ko/en)에 넣는다.
- **로케일 레지스트리 단일 출처** — `src/i18n/locales.ts`가 `LOCALES`·`BASE_LOCALE`(ko)·`DEFAULT_LOCALE`(en)·폴백 금지/허용 구분을 정의하고 **의존성 0**이 불변식이다(`__tests__/locale-registry.test.ts`가 소스 스캔으로 강제). 이 배치는 그 파일을 건드리지 않는다 — E-0대로 항목 32는 키 축이라 층위가 다르다.
- **사전은 두 벌** — CLAUDE.md: log-viewer는 `src/log-viewer/i18n.ts`에 복제 사전(`DICTS`)을 따로 둔다. 훅 matcher(`*src/i18n/*`)에 안 걸리고 `pnpm test`가 잡는다. E-3·E-4가 이 규칙의 그물 자체를 손대는 작업이다.
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
2. **B의 shadcn 이행이 치수를 바꾼다** — `Button` base cva는 `h-9 px-4 text-sm font-medium justify-center`에 **`gap-2`와 `[&_svg]:size-4`**를 깔고(`shadow-sm`은 base가 아니라 `outline` variant에 있다 — 2026-08-14 실측 정정), 원본 raw 버튼은 그중 일부만 갖고 있었다. **가장 놓치기 쉬운 둘은 `[&_svg]:size-4`(아이콘 14→16px, 자손 셀렉터라 특이도로 이긴다)와 `gap-2`(non-compact 콤보박스 3곳)**이며 둘 다 B-1·B-2에 반영했다.
3. **§2의 hover 함정** — "`--accent` == `--secondary` == `--muted`가 라이트·다크 모두 같은 값이다. … shadcn `outline` 버튼의 `bg-background → hover:bg-accent`는 `background` 표면 위를 전제한 관용구라, muted 표면으로 옮기면 방향이 뒤집힌다." `LinkToggle`(B-1)의 on 상태가 `bg-foreground`(어두운 면)이므로 base의 `hover:bg-accent`/`hover:text-accent-foreground`가 그대로 적용되면 **on 상태 hover에서 글자가 사라진다**. B-1의 `hover:text-background` 명시가 필수다.
4. **다크에서만 깨지는 조합** — 색 변경 항목(C 전체, D-2)은 라이트에서 멀쩡한 채 다크만 무너지는 게 §2가 기록한 반복 패턴이다. 모든 시각 확인은 **라이트·다크 두 번** 한다.

### 그물 손상

5. **`tokens.test.ts` 하드 실패** (R1) — D-1이 미디어쿼리 문자열을 지우면 `throw new Error("overlay.ts에 다크 미디어쿼리가 없다")`. 파서를 함께 안 고치면 즉시 red라 "조용히 죽는" 유형은 아니지만, **급히 파서를 느슨하게 고쳐 그물이 무력화되는 것**이 진짜 위험이다. 수정 후 R1의 "일부러 틀리게 하면 red" 증명을 반드시 한다.
6. **drift 테스트 확장이 기존 불일치를 드러낸다** (R10) — E-3이 대조 범위를 넓히는 순간 이미 갈린 값이 있으면 red. 기획 중 실측으로는 겹치는 88키 전부 drift 0이지만, 구현 시점엔 상류가 값을 바꿨을 수 있다. 테스트를 먼저 넣지 말고 **값 대조를 수동으로 먼저** 돌린다.
7. **⚪86 삭제의 부수효과** — `actionLog.role.*`을 지우면 drift 대조 원본이 사라진다(E-4). 감사 원문도 이걸 경고했다. 삭제 대상은 `*.dialog.title` 3키뿐이다(복제 사전엔 이 3키가 **없음**을 실측 확인 — 대조 상대 소멸 문제는 발생하지 않는다).

### 타입 게이트

8. **캐스트 제거가 typecheck를 깰 수 있다** (R9) — ⚪60의 4개 헬퍼가 참조하는 키 중 하나라도 없으면 red. 이건 **의도된 red**지만, 급히 `as TranslationKey`를 되살리면 원점이다. E-2의 판단 규칙(키 추가 vs id union 좁히기)을 따른다.
9. ~~**`import.meta.env.DEV` 가용성**~~ — **해소.** background 번들에서 이미 실사용 중임이 확인됐다(`background/analytics.ts:137`).

### 메시지 경로

10. **iframe 재전송 누락** (R3) — `picker.start`를 보내는 3곳 중 `:297`(iframe 재전송)이 가장 잊기 쉽다. 이걸 빠뜨리면 **1-depth iframe 안에서 요소를 고를 때만** 카드 색이 갈린다 — 재현 조건이 좁아 발견이 늦다.
11. **구버전 content script** (R2) — 확장 리로드 없이 열려 있던 탭에서는 `theme` 필드를 모르는 content script가 돈다. `data-theme` 미설정 = 라이트 폴백 구조라 **깨지지 않고 이전 동작(라이트 고정)** 이 되는지 확인.

### 스코프 침식

12. **"어차피 여는 김에" 유혹** — 이 배치는 파일 수가 많고 각 변경이 작아서, 인접 코드를 함께 손대기 쉽다. CLAUDE.md의 **외과적 변경** 원칙대로 감사 항목이 지목한 줄만 건드린다. 특히 `NetworkLogContent.tsx`는 이 배치에서 **5개 항목**(20·27·79·80·85)이 걸리므로 변경 지점을 미리 특정하고 들어간다(이전 판의 "4개"는 나열과 안 맞았다).

### `docs/features/french-locale/`와의 순서 의존

같은 저장소에 **프랑스어 로케일(fr) 추가 기획**이 대기 중이고, 소주제 E와 **같은 파일들을 만진다**(`i18n/namespaces/*`·`log-viewer/i18n.ts`·`log-viewer/__tests__/i18n.test.ts`). 코드 충돌은 아니지만 양방향 의존이 있다.

13. **fr이 먼저 들어가면 E-3의 그물 계산이 달라진다.** french-locale 기획은 `i18n.test.ts:180`의 `MAIN_NAMESPACES = [logs, editor]`를 근거로 복제 사전 키를 **"값 대조가 강제되는 93키 + 그물 없는 37키"** 로 쪼개 번역 공수를 잡아 놨다(`french-locale/design.md:37`·`tasks.md:88`). E-3이 먼저 들어가면 그 경계가 **96 / 34**로 바뀐다 — 방향은 같지만(그물이 넓어진다) fr 번역자가 옛 숫자를 믿고 34키를 "검증됨"으로 착각하면 안 된다. **E-3을 먼저 넣었다면 french-locale 문서의 그 두 수치를 갱신한다.**
14. **E-3이 나중에 들어가면 fr 사전까지 대조 대상이 된다.** 대조는 `LOCALES` 순회라, fr이 등록된 뒤 E-3을 넣으면 `common.*` 3키가 **ko/en/fr 세 벌 모두** 값 대조에 걸린다. fr 복제 사전이 그 3키를 메인과 다른 문자열로 채웠으면 red다 — R10의 "먼저 값 대조를 돌린다"가 그만큼 더 중요해진다.
15. **⚪86의 dead 키 삭제는 fr 브랜치가 도는 동안 하지 않는다.** french-locale은 875키를 파일별로 나눠 채우는 장기 브랜치라 상류 rebase로 키 목록이 흔들리는 걸 이미 자기 위험으로 잡아 놨다. 배치 5의 삭제 6줄이 그 rebase에 섞이면 "번역이 빠진 건지 삭제된 건지"가 흐려진다 — **둘 중 하나가 dev에 들어간 뒤 다른 하나를 시작**한다.

> 반대로 **E-1·E-2(항목 32·33·⚪60)는 fr과 무관하다.** 캐스트 제거와 `lookup()` 폴백은 키 축이고 로케일 축을 안 건드린다 — 순서 제약 없이 병렬 가능하다. 소주제 A~D·F도 마찬가지다.

---

## 2026-08-14 재검증 편입 사항

`/feature-review`(CTO·CDO·QA 3인 + 하위 검증)로 v1.7.23 기준 재검증한 결과 **새로 편입·축소·취소된 항목**을 여기 모은다. 위 본문의 해당 절도 각각 수정했다.

### 편입 (새 작업)

**N-1. `ActionLogContent.tsx`의 로컬 색 발명 — C-1 소비처에 추가.** v1.7.21(action-log-nav-type)이 만진 파일이고 🟡26·27과 **정확히 같은 문제**다.

| 위치 | 현재 | 문제 |
|---|---|---|
| `:91` | `text-sky-600 dark:text-sky-400` | `sky`는 `LogTone`에 **없는 색**(로컬 발명) |
| `:97` | `text-red-700 dark:text-red-400` | `TONE_TEXT.red`는 `text-red-600 dark:text-red-400` — **이미 값이 갈렸다** |
| `:95` | `text-amber-600 dark:text-amber-400` | `TONE_TEXT.amber`와 문자열은 같으나 하드코딩 |

성공 기준의 `grep "bg-\(red\|amber\|blue\|green\)-200"`은 **`text-*` 축을 안 잡으므로** 이 배치를 통과해도 그대로 남는다. C-1 소비처 목록에 이 파일을 추가하고, `TONE_TEXT` 축의 grep을 성공 기준에 더한다.

**N-2. `DomTreeDialog.tsx:70-77`의 두 번째 raw button — B-3 범위에 추가.** `title`만 있고 접근명이 없다. B-3이 같은 파일의 chevron(`:267-282`)을 여는 김에 판단을 남긴다(고치거나, 명시적 비목표로 적거나).

**N-3. ⚪80 상태 dot을 `TONE_DOT`으로 승격.** 원안은 `NetworkLogContent:521-523`에 `dark:` 짝을 로컬 추가하는 것이었는데, **같은 파일에서 행 배경은 `log-colors.ts`로 올리면서(C-1) dot만 로컬에 새 색을 심는 건 C-1 원칙과 어긋난다.** `TONE_DOT` 표를 `log-colors.ts`에 추가해 함께 올린다.

**N-4. `resolveDark`를 `CssCodeMirror.tsx:675-688`에도 적용.** 같은 판정식이 거기에도 있고 주석이 스스로 "`useThemeEffect`와 동일 규율"이라 자칭한다. 복제본을 하나 남기면 다음 회고감이다. (`log-viewer/main.tsx:10`은 별도 빌드라 **제외가 맞다**.)

**N-5. ⚪90·⚪82 이행 태스크 추가.** prd 목표 11이 "⚪ 9건이 정리된다"고 약속했는데 이 둘에 대응 태스크가 없었다.
- **⚪90** — `editor-store.ts:16`이 `@/sidepanel/components/annotation/presets`를 **value import**한다. store가 컴포넌트 그래프를 끌어오는 형태라 CLAUDE.md의 번들 경계 규칙("store가 필요로 하는 순수 로직은 `sidepanel/lib/`으로 승격")에 정면으로 걸린다. presets를 `sidepanel/lib/` 또는 `src/lib/`로 승격한다.
- **⚪82** — "토큰 발급" 링크 수렴. prd `:117`이 "아래에서 다룬다"고 했으나 세 문서 어디에도 없었다. F(DESIGN.md 갱신)에 판정을 적거나 명시적 비목표로 선언한다.

### 축소 / 취소

- **⚪60 (축소)** — `TextSectionId`가 이미 존재하고 20조합 전수 누락 0이라 R9의 red 시나리오가 없다. "캐스트 4줄 삭제"로 축소. 게이트 증명 대상은 `sectionPlaceholderKey`/`sectionHelpKey`로 옮긴다(`section.description` 리네임은 `sectionKeyParity.test.ts`가 먼저 red를 내 이미 공허하다).
- **⚪84 (취소)** — `rounded-[3px]` 통일 대신 DESIGN §6에 4px 등재.
- **🟡28 (축소)** — 배경만 통일, 글자는 `amber-800` 유지(대비).
- **§9 title-only 목록 (공집합)** — 갱신이 아니라 삭제.
- **B-2 `focus-visible:ring-2` 명시 (불필요)** — base가 이미 `ring-2`.
- **`import.meta.env.DEV` 확인 조문 (해소)** — background 번들에서 이미 실사용.

### 이미 처리돼 있던 것 (작업 불요)

- `LinkToggle`(`StylePropEditors.tsx:186-202`) — `aria-pressed`(`:189`)·`aria-label`(`:195`)·`cn()`(`:190`)이 **이미 다 있다.** 남은 건 shadcn 이행뿐.
- `JsonTreeViewer.tsx:146-154` — `aria-expanded`(`:149`)·`aria-label`(`:148) 완비.
- `ValueCombobox.test.tsx:56`이 `min-w-0`을 **이미 자동 고정**한다(R7을 수동으로 잡을 필요 없음. 변경 후 green 유지가 검증 항목).
- `element-locator.ts`의 테스트 전용 export에 JSDoc 주석이 이미 있다.

### 신규 UI 검증 결과 (v1.7.22·23)

`ProjectField`·`SprintField`·`FieldCombobox`·`EpicField`·`IssueTypeField`·`RelatesField` — **이 배치 축에서 위반 0.** 전부 shadcn `Button variant="outline" role="combobox"` + `aria-expanded` + `aria-label` + `cn()` + semantic 토큰 + 전량 `t()`다. 신규 raw 색 0, `rounded-*` 하드코딩 0, 템플릿 concat 순증 0. 형제인 `SingleLazyCombobox`·`CcMultiCombobox`보다 오히려 관용구를 강하게 지킨다. **회귀 감시 대상이지 작업 대상이 아니다.**

### 회귀 감시 추가

- **R13. 대비 회귀** — 🟡28의 amber 교체로 텍스트 대비가 AA(4.5:1) 아래로 떨어지지 않는지 확인. 현행 6.84:1, 배경만 교체 시 유지. DESIGN §2가 요구하는 "새 raw 색 대비 확인"의 이행이다.
- **R14. e2e 사정권** — 아래 tasks.md 참조. B의 shadcn 이행은 spec 3개가 아니라 **19개**에 걸린다.
