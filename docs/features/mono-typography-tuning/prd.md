# mono 타이포그래피 튜닝

## 배경

v1.6.0이 Geist Mono를 번들하고 코드 표면을 그 위에 올렸다. 폰트 자체는 의도대로 실렸지만(빌드에 woff2 6개 emit, e2e가 `@font-face` 로드를 고정), **실사용에서 다섯 가지가 드러났다.** 전부 v1.6.0이 "13px 2개 표면 통일"이라는 좁은 렌즈로만 봐서 놓친 것들이다.

### 1. `--`가 리거처로 붙어 CSS 토큰이 깨진다 (🔴)

Geist Mono의 GSUB feature는 `ccmp, dnom, frac, liga, locl, numr`다. `calt`·`rlig`는 **없고 `liga`가 있다**(fontTools 실측). 그 `liga`의 69개 치환 중 hyphen 관련이 20개이고, 결정적으로 `hyphen + [hyphen] → hyphen_hyphen.liga`다. **`--`가 리거처다.**

`liga`는 브라우저 **기본 ON**이라 `font-feature-settings`로 켠 적이 없어도 작동한다. 리거처 대시는 두 셀에 걸친 **연속된 선**으로 그려져 잉크가 advance width를 넘고, CodeMirror 토큰 칩의 하이라이트 박스를 삐져나온다.

CSS 커스텀 프로퍼티는 전부 `--`로 시작한다. **CSS 에디터에서 모든 토큰이 이 리거처를 밟는다.**

> v1.6.0 `design.md`는 "Geist Mono엔 코딩 리거처가 없어 `calt`가 작용할 대상이 없다"고 단언했다. `calt`가 없다는 절반은 맞고, **리거처가 없다는 절반은 거짓**이었다 — `liga`로 있었고 폰트 파일을 열어보지 않은 채 쓴 문장이었다.

### 2. 크기가 네 표면 모두 다르다

| 표면 | 현재 | 출처 |
|---|---|---|
| CSS 코드 뷰 본문 | 13px | `CssCodeMirror.tsx:237` |
| CSS 뷰 자동완성 li | 13px | `CssCodeMirror.tsx:343` (주석: "본문과 맞춤") |
| DOM 트리 | 13px | `DomTreeDialog.tsx:201` Card `text-[13px]` |
| **Tiptap 코드블럭·인라인 코드** | **12.25px** | `.ProseMirror`가 `class:"text-sm"`(14px) → `tiptap-editor.css:94`·`:108`의 `font-size: 0.875em` |

13px은 크고, **12.25px(Tiptap)이 좋다**는 게 사용자 판단이다. 두 신호가 같은 지점(12px)을 가리킨다.

v1.6.0이 DESIGN.md `:66`에 "코드뷰는 13px mono로 통일 — 짝을 이루는 불변식"을 박았는데, **그 불변식이 Tiptap을 빠뜨린 채 선언됐다.** 셋이 전부 sans였을 땐 안 보이다가 mono로 통일되니 0.75px 차이가 드러났다.

### 3. 행간이 갈려 있다

CSS 뷰만 `1.7`(`CssCodeMirror.tsx:245`)이고, Tiptap `pre`는 `1.5`(`tiptap-editor.css:109`), DOM 트리는 명시값 없이 preflight `html { line-height: 1.5 }`를 상속해 **이미 1.5**다. Tiptap 값이 좋다는 게 사용자 판단이므로 **CSS 뷰 한 줄만 어긋나 있다**.

### 4. 자간이 넓다

코드베이스 전체에 `letter-spacing`/`tracking-` 지정이 **0건**이라 전부 브라우저 기본(0)이다. Geist Mono의 기본 트래킹이 넓게 읽힌다.

### 5. Tiptap 코드블럭이 줄바꿈되고 들여쓰기가 깨진다 (🔴)

`@tiptap/core`가 `src/style.ts`를 **런타임에 `<style id="tiptap-style">`로 주입**한다. 그 안에 `.ProseMirror pre { white-space: pre-wrap; }`가 있다.

그래서 `tiptap-editor.css:107`의 `overflow-x: auto`는 **죽은 코드**다 — `pre-wrap`이면 가로로 넘칠 일이 없어 스크롤이 생길 수 없다. 줄이 접히면 이어지는 줄이 0열에서 시작해 **들여쓰기가 소실**된다(긴 URL이 든 JSON에서 즉시 보인다).

> **이 CSS는 어떤 grep에도 안 잡힌다.** 우리 소스에도 `dist/assets/*.css`에도 없고, JS 안에 문자열로 있다가 런타임에 DOM에 꽂힌다. `prosemirror-view`가 같은 내용의 `style/prosemirror.css`를 파일로 배포하지만 **우리는 그걸 import하지 않고**(그 패키지는 CSS를 주입하지 않고 `index.js:4859`에서 경고만 한다), Tiptap이 내용을 복사해 자체 주입한다.

## 목표

- **CSS 뷰·DOM 트리에서 `--`가 하이픈 두 개로 렌더된다.** 토큰 칩 하이라이트를 벗어나지 않는다.
- **네 mono 표면이 12px·행간 1.5로 일치한다.** DESIGN.md의 불변식이 실제 표면 수(4개)와 값(12px)을 반영한다.
- **mono 표면의 자간이 좁아진다.**
- **Tiptap 코드블럭에 가로 스크롤이 생기고 들여쓰기가 보존된다.** 접히는 줄이 없다.
- 위 넷이 **한 셀렉터로 안 잡히는 구조**(아래 참조)가 문서에 남아, 다음 사람이 짝을 놓치지 않는다.

### 핵심 제약: "mono 표면"은 한 셀렉터로 안 잡힌다

CSS 뷰·DOM 트리는 **`.font-mono`**로 Geist를 받고, Tiptap 코드블럭은 **Tailwind preflight**(`code, kbd, samp, pre { font-family: theme('fontFamily.mono', …) }`)로 받는다. 경로가 둘이라 mono 전역 규칙은 매번 두 군데를 짝으로 손봐야 하고, **짝을 놓치면 조용히 갈라진다** — v1.6.0이 13px 통일을 선언하고 Tiptap 12.25px를 놓친 게 정확히 그 사례다. 이 작업의 본론은 값 조정이 아니라 이 구조를 어떻게 봉인하느냐다.

## 비목표 (Non-goals)

- **로그 표면에 mono를 확대 적용하지 않는다.** 현재 `font-mono`는 5곳뿐이고 네트워크 JSON 페이로드는 `JsonTreeViewer`(sans 트리)로 간다. "어디까지가 코드냐"는 항목별 판단이 필요해 별도 사이클로 뺀다. **이번 스코프에서 mono 값을 확정한 뒤**에 그 값으로 확대해야 순서가 맞다.
- **`logs.html`에 Geist를 번들하지 않는다.** 12px에서 폰트별 x-height 차이가 13px보다 크게 체감될 수 있다는 우려가 있으나, +100KB가 **내보내는 파일마다** 붙고 그 파일은 이슈에 첨부돼 여러 명이 받는다. **12px 확정 후 실물을 보고** 판단한다 — 지금은 가정이다.
- **`--` 외의 리거처를 개별 판단하지 않는다.** `liga`를 통째로 끈다. `->`·`=>` 등이 코드에서 예뻐 보일 수는 있으나, 고정폭 그리드를 깨는 대가가 코드 에디터에서 더 크다.
- **`font-variant-ligatures`를 sans에 적용하지 않는다.** Pretendard 본문은 무관하다.
- **자간을 앱 전역(sans 포함)에 적용하지 않는다.** mono 표면만 — 사용자 확정.
- **`prosemirror-view`/`@tiptap/core`를 패치하거나 fork하지 않는다.** 주입된 스타일은 특이도로 덮는다.
- **자간 값을 이번 스코프에서 확정하지 않는다.** 초기값을 넣고 시각 검증에서 1회 조정한다(v1.6.0의 weight와 같은 성격 — 실기기 눈으로만 정해진다).

## 사용자 시나리오

1. **CSS 토큰 편집** — 요소를 고르고 CSS 뷰로 토글해 `var(--space-lg)`를 본다. `--`가 하이픈 두 개로 또렷하게 보이고, 토큰 회색 칩이 텍스트를 정확히 감싼다.
2. **코드뷰 이동** — CSS 뷰 ↔ DOM 트리 ↔ 이슈 본문 코드블럭을 오간다. 셋의 글자 크기·행간이 같아 같은 폰트로 읽힌다.
3. **긴 로그 확인** — 본문에 삽입한 JSON에 긴 URL이 있다. 줄이 접히지 않고 **가로 스크롤**로 밀린다. 들여쓰기가 유지돼 중첩 구조가 그대로 읽힌다.
4. **한글 입력(엣지)** — 코드블럭 안에서 한글을 조합한다. `white-space: pre`로 바뀌었어도 IME 조합·커서가 정상이다. (위험 요소 참조 — 이 시나리오가 E 픽스의 유일한 실패 모드다.)
5. **긴 줄 끝 편집(엣지)** — 가로로 넘치는 줄 끝에 커서를 둔다. 뷰가 가로 스크롤돼 커서가 보인다.

## 성공 기준

- CSS 뷰에서 `var(--x)` 입력 시 `--`가 **두 글리프**로 렌더된다. DevTools Computed에서 `font-variant-ligatures: none`.
- 네 표면(CSS 뷰 본문·CM 자동완성 li·DOM 트리·Tiptap 코드블럭)의 Computed `font-size`가 **전부 12px**, `line-height`가 **전부 18px**(12 × 1.5)이다.
- Tiptap 코드블럭에서 뷰포트보다 긴 줄이 **접히지 않고** `pre`에 가로 스크롤바가 생긴다. Computed `white-space: pre`.
- 코드블럭 안 한글 IME 조합·긴 줄 끝 커서가 정상이다(수동).
- `pnpm test` / `pnpm typecheck` / e2e 전체 green. e2e의 폰트 로드 단언(`style-code-view.spec.ts:214`)이 `13px` → `12px`로 갱신돼도 통과한다.
- DESIGN.md의 코드뷰 불변식이 **12px · 4개 표면 · 행간 1.5 · 자간 · 리거처 off**를 담고, 두 진입 경로(`.font-mono` / preflight)를 명시한다.

## 선행 해소: `code-block-collapse`의 거짓 전제

`docs/features/code-block-collapse/prd.md`가 이렇게 단언한다:

> `pre`는 `overflow-x: auto`에 `white-space` 재정의가 없다 → 기본값 `white-space: pre` → **줄바꿈이 일어나지 않는다.** 논리 줄 1개 = 화면 줄 1개다.
> ⚠ 이 전제는 `prosemirror.css`를 로드하지 않는다는 사실에 의존한다. `grep -rn "prosemirror.css" src/` → 0건이라 현재는 안 걸린다.

**그 grep이 틀린 테스트다.** 파일을 import하지 않아도 Tiptap이 같은 CSS를 런타임 주입하므로 `.ProseMirror pre { white-space: pre-wrap }`가 **활성이다.** 따라서 에디터에서 "줄 수 = 화면 높이"는 **거짓**이고, 그 기능의 접기 높이 계산이 어긋난다. (프리뷰 `doc-section-body`는 ProseMirror가 아니라 안 걸리므로 전제가 유효 — **한 기능이 두 표면을 같은 가정으로 다루는데 에디터에서만 깨진다.**)

이번 작업의 E(`white-space: pre`)가 그 전제를 **사후적으로 참으로 만든다.** 즉 이 feature가 `code-block-collapse`의 **선행 조건**이다. 그쪽 문서의 틀린 근거(grep)만 정정하고 나머지 설계는 건드리지 않는다.
