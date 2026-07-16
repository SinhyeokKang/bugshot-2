# 코드뷰 전용 mono 폰트 (Geist Mono) — 기술 설계

## 개요

`@fontsource-variable/geist-mono`를 의존성으로 추가하고 `globals.css`에 `@import`해 `@font-face`를 사이드패널에 싣는다. `tailwind.config.js`에 `fontFamily.mono`를 **처음으로** 정의해 `"Geist Mono Variable"`를 맨 앞에, Tailwind 기본 mono 스택을 폴백으로 둔다. 이 한 곳이 단일 출처이고, 기존 `font-mono` 5곳은 코드 변경 없이 따라온다. 코드뷰 통일은 CodeMirror 래퍼에 `font-mono`, DOM Tree Card에 `font-mono`, DomTreeNode의 `text-sm` 제거 + `title` 툴팁 추가로 끝난다.

런타임 로직·상태·메시지 변경이 전혀 없는 순수 스타일 변경이다. **단, 파급 범위는 `font-mono` 사용처보다 넓다 — 아래 preflight 절이 그 이유다.**

## preflight 파급 (설계의 숨은 절반)

Tailwind preflight(`node_modules/.../tailwindcss/src/css/preflight.css:114-119`):

```css
code, kbd, samp, pre {
  font-family: theme('fontFamily.mono', ui-monospace, SFMono-Regular, Menlo, …);
  font-feature-settings: theme('fontFamily.mono[1].fontFeatureSettings', normal);
  font-variation-settings: theme('fontFamily.mono[1].fontVariationSettings', normal);
  font-size: 1em;
}
```

`fontFamily.mono`가 미정의인 지금은 두 번째 인자(기본 스택)가 나간다. **정의하는 순간 클래스가 안 붙은 모든 `pre`·`code`·`kbd`·`samp`가 Geist로 바뀐다.** 즉 `grep font-mono`로 센 5곳은 파급 범위가 아니다.

이 파급은 **의도적으로 수용한다** — `pre`/`code`가 코드용 mono를 받는 건 정확히 preflight의 설계 의도이고, 앱이 mono를 소유하게 된 이상 그게 바람직한 방향이다.

### 전수조사 결과 (Task 2 — 완료)

결론: **preflight를 실제로 받는 표면은 3곳이고, `font-sans` 방어가 필요한 곳은 0곳**이다(전부 mono 전환이 바람직).

| 후보 | 판정 |
|---|---|
| `NetworkLogContent.tsx:576` / `ConsoleLogContent.tsx:254`,`:262` | `font-mono` 명시 → preflight 안 받음 |
| `NetworkLogContent.tsx:733`(`FrameBody` — WebSocket 프레임 본문) | `font-sans` 명시 → preflight 안 받음(이 방어가 그대로 유효) |
| `markdownToAsanaHtml.ts:89`,`:129`,`:203`,`:214` / `buildIssueMarkdown.ts:334` | **우리 DOM이 아님** — 트래커로 보내는 HTML 문자열이라 Asana 페이지에서 렌더. 무관 |
| **Tiptap 코드블록** (`tiptap-editor.css:90`/`:103`/`:113`) | **preflight 직격 → Geist** |
| **`DocSectionBody.tsx:100`** (마크다운 → `dangerouslySetInnerHTML`) | **preflight 직격 → Geist** (`doc-section-body.css:68`/`:81`/`:91`) |
| **`IssuePreviewView.tsx:167`** (마크다운 → `dangerouslySetInnerHTML`) | **preflight 직격 → Geist**. 같은 `doc-section-body.css` 사용. **`log-viewer/App.tsx:7`이 import**하므로 logs.html에도 나가나 `@font-face`가 없어 폴백 |

- 위 3개 CSS(`tiptap-editor.css`, `doc-section-body.css` ×2 소비처)는 전부 배경·radius·padding·font-size·line-height만 잡고 **`font-family`를 안 잡는다.** 따라서 지금은 preflight 경유 시스템 mono, 변경 후 Geist.
- **전환은 전부 바람직하다.** 셋 다 문자 그대로 코드블록·인라인 코드다. `insertCodeBlock`(`TiptapEditor.tsx:290`)으로 꽂은 로그가 로그 탭과 같은 폰트로 보이고, 이슈 프리뷰의 코드도 마찬가지다. 별도 조치 불요.
- `prose`(@tailwindcss/typography) 클래스는 코드베이스에 없어 그쪽 경로의 추가 파급은 없다.

> **조사 방법의 사각 (재발 방지)**: 1차 조사는 `grep -rnE "<(pre|code|kbd|samp)([ >]|$)" src/`로 **JSX 리터럴만** 훑어 `dangerouslySetInnerHTML` 2곳을 통째로 놓쳤고, "Tiptap 하나뿐"이라 단언했다 — 런타임에 마크다운이 생성하는 마크업은 그 grep에 **구조적으로 안 잡힌다**. preflight 파급을 다시 셀 땐 `grep -rn "dangerouslySetInnerHTML" src/`와 **`font-family`를 안 잡는 `code`/`pre` CSS 규칙**(`grep -rn -A6 "code\s*{\|pre\s*{" src/**/*.css`)을 함께 봐야 한다. POSTMORTEM `2026-07-16` 항목의 교훈("단언은 grep으로 검증한다")에 그대로 걸린 사례다.

관련 사실 둘:
- **`NetworkLogContent.tsx:733`의 `font-sans`가 바로 이 메커니즘을 방어하는 코드다** — 주석이 "preflight가 `pre`를 monospace로 리셋하므로 `font-sans`를 명시한다"라고 적혀 있다. 즉 이 파급 벡터는 이미 코드베이스에 증거가 있었다. 이 줄은 **그대로 둔다**(sans여야 하는 `<pre>`).
- `fontFamily.mono`를 **평범한 배열**로 정의하면 `mono[1]`은 문자열(`"ui-monospace"`)이라 `.fontFeatureSettings`/`.fontVariationSettings`가 `undefined` → 둘 다 `normal`로 폴백한다. 튜플 형태(`[family[], {…}]`)를 쓰지 않는 한 무해하다(대안 3 참조).

## 변경 범위

### `package.json`
- **현재 역할**: 의존성 선언. `pretendard: ^1.3.9`가 `dependencies`에 있는 게 같은 계열의 선례.
- **변경 내용**: `dependencies`에 `@fontsource-variable/geist-mono@5.2.8` 추가 (OFL-1.1).
- **버전을 명시적으로 박는다** — `pnpm-workspace.yaml`의 `minimumReleaseAge: 1440`이 24시간 미만 버전을 배제하므로 무버전 `pnpm add`는 무엇이 잡힐지 고정하지 못한다. 빌드 스크립트 없는 패키지라 `onlyBuiltDependencies` 화이트리스트는 무관.

### `src/styles/globals.css`
- **현재 역할**: 사이드패널 전역 CSS. `:1`에 Pretendard `@import`, `:3-5`에 `@tailwind` 디렉티브, `:7-66`·`:68-105`에 `@layer base`.
- **변경 내용**: `:1` 바로 아래에 `@import "@fontsource-variable/geist-mono/index.css";` 추가.
- **제약**: `@import`는 다른 규칙보다 앞서야 한다. 처리 주체는 브라우저가 아니라 **빌드 타임의 postcss-import**(vite 내장)이고, 오배치 시 `"@import must precede all other statements"` **경고를 내지만 `vite build`는 통과한다** → 로그를 안 읽으면 폴백만 남는다. Pretendard 줄과 붙여 둔다.
- **`body`의 `font-family`(`:78-81`)는 건드리지 않는다** — sans 기본값이고, mono는 `font-mono` 유틸과 preflight로만 진입한다.
- **`font-feature-settings`(`:82`)**: `body`에 걸린 상속 속성이라 모든 `font-mono` 후손이 `"rlig" 1, "calt" 1`을 물려받는다. **무해하다** — 둘 다 브라우저 기본값이고 Geist Mono엔 코딩 리거처가 없어 `calt`가 작용할 대상이 없다. 다만 후속 함정: `font-feature-settings`는 캐스케이드에서 **가산되지 않는다**. 나중에 mono 전용 feature(`tnum`·`zero` 등)를 추가하면 `rlig`/`calt`를 함께 다시 써주지 않는 한 조용히 날아간다.

### `tailwind.config.js`
- **현재 역할**: `theme.extend.fontFamily`에 `sans`만 정의(`:11-26`, 배열 `:12-25`). `mono`는 미정의라 Tailwind 기본값이 나간다. 플러그인은 `:88`(`tailwindcss-animate` + `@tailwindcss/container-queries` 2개), `:89`가 `};`.
- **변경 내용**: `sans` 아래에 `mono` 추가.
- **폴백 스택을 반드시 유지한다** — log-viewer는 `@font-face`가 없으므로 폴백이 없으면 `font-mono`가 아무 데도 해석되지 않는다. 이게 이 설계의 안전장치다.

```js
// tailwind.config.js — theme.extend.fontFamily
mono: [
  '"Geist Mono Variable"',
  // 아래는 Tailwind 기본 mono 스택 — log-viewer(별도 빌드, @font-face 없음)가
  // 여기로 폴백한다. 지우면 다운로드된 logs.html의 코드 텍스트가 깨진다.
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  "Consolas",
  '"Liberation Mono"',
  '"Courier New"',
  "monospace",
],
```

- **`tailwindcss/defaultTheme`를 import해 스프레드하지 않는다.** 저장소 어디에도 `defaultTheme` import가 없고(선례 0), 기존 `sans`가 문자열 리터럴로 나열된 스타일을 그대로 따른다.
- **평범한 배열로 둔다**(튜플 아님) — preflight 절 참조.

### `src/sidepanel/tabs/styleEditor/CssCodeMirror.tsx`
- **현재 역할**: CSS 코드 뷰. `EditorView.theme`의 `"&"`(`:234-240`)가 `.cm-editor`에 `fontSize: 13px`(`:237`)만 주고 **`fontFamily`는 의도적으로 안 준다**. 대신 `.cm-scroller`(`:244`)·`.cm-content`(`:251`)·툴팁(`:325`,`:331`,`:395`)이 모두 `fontFamily: "inherit"`으로 상속 체인을 탄다. 체인의 뿌리는 JSX 래퍼 `<CodeMirror>`(**`:698`에서 열리고 className은 `:721`**) → `body`(Pretendard).
- **변경 내용**: `:721`의 className(`"flex min-h-0 flex-1 flex-col"`)에 `font-mono` 추가 — **이 한 곳이 에디터 본문·거터·자동완성 팝업·토큰 툴팁 전부를 뒤집는다.** `fontFamily: "inherit"` 5곳은 손대지 않는다.
- **`:330`의 2-class 오버라이드는 그대로 둔다**(`:329`는 그 주석). CodeMirror 기본값 `.cm-tooltip.cm-tooltip-autocomplete > ul { font-family: monospace }`를 이겨야 하는 건 변함없다 — 그 `monospace`는 **브라우저 기본 mono이지 우리 Geist가 아니다.**
- **툴팁 상속의 전제**: CM 툴팁이 `inherit` 체인을 타려면 `.cm-editor` 내부에 렌더돼야 하고, 그건 `tooltips({parent})`가 **설정되지 않았을 때**만 참이다. 현재 extension 목록(`:710-719`)에 `tooltips(...)`가 없어 안전하다. 미래에 누가 `parent: document.body`를 넣으면 팝업만 조용히 sans로 남는다 — 이 조건을 여기 기록해둔다.
- `:229`의 주석을 새 사실("DOM Tree Dialog와 통일 — Geist Mono 13px")로 갱신한다.
- **13px은 그대로 둔다** — 대안 5 참조.

### `src/sidepanel/tabs/DomTreeDialog.tsx`
- **현재 역할**: `DomTree`의 `<Card>`(`:201`)가 `text-[13px]`로 크기를 선언하고, `DomTreeNode`의 라벨 span(`:271`, `"min-w-0 flex-1 truncate text-sm"`)이 `text-sm`(14px)으로 **그걸 덮는다**. 자식 span들(`:272`,`:273`,`:275`,`:282`,`:287`,`:292`,`:294`)은 색만 지정해 크기·family를 상속받는다(`:294`는 `ml-1`도 포함하나 크기·family는 미선언).
- **변경 내용**:
  1. `:201` Card className에 `font-mono` 추가 — 트리 전체가 상속받는다.
  2. `:271`의 `text-sm` **제거** — Card의 `text-[13px]`가 비로소 주 텍스트에 적용된다.
  3. `:271`에 `title={...}` 추가 — 트렁케이션 완화(아래 참조). 트리거(`:73`)엔 이미 `title`이 있고 라벨엔 없다.
- **`text-sm` 제거가 안전한 이유**: 크기를 선언한 유일한 자식이 `:271`이고(`:186`·`:194`의 `text-sm`은 Card의 early-return 형제라 무관), 나머지는 색만 지정한다. 제거하면 전부 Card의 13px로 수렴한다.
- **단, "복원"은 font-size 축에만 맞다.** `text-sm` = `font-size:.875rem` + `line-height:1.25rem` **쌍**이고 `text-[13px]`는 font-size만 잡는다. 제거하면 line-height 20px 명시값이 사라지고 preflight의 `html { line-height: 1.5 }` 상속으로 떨어져 **19.5px**가 된다. 0.5px 차이라 수용하되, line-height는 복원이 아니라 **유실**이라는 걸 기록해둔다.
- **로딩·에러 상태(`:186`, `:194`)는 sans 14px로 둔다** — Card의 형제 early-return이라 `font-mono`·`text-[13px]` 어느 쪽도 안 받는다. 상태 메시지는 코드가 아니라 UI 텍스트이므로 의도된 경계다.
- **`font-mono`를 `DialogContent`(`:79`)에 얹지 않는다** — 다이얼로그 제목(`:81` `text-xl`)과 트리거 버튼(`:72` `text-2xl font-semibold`)까지 mono가 돼버린다. 트리 콘텐츠의 루트인 Card가 정확한 경계다.

### `src/styles/__tests__/tokens.test.ts`
- **현재 역할**: `globals.css` ↔ `log-viewer/styles.css` 토큰 표 동등성 + 라이트/다크 채도 + destructive 대비 하한. `readFileSync`(`:11`) + 정규식으로 CSS를 파싱한다.
- **변경 내용**: `describe("폰트 스택")` 1개 추가. 상세는 "테스트 설계" 절.

### `e2e/style-code-view.spec.ts`
- **변경 내용**: 사이드패널 컨텍스트에서 `document.fonts.check` 단언 추가. 상세는 "테스트 설계" 절.

### `docs/DESIGN.md`
- **현재 역할**: 디자인 시스템 단일 출처. `:13`이 폰트로 Pretendard만 나열, `:59`가 "## 4. 타이포그래피" 헤딩, `:61`이 `font-sans` 스택 기술.
- **변경 내용**: `:13`에 Geist Mono(코드뷰·로그 전용) 추가. `:61` 아래에 `font-mono` 스택 + **log-viewer 폴백 사실** 한 줄. 추가로 **사이즈 축**: "코드뷰(CM·DOM 트리) = 13px mono, 두 표면 통일". `text-[13px]`는 현재 코드베이스에서 `DomTreeDialog.tsx:201` **단 1곳뿐인 one-off**인데 이 기능이 그걸 두 표면이 공유하는 규칙으로 승격시킨다 — DESIGN.md에 안 적으면 다음 사람이 한쪽만 바꿔 불변식이 조용히 깨진다(`CssCodeMirror.tsx:229` 주석 하나에만 의존하는 건 이미 얇다).

### `docs/DIRECTORY.md`
- **변경 내용**: `:97`의 `styles/` 설명이 "Pretendard import"라고만 적혀 있다 — Geist Mono import를 함께 명기.

## 데이터 흐름

런타임 데이터 흐름은 없다. 대신 **폰트 해석 체인**이 이 설계의 실체다.

```
[사이드패널]  globals.css @import → @font-face "Geist Mono Variable" (dist/assets/*.woff2, 확장 origin)
                                            │
              tailwind.config fontFamily.mono ┤
                       ├──────────────────────┴─→ preflight: pre/code/kbd/samp (미클래스 전부!)
                       ▼
              .font-mono { font-family: "Geist Mono Variable", ui-monospace, … }
                    │
                    ├── ConsoleLogContent:254,262 / NetworkLogContent:576 / LogSeekChip:11,22  (변경 0)
                    ├── CssCodeMirror:721 wrapper ──┬─→ .cm-editor (fontFamily 미지정 = 상속)
                    │                               ├─→ .cm-scroller / .cm-content  (inherit)
                    │                               └─→ .cm-tooltip*  (inherit — parent 미설정 조건)
                    └── DomTreeDialog:201 Card ─────→ DomTreeNode 전체            (상속)
                                                     ↳ @font-face 있음 → Geist 렌더

[log-viewer]  styles.css (Geist @import 없음 — 의도)
              같은 tailwind.config → 같은 .font-mono 규칙 + 같은 preflight가 emit됨
                    │
                    └── App.tsx:4-5가 import한 NetworkLogContent/ConsoleLogContent
                                                     ↳ @font-face 없음 → "Geist Mono Variable" 해석 실패
                                                     ↳ 다음 후보 ui-monospace로 폴백 (= 현행 동작)
```

핵심은 **`.font-mono` 규칙과 preflight는 두 빌드에 똑같이 나가지만 `@font-face`는 사이드패널에만 있다**는 비대칭이다. 폴백 스택이 이 비대칭을 흡수한다. (같은 비대칭이 `font-sans`/Pretendard에 **이미 존재한다** — `dist-log-viewer/index.html`에 `.font-sans{font-family:Pretendard Variable,…}`가 emit돼 있고 `@font-face`는 0건이다. 즉 이 설계가 새 패턴을 만드는 게 아니라 기성 패턴을 따른다.)

## 인터페이스 설계

새 TypeScript 타입·함수·메시지는 없다. 계약은 두 개의 CSS 사실이다:

```
tailwind.config.js  theme.extend.fontFamily.mono: string[]
  - [0]      === '"Geist Mono Variable"'   (패키지 index.css의 @font-face family와 일치해야 함)
  - [last]   === "monospace"               (제네릭 종착점)
  - length   >  1                          (log-viewer 폴백 보장 — 유일하게 테스트로 지킬 값어치가 있는 불변식)

src/styles/globals.css
  - @import "@fontsource-variable/geist-mono/index.css";  (@tailwind 디렉티브보다 위)
```

`@font-face`의 family 문자열은 패키지가 정한 `'Geist Mono Variable'`이다(`index.css` 6블록 전부 동일). **globals.css 자체엔 `@font-face`가 없다** — `@import`만 있고 실제 선언은 `node_modules/@fontsource-variable/geist-mono/index.css`에 있으며 postcss-import가 빌드 타임에 인라인한다. Tailwind 스택의 `[0]`과 family가 어긋나면 **콘솔 경고 없이 조용히 폴백**되는데, 이 계약은 단위 테스트가 아니라 **e2e의 `document.fonts.check`**가 지킨다(아래).

## 테스트 설계

두 층으로 나눈다. 각 층이 **다른 층이 구조적으로 못 잡는 것**을 잡는다.

### 단위 — `tokens.test.ts`에 `describe("폰트 스택")` 추가

```ts
// 주석을 걷어내고 따옴표 리터럴만 뽑는다 — 배열 안 주석·prettier 리플로우에 안 깨진다.
function parseFontStack(key: string): string[] { /* readFileSync + 정규식 */ }
expect(parseFontStack("mono").length).toBeGreaterThan(1);
expect(mono[mono.length - 1]).toBe("monospace");
```

- **`tailwind.config.js`를 텍스트로 읽는다. `import`하지 않는다** — 단, **이 결론에 이르는 근거가 두 번 바뀌었으니 기록해둔다**:
  1. 1판: "`package.json`이 `type:module`인데 config가 `require()`를 쓰므로 Vitest에서 터진다" → **거짓**. vite-node가 모든 모듈에 `require`를 주입한다(`node_modules/vite-node/dist/client.mjs:371`, `require: createRequire(href)`). **런타임 import는 실제로 성공한다**(실측).
  2. 2판: 그래서 `import`로 바꿨다 → **typecheck가 막는다**. `tsconfig.app.json`에 `allowJs`가 없어(기본 false) `import config from "../../../tailwind.config.js"`가 **TS7016**("Could not find a declaration file")으로 실패한다(실측). `pnpm test`는 통과하는데 `pnpm typecheck`만 깨지는 조합이라 눈에 안 띈다.
  3. 확정: `@ts-expect-error`로 뚫을 수 있으나 **저장소에 `@ts-expect-error`/`@ts-ignore` 선례가 0건**이라 테스트 하나 때문에 첫 사례를 만들지 않는다. `tokens.test.ts`는 이미 `readFileSync` + 정규식이 자기 기법(`parseTokens`)이므로 그걸 따른다.
- **교훈**: 런타임(vitest)과 타입체크(tsc)는 **별개 게이트**다. "import 되더라"는 절반의 검증이다.
- QA가 지적한 정규식 취약성(배열 안 주석의 쉼표·괄호)은 **주석 제거 후 따옴표 리터럴만 추출**해 해소한다. 혼합 따옴표(`'"Geist Mono Variable"'` vs `"ui-monospace"`)도 같은 방식으로 정규화된다 — 기존 `sans` 배열로 파서를 검증했다(12개, `sans-serif`로 종료).
- **검사는 이 하나뿐이다.** 이전 판의 4종 중 나머지 3개는 "같은 PR이 방금 쓴 문자열이 파일에 있는지" 확인하는 동어반복이었다(특히 "log-viewer에 Geist `@import` 없음"은 red가 된 적 없는 항진명제). 폴백 보장만이 **미래의 "정리" 유혹을 막는 진짜 불변식**이다.
- **신규 파일이 아니라 `tokens.test.ts`에 얹는다** — 단언 1개에 파일 하나는 과잉이고, `tokens.test.ts`의 논지 자체가 "globals ↔ log-viewer 쌍을 지킨다"로 같은 성격이다.

### e2e — `style-code-view.spec.ts`에 1줄

```ts
await sidePanel.evaluate(() => document.fonts.ready);
expect(await sidePanel.evaluate(() =>
  document.fonts.check('13px "Geist Mono Variable"'))).toBe(true);
```

- **단위 테스트가 구조적으로 못 잡는 것을 잡는다**: 단위는 소스 텍스트만 보므로 "빌드가 실제로 폰트를 실었는가"에 대해 말할 수 있는 게 없다. 이 단언은 `@import` 오배치(경고만 나고 빌드는 통과), family 문자열 불일치, **woff2 미emit**, 패키지 업그레이드 시 family 개명을 전부 잡는다.
- `getComputedStyle().fontFamily`는 **쓰지 않는다** — 스택 문자열만 돌려주고 실제 해석 결과를 말하지 않아 단위 테스트의 중복일 뿐이다. (이전 판은 이 한계만 보고 e2e 전체를 기각했는데, `document.fonts.check`를 검토하지 않은 절반의 논증이었다.)
- 참고: repo 전체에 `document.fonts` 사용처 0, 폰트를 단언하는 spec 0 → spurious fail 위험 없음.

## 기존 패턴 준수

- **테스트 트랙**: config import + 배열 단언이므로 `*.test.ts`(node 환경). jsdom 불필요.
- **실패 메시지 관용구**: 위반 항목을 문자열 배열로 모아 `toEqual([])`가 `tokens.test.ts`·`log-viewer/__tests__/i18n.test.ts` 양쪽의 하우스 스타일이다. 단언이 1개라 과할 수 있으나 형식은 맞춘다.
- **UI 컨벤션**(`docs/DESIGN.md`): 직접 스타일링이 아니라 Tailwind 토큰(`font-mono`) 경유. 새 임의값(`font-[...]`)을 만들지 않는다.
- **i18n·권한·매니페스트 영향 없음**: 새 문자열 없음(`title` 툴팁은 기존 라벨 텍스트 재사용). `manifest.config.ts`에 `content_security_policy`·`web_accessible_resources` 키가 없고 추가도 불필요 — 사이드패널이 자기 확장 origin에서 woff2를 로드하는 건 same-origin이라 CSP 무관하고, `web_accessible_resources`는 *웹 페이지*가 읽는 리소스에만 필요하다. **Pretendard가 이미 정확히 이 방식으로 출하 중**(`dist/assets/`에 woff2 92개·3.0MB).
- **코어 밸류(Privacy) 무영향**: 폰트가 확장에 번들돼 로컬에서 로드된다. 외부 CDN 요청 0. (Google Fonts CDN을 썼다면 사용자 IP가 매 세션 구글로 새어나가 밸류와 충돌했을 것이다.)
- **POSTMORTEM 참조**: 이 설계는 `2026-06-28 — 내보낸 로그 뷰어 라벨이 i18n 키 raw 노출 …(복제 dict 미동기화)` 항목 계열과 **인접하지만 같지는 않다**. 그 항목의 처방("복제본은 늘 대조 테스트로 묶는다")은 *복제*가 있을 때 성립하는데, 이번엔 복제가 없어 대조할 짝이 없다 — log-viewer가 폰트를 **의도적으로 안 갖는** 발산이다. 그래서 처방을 그대로 쓰지 않고 "발산해도 안전하도록 폴백을 지킨다"로 뒤집었다. (POSTMORTEM은 새 항목이 위에 쌓여 줄번호가 밀리므로 **항목 제목으로 인용한다**.)

## 대안 검토

1. **latin subset만 손수 `@font-face`로 작성** — 기각. Pretendard처럼 subset별 CSS 진입점을 기대했으나 이 패키지엔 없다(`index.css`/`wght.css`/`wght-italic.css`뿐). 직접 쓰면 `unicode-range` 표를 손으로 유지해야 하고 패키지 업데이트 때 조용히 stale된다. 전체 6 subset 실측 **77,256B**이고, `unicode-range` 덕에 브라우저는 실제 쓰는 subset만 로드하므로 런타임 비용은 latin-only와 같다.

2. **log-viewer에도 폰트 번들** — 기각. `vite-plugin-singlefile`이 `assetsInlineLimit`를 무한대로 설정해 모든 애셋을 base64 인라인한다. 77KB → base64 ~100KB가 **내보내는 `logs.html`마다** 붙는다(실측 487,257B → ~590KB). 폴백으로 충분히 읽힌다.

3. **`fontVariationSettings`로 기본 weight 고정** — 기각. Tailwind `fontFamily`는 `[family[], { fontVariationSettings }]` 튜플을 지원하지만, `font-variation-settings`는 **`font-weight` 유틸리티를 무력화**한다(낮은 수준 축이 우선) → `font-bold`가 조용히 안 먹는다. 게다가 preflight가 `theme('fontFamily.mono[1].fontVariationSettings')`를 읽으므로 튜플로 바꾸면 **`pre`/`code`에도 그 설정이 박힌다**. weight를 옮길 땐 `@layer base { .font-mono { font-weight: 450 } }`를 쓴다 — base 레이어라 utilities의 `font-medium`·`font-bold`가 정상적으로 이긴다.

4. **Martian Mono / Monaspace Argon** — 기각. PRD "폰트 선정" 참조. 셋 다 OFL-1.1·npm 제공이라 라이선스·배포 조건은 동일했고, 소구경 가독성과 줄 길이에서 갈렸다.

5. **DOM Tree와 CM을 14px로 통일** — 기각. **트렁케이션이 결정적**이었다. 라벨 가용폭 242px(depth 0) 기준:

   | 안 | 자폭 | depth 0 표시 | 오늘 대비 |
   |---|---|---|---|
   | 오늘 (14px sans) | ≈7.0px | 34자 | — |
   | **13px mono (채택)** | 7.8px | 31자 | **−10.3%** |
   | 14px mono | 8.4px | 28자 | −17.6% |

   mono 전환 자체가 자폭을 1.2배(0.6em/0.5em)로 올리므로, 13px의 0.929배 축소는 그걸 **일부 상쇄**하지만 14px은 상쇄가 없다. 14px은 추가로 CM을 13→14로 올려야 하는데(`:237` 본문 + `:342` 자동완성 li — 주석이 "본문과 맞춤"이라 짝), **CSS 뷰엔 `lineWrapping`이 없어 가로 스크롤이 확정 증가**한다. 14px의 장점(가독성)은 사이즈가 아니라 weight로 푸는 축이다(Task 6).

6. **DOM Tree를 sans 14px로 두고 CM만 mono** — 기각. "코드뷰 통일"이라는 목표를 절반 포기하는 셈이고, `CssCodeMirror.tsx:229`가 선언한 불변식이 깨진 상태로 남는다.

## 위험 요소

- **트렁케이션이 순증한다(−10.3%)** — 대안 5의 표. 그리고 **오늘도 이미 잘리고 있다**: 현실 라벨 `<div.flex.items-center.justify-between+2>`가 40자인데 depth 0 가용이 34자다(depth 5: 26→23자, depth 10: 17→15자). 레이아웃은 안 깨진다(`min-w-0 flex-1` 체인 정상) — **깨지는 건 정보량**이다. sans의 7.0px는 *평균*이라 `.items-center` 같은 narrow-glyph 라벨은 mono가 전부 0.6em을 물려 3자보다 더 잃는다. 완화책으로 `:271`에 `title` 툴팁을 단다. 수동 검증은 "`truncate`가 깨지는지"가 아니라 **"얼마나 더 잘리는지 허용 가능한가"**로 판정한다.
- **`LogSeekChip`의 `w-8`이 오버플로한다 — 기존 버그이고 이 변경이 Windows에서 악화시킨다.** `w-8`=32px, `text-xs`=12px, `truncate`·`overflow-hidden`·`tabular-nums` **없음**. 라벨은 `formatMmSs()`의 `M:SS`인데 분이 unpadded·무한이라 `61:00`(5자)이 가능하고 `logRow.test.ts:23`이 이미 그걸 고정한다. 0.6em·12px = 7.2px/char → 5자 = **36px > 32px**로 **오늘도 넘친다**. macOS는 SF Mono가 이미 0.6em이라 무변화, **Windows는 Consolas 0.55em → 0.6em으로 +9% 악화**(4자 `0:00`도 28.8px로 여유 3.2px뿐). 파급: 호출 4곳(`ConsoleLogContent.tsx:240`, `NetworkLogContent.tsx:438`·`:710`, `ActionLogContent.tsx:319`) × 2빌드. 덤으로 `ConsoleLogContent.tsx:252`의 하드코딩 `pl-[64px]`는 칩+아이콘 폭에 손으로 맞춘 값이라 metric 변화를 따라가지 않는다. **이번 스코프에서 고치지 않는다**(기존 버그 — CLAUDE.md "외과적 변경"). 수동 체크에 등재만 한다.
- **preflight 파급 범위를 모른 채 넘어갈 위험** — 위 preflight 절. Task 2 전수조사가 이걸 막는다.
- **log-viewer 발산은 이제 "기능"이다 — 미래에 폴백을 지우면 조용히 깨진다.** `fontFamily.mono`를 `['"Geist Mono Variable"']`로 정리하고 싶은 유혹이 언젠가 온다. 그 순간 다운로드된 `logs.html`의 코드 텍스트가 family 해석 실패로 브라우저 기본값에 떨어진다. `tokens.test.ts`의 폴백 단언과 tailwind.config 주석이 짝으로 막는다.
- **`@import` 위치 회귀**: 누가 `globals.css` 상단을 정리하며 `@import`를 `@tailwind` 아래로 옮기면 postcss-import가 **경고는 내지만 빌드는 통과**한다 → 로그를 안 읽으면 폴백만 남는다. 증상이 "폰트가 그냥 안 바뀜"이라 진단이 어렵다. e2e `document.fonts.check`가 이걸 잡는다.
- **family 문자열 불일치**: `"Geist Mono Variable"` vs `"Geist Mono"`를 헷갈리면 조용히 폴백된다. 콘솔 경고도 없다. e2e가 잡는다.
- **`text-sm` 제거의 시각 회귀**: 14→13px는 눈에 띈다. sans→mono 전환과 **동시에** 일어나 체감이 겹친다(mono가 넓어 일부 상쇄). line-height는 20px→19.5px. 실기기 확인 필수.
- **아이콘·텍스트 정렬 미세 이동**: `:263`/`:265` chevron(`h-3 w-3`)과 `:269` spacer(`h-4 w-4`)는 고정 px라 14→13px를 따라가지 않는다. 무시할 수준이나 실기기 확인 항목.
- **italic 합성**: `index.css`에 italic face가 없다. mono 영역에 italic이 들어오면 브라우저가 기울여 합성한다. 현재 `italic` 사용처는 `NetworkLogContent.tsx:552` 하나이고 `font-mono` 스코프 밖이라 무관하다. **단 preflight 파급으로 `<code>`/`<pre>` 안에 italic이 오면 해당된다** — 전수조사에서 확인.
- **weight 400이 얇을 수 있다**: mono는 고정폭 안 여백이 넉넉해 같은 400이어도 sans보다 묽게 읽힌다. 11px 로그 × 다크모드가 최악 케이스다. Task 6에서 `@layer base`로 450~500 조정이 필요할 수 있다 — 예상된 후속이지 회귀가 아니다.
- **CodeMirror 자동완성 팝업 회귀**: jsdom·e2e 사각지대라 눈이 유일한 안전망이다.
- **FOUT**: `font-display: swap`이라 폴백 metric으로 먼저 그려진다. `unicode-range`로 latin 1개만 디스크에서 읽으므로 체감은 없으나, swap 시프트가 `w-8` 칩과 겹치면 첫 페인트에서 한 번 흔들린다.
