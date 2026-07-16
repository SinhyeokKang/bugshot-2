# 코드뷰 전용 mono 폰트 (Geist Mono) — 구현 태스크

## 선행 조건

- **새 의존성 1개**: `@fontsource-variable/geist-mono@5.2.8` (OFL-1.1 — 번들·재배포 자유).
- **새 권한·env·OAuth·외부 API 없음.** `manifest.config.ts` 무변경 — 사이드패널이 확장 origin에서 woff2를 로드하는 건 same-origin이라 CSP·`web_accessible_resources` 무관(Pretendard가 이미 같은 방식으로 출하 중).
- **코어 밸류(Privacy) 무영향** — 폰트가 로컬 번들이라 외부 요청 0. privacy 문서 갱신 대상 아님.
- **shadcn 컴포넌트 추가 없음.**
- **착수 전 `docs/POSTMORTEM.md`를 `log-viewer`·`복제`·`토큰`으로 grep** — 별도 번들이 메인을 복제하는 계열의 과거 함정을 소환한다(design.md "기존 패턴 준수" 참조).

## 태스크

### Task 1: 의존성 추가
- **변경 대상**: `package.json`, `pnpm-lock.yaml`
- **작업 내용**: `pnpm add @fontsource-variable/geist-mono@5.2.8` — **설치 명령에 버전을 명시한다**(`minimumReleaseAge: 1440` 때문에 무버전은 무엇이 잡힐지 고정하지 못한다). 단 **manifest에 남는 범위는 `^5.2.8`**로 둔다 — 저장소 관례가 캐럿 46 : 정확고정 1이고 `pretendard: ^1.3.9`가 같은 선례다. 재결정은 lockfile이 막으므로 캐럿이어도 결정성은 유지된다. `dependencies`에 들어가야 한다(런타임 CSS가 참조하므로 devDependencies가 아니다).
  > **함정**: `pnpm add pkg@X`는 manifest에 정확 고정을 쓴다. 손으로 `^`를 붙였으면 **`pnpm install`을 다시 돌려 lockfile specifier를 맞춰야 한다** — 안 그러면 `pnpm install --frozen-lockfile`이 `ERR_PNPM_OUTDATED_LOCKFILE`로 깨진다(CI 기본값).
- **검증**:
  - [x] `package.json`의 `dependencies`에 `@fontsource-variable/geist-mono: ^5.2.8`
  - [x] `pnpm install --frozen-lockfile`이 통과한다 (lockfile specifier 동기 확인)
  - [x] `node_modules/@fontsource-variable/geist-mono/index.css`에 `@font-face` 6개, 전부 `font-style: normal`, family 전부 `'Geist Mono Variable'`
  - [x] `pnpm install` 시 "Ignored build scripts" 경고에 이 패키지가 **뜨지 않음**

### Task 2: preflight 파급 전수조사 (조사 전용 — ✅ 완료, 결과는 design.md "전수조사 결과")
> **결론: `font-sans` 방어 필요 0곳.** preflight를 받는 표면은 **3곳**(Tiptap 코드블록, `DocSectionBody`, `IssuePreviewView` — 뒤 둘은 `dangerouslySetInnerHTML` + `doc-section-body.css` 공유)이고 전부 Geist 전환이 바람직하다. JSX의 `<pre>` 4곳은 `font-mono`/`font-sans` 명시라 무관하고, `markdownToAsanaHtml.ts`·`buildIssueMarkdown.ts`의 `<pre>`/`<code>`는 트래커로 보내는 HTML 문자열이라 우리 DOM이 아니다. 구현 시 이 태스크는 건너뛴다.
> ⚠️ 1차 조사가 JSX grep만 써서 `dangerouslySetInnerHTML` 2곳을 놓쳤다 — design.md "조사 방법의 사각" 참조.

- **변경 대상**: `docs/features/mono-font/design.md` (조사 결과 기록)
- **작업 내용**: `fontFamily.mono` 정의는 preflight(`code, kbd, samp, pre`)를 통해 **클래스가 안 붙은 모든 `pre`/`code`/`kbd`/`samp`**를 Geist로 바꾼다. 그 목록을 확정한다.
  - `grep -rnE "<(pre|code|kbd|samp)[ >]" src/` 로 후보 수집.
  - 각 후보가 (a) `font-mono`/`font-sans`를 명시하는가 (b) 미클래스라 preflight를 받는가 분류.
  - 특히 확인: **Tiptap 에디터의 코드블록·인라인 코드**(`src/sidepanel/components/TiptapEditor.tsx` 및 관련), 마크다운 프리뷰 경로, `src/log-viewer/` 내부(별도 빌드도 같은 preflight를 받는다 — 다만 `@font-face`가 없어 폴백).
  - 각 항목에 "mono로 바뀌는 게 바람직한가" 판정. **바람직하지 않은 게 나오면 그 자리에서 `font-sans` 명시**(`NetworkLogContent.tsx:733`가 그 선례).
- **검증**:
  - [x] 미클래스 `pre`/`code`/`kbd`/`samp` 목록이 design.md에 기록됨 (0건이면 "0건" 명기)
  - [x] 각 항목에 mono 전환 가부 판정이 붙음
  - [x] `font-sans` 방어가 필요한 곳이 식별됨 (없으면 "없음")

### Task 3: 폴백 보장 테스트 (테스트 먼저 — red)
- **변경 대상**: `src/styles/__tests__/tokens.test.ts`
- **작업 내용**: `describe("폰트 스택")` 추가. **신규 파일을 만들지 않는다** — 단언 1개에 파일 하나는 과잉이고, tokens.test.ts의 논지가 "globals ↔ log-viewer 쌍을 지킨다"로 같은 성격이다.
  ```ts
  // 주석 제거 후 따옴표 리터럴만 추출 — 배열 내 주석·prettier 리플로우에 안 깨진다.
  function parseFontStack(key: string): string[] { /* readFileSync + 정규식 */ }
  // log-viewer는 별도 빌드라 @font-face가 없다 — 이 폴백만이 안전망이다.
  expect(parseFontStack("mono").length).toBeGreaterThan(1);
  expect(mono[mono.length - 1]).toBe("monospace");
  ```
  - **텍스트 파싱한다. `import`하지 않는다.** 근거는 `require`가 아니다 — vite-node가 `require`를 주입해 **런타임 import는 실제로 성공한다**(실측). 막는 건 **typecheck**다: `tsconfig.app.json`에 `allowJs`가 없어 `import`가 **TS7016**으로 실패하고(`pnpm test`는 통과하는데 `pnpm typecheck`만 깨지는 조합), 저장소에 `@ts-expect-error` 선례가 0건이라 뚫지 않는다. 옆의 `parseTokens`가 같은 기법이다. 상세는 design.md "테스트 설계".
  - **검사는 이것 하나뿐이다.** family 문자열 일치·`@import` 위치·log-viewer `@import` 부재는 전부 동어반복이거나 항진명제라 뺐다 — 그 위험들은 **Task 6의 e2e**가 실질적으로 잡는다.
- **검증**:
  - [x] Task 4 전이므로 **실패**한다(`fontFamily.mono`가 `undefined` → red 확인)

### Task 4: 폰트 로드 + Tailwind 스택 정의 (green)
- **변경 대상**: `src/styles/globals.css`, `tailwind.config.js`
- **작업 내용**:
  - `globals.css` `:1` Pretendard `@import` **바로 아래**에 `@import "@fontsource-variable/geist-mono/index.css";`. `@tailwind` 디렉티브(`:3-5`)보다 위여야 한다.
  - `tailwind.config.js` `theme.extend.fontFamily`(`:11-26`)에 `sans` 다음으로 `mono` 추가 — design.md "변경 범위"의 코드 블록 그대로. **폴백 스택을 지우면 안 되는 이유를 주석으로 남긴다.** 평범한 배열로 둔다(튜플 금지 — preflight가 `mono[1].fontVariationSettings`를 읽는다).
  - `body`의 `font-family`(`globals.css:78-81`)는 **건드리지 않는다**.
  - **플러그인 배열(`:88`)을 건드리지 않는다** — `tailwindcss-animate`와 `@tailwindcss/container-queries` 2개가 한 줄에 있다.
- **검증**:
  - [x] `pnpm test tokens` 통과 (red→green)
  - [x] `pnpm typecheck` 통과

### Task 5: CSS 코드 뷰 + DOM Tree를 mono로 (동일 커밋)
> Task 4/5를 나누지 않는다. `CssCodeMirror.tsx:229`가 선언한 "DOM Tree Dialog와 통일" 불변식의 양쪽 절반이라, 하나만 들어가면 문서화된 불변식이 깨진 상태가 된다. (각각 클래스 1개 수준이라 "병렬 가능"을 논할 크기도 아니다.)

- **변경 대상**: `src/sidepanel/tabs/styleEditor/CssCodeMirror.tsx`, `src/sidepanel/tabs/DomTreeDialog.tsx`
- **작업 내용**:
  - **CssCodeMirror**: `:721`의 className(`"flex min-h-0 flex-1 flex-col"`)에 `font-mono` 추가. `<CodeMirror>`는 `:698`에서 열리고 `:721`이 className prop 줄이다. **이 한 곳이 상속 체인의 뿌리**라 본문·거터·자동완성 팝업·토큰 툴팁이 전부 따라온다.
    - `:229` 주석 갱신 — "앱 기본 Pretendard·13px" → "Geist Mono·13px".
    - **`fontFamily: "inherit"` 5곳(`:244`,`:251`,`:325`,`:331`,`:395`)은 손대지 않는다.**
    - **`:330`의 2-class 오버라이드도 그대로 둔다**(`:329`는 주석) — CM 기본값의 `monospace`는 *브라우저 기본 mono*이지 Geist가 아니다.
    - `fontSize: "13px"`(`:237`)를 **올리지 않는다** (design.md 대안 5).
  - **DomTreeDialog**:
    1. `:201` `<Card>` className에 `font-mono` 추가 (`text-[13px]` 옆).
    2. `:271` 라벨 span의 **`text-sm` 제거** → Card의 `text-[13px]` 적용.
    3. `:271`에 **`title` 추가** — 트렁케이션이 −10.3% 순증하고 오늘도 이미 잘리므로(design.md 위험 요소) hover로 전문을 볼 수 있게 한다. 트리거(`:73`)의 기존 `title` 패턴을 따른다. 새 i18n 문자열 없음(라벨 텍스트 재사용).
    - **`font-mono`를 `DialogContent`(`:79`)에 얹지 않는다** — 제목(`:81`)·트리거(`:72`)까지 mono가 된다.
    - **로딩·에러 상태(`:186`,`:194`)는 sans 14px로 둔다** — 코드가 아니라 UI 텍스트다.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] 수동은 Task 8에서 일괄

### Task 6: e2e 폰트 로드 단언 (✅ 완료)
- **변경 대상**: `e2e/style-code-view.spec.ts`
- **작업 내용**: 사이드패널 컨텍스트에 아래 추가. 단위 테스트는 소스 텍스트만 보므로 "빌드가 실제로 폰트를 실었는가"를 말할 수 없다 — 이 단언이 그 공백을 메운다(`@import` 오배치·family 불일치·woff2 미emit·패키지 업그레이드 시 개명).
  ```ts
  await document.fonts.load('13px "Geist Mono Variable"');   // unicode-range 지연 로드 강제
  [...document.fonts].filter((f) => f.family.replace(/["']/g, "") === "Geist Mono Variable")
  // → length > 0 (등록 자체) + status에 "loaded" 포함
  ```
  > **`document.fonts.check()`는 쓰지 말 것 — 실측으로 기각됐다.** 매칭 `@font-face`가 없으면 family가 시스템 폰트로 폴백되고 폴백은 늘 available이라 **true**를 돌려준다. woff2가 0개 emit된 빌드에서도 통과하는 공허한 단언이다. `getComputedStyle().fontFamily`도 스택 문자열만 반환해 단위 테스트 중복.
- **검증**:
  - [x] `pnpm build:e2e && pnpm test:e2e style-code-view` 통과 (9/9, 연속 2회)
  - [x] 일부러 `globals.css`의 `@import`를 `@tailwind` 아래로 옮기면 이 단언이 **실패**한다 — **확인됨**: woff2 0개 emit + `faces.length` 0으로 red (빌드는 경고만 내고 통과). 원복 완료

### Task 7: 문서 갱신
- **변경 대상**: `docs/DESIGN.md`, `docs/DIRECTORY.md`
- **작업 내용**:
  - `DESIGN.md:13` — 폰트 목록에 Geist Mono(코드뷰·로그 전용) 추가.
  - `DESIGN.md:61` 아래(§4 타이포그래피, 헤딩은 `:59`) — ① `font-mono` 스택 한 줄 ② **log-viewer는 `@font-face`가 없어 시스템 mono로 폴백된다는 사실**(의도된 발산임을 남겨야 나중에 "버그"로 오인해 폴백을 지우지 않는다) ③ **사이즈 축**: "코드뷰(CM·DOM 트리) = 13px mono, 두 표면 통일".
  - `DIRECTORY.md:97` — `styles/` 설명의 "Pretendard import"에 Geist Mono import 추가.
- **검증**:
  - [x] `DESIGN.md:13`에 Geist Mono 항목 존재
  - [x] `DESIGN.md` §4에 `font-mono` 스택 + log-viewer 폴백 사실 + 13px 통일 규칙 3개 모두 존재
  - [x] `DIRECTORY.md:97`에 Geist import 명기

### Task 8: 시각 검증 + weight 판정
- **변경 대상**: 없음(검증 전용). 조정이 필요하면 `globals.css`에 `@layer base` 한 블록.
- **작업 내용**: **`/build` 스킬 실행 후**(CLAUDE.md: 빌드는 자동 실행하지 않는다) Chrome에 언팩 로드. 아래 "수동 테스트"의 **차단 항목**을 통과시키고, **관찰 항목**으로 weight를 판정한다.
  - **weight 판정 기준**(주관 배제): *"다크모드 × 11px × `NetworkLogContent.tsx:576` 페이로드"*가 최악 케이스다. **이 조합에서 sans 400 대비 묽게 읽히면 조정한다.** 조정은 `@layer base { .font-mono { font-weight: 450 } }` — `font-variation-settings`는 쓰지 않는다(`font-bold` 무력화 + preflight가 튜플을 읽음). base 레이어라 utilities가 정상적으로 이긴다.
  - 조정은 **1회로 끝낸다**. 400↔450에서 결론이 안 나면 400으로 확정하고 후속 이슈로 뺀다.
- **검증**: 아래 "수동 테스트 — 차단" 5항목 전부 + weight 판정 기록.

## 테스트 계획

- **단위** (`src/styles/__tests__/tokens.test.ts`, node 트랙): 폴백 보장 1종 — `mono.length > 1` && 마지막이 `"monospace"`. (design.md "테스트 설계"에 4종→1종으로 줄인 근거.)
- **e2e** (`e2e/style-code-view.spec.ts`): `document.fonts.check('13px "Geist Mono Variable"')` === `true`. **"~하면 ~가 된다" 판정 가능**: *사이드패널이 열리면 Geist Mono Variable이 로드돼 있다.*
- **수동 — 차단(5)**: 통과 못 하면 진행 불가.
  - [ ] 로그 탭 콘솔 항목: DevTools **Computed → Rendered Fonts**에 `Geist Mono Variable` 표기 (스택 문자열이 아니라 실제 렌더 폰트 — 폴백을 잡는 유일한 수단)
  - [ ] **CSS 뷰 자동완성 팝업**(속성 입력 중)이 Geist — CM 기본 monospace로 새지 않는지. jsdom·e2e 사각지대라 눈이 유일한 안전망
  - [ ] DOM Tree Dialog와 CSS 코드 뷰가 **같은 13px**로 보임 (통일 불변식)
  - [ ] `NetworkLogContent.tsx:733`의 `<pre>`가 **여전히 sans** (mono로 바뀌었으면 preflight 방어가 깨진 것 = 회귀)
  - [ ] `logs.html` 내보내 열기: 코드 텍스트가 시스템 mono로 **정상 렌더**(사이드패널과 폰트가 다른 건 정상) + `dist-log-viewer/index.html`이 **487,257B에서 증가하지 않음**
- **수동 — 관찰(weight 판정 입력, pass/fail 아님)**:
  - [ ] 다크모드 × 11px 페이로드 체감 → Task 8의 판정 기준에 대입
  - [ ] DOM Tree 깊은 노드: 잘림이 **얼마나 더 늘었는지 허용 가능한가** (안 깨지는지가 아니다 — 레이아웃은 안 깨진다). `title` 툴팁으로 전문이 보이는지 함께 확인
  - [ ] DOM Tree 제목·트리거가 **sans 유지**(mono로 샜으면 경계 실수)
  - [ ] 아이콘 정렬(`:263`/`:265` chevron, `:269` spacer는 고정 px라 13px를 안 따라감)
- **수동 — 등재만(기존 버그, 이번에 안 고침)**:
  - [ ] `LogSeekChip`: 60분 이상 녹화 후 5자 라벨(`61:00`)이 인접 아이콘을 침범하는지 관찰. **오늘도 이미 넘치고**(36px > `w-8`=32px) Windows에서 +9% 악화. 고치지 않되 실제 모습을 확인해 후속 이슈에 근거를 남긴다

> 이전 판의 "latin 하나만 로드되는지(`unicode-range` 확인)"는 뺐다 — 브라우저 보장 동작이라 우리가 검증할 대상이 아니다. "`dist/assets`에 woff2 emit"도 Task 6의 e2e가 자동으로 잡으므로 뺐다.

## 구현 순서 권장

```
Task 1 (의존성)
   └→ Task 2 (preflight 전수조사 — 조사 전용)
        └→ Task 3 (테스트 red) → Task 4 (스택 정의 → green)
                                     └→ Task 5 (CM + DOM Tree, 동일 커밋)
                                          └→ Task 6 (e2e)
                                               └→ Task 7 (문서)
                                                    └→ Task 8 (시각 검증 + weight)
```

- **Task 2를 Task 4보다 먼저 한다** — 파급 범위를 모르고 `fontFamily.mono`를 정의하면 미클래스 `pre`/`code`가 조용히 바뀐 채로 넘어간다. 조사가 먼저다.
- Task 3→4는 TDD red→green.
- Task 8은 실기기 의존이라 마지막. weight 조정이 발생하면 후속이지 회귀가 아니다.
- Task 7은 Task 8에서 weight가 바뀌면 DESIGN.md에 반영해야 하므로 Task 8 앞에 두되, 확정값은 Task 8 후 보정.

## 가이드 영향

**없음.** 폰트 교체는 가이드 본문의 설명 대상(기능·플로우·UI 라벨)이 아니다. `guide/{ko,en}/assets/*.jpg` 스크린샷에 로그·CSS 뷰 화면이 있어 렌더 폰트가 미세하게 달라지지만, **UI 구조·라벨·플로우가 그대로**라 재촬영 대상이 아니다. `guide/AUTHORING.md`의 사실 스냅샷(플랫폼 표·단축키·로그 정책)도 무관.
