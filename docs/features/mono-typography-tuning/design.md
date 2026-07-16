# mono 타이포그래피 튜닝 — 기술 설계

## 개요

값 조정 다섯 개지만 본론은 **"mono 표면"이 한 셀렉터로 안 잡힌다**는 구조다. CSS 뷰·DOM 트리는 `.font-mono`로, Tiptap 코드블럭은 Tailwind preflight로 Geist를 받는다. 이 설계는 그 둘을 **`@layer base`의 단일 셀렉터 리스트로 묶어** 크기·행간·자간·리거처를 한 곳에서 주고, 표면별 잔재(CM의 인라인 theme, Tiptap의 `0.875em`)를 그 단일 출처에 양보시킨다.

런타임 로직·상태·메시지 변경은 없다. 순수 CSS·상수 변경이다.

## mono 진입 경로 (설계의 축)

```
tailwind.config.js  fontFamily.mono = ["Geist Mono Variable", …fallback]
        │
        ├── .font-mono 유틸리티 ──→ CssCodeMirror:723 래퍼 ──→ .cm-editor 이하 (fontFamily:"inherit" 체인)
        │                       └─→ DomTreeDialog:201 Card ──→ DomTreeNode 전체
        │
        └── preflight (code, kbd, samp, pre) ──→ Tiptap .ProseMirror pre/code   ← .font-mono 밖!
                                             └─→ DocSectionBody / IssuePreviewView (프리뷰 — 이번 스코프 밖)
```

**두 경로가 만나는 지점이 없다.** 그래서 `.font-mono`에만 규칙을 걸면 Tiptap이 빠지고, preflight 대상에만 걸면 CSS 뷰·DOM 트리가 빠진다. v1.6.0이 전자를 밟았다.

### 채택: 두 경로를 한 셀렉터 리스트로 묶는다

```css
/* globals.css — @layer base */
/* Geist를 받는 두 경로(.font-mono 유틸 / preflight의 pre·code)를 한 곳에서 튜닝한다.
   경로가 갈려 있어 한쪽만 고치면 조용히 어긋난다(v1.6.0이 13px 통일에서 Tiptap을 놓친 이유). */
.font-mono,
pre,
code,
kbd,
samp {
  font-variant-ligatures: none;   /* Geist의 liga가 `--`를 잇는다 — CSS 토큰이 전부 깨진다 */
  letter-spacing: -0.01em;        /* 초기값 — Task 6 시각 검증에서 1회 조정 */
}
```

- **`@layer base`에 둔다.** utilities보다 약해서 `font-bold`·`tracking-*` 같은 유틸이 정상적으로 이긴다.
- **`font-feature-settings`를 쓰지 않는다.** body(`globals.css:82`)의 `"rlig" 1, "calt" 1`을 통째로 덮어써 날린다(가산 안 됨). `font-variant-ligatures`는 별도 속성이라 안전하다.
- **`pre`/`code`가 `font-sans`를 명시한 경우**(`NetworkLogContent.tsx:733`의 `FrameBody`)도 이 리스트에 걸려 자간·리거처가 적용된다. 리거처는 Pretendard에 `--` 리거처가 없어 무해하고, 자간 `-0.01em`은 11px에서 0.11px라 무시 가능하다. 이걸 피하려고 셀렉터를 정교하게 만드는 건 오버엔지니어링이다(대안 2 참조).
- **크기·행간은 여기 넣지 않는다.** `pre`/`code`는 `em` 문맥(프리뷰·인라인 코드)에 걸쳐 있어 일괄 px 지정이 인라인 코드를 깨뜨린다 — 표면별로 준다(아래).

## 변경 범위

### `src/styles/globals.css`
- **현재 역할**: `:1-2` 폰트 `@import`, `:4-6` `@tailwind`, `:8-67`·`:69-106` `@layer base`(토큰 표·body·스크롤바). `letter-spacing`·`font-variant-ligatures` 지정 0건.
- **변경 내용**: `@layer base`에 위 블록 1개 추가.

### `src/sidepanel/tabs/styleEditor/CssCodeMirror.tsx`
- **현재 역할**: CSS 코드 뷰. `EditorView.theme`이 `"&"`(`.cm-editor`)에 `fontSize: "13px"`(`:237`), `.cm-scroller`에 `lineHeight: "1.7"`(`:245`), 자동완성 li에 `fontSize: "13px"`(`:343`)을 준다. family는 `:723` 래퍼의 `font-mono`를 `fontFamily:"inherit"` 체인으로 상속(5곳).
- **변경 내용**:
  - `:237` `fontSize: "13px"` → `"12px"`
  - `:245` `lineHeight: "1.7"` → `"1.5"`
  - `:343` `fontSize: "13px"` → `"12px"` (본문과 짝 — 주석이 이미 "본문(13px)과 맞춤"이라 명시하므로 숫자도 함께 갱신)
  - `:229` 주석의 "Geist Mono·13px" → "12px"
- **`:344`의 `lineHeight: "1.25rem"`(자동완성 li)은 건드리지 않는다** — 그건 텍스트 행간이 아니라 li 높이이고 편집 패널 `CommandItem`/`TokenItem`과 맞춘 값이다(주석 명시). 코드 행간과 다른 축이다.
- **`fontFamily: "inherit"` 5곳·`:330` 2-class 오버라이드는 손대지 않는다.**

### `src/sidepanel/tabs/DomTreeDialog.tsx`
- **현재 역할**: `:201` Card가 `font-mono text-[13px]`로 트리 전체에 크기·family를 준다. 행간은 명시값 없이 preflight `html { line-height: 1.5 }` 상속 = 이미 1.5.
- **변경 내용**: `:201` `text-[13px]` → `text-[12px]`. **행간은 건드리지 않는다**(이미 목표값).
- `:271`의 주석(`크기는 Card의 text-[13px]에 맡긴다`)에서 숫자 갱신.

### `src/sidepanel/components/tiptap-editor.css`
- **현재 역할**: `:90` `.tiptap-editor .ProseMirror code`(배경·radius·padding·`font-size: 0.875em`), `:103` `.tiptap-editor .ProseMirror pre`(+`overflow-x: auto` `:107`, `line-height: 1.5` `:109`), `:113` `pre code`(`font-size: inherit`). `white-space` 지정 0건 → **Tiptap이 주입한 `.ProseMirror pre { white-space: pre-wrap }`가 이긴다.**
- **변경 내용**:
  1. `:94`·`:108` `font-size: 0.875em` → `font-size: 12px`. **`em`을 버리는 이유**: 네 표면이 같은 12px이라는 게 불변식인데 하나만 부모(`text-sm`)에 묶여 있으면 부모가 바뀔 때 조용히 갈라진다. 인라인 코드도 14px 본문 속 12px이라 비율(0.857)이 현행(0.875)과 사실상 같아 체감 변화가 없다.
  2. `:103` 블록에 **`white-space: pre` 추가** — Tiptap 주입 스타일(`.ProseMirror pre`, 특이도 (0,1,1))을 `.tiptap-editor .ProseMirror pre`(0,2,1)로 이긴다. 이걸로 `:107`의 `overflow-x: auto`가 비로소 살아난다.
  3. `:109` `line-height: 1.5`는 그대로(목표값).
- **`:113` `pre code { font-size: inherit }`는 그대로** — `pre`의 12px를 그대로 받는다.

### `docs/DESIGN.md`
- **현재 역할**: `:66`이 "코드뷰는 13px mono로 통일 — CSS 코드 뷰와 DOM 트리는 짝을 이루는 불변식".
- **변경 내용**: 12px·**4개 표면**·행간 1.5·자간·리거처 off로 재작성 + **두 진입 경로(`.font-mono` / preflight) 명시**. 14px 기각 사유(mono 자폭 1.2배)는 유지하되 13px 기각(너무 큼)을 추가.

### `e2e/style-code-view.spec.ts`
- **현재 역할**: `:214` `document.fonts.load('13px "Geist Mono Variable"')`로 `@font-face` 로드를 단언.
- **변경 내용**: `13px` → `12px`. **동작상 무의미하지만**(`fonts.load`의 size는 매칭용이고 variable font는 전 크기 한 face) 문서로서 실제 렌더 크기와 어긋나면 다음 사람이 오해한다. Task 5의 새 단언은 별도.

### `docs/features/code-block-collapse/prd.md`
- **변경 내용**: `:62`의 틀린 근거만 정정(아래 "선행 해소").

## 데이터 흐름

런타임 흐름 없음. **CSS 캐스케이드 해소 순서**가 이 설계의 실체다.

```
[Tiptap 코드블럭의 white-space]
  UA:                  pre                       (특이도 —)
  Tiptap 주입:         .ProseMirror pre → pre-wrap   (0,1,1)  ← 현재 승자 (줄바꿈 발생)
  이번 변경:           .tiptap-editor .ProseMirror pre → pre  (0,2,1)  ← 새 승자
                       ↳ overflow-x: auto(:107)가 비로소 발동

[리거처]
  Geist liga:          기본 ON → `--` 이어붐
  Tiptap 주입:         .ProseMirror { font-variant-ligatures: none }  ← Tiptap만 이미 방어됨
  이번 변경:           @layer base { .font-mono, pre, code, … { font-variant-ligatures: none } }
                       ↳ CSS 뷰·DOM 트리가 비로소 방어됨 (Tiptap은 중복이나 무해)

[크기 — 표면별로 준다]
  .cm-editor    fontSize 12px (인라인 theme)
  Card          text-[12px]
  .ProseMirror pre/code  font-size 12px  (em 아님)
```

## 인터페이스 설계

새 TypeScript 타입·함수·메시지 없음. 계약은 CSS 사실 다섯 개다:

```
globals.css @layer base
  .font-mono, pre, code, kbd, samp {
    font-variant-ligatures: none;    // Geist liga가 `--`를 잇는 걸 차단
    letter-spacing: <tuned>;         // 초기 -0.01em
  }

mono 4개 표면의 computed:
  font-size: 12px
  line-height: 18px        // 12 × 1.5

tiptap-editor.css
  .tiptap-editor .ProseMirror pre { white-space: pre; }   // 주입 pre-wrap을 특이도로 이김
```

## 기존 패턴 준수

- **테스트 트랙**: CSS 값 검증이라 `*.test.ts`(node). `tokens.test.ts`가 이미 `readFileSync`+정규식으로 `globals.css`·`tailwind.config.js`를 읽는 선례.
- **`tailwind.config.js`를 import하지 말 것** — `allowJs`가 없어 `pnpm test`는 통과해도 `pnpm typecheck`가 TS7016으로 깨진다. POSTMORTEM `2026-07-16 — vitest에서 멀쩡히 되는 import가 typecheck만 깨…` 항목. 이번엔 `globals.css`·`tiptap-editor.css`만 읽으면 되므로 해당 없음이나, 확장 시 재발 주의.
- **주석 최소화**(CLAUDE.md): `globals.css`의 새 블록은 WHY가 비자명하므로(경로가 둘이라 짝을 놓치면 갈라진다 / liga가 기본 ON) 주석 유지. 나머지 숫자 변경은 주석 불요.
- **i18n·권한·매니페스트 영향 0**: 새 문자열·권한·외부 요청 없음. `manifest.config.ts` 무변경.
- **코어 밸류(Privacy) 무영향**: 외부 요청 0.
- **POSTMORTEM 소환**: `2026-07-16 — JSON 팔레트 단일 출처`("단언은 grep으로 검증한다")가 이 작업의 배경 그 자체다 — v1.6.0의 리거처 단언·13px 통일 단언이 전부 미검증이었다. 이번 문서의 모든 사실은 fontTools·CSS 실측으로 확인했다.

## 대안 검토

1. **`.font-mono`에만 규칙을 건다** — 기각. **Tiptap이 빠진다.** 그게 v1.6.0이 밟은 함정이고 이 작업이 존재하는 이유다. 리거처만 놓고 보면 Tiptap이 자체 방어(`.ProseMirror`에 `font-variant-ligatures: none` 주입)해서 우연히 통과하지만, **자간은 그대로 빠진다** — 우연에 기대는 설계다.

2. **셀렉터를 정교하게 좁힌다** (`pre:not(.font-sans)` 등) — 기각. `FrameBody`의 `font-sans` `<pre>` 하나 때문에 셀렉터를 복잡하게 만드는 비용이 이득보다 크다. 그 요소에 자간 `-0.01em`(11px에서 0.11px)·리거처 off(Pretendard에 `--` 리거처 없음)가 적용돼도 관측 가능한 변화가 없다.

3. **Tiptap 코드블럭에 `font-mono` 클래스를 붙인다** (`editorProps.attributes` 또는 CodeBlock 확장의 `HTMLAttributes`) — 기각. 그러면 셀렉터가 하나로 통일되나, **에디터 본문은 sans여야 하므로 루트엔 못 붙이고** CodeBlock 확장에 `HTMLAttributes: { class: "font-mono" }`를 줘야 한다. 그건 (a) 인라인 `code` 마크에 별도로 또 붙여야 하고 (b) `renderHTML`이 마크다운 왕복(`tiptap-markdown`)에 클래스를 흘릴 위험이 있고 (c) 이미 preflight가 family를 주고 있어 **중복**이다. CSS 한 블록이 더 싸다.

4. **`white-space: pre-wrap`을 두고 들여쓰기만 복구** (`text-indent` 음수 + `padding-left` 트릭) — 기각. contenteditable 커서 위험이 0이라는 장점이 있으나, **가로 스크롤이 영영 안 생기고** `overflow-x: auto`가 죽은 채로 남는다. 사용자 요구가 "가로 스크롤이 안 생긴다"이므로 증상을 절반만 고친다. 무엇보다 `code-block-collapse`의 "줄 수 = 화면 높이" 전제를 **거짓인 채로 방치**한다.

5. **`liga`를 `font-feature-settings: "liga" 0`으로 끈다** — 기각. body의 `"rlig" 1, "calt" 1`을 통째로 덮어써 날린다(가산 안 됨 — v1.6.0 design.md가 기록한 함정). Geist Mono엔 `rlig`/`calt`가 없어 mono 표면에선 손실이 없지만, 이 셀렉터 리스트엔 `font-sans` `<pre>`도 걸려서 실제로 잃는다. `font-variant-ligatures`가 정확한 도구다.

6. **`--`만 살리는 리거처 예외** — 불가. `liga`는 feature 단위로만 켜고 끈다. 개별 치환 비활성화는 CSS로 불가능하다.

## 위험 요소

- **`white-space: pre`가 contenteditable을 깨뜨릴 수 있다 — 이번 변경의 유일한 실질 위험.** Tiptap/ProseMirror가 `pre-wrap`을 주입하는 건 취향이 아니라 방어다(`prosemirror-view/dist/index.js:4859`가 `white-space`가 안 잡혀 있으면 *"ProseMirror expects the CSS white-space property to be set, preferably to 'pre-wrap'"*라고 경고한다 — 즉 **우리는 지금 그 경고 대상은 아니고**(주입 스타일이 값을 주고 있음) 값을 `pre`로 **바꾸는** 것이다). 알려진 실패 모드: (a) 긴 줄 끝 커서에서 스크롤 점프, (b) 한글 IME 조합 중 커서 위치 이탈, (c) 줄 끝 공백 처리 차이(`pre`는 공백 보존, `break-spaces`와 다름). **수동 검증 없이 통과시키지 말 것** — jsdom·e2e 둘 다 IME를 재현 못 한다.
  - 참고: 주입 스타일의 `.ProseMirror`엔 `white-space: pre-wrap; white-space: break-spaces;`가 연달아 있어 **실제 승자는 `break-spaces`**다. 우리는 `pre`(자손 `pre` 한정)만 바꾸므로 에디터 본문(문단)은 `break-spaces` 그대로다 — **영향 범위가 코드블럭에 국한된다**는 게 이 위험을 낮춘다.
- **Tiptap 주입 스타일은 grep에 안 잡힌다.** `@tiptap/core/src/style.ts`가 JS 문자열로 들고 있다가 `createStyleTag`로 `<style id="tiptap-style">`을 만든다. 소스에도 `dist/assets/*.css`에도 없다. **Tiptap 메이저 업그레이드 시 이 내용이 바뀌면 특이도 싸움이 조용히 뒤집힌다.** DevTools의 `<style id="tiptap-style">`을 직접 봐야 확인된다.
- **`0.875em` → `12px`는 부모 크기 변화를 안 따라간다.** 의도된 트레이드오프(4개 표면 통일이 불변식이므로)이나, 나중에 `.ProseMirror`의 `text-sm`을 바꾸면 인라인 코드만 안 따라온다. DESIGN.md에 남긴다.
- **자간 초기값 `-0.01em`은 근거 없는 시작점이다.** 12px에서 0.12px. 실기기 눈으로만 정해진다(v1.6.0 weight와 같은 성격). 너무 좁히면 고정폭 가독성이 되레 떨어진다.
- **DOM 트리 트렁케이션이 개선되지만 측정되지 않는다.** 12px(13→12) + 자간 축소로 v1.6.0이 만든 −10.3%가 일부 되돌아온다. 정량 확인은 스코프 밖 — 관찰만.
- **`e2e/style-code-view.spec.ts:214`의 `13px`은 사실 아무것도 안 한다.** `document.fonts.load('13px "…"')`의 size는 face 매칭용이고 Geist는 variable이라 전 크기가 한 face다. 12px로 바꿔도 안 바꿔도 통과한다 — **문서적 정합성 때문에** 바꾸는 것이지 동작 때문이 아니다. 이걸 "테스트를 고쳤다"고 착각하지 말 것.
- **리거처 off가 `font-sans` `<pre>`에도 적용된다.** 의도(대안 2). Pretendard에 `--` 리거처가 없어 무해하나, 나중에 sans 폰트를 바꾸면 재검토 대상.

## 선행 해소: `code-block-collapse`

그 PRD `:62`의 근거가 틀렸다 — `grep -rn "prosemirror.css" src/` → 0건은 **CSS가 없다는 증거가 아니다.** Tiptap이 동일 내용을 런타임 주입하므로 `.ProseMirror pre { white-space: pre-wrap }`가 활성이고, 따라서 **에디터에서** "줄 수 = 화면 높이"는 거짓이었다(프리뷰는 ProseMirror가 아니라 참).

이번 Task 3(`white-space: pre`)이 그 전제를 **사후적으로 참으로 만든다.** 그 문서에는 (a) 틀린 grep 근거를 정정하고 (b) 이 feature가 선행 조건임을 명시한다. **접기 로직·설계는 건드리지 않는다** — 담당 세션 영역이다.
