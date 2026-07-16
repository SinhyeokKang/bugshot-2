# mono 타이포그래피 튜닝 — 구현 태스크

## 선행 조건

- **새 의존성·권한·env·외부 API 없음.** `manifest.config.ts` 무변경. 코어 밸류(Privacy) 무영향(외부 요청 0).
- **shadcn 컴포넌트 추가 없음.**
- **착수 전 `docs/POSTMORTEM.md` grep**: `-e 'JSON 팔레트' -e 'vitest' -e 'typecheck' -e '단언'` — 이 작업의 배경 자체가 "미검증 단언"이라 그 회로를 먼저 소환한다.
- **`e2e/GOTCHAS.md`의 `document.fonts.check()` 항목**을 읽는다 — Task 5가 폰트 단언을 건드린다.
- **Tiptap 주입 스타일 확인법**: `@tiptap/core/src/style.ts`(소스) 또는 실행 중 DevTools의 `<style id="tiptap-style">`. **grep으로는 안 잡힌다** — 이 작업의 모든 특이도 판단이 여기 걸려 있다.

## 태스크

### Task 1: 리거처·자간 회귀 테스트 (테스트 먼저 — red)
- **변경 대상**: `src/styles/__tests__/tokens.test.ts`
- **작업 내용**: `describe("mono 타이포그래피")` 추가. 기존 `parseTokens`와 같은 기법(`readFileSync` + 정규식).
  - `globals.css`의 `@layer base`에 `.font-mono`·`pre`·`code`를 함께 거는 블록이 있고, 거기에 `font-variant-ligatures: none`이 있다.
  - **`font-feature-settings`로 리거처를 끄지 않았다** — body의 `"rlig" 1, "calt" 1`을 날리는 함정(design.md 대안 5). 그 블록에 `font-feature-settings`가 **없어야** 한다.
  - 셀렉터 리스트에 `.font-mono`와 `pre`가 **둘 다** 있다 — 진입 경로가 둘이라 하나만 있으면 조용히 갈라진다(v1.6.0이 밟은 함정을 고정).
  > **`tailwind.config.js`를 import하지 말 것** — `allowJs` 미설정이라 `pnpm test`는 통과해도 `pnpm typecheck`가 TS7016으로 깨진다(POSTMORTEM `2026-07-16 — vitest에서 멀쩡히 되는 import가…`). 이번엔 CSS만 읽으면 되므로 해당 없음.
- **검증**:
  - [ ] Task 2 전이므로 **실패**한다 (red 확인 — 블록 자체가 없음)

### Task 2: 리거처 off + 자간 (green)
- **변경 대상**: `src/styles/globals.css`
- **작업 내용**: `@layer base`에 블록 추가 (design.md "채택" 코드 그대로):
  ```css
  .font-mono, pre, code, kbd, samp {
    font-variant-ligatures: none;
    letter-spacing: -0.01em;
  }
  ```
  - **`@layer base`에 둔다** — utilities(`font-bold`·`tracking-*`)가 이겨야 한다.
  - **주석으로 WHY를 남긴다**: 진입 경로가 둘(`.font-mono` / preflight)이라 짝을 놓치면 갈라진다 + Geist `liga`가 기본 ON이라 `--`를 잇는다.
  - `font-feature-settings`는 **쓰지 않는다**(대안 5).
- **검증**:
  - [ ] `pnpm test tokens` 통과 (red→green)
  - [ ] `pnpm typecheck` 통과

### Task 3: Tiptap 코드블럭 — 12px + 가로 스크롤
- **변경 대상**: `src/sidepanel/components/tiptap-editor.css`
- **작업 내용**:
  1. `:94`(`.ProseMirror code`) `font-size: 0.875em` → `font-size: 12px`
  2. `:108`(`.ProseMirror pre`) `font-size: 0.875em` → `font-size: 12px`
  3. `:103` `.tiptap-editor .ProseMirror pre` 블록에 **`white-space: pre;` 추가** — Tiptap 주입 `.ProseMirror pre { white-space: pre-wrap }`(0,1,1)을 (0,2,1)로 이긴다. `overflow-x: auto`(`:107`)가 이걸로 살아난다.
  4. `:109` `line-height: 1.5` **유지**(목표값)
  5. `:113` `pre code { font-size: inherit }` **유지**
  - **`em`을 버리는 이유를 주석 한 줄로** — 4개 표면 12px 통일이 불변식이라 부모(`text-sm`)에 묶이면 안 된다.
- **검증**:
  - [ ] DevTools: 코드블럭 `<pre>`의 Computed `font-size: 12px`, `line-height: 18px`, `white-space: pre`
  - [ ] 뷰포트보다 긴 줄이 **접히지 않고** `<pre>`에 가로 스크롤바가 생긴다
  - [ ] 들여쓰기가 보존된다 (중첩 JSON에서 확인)
  - [ ] **한글 IME 조합**이 코드블럭 안에서 정상 (design.md 위험 요소 — jsdom·e2e 사각지대)
  - [ ] **긴 줄 끝 커서**가 가로 스크롤로 따라간다

### Task 4: CSS 뷰 + DOM 트리 — 12px + 행간 1.5
- **변경 대상**: `src/sidepanel/tabs/styleEditor/CssCodeMirror.tsx`, `src/sidepanel/tabs/DomTreeDialog.tsx`
> Task 3/4를 나누지 않는다 — 네 표면이 같은 12px이라는 게 불변식이라 하나만 들어가면 DESIGN.md가 선언할 상태가 깨진 채로 남는다. **동일 커밋.**

- **작업 내용**:
  - **CssCodeMirror**: `:237` `fontSize: "13px"` → `"12px"` / `:245` `lineHeight: "1.7"` → `"1.5"` / `:343` `fontSize: "13px"` → `"12px"` / `:229` 주석의 13px → 12px
    - **`:344` `lineHeight: "1.25rem"`은 건드리지 않는다** — li 높이이지 코드 행간이 아니다(편집 패널 `CommandItem`과 맞춘 값, 주석 명시)
    - `fontFamily: "inherit"` 5곳·`:330` 2-class 오버라이드 **손대지 않는다**
  - **DomTreeDialog**: `:201` `text-[13px]` → `text-[12px]` / `:271` 주석의 13px → 12px
    - **행간은 건드리지 않는다** — 명시값 없이 preflight `html { line-height: 1.5 }` 상속이라 이미 목표값
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] DevTools: CSS 뷰 `.cm-content`·DOM 트리 노드가 **둘 다** `font-size: 12px`, `line-height: 18px`
  - [ ] CSS 뷰 자동완성 팝업 li가 12px

### Task 5: e2e — `--` 리거처 회귀 + 폰트 단언 갱신
- **변경 대상**: `e2e/style-code-view.spec.ts`
- **작업 내용**:
  1. `:214` `document.fonts.load('13px "Geist Mono Variable"')` → `'12px …'`. **동작상 무의미**(size는 face 매칭용, Geist는 variable이라 전 크기 한 face)하나 실제 렌더 크기와 문서적 정합을 맞춘다. **이걸 "테스트를 고쳤다"고 착각하지 말 것**(design.md 위험 요소).
  2. **리거처 off 회귀 단언 추가** — CSS 뷰에서 `--`가 두 글리프로 렌더되는지. 판정 방법:
     ```ts
     // 리거처가 살아있으면 `--`가 한 글리프로 합쳐져 advance가 2셀보다 좁아진다.
     // getComputedStyle로 font-variant-ligatures를 보는 건 선언값 확인일 뿐이라,
     // Range.getBoundingClientRect로 실제 렌더 폭을 재 2 × 단일 문자폭과 비교한다.
     ```
     - **`getComputedStyle(el).fontVariantLigatures === "none"`만으로 끝내지 말 것** — 그건 "선언했다"이지 "적용됐다"가 아니다. `document.fonts.check()`가 폰트 없이도 true를 냈던 것과 같은 부류의 공허한 단언이다(`e2e/GOTCHAS.md`).
     - 실측이 어려우면 **선언 단언 + 수동 검증**으로 내리고 그 사유를 `e2e/COVERAGE.md` 수동 잔여에 기록한다.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e style-code-view` 통과
  - [ ] **비공허함 입증**: `globals.css`의 `font-variant-ligatures: none`을 임시로 지우면 새 단언이 **실패**한다 (확인 후 원복)

### Task 6: 시각 검증 + 자간 판정
- **변경 대상**: 없음(검증 전용). 조정 시 `globals.css`의 `letter-spacing` 한 값.
- **작업 내용**: **`/build` 스킬 실행 후** Chrome 언팩 로드. 아래 "수동 테스트 — 차단"을 통과시키고 자간을 판정한다.
  - **자간 판정 기준**: *"CSS 뷰에서 `var(--space-lg)` 같은 토큰이 답답하지 않으면서, 고정폭 그리드가 흐트러져 보이지 않을 것."* 너무 좁히면 mono 가독성이 되레 떨어진다.
  - 조정은 **1회로 끝낸다**. `-0.01em`↔`-0.02em`에서 결론이 안 나면 `-0.01em`으로 확정하고 후속으로 뺀다.
- **검증**: 아래 "수동 테스트 — 차단" 전부 + 자간 판정 기록.

### Task 7: 문서 갱신
- **변경 대상**: `docs/DESIGN.md`, `docs/features/code-block-collapse/prd.md`
- **작업 내용**:
  - **DESIGN.md `:66`** 재작성: 13px 2표면 → **12px 4표면**(CSS 뷰 본문·CM 자동완성 li·DOM 트리·Tiptap 코드블럭/인라인 코드) + 행간 1.5 + 자간 + 리거처 off. **두 진입 경로(`.font-mono` / preflight)를 명시** — 이게 짝을 놓치게 만드는 구조라는 걸 남겨야 다음 사람이 안 밟는다. 14px 기각 사유(mono 자폭 1.2배) 유지 + 13px 기각(큼) 추가.
  - **`code-block-collapse/prd.md :62`**: 틀린 grep 근거만 정정 — *"`grep -rn "prosemirror.css" src/` → 0건이라 안 걸린다"*는 거짓이다. Tiptap이 `@tiptap/core/src/style.ts`를 런타임 주입해 `.ProseMirror pre { white-space: pre-wrap }`가 활성이었다. 이 feature의 Task 3이 `white-space: pre`로 덮어 전제를 참으로 만든다는 **선행 의존**을 명시. **접기 로직·설계는 건드리지 않는다.**
- **검증**:
  - [ ] `DESIGN.md`에 12px·4표면·두 진입 경로·행간·자간·리거처가 모두 존재
  - [ ] `code-block-collapse/prd.md`에 선행 의존과 정정된 근거가 존재

## 테스트 계획

- **단위** (`src/styles/__tests__/tokens.test.ts`, node 트랙): `globals.css`의 mono 블록에 (a) `font-variant-ligatures: none` 존재 (b) `font-feature-settings` 부재 (c) 셀렉터에 `.font-mono`와 `pre` 둘 다 존재.
- **e2e** (`e2e/style-code-view.spec.ts`): *CSS 뷰에 `var(--x)`를 넣으면 `--`가 두 글리프 폭으로 렌더된다.* (실측 불가 시 선언 단언으로 내리고 수동 잔여 기록 — Task 5)
- **수동 — 차단(6)**: 통과 못 하면 진행 불가.
  - [ ] CSS 뷰 `var(--x)`의 `--`가 **하이픈 두 개**로 보이고 토큰 칩 하이라이트를 안 벗어난다
  - [ ] Tiptap 코드블럭: 긴 줄이 **접히지 않고 가로 스크롤**, 들여쓰기 보존
  - [ ] Tiptap 코드블럭에서 **한글 IME 조합 정상** (design.md 최대 위험 — 자동 검증 불가)
  - [ ] Tiptap 코드블럭 **긴 줄 끝 커서**가 스크롤로 따라간다
  - [ ] 네 표면 Computed가 **전부 `font-size:12px` / `line-height:18px`**
  - [ ] `NetworkLogContent`의 WebSocket 프레임 본문(`FrameBody`)이 **여전히 sans** (셀렉터 리스트에 `pre`가 들어가 자간·리거처가 걸리지만 family는 안 바뀌어야 함)
- **수동 — 관찰(자간 판정 입력)**:
  - [ ] CSS 뷰 토큰 자간 체감 → Task 6 기준에 대입
  - [ ] DOM 트리 트렁케이션이 v1.6.0 대비 나아졌는지 (12px + 자간 축소 효과 — 정량 측정은 스코프 밖)
  - [ ] 에디터 **본문 문단**(코드블럭 밖)이 영향 없는지 — `white-space` 변경이 `pre` 자손 한정인지 확인

## 구현 순서 권장

```
Task 1 (테스트 red) → Task 2 (리거처·자간 green)
                          └→ Task 3 + Task 4 (12px 4표면 + wrap, 동일 커밋)
                               └→ Task 5 (e2e)
                                    └→ Task 7 (문서)
                                         └→ Task 6 (시각 검증 + 자간 판정)
```

- Task 1→2는 TDD red→green.
- **Task 3·4는 동일 커밋** — 4개 표면 12px이 불변식이라 쪼개면 깨진 상태가 커밋에 남는다.
- Task 6은 실기기 의존이라 마지막. 자간 조정이 발생하면 Task 7의 DESIGN.md에 반영.

## 가이드 영향

**없음.** 폰트 크기·자간·행간·리거처는 가이드 본문의 설명 대상(기능·플로우·UI 라벨)이 아니다. `guide/{ko,en}/assets/*.jpg` 스크린샷의 렌더가 미세하게 달라지지만 UI 구조·라벨·플로우가 그대로라 재촬영 대상이 아니다.
