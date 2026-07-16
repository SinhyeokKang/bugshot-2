# mono 타이포그래피 튜닝 — 기술 설계

## 개요

값 조정 다섯 개지만 본론은 **"mono 표면"이 한 셀렉터로 안 잡힌다**는 구조다. CSS 뷰·DOM 트리·로그는 `.font-mono`로, Tiptap·프리뷰 코드블럭은 Tailwind preflight로 Geist를 받는다. 이 설계는 그 둘을 **`@layer base`의 단일 셀렉터 리스트로 묶어** 자간·리거처를 한 곳에서 주고, 크기는 표면별로 12px에 수렴시킨다.

런타임 로직·상태·메시지 변경은 없다. 순수 CSS·상수 변경이다.

## mono 진입 경로 (설계의 축)

```
tailwind.config.js  fontFamily.mono = ["Geist Mono Variable", …fallback]
        │
        ├── .font-mono 유틸리티 (7곳) ──→ CssCodeMirror:723 래퍼 ──→ .cm-editor 이하 (fontFamily:"inherit" 체인)
        │                            ├─→ DomTreeDialog:201 Card ──→ DomTreeNode 전체
        │                            ├─→ ConsoleLogContent:254·:262  <pre> (본문·스택트레이스)
        │                            ├─→ NetworkLogContent:576       <pre> (본문)
        │                            └─→ LogSeekChip:11·:22          (상대시각·seek 버튼)
        │
        └── preflight (code, kbd, samp, pre) ──→ Tiptap  .ProseMirror pre/code   ← .font-mono 밖!
                                             └─→ 프리뷰 .doc-section-body pre/code  (DocSectionBody / IssuePreviewView)
```

**두 경로가 만나는 지점이 없다.** 그래서 `.font-mono`에만 규칙을 걸면 Tiptap·프리뷰가 빠지고, preflight 대상에만 걸면 CSS 뷰·DOM 트리·로그가 빠진다. v1.6.0이 전자를 밟았다.

**두 번째 짝**: preflight 경로의 두 소비처는 `tiptap-editor.css`(에디터)와 `doc-section-body.css`(프리뷰)이고, 그 code/pre 규칙은 **바이트 동일한 클론**이다(`:94`↔`:72`, `:108-109`↔`:86-87`). 같은 마크다운의 편집 화면과 프리뷰라 **항상 짝**이다 — 한쪽만 12px로 바꾸면 WYSIWYG이 깨진다.

**행간은 표면 성격에 따라 두 그룹**이고 한 규칙으로 안 묶인다:

| 그룹 | 표면 | 값 | 출처 |
|---|---|---|---|
| 코드블럭 | CSS 뷰 본문 · Tiptap `pre` · 프리뷰 `pre` | 12/18px | CM 인라인 theme · CSS 파일 `line-height: 1.5` |
| 리스트·칩 | DOM 트리 · 콘솔 2 · LogSeekChip 2 · 네트워크 | 12/16px | `text-xs` |

축이 달라 제외되는 둘: **인라인 `code`**(문단 행간 상속), **CM 자동완성 li**(`lineHeight: 1.25rem` — li 높이).

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

- **`@layer base`에 둔다.** utilities(`font-bold`·`tracking-*`)가 정상적으로 이겨야 한다.
  - **이유는 cascade layer가 아니다.** Tailwind 3.4.19의 `@layer`는 **PostCSS 빌드타임 지시자**라 실제 CSS cascade layer로 emit되지 않는다(`dist/assets/*.css`에 `@layer` 문자열 0건). 유틸이 이기는 건 base→components→utilities **flat emit 순서** 때문이다(byte offset 실측: preflight 54442 → globals base 57334 → `.font-mono` 78197 → `.tracking-tight` 79532). 결론은 같지만 근거를 적어둔다 — **'왜'를 실측 안 하면 맞는 결론도 다음 리뷰에 뒤집힌다**(POSTMORTEM `2026-07-16 — vitest에서 멀쩡히 되는 import가…`의 자기비판이 정확히 이 형태). 부수 효과로 **레이어 밖 스타일이 레이어 안을 항상 이긴다**는 우려(Tiptap 주입분·lazy 청크)도 이 코드베이스에선 발생하지 않는다 — 전부 flat cascade에서 특이도+순서로만 겨룬다.
- **`font-feature-settings`를 쓰지 않는다.** body(`globals.css:83`)의 `"rlig" 1, "calt" 1`을 통째로 덮어써 날린다(가산 안 됨). `font-variant-ligatures`는 별도 속성이라 안전하다.
- **`pre`/`code`가 `font-sans`를 명시한 경우**(`NetworkLogContent.tsx:733`의 `FrameBody`)도 이 리스트에 걸려 자간·리거처가 적용된다. 리거처는 Pretendard에 `--` 리거처가 없어 무해하고, 자간 `-0.01em`은 11px에서 0.11px라 무시 가능하다. 이걸 피하려고 셀렉터를 정교하게 만드는 건 오버엔지니어링이다(대안 2 참조).
- **크기·행간은 여기 넣지 않는다.** preflight(`preflight.css:111-119`)가 `code, kbd, samp, pre`에 family와 함께 **`font-size: 1em`**을 주고 있어 이 표면들은 `em` 문맥(프리뷰·인라인 코드)에 걸쳐 있다 — 일괄 px 지정이 인라인 코드를 깨뜨린다. 표면별로 준다(아래). 행간은 애초에 두 그룹이라 한 규칙으로 못 묶는다(위 표).
- **`kbd`/`samp`는 `src/`에 0건**이다(markdown-it도 `html:false`라 생성 안 함). preflight 리스트와 형태를 맞춘 순수 예방이다 — 그래서 Task 1의 단언에는 넣지 않는다(지키는 게 없는 단언이 된다).

## 변경 범위

### `src/styles/globals.css`
- **현재 역할**: `:1-2` 폰트 `@import`, `:4-6` `@tailwind`, `:8-67`·`:69-106` `@layer base`(토큰 표·body·스크롤바). `letter-spacing`·`font-variant-ligatures` 지정 0건.
- **변경 내용**: `@layer base`에 위 블록 1개 추가.

### `src/sidepanel/tabs/styleEditor/CssCodeMirror.tsx`
- **현재 역할**: CSS 코드 뷰. `EditorView.theme`이 `"&"`(`.cm-editor`)에 `fontSize: "13px"`(`:237`), `.cm-scroller`에 `lineHeight: "1.7"`(`:245`), 자동완성 li에 `fontSize: "13px"`(`:343`)을 준다. family는 `:723` 래퍼의 `font-mono`를 `fontFamily:"inherit"` 체인으로 상속(5곳).
- **변경 내용**:
  - `:237` `fontSize: "13px"` → `"12px"`
  - `:245` `lineHeight: "1.7"` → `"1.5"`
  - `:343` `fontSize: "13px"` → `"12px"` (본문과 짝 — `:335` 주석이 이미 "font-size는 에디터 본문(13px)과 맞춤"이라 명시하므로 그 숫자도 함께 갱신)
  - `:229` 주석의 "Geist Mono·13px" → "12px"
- **`:344`의 `lineHeight: "1.25rem"`(자동완성 li)은 건드리지 않는다** — 그건 텍스트 행간이 아니라 li 높이이고 편집 패널 `CommandItem`/`TokenItem`과 맞춘 값이다(주석 명시). 코드 행간과 다른 축이다.
- **`fontFamily: "inherit"` 5곳·`:331` 2-class 오버라이드(`:329-330` 주석)는 손대지 않는다.**

### `src/sidepanel/tabs/DomTreeDialog.tsx`
- **현재 역할**: `:201` Card가 `font-mono text-[13px]`로 트리 전체에 크기·family를 준다. 행간은 명시값 없이 preflight `html { line-height: 1.5 }` 상속 = 18px.
- **변경 내용**: `:201` `text-[13px]` → **`text-xs`**(12px / 행간 16px).
  - **`text-[12px]`가 아니라 `text-xs`인 이유**: `text-xs`는 정확히 12px이지만 `line-height: 1rem`(16px)을 **동반**한다. DOM 트리는 코드블럭이 아니라 **한 줄이 한 항목인 리스트**라 행간이 가독성이 아니라 밀도의 축이고, 이미 `text-xs`인 로그 mono 5곳과 같은 그룹이다 — 18 → 16px로 조여져 그 그룹에 합류한다. 스케일 유틸이라 **다음 사람이 `text-[12px]`를 `text-xs`로 "정리"하다 행간을 조용히 깨뜨릴 위험이 원천 소멸**한다(src에 `text-xs` 121건 vs `text-[12px]` 1건 — 이 저장소의 실제 규칙은 "스케일에 대응값이 없을 때만 임의값"이고 12px은 대응값이 있다).
- `:271`의 주석(`크기는 Card의 text-[13px]에 맡긴다`)에서 클래스명 갱신.

### `src/sidepanel/components/NetworkLogContent.tsx`
- **현재 역할**: `:576` 본문 `<pre>`가 `font-mono text-[11px]` — mono 7곳 중 **유일하게 12px이 아니다**.
- **변경 내용**: `text-[11px]` → **`text-xs`**(12px/16px). 형제인 `ConsoleLogContent:254`·`:262`가 이미 `text-xs`라 로그 그룹에 맞춘다.
- **`:733`의 `FrameBody`(`font-sans text-[11px]`)는 건드리지 않는다** — sans 표면이고 mono 통일 대상이 아니다.

### `src/sidepanel/components/tiptap-editor.css`
- **현재 역할**: `:90` `.tiptap-editor .ProseMirror code`(배경·radius·padding·`font-size: 0.875em`), `:103` `.tiptap-editor .ProseMirror pre`(+`overflow-x: auto` `:107`, `line-height: 1.5` `:109`), `:113` `pre code`(`font-size: inherit`). `white-space` 지정 0건 → **Tiptap이 주입한 `.ProseMirror pre { white-space: pre-wrap }`가 이긴다.**
- **변경 내용**:
  1. `:94`·`:108` `font-size: 0.875em` → `font-size: 12px`. **`em`을 버리는 이유**: 전 표면이 같은 12px이라는 게 불변식인데 이 둘만 부모(`text-sm`)에 묶여 있으면 부모가 바뀔 때 조용히 갈라진다. 인라인 코드도 14px 본문 속 12px이라 비율(0.857)이 현행(0.875)과 사실상 같아 체감 변화가 없다.
  2. `:103` 블록에 **`white-space: pre` 추가** — Tiptap 주입 스타일(`.ProseMirror pre`, 특이도 (0,1,1))을 `.tiptap-editor .ProseMirror pre`(0,2,1)로 이긴다. 이걸로 `:107`의 `overflow-x: auto`가 비로소 살아난다.
  3. `:109` `line-height: 1.5`는 그대로(목표값).
- **`:113` `pre code`의 `font-size: inherit`(`:117`)는 그대로** — `pre`의 12px를 그대로 받는다.

### `src/sidepanel/components/doc-section-body.css` ← **위 파일의 짝**
- **현재 역할**: 프리뷰(`DocSectionBody.tsx:10`·`IssuePreviewView.tsx:8`이 import). `:72` `.doc-section-body code`, `:86` `pre`의 `font-size: 0.875em`, `:87` `line-height: 1.5`, `:95` `pre code { font-size: inherit }`. 부모가 `text-sm`이라 **현재 12.25px — 에디터와 일치**.
- **변경 내용**: `:72`·`:86` `font-size: 0.875em` → `12px`. 에디터와 **동일 커밋**.
  - **`white-space`는 추가하지 않는다** — 프리뷰는 ProseMirror가 아니라 주입 스타일이 안 걸리고, UA 기본 `pre`가 이미 이긴다. `overflow-x: auto`(`:85`)도 이미 살아 있다.
  - 두 파일 다 **`@layer` 밖 평범한 CSS**이고 규칙이 바이트 동일하므로, 한쪽만 고치면 편집 화면과 프리뷰가 0.75px 갈라진다. 이 feature가 존재하는 이유(v1.6.0의 짝 누락)와 **같은 실패 클래스**다.

### `docs/DESIGN.md`
- **현재 역할**: `:66`이 "코드뷰는 13px mono로 통일 — CSS 코드 뷰와 DOM 트리는 짝을 이루는 불변식".
- **변경 내용**: **12px 전 표면 + 행간 두 그룹**(코드블럭 3개 18px / 리스트·칩 6개 `text-xs` 16px) + 자간 + 리거처 off로 재작성. **두 진입 경로(`.font-mono` / preflight)**와 **두 클론 파일(`tiptap-editor.css` / `doc-section-body.css`)**을 짝으로 명시 — 이게 짝을 놓치게 만드는 구조라 남겨야 다음 사람이 안 밟는다. 14px 기각 사유(mono 자폭 1.2배)는 유지하되 13px 기각(너무 큼)을 추가. **`text-[12px]`가 아니라 `text-xs`인 이유**(행간 그룹)도 박는다.
- §4에 **임의값(`text-[…]`) 정책이 없다**(§5 간격에만 "임의 값은 이유가 있을 때만"). 이번에 "스케일에 대응값이 없을 때만 임의값" 한 줄을 함께 메운다.

### `e2e/style-code-view.spec.ts`
- **현재 역할**: `:214` `document.fonts.load('13px "Geist Mono Variable"')`로 `@font-face` 로드를 단언.
- **변경 내용**:
  1. `13px` → `12px`. **동작상 무의미하지만**(`fonts.load`의 size는 매칭용이고 variable font는 전 크기 한 face) 문서로서 실제 렌더 크기와 어긋나면 다음 사람이 오해한다.
  2. **`--` 리거처 렌더 실측 단언 추가**(Task 5).
  3. **크기 불변식 단언 추가** — `.cm-content`의 computed `font-size: 12px` / `line-height: 18px`. v1.6.0이 실제로 깨뜨린 게 **크기 불변식**인데 현재 재발 방지책이 문서 한 줄뿐이다. `style-css-view` locator가 이미 있어 거의 공짜이고, 선언이 아니라 렌더를 잰다.
- e2e는 **headed persistent context**(`e2e/fixtures/extension.ts:164` `headless: false`, 오프스크린 `--window-position=-10000,-10000`)라 실제 폰트 렌더 경로를 탄다 — headless 폰트 렌더 신뢰성 문제가 구조적으로 없다.

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
  Geist liga:          기본 ON → `--`가 2셀 → 1셀로 붕괴 (advance 1200 → 600)
  Tiptap 주입:         .ProseMirror { font-variant-ligatures: none; font-feature-settings: "liga" 0 }
                       ← Tiptap만 이미 방어됨 (둘 다 건다 — 주석: "the above doesn't seem to work in Edge")
  이번 변경:           @layer base { .font-mono, pre, code, … { font-variant-ligatures: none } }
                       ↳ CSS 뷰·DOM 트리·로그·프리뷰가 비로소 방어됨 (Tiptap은 중복이나 무해)

[크기 — 표면별로 준다]
  .cm-editor              fontSize 12px  (인라인 theme)
  DomTree Card            text-xs        (12/16)
  로그 pre·칩             text-xs        (12/16 — Network만 11px에서 이동)
  .ProseMirror pre/code   font-size 12px (em 아님)
  .doc-section-body pre/code  font-size 12px  ← 위의 짝
```

## 인터페이스 설계

새 TypeScript 타입·함수·메시지 없음. 계약은 CSS 사실 다섯 개다:

```
globals.css @layer base
  .font-mono, pre, code, kbd, samp {
    font-variant-ligatures: none;    // Geist liga가 `--`를 잇는 걸 차단
    letter-spacing: <tuned>;         // 초기 -0.01em
  }

mono 전 표면의 computed:
  font-size: 12px                          // 예외 없음
  line-height: 18px   (코드블럭 3: CSS 뷰 본문 · Tiptap pre · 프리뷰 pre)
              16px   (리스트·칩 6: DOM 트리 · 콘솔 2 · LogSeekChip 2 · 네트워크 — text-xs)

tiptap-editor.css  ↔  doc-section-body.css        // 짝 — 같은 값을 함께 움직인다
  .tiptap-editor .ProseMirror pre { white-space: pre; }   // 주입 pre-wrap을 특이도로 이김 (에디터만)
```

## 기존 패턴 준수

- **테스트 트랙**: CSS 값 검증이라 `*.test.ts`(node). `tokens.test.ts`가 이미 `readFileSync`+정규식으로 `globals.css`·`tailwind.config.js`를 읽는 선례.
- **`tailwind.config.js`를 import하지 말 것** — `allowJs`가 없어 `pnpm test`는 통과해도 `pnpm typecheck`가 TS7016으로 깨진다. POSTMORTEM `2026-07-16 — vitest에서 멀쩡히 되는 import가 typecheck만 깨…` 항목. 이번엔 `globals.css`·`tiptap-editor.css`만 읽으면 되므로 해당 없음이나, 확장 시 재발 주의.
- **주석 최소화**(CLAUDE.md): `globals.css`의 새 블록은 WHY가 비자명하므로(경로가 둘이라 짝을 놓치면 갈라진다 / liga가 기본 ON) 주석 유지. 나머지 숫자 변경은 주석 불요.
- **i18n·권한·매니페스트 영향 0**: 새 문자열·권한·외부 요청 없음. `manifest.config.ts` 무변경.
- **코어 밸류(Privacy) 무영향**: 외부 요청 0.
- **POSTMORTEM 소환**: `2026-07-16 — JSON 팔레트 단일 출처`("단언은 grep으로 검증한다")가 이 작업의 배경 그 자체다 — v1.6.0의 리거처 단언·13px 통일 단언이 전부 미검증이었다. 이번 문서의 모든 사실은 fontTools·CSS 실측으로 확인했다.

## 대안 검토

1. **`.font-mono`에만 규칙을 건다** — 기각. **Tiptap·프리뷰가 빠진다.** 그게 v1.6.0이 밟은 함정이고 이 작업이 존재하는 이유다. 리거처만 놓고 보면 Tiptap이 자체 방어(`.ProseMirror`에 `font-variant-ligatures: none` + `font-feature-settings: "liga" 0` 주입)해서 우연히 통과하지만, **프리뷰는 ProseMirror가 아니라 그 방어도 못 받고**, 자간은 양쪽 다 빠진다 — 우연에 기대는 설계다.

2. **셀렉터를 정교하게 좁힌다** (`pre:not(.font-sans)` 등) — 기각. `FrameBody`의 `font-sans` `<pre>` 하나 때문에 셀렉터를 복잡하게 만드는 비용이 이득보다 크다. 그 요소에 자간 `-0.01em`(11px에서 0.11px)·리거처 off(Pretendard에 `--` 리거처 없음)가 적용돼도 관측 가능한 변화가 없다.

3. **Tiptap 코드블럭에 `font-mono` 클래스를 붙인다** (`editorProps.attributes` 또는 CodeBlock 확장의 `HTMLAttributes`) — 기각. 그러면 셀렉터가 하나로 통일되나, **에디터 본문은 sans여야 하므로 루트엔 못 붙이고** CodeBlock 확장에 `HTMLAttributes: { class: "font-mono" }`를 줘야 한다. 그건 (a) 인라인 `code` 마크에 별도로 또 붙여야 하고 (b) `renderHTML`이 마크다운 왕복(`tiptap-markdown`)에 클래스를 흘릴 위험이 있고 (c) 이미 preflight가 family를 주고 있어 **중복**이다. CSS 한 블록이 더 싸다.

4. **`white-space: pre-wrap`을 두고 들여쓰기만 복구** (`text-indent` 음수 + `padding-left` 트릭) — 기각. contenteditable 커서 위험이 0이라는 장점이 있으나, **가로 스크롤이 영영 안 생기고** `overflow-x: auto`가 죽은 채로 남는다. 사용자 요구가 "가로 스크롤이 안 생긴다"이므로 증상을 절반만 고친다. 무엇보다 `code-block-collapse`의 "줄 수 = 화면 높이" 전제를 **거짓인 채로 방치**한다.

5. **`liga`를 `font-feature-settings: "liga" 0`으로 끈다** — 기각. body의 `"rlig" 1, "calt" 1`을 통째로 덮어써 날린다(가산 안 됨 — v1.6.0 design.md가 기록한 함정). Geist Mono엔 `rlig`/`calt`가 없어 mono 표면에선 손실이 없지만, 이 셀렉터 리스트엔 `font-sans` `<pre>`도 걸려서 실제로 잃는다. `font-variant-ligatures`가 정확한 도구다.

6. **`--`만 살리는 리거처 예외** — 불가. `liga`는 feature 단위로만 켜고 끈다. 개별 치환 비활성화는 CSS로 불가능하다.

7. **코드블럭에 wrap 토글 UI를 단다** — 기각(이번 스코프). 아래 "가로 스크롤바의 비용"대로 400px 패널에서 실사용 코드블럭 대부분이 스크롤바를 얻으므로 가장 먼저 떠오르는 대안이지만, **코드베이스에 wrap 토글 선례가 0건**이고 새 UI 어포던스라 값 조정 사이클에 끼워 넣을 게 아니다. 스크롤바가 실제로 거슬리는 게 Task 6에서 확인되면 그때 별도 사이클로 뺀다. (기각을 기록해두는 건 다음 사람이 이 논의를 처음부터 다시 하지 않게 하려는 것이다.)

8. **`text-[12px]`로 DOM 트리 행간 18px을 지킨다** — 기각. `text-xs`가 정확히 12px이고 `line-height: 1rem`(16px)을 동반하는데, DOM 트리는 코드블럭이 아니라 **한 줄이 한 항목인 리스트**라 16px이 오히려 맞고 이미 `text-xs`인 로그 5곳과 같은 그룹이다. 임의값을 쓰면 스케일에 대응값(12px = `text-xs`)이 있는데도 이탈하는 것이고(src `text-xs` 121건 vs `text-[12px]` 1건), 다음 사람이 "정리"하다 행간을 조용히 깨뜨릴 표면을 하나 남기게 된다.

## 위험 요소

- **`white-space: pre`가 contenteditable을 깨뜨릴 수 있다 — 이번 변경의 유일한 실질 위험.** 알려진 실패 모드: (a) 긴 줄 끝 커서에서 스크롤 점프, (b) 한글 IME 조합 중 커서 위치 이탈, (c) 줄 끝 공백 처리 차이(`pre`는 공백 보존, `break-spaces`와 다름). **수동 검증 없이 통과시키지 말 것** — jsdom·e2e 둘 다 IME를 재현 못 한다. `TiptapEditor.tsx`에 composition 가드가 **0건**이라(코드베이스의 다른 4곳은 전부 Tiptap 밖) 한글 조합 회귀를 잡아줄 자체 방어선이 없다.
  - **ProseMirror의 경고는 `pre`를 대상으로 하지 않는다.** `prosemirror-view/dist/index.js:4859`의 실제 조건은 `['normal','nowrap','pre-line'].indexOf(getComputedStyle(view.dom).whiteSpace) !== -1` — 즉 PM 자신이 `pre`를 허용 범위로 본다. 역으로 **"경고가 안 뜨니 안전하다"는 추론도 성립하지 않는다**(래치 `cssCheckWarned`로 프로세스당 1회뿐이고, 검사 대상도 `view.dom`이지 자손 `pre`가 아니다). 경고 유무는 이 위험의 신호가 아니다 — 눈으로 봐야 한다.
  - 주입 스타일의 `.ProseMirror`엔 `white-space: pre-wrap; white-space: break-spaces;`가 연달아 있어 **실제 승자는 `break-spaces`**다. 우리는 `pre`(자손 `pre` 한정)만 바꾸므로 에디터 본문(문단)은 `break-spaces` 그대로다 — **영향 범위가 코드블럭에 국한된다**는 게 이 위험을 낮춘다.
- **가로 스크롤바가 세로 공간을 먹는다 — 가로 스크롤 도입의 실제 비용.** `globals.css:86-88`의 `::-webkit-scrollbar { width: 10px; height: 10px }`는 **overlay가 아니라 gutter를 점유**한다. 코드블럭 실폭 ≈ 패널폭 − 76px, 12px Geist Mono advance ≈ 7.2px →

  | 패널 폭 | 코드블럭 폭 | 한 줄 글자수 |
  |---|---|---|
  | 320px (DESIGN.md:165의 min) | 244px | ~33자 |
  | 400px | 324px | ~45자 |

  **45자면 실사용 JSON·URL은 거의 전부 스크롤바를 얻는다.** 1~2줄짜리 블록(높이 ~33px)에 10px이 붙으면 **높이의 23%가 스크롤바**다. 대안 7(wrap 토글)을 기각한 근거가 여기 걸려 있으니 Task 6에서 실물을 보고 재평가한다. (스크롤바 *스타일*은 `-corner`까지 이미 커버돼 추가 CSS는 0이다.)
- **자간·12px 판정이 다크모드에서 다르게 보인다.** v1.6.0이 뉴트럴 다크 테마를 출시했고, 다크 배경 위 밝은 글자는 halation으로 글리프가 번져 **라이트보다 굵고 조밀하게** 보인다. 라이트에서 튜닝한 자간이 다크에선 과하게 좁을 수 있다 — Task 6은 **양 테마**에서 본다.
- **Tiptap 주입 스타일은 grep에 안 잡힌다.** `@tiptap/core`(3.23.4)의 `src/style.ts`가 JS 문자열로 들고 있다가 `createStyleTag`로 `<style data-tiptap-style>`을 만든다(`id`가 아니라 **속성**이다 — `createStyleTag.ts:3`의 `setAttribute(\`data-tiptap-style\`, "")`. `#tiptap-style`로 찾으면 0건이다). 소스에도 `dist/assets/*.css`에도 없다. **Tiptap 메이저 업그레이드 시 이 내용이 바뀌면 특이도 싸움이 조용히 뒤집힌다.** 확인 경로:
  - 실행 중: DevTools에서 `style[data-tiptap-style]`
  - 파일: pnpm 레이아웃이라 루트 `node_modules/@tiptap/core`에 **없다** → `node_modules/.pnpm/@tiptap+core@3.23.4_@tiptap+pm@3.23.4/node_modules/@tiptap/core/dist/index.js`의 `// src/style.ts` 구간(L4610-4681)
- **`0.875em` → `12px`는 부모 크기 변화를 안 따라간다.** 의도된 트레이드오프(전 표면 12px 통일이 불변식이므로)이나, 나중에 `.ProseMirror`/`.doc-section-body`의 `text-sm`을 바꾸면 인라인 코드만 안 따라온다. DESIGN.md에 남긴다.
- **`LogSeekChip`은 7곳 중 유일하게 자간이 레이아웃과 결합한다.** `:11`·`:22`가 **`w-8`(32px 고정)** 박스라 자간이 좁아지면 라벨 배치가 움직인다. `FrameBody`처럼 "관측 가능한 변화 없음"으로 넘길 표면이 아니다 — Task 6 관찰 항목.
- **`globals.css`의 새 base 블록은 log-viewer에 안 나간다.** `globals.css`는 `src/sidepanel/main.tsx:7`만 import하고 `src/log-viewer/main.tsx:7`은 자체 `./styles.css`(별도 `@tailwind base` + 손복사 토큰 표)를 쓴다. 오늘 영향은 0이다(log-viewer에 `pre`/`code`/`font-mono` 0건). 다만 **`tokens.test.ts:112`의 주석**(*".font-mono 규칙은 사이드패널과 log-viewer 두 빌드에 똑같이 나가는데…"*)은 공유 `tailwind.config.js`가 주는 **유틸리티**엔 참이지만 **새 base 규칙엔 거짓**이 된다. `parseTokens` 동등성 가드(`:83-91`)는 `:root`/`.dark` 토큰 표만 대조해 이 구멍을 못 본다 — Task 1에서 주석을 정정한다.
- **자간 초기값 `-0.01em`은 근거 없는 시작점이다.** 12px에서 0.12px. 실기기 눈으로만 정해진다(v1.6.0 weight와 같은 성격). 너무 좁히면 고정폭 가독성이 되레 떨어진다.
- **DOM 트리 트렁케이션이 개선되지만 측정되지 않는다.** 12px(13→12) + 자간 축소로 v1.6.0이 만든 −10.3%가 일부 되돌아온다. 정량 확인은 스코프 밖 — 관찰만.
- **`e2e/style-code-view.spec.ts:214`의 `13px`은 사실 아무것도 안 한다.** `document.fonts.load('13px "…"')`의 size는 face 매칭용이고 Geist는 variable이라 전 크기가 한 face다. 12px로 바꿔도 안 바꿔도 통과한다 — **문서적 정합성 때문에** 바꾸는 것이지 동작 때문이 아니다. 이걸 "테스트를 고쳤다"고 착각하지 말 것.
- **리거처 off가 `font-sans` `<pre>`에도 적용된다.** 의도(대안 2). Pretendard에 `--` 리거처가 없어 무해하나, 나중에 sans 폰트를 바꾸면 재검토 대상.

## 선행 해소: `code-block-collapse`

그 PRD `:62`의 **근거가 한 겹 좁았다.** `grep -rn "prosemirror.css" src/` → 0건은 **지금도 사실**이고, 원저자는 문제 규칙(`prosemirror-view/style/prosemirror.css:14-15`)과 실패 모드까지 이미 특정해뒀다. 틀린 건 **출처가 하나라고 본 것**이다 — `@tiptap/core`가 동일 내용을 자체 보유하다가 런타임 주입하므로, import를 grep해선 안 잡히는 두 번째 경로로 `.ProseMirror pre { white-space: pre-wrap }`가 이미 활성이었다. 따라서 **에디터에서** "줄 수 = 화면 높이"는 거짓이었다(프리뷰는 ProseMirror가 아니라 참).

이번 Task 3(`white-space: pre`)이 그 전제를 **사후적으로 참으로 만든다.** 그 문서에는 (a) 근거를 "출처가 하나가 아니다"로 정정하고 (b) 이 feature가 선행 조건임을 명시하고 (c) **가로 스크롤바 10px이 접기 높이 계산의 새 항**이 된다는 사실을 넘긴다. **접기 로직·설계는 건드리지 않는다** — 담당 세션 영역이다.
