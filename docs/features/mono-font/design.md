# 코드뷰 전용 mono 폰트 (Geist Mono) — 기술 설계

## 개요

`@fontsource-variable/geist-mono`를 의존성으로 추가하고 `globals.css`에 `@import`해 `@font-face`를 사이드패널에 싣는다. `tailwind.config.js`에 `fontFamily.mono`를 **처음으로** 정의해 `"Geist Mono Variable"`를 맨 앞에, Tailwind 기본 mono 스택을 폴백으로 둔다. 이 한 곳이 단일 출처이고, 기존 `font-mono` 5곳은 코드 변경 없이 따라온다. 코드뷰 통일은 클래스 2개 추가·1개 제거로 끝난다 — CodeMirror 래퍼에 `font-mono`, DOM Tree Card에 `font-mono`, DomTreeNode의 `text-sm` 제거.

런타임 로직·상태·메시지 변경이 전혀 없는 순수 스타일 변경이다.

## 변경 범위

### `package.json`
- **현재 역할**: 의존성 선언. `pretendard: ^1.3.9`가 같은 계열의 선례.
- **변경 내용**: `dependencies`에 `@fontsource-variable/geist-mono` 추가 (5.2.8, OFL-1.1).
- **주의**: `pnpm-workspace.yaml`의 `minimumReleaseAge: 1440` 정책이 적용된다 — 24시간 안 지난 버전은 자동 제외되고 직전 버전이 잡힌다. 5.2.8은 충분히 오래돼 무관. 빌드 스크립트 없는 패키지라 `onlyBuiltDependencies` 화이트리스트도 무관.

### `src/styles/globals.css`
- **현재 역할**: 사이드패널 전역 CSS. `:1`에 Pretendard `@import`, `:3-5`에 `@tailwind` 디렉티브, `:7-66`·`:68-105`에 `@layer base`.
- **변경 내용**: `:1` 바로 아래에 `@import "@fontsource-variable/geist-mono/index.css";` 추가.
- **제약**: CSS 사양상 `@import`는 **다른 규칙보다 앞서야 한다**. `@tailwind` 디렉티브 아래로 내려가면 무시된다. Pretendard 줄과 붙여 둔다.
- **`body`의 `font-family`(`:78-81`)는 건드리지 않는다** — 여긴 sans 기본값이고, mono는 `font-mono` 유틸로만 진입한다.

### `tailwind.config.js`
- **현재 역할**: `theme.extend.fontFamily`에 `sans`만 정의(`:11-24`). `mono`는 미정의라 Tailwind 기본값이 나간다.
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

- **`tailwindcss/defaultTheme`를 import해 스프레드하지 않는다.** 저장소 어디에도 `defaultTheme` import가 없고(선례 0), 기존 `sans`가 문자열 리터럴로 나열된 스타일을 그대로 따른다. 무엇보다 이 배열을 **테스트가 텍스트로 읽어 검증**하므로(아래) 리터럴이어야 한다.

### `src/sidepanel/tabs/styleEditor/CssCodeMirror.tsx`
- **현재 역할**: CSS 코드 뷰. `EditorView.theme`의 `"&"`(`:234-240`)가 `.cm-editor`에 `fontSize: 13px`만 주고 **`fontFamily`는 의도적으로 안 준다**. 대신 `.cm-scroller`(`:244`)·`.cm-content`(`:251`)·툴팁(`:325`,`:331`,`:395`)이 모두 `fontFamily: "inherit"`으로 상속 체인을 탄다. 체인의 뿌리는 JSX 래퍼 `<CodeMirror className="flex min-h-0 flex-1 flex-col">`(`:721`) → `body`(Pretendard).
- **변경 내용**: `:721`의 className에 `font-mono` 추가 — **이 한 곳이 에디터 본문·거터·자동완성 팝업·토큰 툴팁 전부를 뒤집는다.** `fontFamily: "inherit"` 5곳은 손대지 않는다.
- **`:329`의 2-class 오버라이드는 그대로 둔다.** CodeMirror 기본값 `.cm-tooltip.cm-tooltip-autocomplete > ul { font-family: monospace }`를 이겨야 하는 건 변함없다 — 그 `monospace`는 **브라우저 기본 mono이지 우리 Geist가 아니다.** family 지정이 무의미해지는 게 아니라 여전히 필요하다. (`maxHeight` 등 다른 속성도 이 셀렉터에 얹혀 있다.)
- `:229`의 주석을 새 사실("DOM Tree Dialog와 통일 — Geist Mono 13px")로 갱신한다.

### `src/sidepanel/tabs/DomTreeDialog.tsx`
- **현재 역할**: DOM 트리 다이얼로그. `DomTree`의 `<Card>`(`:201`)가 `text-[13px]`로 크기를 선언하고, `DomTreeNode`의 라벨 span(`:271`)이 `text-sm`(14px)으로 **그걸 덮는다**. 자식 span들(`:272`,`:273`,`:275`,`:282`,`:288`,`:292`,`:294`)은 색만 지정해 크기·family를 상속받는다.
- **변경 내용**:
  1. `:201` Card className에 `font-mono` 추가 — 트리 전체가 상속받는다.
  2. `:271`의 `text-sm` **제거** — Card의 `text-[13px]`가 비로소 주 텍스트에 적용된다.
- **`text-sm` 제거가 안전한 이유**: 크기를 선언한 유일한 자식이 `:271`이고, 나머지는 색만 지정한다. 제거하면 전부 Card의 13px로 수렴한다. 새 값을 심는 게 아니라 이미 있던 `text-[13px]` 선언(현재 주 텍스트에 안 먹는 사실상 죽은 선언)을 복원하는 것이다.
- **`font-mono`를 `DialogContent`(`:79`)에 얹지 않는다** — 다이얼로그 제목(`:81` `text-xl`)과 트리거 버튼(`:72` `text-2xl font-semibold`)까지 mono가 돼버린다. 트리 콘텐츠의 루트인 Card가 정확한 경계다.

### `src/styles/__tests__/fonts.test.ts` (신규)
- **역할**: 폰트 스택 회귀 고정. 상세는 아래 "기존 패턴 준수".

### `docs/DESIGN.md`
- **현재 역할**: 디자인 시스템 단일 출처. `:13`이 폰트로 Pretendard만 나열, `:58-60` "타이포그래피" 절이 `font-sans` 스택만 기술.
- **변경 내용**: `:13`에 Geist Mono(코드뷰·로그 전용) 추가, `:60`에 `font-mono` 스택 한 줄 추가 + log-viewer 폴백 사실 명기.

### `docs/DIRECTORY.md`
- **변경 내용**: `:97`의 `styles/` 설명이 "Pretendard import"라고만 적혀 있다 — Geist Mono import를 함께 명기.

## 데이터 흐름

런타임 데이터 흐름은 없다. 대신 **폰트 해석 체인**이 이 설계의 실체다.

```
[사이드패널]  globals.css @import → @font-face "Geist Mono Variable" (dist/assets/*.woff2, 확장 origin)
                                            │
              tailwind.config fontFamily.mono ┤
                                            ▼
              .font-mono { font-family: "Geist Mono Variable", ui-monospace, … }
                    │
                    ├── ConsoleLogContent:254,262 / NetworkLogContent:576 / LogSeekChip:11,22  (변경 0)
                    ├── CssCodeMirror:721 wrapper ──┬─→ .cm-editor (fontFamily 미지정 = 상속)
                    │                               ├─→ .cm-scroller / .cm-content  (inherit)
                    │                               └─→ .cm-tooltip*               (inherit)
                    └── DomTreeDialog:201 Card ─────→ DomTreeNode 전체            (상속)
                                                     ↳ @font-face 있음 → Geist 렌더

[log-viewer]  styles.css (Geist @import 없음 — 의도)
              같은 tailwind.config → 같은 .font-mono 규칙이 emit됨
                    │
                    └── App.tsx:4-5가 import한 NetworkLogContent/ConsoleLogContent
                                                     ↳ @font-face 없음 → "Geist Mono Variable" 해석 실패
                                                     ↳ 다음 후보 ui-monospace로 폴백 (= 현행 동작)
```

핵심은 **`.font-mono` 규칙은 두 빌드에 똑같이 나가지만 `@font-face`는 사이드패널에만 있다**는 비대칭이다. 폴백 스택이 이 비대칭을 흡수한다.

## 인터페이스 설계

새 TypeScript 타입·함수·메시지는 없다. 계약은 두 개의 CSS 사실이다:

```
tailwind.config.js  theme.extend.fontFamily.mono: string[]
  - [0]      === '"Geist Mono Variable"'   (globals.css의 @font-face family와 정확히 일치해야 함)
  - [last]   === "monospace"               (제네릭 종착점)
  - length   >  1                          (log-viewer 폴백 보장)

src/styles/globals.css
  - @import "@fontsource-variable/geist-mono/index.css";  (@tailwind 디렉티브보다 위)
```

`@font-face`의 family 문자열은 패키지가 정한 `'Geist Mono Variable'`이다(`index.css` 6개 블록 전부 동일, `metadata.json`의 `family: "Geist Mono"` + fontsource-variable 관례). Tailwind 스택의 `[0]`과 **문자열이 어긋나면 조용히 폴백**된다 — 아래 테스트가 이 쌍을 묶는다.

## 기존 패턴 준수

- **"별도 번들이 메인 모듈을 복제 → 복제본은 늘 대조 테스트로 묶는다"** (`docs/POSTMORTEM.md:198`, i18n dict 항목). log-viewer 폰트 공백이 정확히 이 계열이다. 다만 이번엔 *동기화*가 아니라 *의도된 발산*이므로, 테스트는 "두 값이 같다"가 아니라 **"발산해도 안전하도록 폴백이 남아있다"**를 고정한다. 같은 파일 `:29`가 기록한 globals↔log-viewer 토큰 표 쌍과 같은 구조.
- **테스트는 `tailwind.config.js`를 import하지 말고 텍스트로 읽는다.** `package.json`이 `"type": "module"`인데 `tailwind.config.js`는 마지막 줄에서 `require("tailwindcss-animate")`를 쓴다. Tailwind는 jiti로 로드해 문제없지만 **Vitest에서 `import`하면 `require is not defined`로 터진다.** 같은 디렉터리의 `tokens.test.ts:17`이 이미 `readFileSync` + 정규식으로 CSS를 파싱하는 선례를 만들어놨다 — 그대로 따른다.
- **테스트 트랙**: 순수 텍스트 파싱이므로 `*.test.ts`(node 환경). jsdom 불필요.
- **UI 컨벤션**(`docs/DESIGN.md`): 직접 스타일링이 아니라 Tailwind 토큰(`font-mono`) 경유. 새 임의값(`font-[...]`)을 만들지 않는다.
- **i18n·권한·매니페스트 영향 없음**: 새 문자열 없음. `manifest.config.ts`에 `content_security_policy`·`web_accessible_resources` 키가 없고 추가도 불필요 — 사이드패널이 자기 확장 origin에서 woff2를 로드하는 건 same-origin이라 CSP 무관하고, `web_accessible_resources`는 *웹 페이지*가 읽는 리소스에만 필요하다. **Pretendard가 이미 정확히 이 방식으로 동작 중**(`dist/assets/PretendardVariable.subset.*.woff2`)이라 검증된 경로다.
- **코어 밸류(Privacy) 무영향**: 폰트는 확장에 번들돼 로컬에서 로드된다. 외부 CDN 요청 0 — 네트워크로 나가는 게 없다. (Google Fonts CDN을 썼다면 사용자 IP가 매 세션 구글로 새어나가 밸류와 충돌했을 것이다.)

## 대안 검토

1. **latin subset만 손수 `@font-face`로 작성** — 기각. Pretendard처럼 subset별 CSS 진입점을 기대했으나 이 패키지엔 없다(`index.css`/`wght.css`/`wght-italic.css`뿐, `latin.css` 부재). 직접 쓰면 `unicode-range` 표를 손으로 유지해야 하고 패키지 업데이트 때 조용히 stale된다. 전체 6 subset을 다 실어도 ~75KB이고, `unicode-range` 덕에 **브라우저는 실제 쓰는 subset만 로드**하므로 런타임 비용은 latin-only와 같다. 번들 용량 75KB는 이 정도 유지보수 부채를 살 만큼 크지 않다.

2. **log-viewer에도 폰트 번들** — 기각. `vite-plugin-singlefile`이 `assetsInlineLimit`를 무한대로 설정해 모든 애셋을 base64 인라인한다. 6 subset ≈ 75KB → base64 ~100KB가 **내보내는 `logs.html`마다** 붙는다(476KB → ~576KB). log-viewer가 Pretendard를 뺀 것도 같은 이유로 보이며, 그 선례를 깨면서까지 살 가치가 없다. 폴백으로 충분히 읽힌다.

3. **`fontVariationSettings`로 기본 weight 고정** — 기각(그리고 이번엔 weight 자체가 비목표). Tailwind `fontFamily`는 `[family, { fontVariationSettings }]` 튜플을 지원하지만, `font-variation-settings`는 **`font-weight` 유틸리티를 무력화**한다(낮은 수준 축이 우선). `font-bold`가 조용히 안 먹는 함정이 생긴다. 나중에 기본 weight를 옮기고 싶으면 `@layer base { .font-mono { font-weight: 450 } }`가 낫다 — base 레이어라 utilities의 `font-medium`·`font-bold`가 정상적으로 이긴다.

4. **Martian Mono / Monaspace Argon** — 기각. PRD "폰트 선정" 참조. 셋 다 OFL-1.1·npm 제공이라 라이선스·배포 조건은 동일했고, 소구경 가독성과 줄 길이에서 갈렸다.

5. **DOM Tree를 14px로 통일(13px 대신)** — 기각. CSS 코드 뷰가 13px에 고정돼 있어(`CssCodeMirror.tsx:237`) 기준점이 13이고, 14로 올리면 CM까지 따라 올려야 해 스코프가 번진다. 게다가 mono는 같은 px에서 sans보다 넓고 x-height가 높아 체감이 커지는데, 트리 라벨엔 `truncate`가 걸려 있어(`:271`) 폭 증가가 곧 잘림 증가다.

## 위험 요소

- **log-viewer 발산은 이제 "기능"이다 — 미래에 폴백을 지우면 조용히 깨진다.** `fontFamily.mono`를 `['"Geist Mono Variable"']`로 정리하고 싶은 유혹이 언젠가 온다. 그 순간 다운로드된 `logs.html`의 코드 텍스트가 family 해석 실패로 브라우저 기본값에 떨어진다. `fonts.test.ts`가 이걸 막고, tailwind.config 주석이 이유를 남긴다.
- **`@import` 위치 회귀**: 누가 `globals.css` 상단을 정리하며 `@import`를 `@tailwind` 아래로 옮기면 CSS 사양상 **무시되고**, 에러 없이 폴백만 남는다. 증상이 "폰트가 그냥 안 바뀜"이라 진단이 어렵다.
- **family 문자열 불일치**: `"Geist Mono Variable"` vs `"Geist Mono"`를 헷갈리면 조용히 폴백된다. 콘솔 경고도 없다. → `fonts.test.ts`가 globals.css의 `@font-face` family와 tailwind 스택 `[0]`을 **대조**한다.
- **`text-sm` 제거의 시각 회귀**: 14px→13px는 눈에 띈다. 게다가 sans→mono 전환과 **동시에** 일어나 체감 변화가 겹친다(mono가 더 넓어 보이므로 일부 상쇄된다). 실기기 확인 필수 — 특히 깊게 중첩된 노드의 들여쓰기·`truncate` 경계.
- **italic 합성**: `index.css`에 italic face가 없다. mono 영역에 italic이 들어오면 브라우저가 기울여 합성한다(품질 저하). 현재 `italic` 사용처는 `NetworkLogContent.tsx:552` 하나이고 `font-mono` 스코프 밖(`:576`의 `<pre>`와 다른 요소)이라 무관하다. mono 영역에 italic을 새로 쓸 일이 생기면 `wght-italic.css`를 추가로 import해야 한다.
- **weight 400이 얇을 수 있다**: mono는 고정폭 안 여백이 넉넉해 같은 400이어도 sans보다 묽게 읽힌다. 11px 로그에서 특히. 시각 검증에서 `@layer base`로 450~500 조정이 필요할 수 있다(대안 3 참조) — 이건 예상된 후속이지 회귀가 아니다.
- **CodeMirror 자동완성 팝업 회귀**: `:331`이 CM 기본 `monospace`를 이기는 구조가 유지돼야 한다. 래퍼만 바꾸면 되지만, 팝업은 시각 확인이 필요한 표면이다(jsdom으로 못 잡음 — `CLAUDE.md`의 "포인터·캔버스" 계열과 같은 한계).
- **`pnpm install` 시 `minimumReleaseAge` 경고**: 정책상 24시간 미만 버전은 배제된다. 5.2.8은 무관하나, 설치 결과 lockfile 버전이 의도와 다르면 이 정책을 먼저 의심한다.
