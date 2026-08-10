# audit-refactor-5 — 구현 태스크

## 선행 조건

- 새 권한·env·의존성·shadcn 설치 **없음**. 모든 변경이 기존 컴포넌트·토큰·메시지 안에서 끝난다.
- 착수 전 읽을 것:
  - `docs/DESIGN.md` §1·§2·§3·§4·§6·§9·§10·§13·§14·§15 — 이 배치의 ground truth.
  - `src/components/ui/button.tsx` — Task 2의 cva 대조 대상(설계는 §10 요약을 인용했지만 **실제 cva를 읽고** 덮을 항목을 확정한다).
  - `docs/POSTMORTEM.md`를 `overlay`·`theme`·`i18n`·`log-colors`·`aria`로 grep — CLAUDE.md의 소환 회로.
- **라이트/다크 두 테마로 확장을 실물 확인할 준비**: 시각 판정 태스크(Task 2·3·4)는 `pnpm build` 후 로드해야 한다. dist가 stale이면 헛테스트다.
- 브랜치: `dev`.

---

## 태스크

태스크는 design.md의 소주제 A~F에 대응한다. **Task 1·6은 다른 태스크와 병렬 가능**하고, Task 2·3은 시각 회귀 위험이 겹치므로 순차 권장.

---

### Task 1: 접근성 속성 보강 (소주제 A — 🟡19·20·21·22·23 + ⚪85)

- **변경 대상**
  - `src/sidepanel/components/OriginFilterBar.tsx:27-32`
  - `src/sidepanel/components/NetworkLogContent.tsx:634-639`
  - `src/sidepanel/tabs/StyleEditorPanel.tsx:527-529`
  - `src/sidepanel/components/OrderedListEditor.tsx:91-99`
  - `src/sidepanel/components/AnnotationOverlay.tsx:664-666`
  - `src/i18n/namespaces/editor.ts` (ko/en 동시 — `annotation.textInput`)
- **작업 내용**
  - pill 2종: 템플릿 concat → `cn()`(§15), `aria-pressed={value === k}` / `aria-pressed={dir === d}` 추가. `data-active`·`data-testid`·클래스 문자열은 **그대로 보존**(시각 변화 0).
  - `StyleEditorPanel`: `useEditorStore((s) => s.aiStylingLoading)` 구독 → 배너 버튼에 `aria-disabled={aiStylingLoading}` + `aria-disabled:cursor-not-allowed aria-disabled:opacity-50` + `onClick` 최상단 `if (aiStylingLoading) return;`. **`DraftingPanel.tsx:469-473`과 문자 대조**해 대칭을 맞춘다.
  - `OrderedListEditor`: `title` 유지 + `aria-label={t("common.delete")}` 추가.
  - `AnnotationOverlay`: `<textarea>`에 `aria-label={t("annotation.textInput")}`. **placeholder는 넣지 않는다**(R12).
- **검증**
  - [ ] `src/sidepanel/components/__tests__/OriginFilterBar.test.tsx`(신규) — origin 2개일 때 렌더 후 활성 pill이 `aria-pressed="true"`, 비활성이 `"false"`.
  - [ ] `src/sidepanel/components/__tests__/NetworkLogContent.test.tsx`(기존 확장) — WS 방향 필터 3개 중 선택된 것만 `aria-pressed="true"`.
  - [ ] `src/sidepanel/components/__tests__/OrderedListEditor.test.tsx`(신규) — 삭제 버튼이 `getByRole("button", { name: <common.delete 값> })`로 잡힌다.
  - [ ] `src/sidepanel/components/__tests__/AnnotationOverlay.test.tsx`(기존 확장) — 텍스트 편집 진입 시 `getByRole("textbox", { name: … })`가 존재. **기존 테스트가 Konva 마운트를 어떻게 다루는지 먼저 확인**하고, 진입 경로 시뮬레이션이 불가하면 이 항목만 수동으로 내린다.
  - [ ] `pnpm test src/i18n` green (PostToolUse 훅이 자동 실행 — ko/en 대칭).
  - [ ] 수동: `aria-pressed` 추가 전후로 pill 모양이 **픽셀 동일**한지(라이트·다크).
  - [ ] 수동(R6): 스타일링 AI 실행 중 배너가 흐려지고 다시 눌리지 않는다. 완료 후 정상 복귀한다.

---

### Task 2: shadcn 이행 (소주제 B — 🟡24·25 + ⚪83)

- **변경 대상**
  - `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx:177-203` (`LinkToggle`)
  - `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx:201-215` (Popover 트리거)
  - `src/sidepanel/components/TreeChevronButton.tsx` (**신규**)
  - `src/sidepanel/components/JsonTreeViewer.tsx:146-154`
  - `src/sidepanel/tabs/DomTreeDialog.tsx:258-273`
- **작업 내용**
  - **먼저 `src/components/ui/button.tsx`의 cva를 읽고** 덮어야 할 항목을 확정한다(design.md B-1·B-2의 목록은 §10 요약 기반 — 실제 cva와 대조 필요).
  - `LinkToggle` → `Button size="icon" variant="outline"` + `cn("h-9 w-9 shrink-0", linked && "border-foreground bg-foreground text-background hover:bg-foreground/80 hover:text-background")`. **`hover:text-background` 누락 금지**(위험 요소 3).
  - `ValueCombobox` 트리거 → `Button variant="outline"` + `cn(…)`. **`min-w-0`과 그 주석을 반드시 이관**(R7). `justify-start`·`font-normal`·`hover:bg-muted/50`을 명시적으로 덮는다.
  - `TreeChevronButton` 신설 — raw `<button>` 유지, className은 기존 바이트 동일 문자열, `aria-expanded={open}` **양쪽 다** 갖게, 라벨은 `label` prop 주입(i18n 키는 호출부가 유지).
- **검증**
  - [ ] `src/sidepanel/tabs/styleEditor/__tests__/StylePropEditors.test.tsx`(신규 또는 확장) — `LinkToggle`의 `aria-pressed` on/off와 on일 때 `bg-foreground` 클래스 존재.
  - [ ] `src/sidepanel/components/__tests__/JsonTreeViewer.test.tsx`(기존 확장) — chevron이 `aria-expanded`를 갖고 토글 시 값이 뒤집힌다.
  - [ ] `src/sidepanel/tabs/__tests__/DomTreeDialog.test.tsx`(존재 확인 필요, 없으면 신규) — 동일.
  - [ ] `pnpm typecheck` green.
  - [ ] **수동(R7, 최우선)**: 스타일 편집기 → `margin` 4방향 개별 편집 펼치기 → 긴 토큰 값 입력 → 4열 트랙이 안 뚫린다. **사이드패널 폭 320px**로 좁혀서도 확인.
  - [ ] **수동(R8)**: `LinkToggle` on/off × 라이트/다크 4조합에서 글자·아이콘이 보인다(특히 **on + hover**).
  - [ ] 수동: `ValueCombobox` 트리거의 높이·정렬·hover가 형제 `SingleLazyCombobox`와 나란히 놓았을 때 어색하지 않다.

---

### Task 3: 로그 색 단일 출처 확장 (소주제 C-1 — 🟡26·27)

- **변경 대상**
  - `src/lib/log-colors.ts` (추가)
  - `src/sidepanel/components/ConsoleLogContent.tsx:38-46,250,258`
  - `src/sidepanel/components/NetworkLogContent.tsx:50-62`
- **작업 내용**
  - `TONE_BG_STRONG`·`TONE_BG_HOVER`·`consoleLevelBgStrongClass` 추가. **`TONE_BG_STRONG.neutral = "bg-muted"`**(R5)와 두 표의 neutral 비대칭 사유를 주석으로 남긴다.
  - `levelCodeBg` 로컬 함수 **삭제** → 호출부 2곳을 `consoleLevelBgStrongClass(entry.level)`로 교체.
  - `rowBg`가 세 표만 조합하도록 재작성. neutral 행의 `bg-accent`/`hover:bg-accent/50`은 semantic 토큰이므로 **그대로 둔다**.
  - **값은 그대로 옮긴다** — 이 태스크의 결과 픽셀 변화는 0이어야 한다.
- **검증**
  - [ ] `src/lib/__tests__/log-colors.test.ts`(존재 확인 필요, 없으면 신규) — `TONE_BG_STRONG`의 5키 전부가 빈 문자열이 아니다(특히 `neutral`).
  - [ ] `src/sidepanel/components/__tests__/ConsoleLogContent.test.tsx`(기존 확장) — error/warn/info/log 4레벨의 `<pre>`가 각각 기대 클래스를 갖는다. **`log` 레벨이 `bg-muted`인지**를 명시적으로 고정(R5).
  - [ ] `src/sidepanel/components/__tests__/NetworkLogContent.test.tsx`(기존 확장) — error 행의 선택/비선택 클래스가 다르다.
  - [ ] `grep -rn "bg-\(red\|amber\|blue\|green\)-200" src/sidepanel/components/` 결과가 비어 있다.
  - [ ] **수동(R4)**: 라이트·다크 각각에서 network 로그의 error 행을 선택 → 이웃 hover 행과 구별된다. console 로그의 error 항목을 펼쳐 코드블럭이 행 배경 위에 떠 보인다.

---

### Task 4: 잔여 색상·radius (소주제 C-2·C-4 — 🟡28 + ⚪80·84)

- **변경 대상**
  - `src/sidepanel/tabs/styleEditor/StyleCssView.tsx:110`
  - `src/sidepanel/components/NetworkLogContent.tsx:502`
  - `src/sidepanel/components/HighlightedText.tsx:18`
  - `src/sidepanel/tabs/slackFields/ChannelIcon.tsx:16`
- **작업 내용**
  - 🟡28: `bg-amber-50 text-amber-800 dark:text-amber-200` → `bg-amber-100/80 text-amber-700 dark:text-amber-300`. **`dark:bg-amber-950`은 이미 맞으므로 유지**, `border-amber-300`/`dark:border-amber-800`도 유지(§2에 경계선 규정 없음).
  - ⚪80: 상태 dot 3색에 `dark:bg-amber-400`/`dark:bg-red-400`/`dark:bg-green-400` 추가.
  - ⚪84: `rounded-[4px]` 2곳 → `rounded-[3px]`(§6 등재값).
- **검증**
  - [ ] `pnpm typecheck` green.
  - [ ] `grep -rn "rounded-\[4px\]" src/` 결과가 비어 있다.
  - [ ] 수동: CSS 뷰에서 미적용 draft 상태를 만들어 경고 배너를 띄우고, 라이트·다크에서 글자가 읽히는지 확인(§2의 "다크 배너 배경에 알파를 얹지 말 것" 위반이 없는지도).
  - [ ] 수동: 네트워크 상세를 다크에서 열어 pending/error/ok dot 3종이 배경에 묻히지 않는다.

---

### Task 5: picker 오버레이 theme 동기화 (소주제 D-1 — 🟡29)

> **이 배치에서 가장 큰 변경.** design.md "대안 3"의 이탈 조건 3개 중 하나라도 발생하면 이 태스크만 분리해 별도 배치로 뺀다.

- **변경 대상**
  - `src/types/picker.ts:102` (메시지 필드)
  - `src/sidepanel/lib/resolveDark.ts` (**신규**)
  - `src/sidepanel/hooks/useThemeEffect.ts` (인라인 판정 → `resolveDark` 사용)
  - `src/sidepanel/picker-control.ts:227,297,633` (송신 3곳 + 모듈 로컬 `currentTheme()`)
  - `src/content/picker.ts:213` + `handleStart` 시그니처
  - `src/content/overlay.ts:201-206` (CSS) + overlay handle의 theme 세팅부
  - `src/styles/__tests__/tokens.test.ts:15-26` (**파서 앵커 — 필수 동반 수정**)
- **작업 내용 (순서 고정)**
  1. `resolveDark` 추출 + 유닛 테스트 → `useThemeEffect`가 그걸 쓰게 전환. **여기까지 단독으로 green**이어야 한다.
  2. `picker.start`에 `theme?: "light" | "dark"` 추가(주석으로 "미전달 = 라이트 폴백" 명시).
  3. `picker-control.ts`에 `currentTheme()` 헬퍼 + **송신 3곳 전부**에 부착(R3).
  4. `picker.ts` → `handleStart(frameToken, theme)` → `labelEl.dataset.theme = theme ?? "light"`.
  5. `OVERLAY_CSS`의 `@media (prefers-color-scheme: dark)` 블록 → `.picker-label[data-theme="dark"][data-mode="inspector"]`.
  6. `tokens.test.ts`의 `parseOverlayTokens` 앵커 교체.
- **검증**
  - [ ] `src/sidepanel/lib/__tests__/resolveDark.test.ts`(신규) — `("light", true)=false` / `("dark", false)=true` / `("system", true)=true` / `("system", false)=false` 4케이스.
  - [ ] `pnpm test src/styles` green.
  - [ ] **(R1 그물 증명)** overlay의 다크 `--border` 값을 일부러 한 자리 틀리게 바꿔 `tokens.test.ts`가 **red**가 되는지 확인 후 되돌린다. 이걸 안 하면 파서를 무력화하고도 green을 볼 수 있다.
  - [ ] `grep -n "picker.start" src/sidepanel/picker-control.ts` 결과 3곳이 **전부** theme을 싣는다.
  - [ ] **수동**: 앱 설정 theme=라이트 + OS 다크 → picker 실행 → 인스펙터 카드가 **흰색**. 앱 theme=다크 + OS 라이트 → **검은색**. 앱 theme=system → OS를 따라간다.
  - [ ] **수동(R3)**: 1-depth iframe이 있는 페이지(cross-origin 위젯)에서 iframe 내부 요소를 hover → 카드 색이 top 프레임과 같다.
  - [ ] **수동(R2)**: 확장을 리로드하지 않은 채 **기존에 열려 있던 탭**에서 picker 실행 → 카드가 깨지지 않고 라이트로 뜬다.

---

### Task 6: overlay box-model 색 + 죽은 훅 주석 (소주제 D-2·D-3 — 🟡30 + ⚪88)

- **변경 대상**: `src/content/overlay.ts:366`(gap fill), `:704-706`(주석만)
- **작업 내용**
  - gap 채움 `rgba(236, 72, 153, 0.3)` → `rgba(139, 92, 246, 0.3)`(violet-500, 알파 유지). 라벨 `#7c3aed`(violet-600)와 계열 일치.
  - `.pl-tag`/`.pl-class`에 `// 현재 스타일 규칙 없음 — 태그/클래스 구분 훅으로 유지` 주석 추가(**삭제하지 않는다**).
- **검증**
  - [ ] `pnpm typecheck` green.
  - [ ] **수동**: flex/grid `gap`이 있는 요소를 hover → 채움색과 `gap` 라벨색이 같은 보라 계열로 읽힌다. margin(주황/amber)·padding(초록/green)과 3축이 구별된다.
  - [ ] 수동: 라이트·다크 페이지 배경 양쪽에서 채움이 보인다(알파 0.3이라 밝은 배경에서 옅을 수 있다).

---

### Task 7: i18n 타입 게이트 (소주제 E-1·E-2 — 🟡32·33 + ⚪60)

> **순서가 중요하다: 캐스트 제거(7-1) → 폴백 추가(7-2).** 반대로 하면 폴백이 캐스트 구멍을 덮어 typecheck red가 안 나온다.

- **변경 대상**
  - `src/sidepanel/tabs/statusBadges/constants.ts:41`
  - `src/sidepanel/tabs/statusBadges/LinearStatusBadge.tsx:31`
  - `src/sidepanel/tabs/statusBadges/LinearSubmittedBadge.tsx:85`
  - `src/store/settings-ui-store.ts:80,83,86,89`
  - `src/i18n/index.ts:33-52`
- **작업 내용**
  - **7-1**: `LINEAR_STATE_I18N: Record<string, TranslationKey>`(type-only import) + 소비처 2곳의 `as Parameters<typeof t>[0]` 삭제. `settings-ui-store`의 `as TranslationKey` 4개 삭제.
  - **7-1 게이트**: 여기서 `pnpm typecheck`를 돌린다. **red면 그게 성과다** — R9의 판단 규칙(키 추가 vs id union 좁히기)을 따르고, 캐스트를 되살리지 않는다.
  - **7-2**: `lookup(locale, key)` 헬퍼 도입 — `t()`와 `useT()`의 **두 경로가 함께** 쓰게 한다(한쪽만 고치면 훅 경유만 폴백이 없다). `import.meta.env.DEV`에서 `console.error`, 항상 `return key`.
  - `import.meta.env.DEV`가 background 번들에서 치환되지 않으면 조건을 제거하고 무조건 `console.error`로 단순화.
- **검증**
  - [ ] `grep -rn "as TranslationKey\|as Parameters<typeof t>" src/` 결과가 비어 있다.
  - [ ] `src/i18n/__tests__/index.test.ts`(존재 확인 필요, 없으면 신규) — 미정의 키를 `as any`로 넘겨도 **throw하지 않고** 키 문자열을 반환한다. params가 있어도 동일(현재는 TypeError).
  - [ ] `pnpm typecheck` green (7-1 red 처리 완료 후).
  - [ ] **(게이트 증명)** `src/i18n/namespaces/issue.ts`의 `section.description`을 임시 리네임 → `settings-ui-store.ts`에서 typecheck red 확인 → 되돌린다.
  - [ ] 수동: Linear 이슈 목록에서 상태 배지 5종(backlog/unstarted/started/completed/cancelled) 라벨이 정상 렌더된다.

---

### Task 8: i18n 사전 정리 (소주제 E-3·E-4·E-5 — 🟡34 + ⚪86·91)

> **이 태스크는 그 자체가 테스트 수정이다**(🟡34). 순서: 값 대조 → 값 정합 → 테스트 확장 → dead 키 삭제.

- **변경 대상**
  - `src/log-viewer/__tests__/i18n.test.ts:169`
  - `src/i18n/namespaces/logs.ts` (dead 키 3종 ko/en 6줄 삭제 + `actionLog.role.*` 보존 주석)
  - `src/log-viewer/markers.ts:106-109` (주석만)
  - `src/log-viewer/i18n.ts` (값 불일치가 있으면 정합)
- **작업 내용**
  - **8-1 (선행)**: `common.expand`·`common.collapse`·`common.clearSearch` 3키를 메인 `src/i18n/namespaces/common.ts`와 `src/log-viewer/i18n.ts`에서 **값 대조**(ko/en). 불일치가 있으면 메인 값을 정답으로 삼아 복제 사전을 맞춘다.
  - **8-2**: `MAIN_NAMESPACES = [logs, editor, common]` + `import { common }` 추가. 배열 위에 "복제 사전에 다른 namespace 키를 추가하면 여기 등록" 주석.
  - **8-3**: `networkLog/consoleLog/actionLog.dialog.title` 6줄 삭제. **삭제 전 `src/log-viewer/i18n.ts`에도 같은 키가 있는지 grep** — 있으면 그쪽도 함께(대조 상대 소멸 방지).
  - **8-4**: `actionLog.role.*` 위에 보존 사유 주석(design.md E-4 문구).
  - **8-5**: `markers.ts`의 role 폴백에 "미등재 role은 단어를 생략한다(의도)" 주석. 액션 레코더가 실제로 기록하는 role 집합을 확인해 **기록되는데 미등재인 role이 있으면 그것만** ko/en 추가.
- **검증**
  - [ ] `pnpm test src/log-viewer` green.
  - [ ] **(R10 그물 증명)** `log-viewer/i18n.ts`의 `common.expand` 값을 일부러 바꿔 drift 테스트가 **red**가 되는지 확인 후 되돌린다.
  - [ ] `grep -rn "dialog.title" src/` 결과에 `networkLog/consoleLog/actionLog`가 없다.
  - [ ] `pnpm test src/i18n` green (ko/en 대칭 유지).
  - [ ] 수동: log-viewer(`logs.html`)를 다운로드해 열어 액션 타임라인 마커 툴팁의 role 단어가 정상 표시된다.

---

### Task 9: DESIGN.md 갱신 (소주제 F — ⚪92 + 79·89 + C-3·E-6 결론)

> **코드 변경 0.** 별도 커밋(`docs(DESIGN): …`)으로 묶는다.

- **변경 대상**: `docs/DESIGN.md` §2·§4·§9·§13·§14
- **작업 내용**: design.md 소주제 F의 표 9행을 그대로 반영. 요약:
  - §2 raw 색 목록 **+4종**(green/sky/blue/red — `dark:` 짝 보유 명시)
  - §2 AI 액센트에 **그라디언트 규칙 1줄**
  - §2 세 표 항목에 **overlay 다크 전환이 앱 theme을 따른다** + `tokens.test.ts` 앵커 명시
  - §4에 **overlay 폰트 스택 5벌 하드코딩** 1줄
  - §9 title-only 레거시 목록 **실측 재확인**(`OrderedListEditor`는 Task 1로 해소되므로 제외)
  - §13 FieldRow **"42곳 / 그중 라벨 동반 34곳"**으로 정밀화
  - §14 `lockedClass` **"명명 상수 3곳 + 인라인 7곳 + `opacity-50` 없는 축약형 19곳"** + 경로 2건 정정
  - §14 빈 상태에 **`common.empty` vs `md.noValue` 경계** 1줄
- **검증**
  - [ ] 갱신한 모든 수치가 **grep 한 줄로 재확인 가능**하다(문서에 확인 명령을 적을 필요는 없지만, 작성자가 실제로 돌려서 맞춘다).
  - [ ] Task 5가 끝난 뒤 §2를 쓴다(셀렉터 문자열이 확정돼야 한다).
  - [ ] `docs(DESIGN): ...` 단독 커밋.

---

## 테스트 계획

### 단위 테스트 (`*.test.ts` — node)

| 대상 | 케이스 |
|---|---|
| `src/sidepanel/lib/__tests__/resolveDark.test.ts` (신규) | `("light", true)` / `("dark", false)` / `("system", true)` / `("system", false)` 4조합 |
| `src/lib/__tests__/log-colors.test.ts` (신규 또는 확장) | `TONE_BG_STRONG` 5키 전부 non-empty(특히 `neutral === "bg-muted"`), `TONE_BG`와 키 집합 일치 |
| `src/i18n/__tests__/index.test.ts` (신규 또는 확장) | 미정의 키 + params → throw 없이 키 문자열 반환. 정의된 키 + params → 치환 정상. `useT()` 경로도 동일 |
| `src/log-viewer/__tests__/i18n.test.ts` (**수정 = 항목 34 본체**) | `MAIN_NAMESPACES`에 `common` 추가 |
| `src/styles/__tests__/tokens.test.ts` (**수정**) | `parseOverlayTokens` 앵커 교체. 기존 3표 대조 케이스는 그대로 통과해야 한다 |

### 컴포넌트 테스트 (`*.test.tsx` — jsdom + @testing-library/react)

**aria 속성 존재·토글은 전부 여기서 고정 가능하다.**

| 대상 | 케이스 |
|---|---|
| `OriginFilterBar.test.tsx` (신규) | 활성 pill `aria-pressed="true"` / 비활성 `"false"`, 클릭 시 뒤집힘 |
| `NetworkLogContent.test.tsx` (확장) | WS 방향 필터 `aria-pressed`; error 행의 선택/비선택 클래스 차이 |
| `ConsoleLogContent.test.tsx` (확장) | 레벨 4종(error/warn/info/**log**)의 코드블럭 배경 클래스 |
| `OrderedListEditor.test.tsx` (신규) | 삭제 버튼이 접근명으로 조회된다 |
| `StylePropEditors.test.tsx` (신규/확장) | `LinkToggle` `aria-pressed` on/off + on일 때 강대비 클래스 |
| `JsonTreeViewer.test.tsx` (확장) · `DomTreeDialog.test.tsx` (확인 후 신규) | chevron `aria-expanded` 존재·토글 |
| `AnnotationOverlay.test.tsx` (확장, **가능하면**) | 텍스트 편집 `<textarea>`의 접근명. Konva 마운트 제약으로 불가하면 수동으로 내린다 |

### e2e 시나리오 (`/e2e-write` 입력)

**이 배치는 신규 e2e를 만들지 않는다.** 이유: 변경이 전부 속성·클래스·색 값이라 Playwright로 판정하면 **구현 세부를 그대로 복사한 동어반복 assertion**이 된다(색 hex를 스펙에 박으면 다음 색 변경 때마다 spec을 고쳐야 한다). 다만 **기존 spec의 green 유지**가 게이트다:

- [ ] 스타일 편집기 진입·값 편집 spec (Task 2가 트리거를 교체하므로 셀렉터 회귀 가능)
- [ ] `e2e/style-shorthand-var.spec.ts` (CLAUDE.md가 "유일한 그물"로 지목 — `ValueCombobox` 변경이 걸린다)
- [ ] picker 요소 선택 spec (Task 5가 `picker.start`를 바꾼다)

**확인 필요**: 위 spec의 정확한 파일명은 `e2e/` 디렉터리를 읽고 확정한다. `/e2e-run`으로 전체 스위트를 한 번 돌리는 게 안전하다.

### 수동 테스트 (Chrome, `pnpm build` 선행 필수)

**시각 판정이라 자동화 불가한 항목만.** 전부 **라이트·다크 두 번** 확인한다.

- [ ] **R4** network error 행 선택 ↔ hover 구별 / console 코드블럭이 행 배경 위에 뜸
- [ ] **R5** console `log`·`debug` 레벨 코드블럭 배경이 사라지지 않음
- [ ] **R6** 스타일링 AI 진행 중 배너 잠금(흐림 + 재클릭 무시), 완료 후 복귀
- [ ] **R7** `margin` 4열 quad에 긴 토큰 값 → 트랙 안 뚫림(패널 폭 320px 포함)
- [ ] **R8** `LinkToggle` on/off × hover 4조합에서 아이콘 가시
- [ ] **R2** 확장 리로드 없이 기존 탭에서 picker → 카드 라이트 폴백
- [ ] **R3** 1-depth cross-origin iframe 내부 요소 hover → 카드 색이 top과 동일
- [ ] 🟡29 앱 theme(라이트/다크/system) × OS theme(라이트/다크) 6조합 중 최소 4조합
- [ ] 🟡30 flex gap 요소 hover → 채움·라벨 색 계열 일치, margin/padding과 구별
- [ ] 🟡28 CSS 뷰 경고 배너 글자 가독
- [ ] ⚪80 네트워크 상세 상태 dot 3종이 다크에서 안 묻힘
- [ ] **R12** 어노테이션 텍스트 도구로 새 박스 생성 시 placeholder 문구가 안 보인다
- [ ] Task 1 pill의 픽셀 무변화

---

## 구현 순서 권장

```
Task 1 (접근성)          ─┐
Task 7 (i18n 타입 게이트) ─┤ 병렬 가능 — 파일 겹침 없음
Task 6 (overlay 색/주석)  ─┘

Task 2 (shadcn 이행) ──► Task 3 (로그 색) ──► Task 4 (잔여 색/radius)
        시각 회귀 위험이 겹치므로 순차. 각 태스크마다 수동 확인을 끝내고 다음으로.

Task 5 (picker theme)   독립. 단 tokens.test.ts 앵커 교체가 끝나기 전엔 다른 테스트 결과를 믿지 않는다.

Task 8 (i18n 사전)      Task 7 이후 권장 — 7-2의 폴백이 있어야 8-3 삭제 중 실수가 화면을 안 깬다.

Task 9 (DESIGN.md)      전부 끝난 뒤 마지막. 별도 커밋.
```

**파일 충돌 주의**: `NetworkLogContent.tsx`에 **4개 항목**(Task 1의 🟡20·⚪85, Task 3의 🟡27, Task 4의 ⚪80)이 걸린다. 순차로 처리하거나 한 번에 열어 지점을 미리 특정한다.

**CI 게이트**: main required check는 `verify` + `e2e-gate` 둘(CLAUDE.md). `/push`는 e2e를 안 돌리므로, Task 2·5가 셀렉터를 건드린 뒤엔 로컬 `/e2e-run`으로 미리 확인하는 게 안전하다.

---

## 가이드 영향

**있다 — 스크린샷 한정.** 본문 텍스트·UI 라벨은 바뀌지 않으므로 `/guide`(본문 갱신)는 불필요하고, `/guide-shots`(스크린샷 재촬영)만 필요할 가능성이 높다.

스크린샷이 영향받을 수 있는 화면:

| 화면 | 원인 태스크 | 비고 |
|---|---|---|
| 로그(console/network) 탭 | Task 3·4 | Task 3은 값 이동이라 이론상 무변화 — **stale 탐지가 잡으면 그게 회귀 신호**다 |
| 요소 스타일 편집(폼·CSS 뷰) | Task 2·4 | 컨트롤 치수·hover·amber 배너가 실제로 바뀐다 |
| picker 인스펙터 카드가 실린 컷 | Task 5 | 촬영 환경의 OS 다크모드 설정에 따라 기존 컷이 이미 앱과 어긋나 있을 수 있다 |

**확인 필요**: 위 화면에 대응하는 `guide/{ko,en}` 파일명은 `guide/AUTHORING.md`의 IA를 읽고 확정한다. 촬영은 확장 로드 + 특권 `chrome.*` API가 있는 런타임에서만 가능하며, 없으면 stale 탐지·리포트까지만 돈다(CLAUDE.md).

**절차**: 구현 완료 → `/guide-shots`로 stale 탐지 → 변한 컷만 재촬영. 본문 문구 변경이 필요하다고 판명되면 그때 `/guide`.
