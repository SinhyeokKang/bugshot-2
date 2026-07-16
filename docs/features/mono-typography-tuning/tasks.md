# mono 타이포그래피 튜닝 — 구현 태스크

## 선행 조건

- **새 의존성·권한·env·외부 API 없음.** `manifest.config.ts` 무변경. 코어 밸류(Privacy) 무영향(외부 요청 0).
- **shadcn 컴포넌트 추가 없음.**
- **착수 전 `docs/POSTMORTEM.md` grep**: `-e 'JSON 팔레트' -e 'vitest' -e 'typecheck' -e '단언'` — 이 작업의 배경 자체가 "미검증 단언"이라 그 회로를 먼저 소환한다.
- **`e2e/GOTCHAS.md`의 `document.fonts.check()` 항목**을 읽는다 — Task 5가 폰트 단언을 건드린다.
- **Tiptap 주입 스타일 확인법**: **grep으로는 안 잡힌다** — 이 작업의 모든 특이도 판단이 여기 걸려 있다.
  - 실행 중: DevTools에서 **`style[data-tiptap-style]`** — `id`가 아니라 **속성**이다(`createStyleTag.ts:3`). `#tiptap-style`로 찾으면 0건이 나온다.
  - 파일: pnpm 레이아웃이라 루트 `node_modules/@tiptap/core`에 **없다** → `node_modules/.pnpm/@tiptap+core@3.23.4_@tiptap+pm@3.23.4/node_modules/@tiptap/core/dist/index.js`의 `// src/style.ts` 구간(L4610-4681)

## 태스크

### Task 1: 리거처·자간 회귀 테스트 (테스트 먼저 — red)
- **변경 대상**: `src/styles/__tests__/tokens.test.ts`
- **작업 내용**: `describe("mono 타이포그래피")` 추가. `readFileSync` + 정규식이라는 **기법**은 기존과 같지만 **`parseTokens`는 재사용 불가 — 헬퍼를 새로 짜야 한다**:
  - `:18` `/--([\w-]+):\s*([^;]+);/g` → **`--`로 시작하는 커스텀 프로퍼티만** 잡는다. `font-variant-ligatures: none;`은 매치조차 안 된다.
  - `:13` `css.indexOf(\`${selector} {\`)` → **완전 일치 문자열 검색**이라 멀티라인 셀렉터 리스트(`.font-mono,\n  pre,\n  code {`)를 못 찾는다.
  - `:15` `css.indexOf("}", start)` → 첫 `}`에서 끊는다.
  - **블록 경계를 정확히 잘라야 한다** — 특히 아래 (b)를 파일 전체 grep으로 짜면 `globals.css:83`의 body `font-feature-settings` 때문에 **항상 실패**한다.
- **단언**:
  - (a) `globals.css`의 `@layer base`에 `.font-mono`·`pre`·`code`를 함께 거는 블록이 있고, 거기에 `font-variant-ligatures: none`이 있다.
  - (b) **그 블록에 `font-feature-settings`가 없다** — body의 `"rlig" 1, "calt" 1`을 날리는 함정(design.md 대안 5).
  - (c) 셀렉터 리스트에 `.font-mono`와 `pre`가 **둘 다** 있다 — 진입 경로가 둘이라 하나만 있으면 조용히 갈라진다(v1.6.0이 밟은 함정을 고정). **`kbd`/`samp`는 단언에 넣지 않는다** — `src/`에 0건이라 지키는 게 없는 단언이 된다.
- **함께**: **`:112`의 주석을 정정한다.** *".font-mono 규칙은 사이드패널과 log-viewer 두 빌드에 똑같이 나가는데…"*는 공유 `tailwind.config.js`가 주는 **유틸리티**엔 참이지만 **Task 2가 넣는 base 규칙엔 거짓**이다(log-viewer는 `globals.css`를 import하지 않고 자체 `styles.css`를 쓴다). 편집하는 파일의 몇 줄 위라 지금 안 고치면 거짓인 채로 남는다.
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

### Task 3: 에디터·프리뷰 코드블럭 — 12px + 가로 스크롤
- **변경 대상**: `src/sidepanel/components/tiptap-editor.css` **+ `src/sidepanel/components/doc-section-body.css`**
> **두 파일은 짝이다** — code/pre 규칙이 **바이트 동일한 클론**이고 같은 마크다운의 편집 화면/프리뷰다. 한쪽만 고치면 12px vs 12.25px로 갈라져 WYSIWYG이 깨진다. **v1.6.0이 짝을 놓친 것과 같은 실패 클래스라, 이 feature가 그걸 반복하면 안 된다.**

- **작업 내용**:
  1. `tiptap-editor.css:94`(`.ProseMirror code`) `font-size: 0.875em` → `12px`
  2. `tiptap-editor.css:108`(`.ProseMirror pre`) `font-size: 0.875em` → `12px`
  3. `tiptap-editor.css:103` `.tiptap-editor .ProseMirror pre` 블록에 **`white-space: pre;` 추가** — Tiptap 주입 `.ProseMirror pre { white-space: pre-wrap }`(0,1,1)을 (0,2,1)로 이긴다. `overflow-x: auto`(`:107`)가 이걸로 살아난다.
  4. **`doc-section-body.css:72`·`:86` `font-size: 0.875em` → `12px`** (위 1·2의 짝)
  5. `line-height: 1.5` **유지** — `tiptap-editor.css:109`·`doc-section-body.css:87` 둘 다 목표값
  6. `pre code { font-size: inherit }` **유지** — `tiptap-editor.css:117`·`doc-section-body.css:95`
  - **`doc-section-body.css`엔 `white-space`를 추가하지 않는다** — 프리뷰는 ProseMirror가 아니라 주입 스타일이 안 걸리고 UA 기본 `pre`가 이미 이긴다. `overflow-x: auto`(`:85`)도 이미 살아 있다.
  - **`em`을 버리는 이유를 주석 한 줄로** — 전 표면 12px 통일이 불변식이라 부모(`text-sm`)에 묶이면 안 된다. **두 파일이 짝이라는 것도** 한 줄.
- **검증**:
  - [ ] DevTools: 코드블럭 `<pre>`의 Computed `font-size: 12px`, `line-height: 18px`, `white-space: pre`
  - [ ] 뷰포트보다 긴 줄이 **접히지 않고** 가로 스크롤이 **`<pre>` 안에서만** 생긴다 — 에디터·사이드패널 전체가 밀리지 않는다. (`overflow-x: auto`는 지금까지 죽은 코드라 **이 레이아웃에서 한 번도 실행된 적이 없다**. `.tiptap-editor`가 column flex이고 `.ProseMirror`가 `flex:1`이라 이론상 cross-axis가 stretch로 캡되고 프리뷰가 같은 구성으로 이미 동작 중이지만, 에디터 레이아웃에선 미검증 경로다.)
  - [ ] 들여쓰기가 보존된다 (중첩 JSON에서 확인)
  - [ ] **한글 IME 조합**이 코드블럭 안에서 정상 (design.md 최대 위험 — jsdom·e2e 사각지대)
  - [ ] **긴 줄 끝 커서**가 가로 스크롤로 따라간다
  - [ ] **에디터 ↔ 프리뷰 전환 시 코드블럭이 같은 크기**로 보인다 (짝 검증)

### Task 4: CSS 뷰 + DOM 트리 + 로그 — 12px
- **변경 대상**: `src/sidepanel/tabs/styleEditor/CssCodeMirror.tsx`, `src/sidepanel/tabs/DomTreeDialog.tsx`, `src/sidepanel/components/NetworkLogContent.tsx`
> Task 3/4를 나누지 않는다 — 전 표면이 같은 12px이라는 게 불변식이라 하나만 들어가면 DESIGN.md가 선언할 상태가 깨진 채로 남는다. **동일 커밋.**

- **작업 내용**:
  - **CssCodeMirror**: `:237` `fontSize: "13px"` → `"12px"` / `:245` `lineHeight: "1.7"` → `"1.5"` / `:343` `fontSize: "13px"` → `"12px"` / `:229`·`:335` 주석의 13px → 12px
    - **`:344` `lineHeight: "1.25rem"`은 건드리지 않는다** — li 높이이지 코드 행간이 아니다(편집 패널 `CommandItem`과 맞춘 값, 주석 명시)
    - `fontFamily: "inherit"` 5곳·`:331` 2-class 오버라이드 **손대지 않는다**
  - **DomTreeDialog**: `:201` `text-[13px]` → **`text-xs`** / `:271` 주석의 클래스명 갱신
    - **`text-[12px]`가 아니다.** `text-xs`는 12px + `line-height: 1rem`(16px)이고, DOM 트리는 코드블럭이 아니라 **한 줄이 한 항목인 리스트**라 이 행간이 맞다 — 이미 `text-xs`인 로그 mono 5곳과 같은 그룹으로 18 → 16px 합류. 스케일 유틸이라 다음 사람이 "정리"하다 행간을 깨뜨릴 여지도 없다(design.md 대안 8).
  - **NetworkLogContent**: `:576` `text-[11px]` → **`text-xs`** — mono 7곳 중 유일하게 12px이 아니던 표면. 형제인 `ConsoleLogContent:254`·`:262`가 이미 `text-xs`다.
    - **`:733`의 `FrameBody`(`font-sans text-[11px]`)는 건드리지 않는다** — sans 표면이다.
  - **`ConsoleLogContent:254`·`:262`, `LogSeekChip:11`·`:22`는 무변경** — 이미 `text-xs`(12px)라 목표값에 서 있다. 단 자간·리거처는 새로 걸리므로 Task 6에서 눈으로 본다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] DevTools: CSS 뷰 `.cm-content`가 `font-size: 12px` / `line-height: 18px`
  - [ ] DevTools: DOM 트리 노드·네트워크 본문 `<pre>`가 `font-size: 12px` / `line-height: 16px`
  - [ ] CSS 뷰 자동완성 팝업 li가 12px (**띄우는 법**: CSS 뷰에서 속성명 일부를 타이핑 — 예 `col`)

### Task 5: e2e — `--` 리거처 회귀 + 폰트 단언 갱신
- **변경 대상**: `e2e/style-code-view.spec.ts`
- **작업 내용**:
  1. `:214` `document.fonts.load('13px "Geist Mono Variable"')` → `'12px …'`. **동작상 무의미**(size는 face 매칭용, Geist는 variable이라 전 크기 한 face)하나 실제 렌더 크기와 문서적 정합을 맞춘다. **이걸 "테스트를 고쳤다"고 착각하지 말 것**(design.md 위험 요소).
  2. **리거처 off 회귀 단언 추가** — CSS 뷰에서 `--`가 두 글리프로 렌더되는지. 판정 방법:
     ```ts
     // 리거처가 살아있으면 `--`가 한 글리프로 합쳐져 advance가 2셀 → 1셀로 붕괴한다.
     // (fontTools 실측: hyphen advance=600, hyphen_hyphen.liga advance=600 — 1200이 아니다.)
     // getComputedStyle로 font-variant-ligatures를 보는 건 선언값 확인일 뿐이라,
     // Range.getBoundingClientRect로 실제 렌더 폭을 재 2 × 단일 하이픈 폭과 비교한다.
     ```
     - **`getComputedStyle(el).fontVariantLigatures === "none"`만으로 끝내지 말 것** — 그건 "선언했다"이지 "적용됐다"가 아니다. `document.fonts.check()`가 폰트 없이도 true를 냈던 것과 같은 부류의 공허한 단언이다(`e2e/GOTCHAS.md`).
     - **폴백 없음.** 12px에서 리거처 ON이면 6px, OFF면 12px — **2배 차이의 이산 판정**이라 오차 마진이 낄 여지가 없고, e2e가 headed라 실제 폰트 렌더 경로를 탄다. 실측은 가능하다. (이전 판의 *"실측이 어려우면 선언 단언으로 내린다"* 헤지는 삭제했다 — 손쉬운 공허한 단언으로 도망갈 명분이 된다.)
  3. **크기 불변식 단언 추가** — `.cm-content`의 computed `font-size: 12px` / `line-height: 18px`. v1.6.0이 실제로 깨뜨린 건 **크기 불변식**인데 지금 자동 그물이 0이다(Task 1은 `globals.css`만 본다). `style-css-view` locator가 이미 있어 거의 공짜이고 선언이 아니라 렌더를 잰다.
- **함께**: **`e2e/COVERAGE.md` 갱신** — style-code-view 맵 행(현재 "serial 9")에 새 시나리오 추가. 리거처 렌더 판정 기법은 GOTCHAS에 선례가 전무하므로(폰트 항목은 `document.fonts.check()` 하나뿐) **`e2e/GOTCHAS.md`에도 남긴다**.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e style-code-view` 통과
  - [ ] **비공허함 입증**: `globals.css`의 `font-variant-ligatures: none`을 임시로 지우면 새 단언이 **실패**한다 (확인 후 원복)

### Task 6: 시각 검증 + 자간 판정
> **Task 7(문서)보다 먼저다** — DESIGN.md에 확정된 자간 값을 적어야 하므로, 값이 미정인 채로 문서를 쓰고 나중에 역참조로 때우면 안 된다.

- **변경 대상**: 없음(검증 전용). 조정 시 `globals.css`의 `letter-spacing` 한 값.
- **작업 내용**: **`/build` 스킬 실행 후** Chrome 언팩 로드. 아래 "수동 테스트 — 차단"을 통과시키고 자간을 판정한다.
  - **자간 판정 기준**: *"CSS 뷰에서 `var(--space-lg)` 같은 토큰이 답답하지 않으면서, 고정폭 그리드가 흐트러져 보이지 않을 것."* 너무 좁히면 mono 가독성이 되레 떨어진다.
  - **라이트·다크 양 테마에서 본다** — 다크 배경 위 밝은 글자는 halation으로 번져 더 굵고 조밀하게 보인다. 라이트에서 튜닝한 값이 다크에선 과하게 좁을 수 있다.
  - **`-0.01em`은 12px에서 글자당 0.12px**(45자 줄 전체로도 5.4px ≈ 0.75자)라 사실상 no-op에 가깝다는 점을 알고 시작한다. "Geist Mono 기본 트래킹이 넓다"가 진짜 불만이면 `-0.02~-0.03em`이 필요한데 그 구간은 고정폭 그리드를 흐트러뜨린다 — **이 트레이드오프가 판정의 실체**다.
  - 조정은 **1회로 끝낸다**. `-0.01em`↔`-0.02em`에서 결론이 안 나면 `-0.01em`으로 확정하고 후속으로 뺀다.
- **검증**: 아래 "수동 테스트 — 차단" 전부 + 자간 판정 기록(값 + 어느 테마·디스플레이에서 봤는지).

### Task 7: 문서 갱신 (Task 6 뒤)
- **변경 대상**: `docs/DESIGN.md`, `docs/features/code-block-collapse/prd.md`
- **작업 내용**:
  - **DESIGN.md `:66`** 재작성: 13px 2표면 → **12px 전 표면 + 행간 두 그룹**
    - 크기 12px: CSS 뷰 본문 · CM 자동완성 li · DOM 트리 · Tiptap 코드블럭/인라인 · 프리뷰 코드블럭/인라인 · 콘솔 2 · LogSeekChip 2 · 네트워크
    - 행간: **코드블럭 3개**(CSS 뷰 본문·Tiptap `pre`·프리뷰 `pre`) 18px / **리스트·칩 6개**(DOM 트리·콘솔 2·LogSeekChip 2·네트워크) `text-xs` 16px. 축이 달라 제외: 인라인 `code`(문단 상속)·CM 자동완성 li(`1.25rem` li 높이)
    - 자간(Task 6 확정값) + 리거처 off
    - **두 진입 경로(`.font-mono` / preflight)**와 **두 클론 파일(`tiptap-editor.css` / `doc-section-body.css`)**을 짝으로 명시 — 이게 짝을 놓치게 만드는 구조라는 걸 남겨야 다음 사람이 안 밟는다
    - **`text-[12px]`가 아니라 `text-xs`인 이유**(행간 그룹) + `0.875em` → `12px`이 부모를 안 따라간다는 트레이드오프
    - 14px 기각 사유(mono 자폭 1.2배) 유지 + 13px 기각(큼) 추가
    - **§4에 임의값 정책 한 줄 추가**: "스케일에 대응값이 없을 때만 `text-[…]`" (현재 §5 간격에만 있고 타이포엔 없다)
  - **`code-block-collapse/prd.md :62`**: 근거만 정정 — *"grep이 틀렸다"가 아니다.* `grep -rn "prosemirror.css" src/` → 0건은 **지금도 사실**이고 원저자는 문제 규칙·실패 모드를 이미 특정해뒀다. 틀린 건 **출처가 하나라고 본 것** — `@tiptap/core`가 동일 CSS를 자체 보유하다 `<style data-tiptap-style>`로 런타임 주입하므로, import를 grep해선 안 잡히는 두 번째 경로로 `.ProseMirror pre { white-space: pre-wrap }`가 활성이었다. 이 feature의 Task 3이 `white-space: pre`로 덮어 전제를 참으로 만든다는 **선행 의존**을 명시하고, **가로 스크롤바 10px이 접기 높이 계산의 새 항**이 된다는 사실도 넘긴다. **접기 로직·설계는 건드리지 않는다.**
- **검증**:
  - [ ] `DESIGN.md`에 12px·표면 목록·두 행간 그룹·두 진입 경로·두 클론 파일·자간(확정값)·리거처·`text-xs` 근거가 모두 존재
  - [ ] `code-block-collapse/prd.md`에 선행 의존·정정된 근거·스크롤바 항이 존재

## 테스트 계획

- **단위** (`src/styles/__tests__/tokens.test.ts`, node 트랙): `globals.css`의 mono 블록에 (a) `font-variant-ligatures: none` 존재 (b) `font-feature-settings` 부재 (c) 셀렉터에 `.font-mono`와 `pre` 둘 다 존재. **새 파서 헬퍼 필요**(`parseTokens` 재사용 불가 — Task 1).
- **e2e** (`e2e/style-code-view.spec.ts`): (a) *CSS 뷰에 `var(--x)`를 넣으면 `--`가 단일 하이픈의 **2배 폭**으로 렌더된다* (b) *`.cm-content`의 computed가 `font-size: 12px` / `line-height: 18px`이다*. 둘 다 선언이 아니라 렌더 실측.
- **수동 — 차단(8)**: 통과 못 하면 진행 불가.
  - [ ] CSS 뷰 `var(--x)`의 `--`가 **하이픈 두 개**로 보이고 토큰 칩 하이라이트를 안 벗어난다
  - [ ] Tiptap 코드블럭: 긴 줄이 **접히지 않고**, 가로 스크롤이 **`<pre>` 안에서만** 생긴다(에디터·패널 전체가 안 밀림), 들여쓰기 보존
  - [ ] Tiptap 코드블럭에서 **한글 IME 조합 정상** (design.md 최대 위험 — 자동 검증 불가)
  - [ ] Tiptap 코드블럭 **긴 줄 끝 커서**가 스크롤로 따라간다
  - [ ] **에디터 ↔ 프리뷰 코드블럭이 같은 크기** (`tiptap-editor.css` / `doc-section-body.css` 짝 검증)
  - [ ] 코드블럭 3개 Computed가 **`font-size:12px` / `line-height:18px`**, 리스트·칩 6개가 **`font-size:12px` / `line-height:16px`**
  - [ ] `NetworkLogContent`의 WebSocket 프레임 본문(`FrameBody`)이 **여전히 sans** (셀렉터 리스트에 `pre`가 들어가 자간·리거처가 걸리지만 family는 안 바뀌어야 함)
  - [ ] **양 테마(라이트/다크)**에서 위 항목이 성립
- **수동 — 관찰(자간 판정 입력)**:
  - [ ] CSS 뷰 토큰 자간 체감 → Task 6 기준에 대입 (**라이트·다크 둘 다**)
  - [ ] **`LogSeekChip`의 `w-8`(32px 고정) 박스** — mono 7곳 중 유일하게 자간이 레이아웃과 결합한다. 라벨 배치가 틀어지지 않는지
  - [ ] **가로 스크롤바 10px**이 실제로 얼마나 거슬리는지 — 1~2줄 코드블럭에서 높이의 23%다. 거슬리면 wrap 토글(design.md 대안 7)을 후속으로 올린다
  - [ ] DOM 트리 트렁케이션이 v1.6.0 대비 나아졌는지 (13→12px + 자간 축소 효과 — 정량 측정은 스코프 밖)
  - [ ] 에디터 **본문 문단**(코드블럭 밖)이 영향 없는지 — `white-space` 변경이 `pre` 자손 한정인지 확인
  - [ ] **빈 코드블럭**의 빈 줄 높이, CodeMirror placeholder, DOM 트리 로딩이 12px에서 정상인지

## 구현 순서 권장

```
Task 1 (테스트 red) → Task 2 (리거처·자간 green)
                          └→ Task 3 + Task 4 (전 표면 12px + wrap, 동일 커밋)
                               └→ Task 5 (e2e)
                                    └→ Task 6 (시각 검증 + 자간 판정)
                                         └→ Task 7 (문서 — 확정된 자간 값을 받는다)
```

- Task 1→2는 TDD red→green.
- **Task 3·4는 동일 커밋** — 전 표면 12px이 불변식이라 쪼개면 깨진 상태가 커밋에 남는다. Task 3 안에서도 `tiptap-editor.css`·`doc-section-body.css`는 짝이라 함께 간다.
- **Task 6 → Task 7 순서** — DESIGN.md가 자간 확정값을 담아야 하므로 시각 판정이 문서보다 앞선다. (역참조로 때우지 않는다.)

## 가이드 영향

**없음.** 폰트 크기·자간·행간·리거처는 가이드 본문의 설명 대상(기능·플로우·UI 라벨)이 아니다. `guide/{ko,en}/assets/*.jpg` 스크린샷의 렌더가 미세하게 달라지지만 UI 구조·라벨·플로우가 그대로라 재촬영 대상이 아니다.
