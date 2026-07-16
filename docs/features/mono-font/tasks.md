# 코드뷰 전용 mono 폰트 (Geist Mono) — 구현 태스크

## 선행 조건

- **새 의존성 1개**: `@fontsource-variable/geist-mono@5.2.8` (OFL-1.1 — 번들·재배포 자유). `pnpm-workspace.yaml`의 `minimumReleaseAge: 1440`에 걸리지 않는 오래된 버전이고, 빌드 스크립트가 없어 `onlyBuiltDependencies` 승인도 불필요하다.
- **새 권한·env·OAuth·외부 API 없음.** `manifest.config.ts` 무변경 — 사이드패널이 확장 origin에서 woff2를 로드하는 건 same-origin이라 CSP·`web_accessible_resources` 무관하다(Pretendard가 이미 같은 방식).
- **코어 밸류(Privacy) 무영향** — 폰트가 로컬 번들이라 외부 요청 0. privacy 문서 갱신 대상 아님.
- **shadcn 컴포넌트 추가 없음.**

## 태스크

### Task 1: 의존성 추가
- **변경 대상**: `package.json`, `pnpm-lock.yaml`
- **작업 내용**: `pnpm add @fontsource-variable/geist-mono` — `dependencies`에 들어가야 한다(`pretendard`와 같은 위치. 런타임 CSS가 참조하므로 devDependencies가 아니다).
- **검증**:
  - [ ] `package.json`의 `dependencies`에 `@fontsource-variable/geist-mono` 존재
  - [ ] `node_modules/@fontsource-variable/geist-mono/index.css` 존재 + `@font-face` 6개(전부 `font-style: normal`)
  - [ ] `pnpm install` 시 "Ignored build scripts" 경고에 이 패키지가 **뜨지 않음**

### Task 2: 폰트 스택 회귀 테스트 (테스트 먼저 — red)
- **변경 대상**: `src/styles/__tests__/fonts.test.ts` (신규)
- **작업 내용**: `tokens.test.ts`의 방식을 그대로 따라 **파일을 텍스트로 읽어 정규식 파싱**한다.
  > **`tailwind.config.js`를 `import`하면 안 된다** — `package.json`이 `"type": "module"`인데 config 마지막 줄이 `require("tailwindcss-animate")`라 Vitest(ESM)에서 `require is not defined`로 터진다. Tailwind는 jiti로 로드해서 무사한 것뿐이다.
  - `readFileSync`로 `tailwind.config.js` + `src/styles/globals.css` 로드.
  - `fontFamily` 블록에서 `mono: [ ... ]` 배열을 추출해 문자열 리스트로 파싱.
  - 검사 4종:
    1. `mono[0]`이 globals.css의 `@font-face`가 선언한 family(`Geist Mono Variable`)와 **일치** — 어긋나면 조용히 폴백되는 함정을 고정.
    2. `mono.length > 1` && `mono[mono.length - 1] === "monospace"` — **log-viewer 폴백 보장**(핵심). 주석으로 이유를 남긴다: log-viewer는 별도 빌드라 `@font-face`가 없고 이 폴백만이 안전망이다.
    3. globals.css의 Geist `@import`가 첫 `@tailwind` 디렉티브보다 **앞선다** — CSS 사양상 뒤로 가면 무시된다.
    4. `src/log-viewer/styles.css`에 Geist `@import`가 **없다** — 의도된 발산을 못박아, 나중에 무심코 추가해 `logs.html`이 ~100KB 불어나는 걸 막는다.
- **검증**:
  - [ ] `pnpm test fonts` — Task 3 전이므로 1·2·3이 **실패**해야 한다(red 확인). 4는 처음부터 통과.

### Task 3: 폰트 로드 + Tailwind 스택 정의 (green)
- **변경 대상**: `src/styles/globals.css`, `tailwind.config.js`
- **작업 내용**:
  - `globals.css` `:1` Pretendard `@import` **바로 아래**에 `@import "@fontsource-variable/geist-mono/index.css";` 추가. `@tailwind` 디렉티브(`:3-5`)보다 위여야 한다.
  - `tailwind.config.js` `theme.extend.fontFamily`에 `sans` 다음으로 `mono` 추가 (`design.md` "변경 범위"의 코드 블록 그대로). **폴백 스택을 지우면 안 되는 이유를 주석으로 남긴다.**
  - `body`의 `font-family`(`globals.css:78-81`)는 **건드리지 않는다** — sans 기본값 유지.
- **검증**:
  - [ ] `pnpm test fonts` 통과 (4종 전부 green)
  - [ ] `pnpm typecheck` 통과

### Task 4: CSS 코드 뷰를 mono로
- **변경 대상**: `src/sidepanel/tabs/styleEditor/CssCodeMirror.tsx`
- **작업 내용**:
  - `:721`의 `<CodeMirror className="flex min-h-0 flex-1 flex-col">`에 `font-mono` 추가. **이 한 곳이 상속 체인의 뿌리**라 본문·거터·자동완성 팝업·토큰 툴팁이 전부 따라온다.
  - `:229` 주석 갱신 — "앱 기본 Pretendard·13px" → "Geist Mono·13px"로. DOM Tree Dialog와 통일한다는 취지는 유지(Task 5가 짝).
  - **`fontFamily: "inherit"` 5곳(`:244`,`:251`,`:325`,`:331`,`:395`)은 손대지 않는다.**
  - **`:329`의 2-class 오버라이드도 그대로 둔다** — CM 기본값 `.cm-tooltip.cm-tooltip-autocomplete > ul { monospace }`의 `monospace`는 *브라우저 기본 mono*이지 Geist가 아니다. 여전히 이겨야 한다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동(Task 6에서 일괄): CSS 세그먼트 토글 → 본문이 Geist Mono 13px

### Task 5: DOM Tree를 mono + 13px로 통일
- **변경 대상**: `src/sidepanel/tabs/DomTreeDialog.tsx`
- **작업 내용**:
  - `:201` `<Card>` className에 `font-mono` 추가 (`text-[13px]` 옆). 트리 콘텐츠의 루트라 여기가 정확한 경계다.
  - `:271` 라벨 span의 **`text-sm` 제거** → Card의 `text-[13px]`가 주 텍스트에 적용된다. (크기를 선언한 유일한 자식이라, 제거하면 나머지 색-only span들과 함께 전부 13px로 수렴한다.)
  - **`font-mono`를 `DialogContent`(`:79`)에 얹지 않는다** — 제목(`:81`)·트리거(`:72`)까지 mono가 된다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동(Task 6): DOM 트리 텍스트가 Geist Mono 13px, CSS 코드 뷰와 **같은 크기로 보임**

### Task 6: 시각 검증 + weight 판단
- **변경 대상**: 없음(검증 전용). 조정이 필요하면 `globals.css`에 `@layer base` 한 블록.
- **작업 내용**: `pnpm build` 후 Chrome에 언팩 로드. 아래 체크리스트 수행. weight가 얇게 읽히면 `@layer base { .font-mono { font-weight: 450 } }`로 조정한다 — `font-variation-settings`는 쓰지 않는다(`font-bold` 등 weight 유틸을 무력화한다). base 레이어라 utilities가 정상적으로 이긴다.
- **검증**: 아래 "수동 테스트" 절 전체.

### Task 7: 문서 갱신
- **변경 대상**: `docs/DESIGN.md`, `docs/DIRECTORY.md`
- **작업 내용**:
  - `DESIGN.md:13` — 폰트 목록에 Geist Mono(코드뷰·로그 전용) 추가.
  - `DESIGN.md:60` "타이포그래피" — `font-mono` 스택 한 줄 추가 + **log-viewer는 `@font-face`가 없어 시스템 mono로 폴백된다는 사실**을 명기(의도된 발산임을 문서에 남겨야 나중에 "버그"로 오인해 폴백을 지우지 않는다).
  - `DIRECTORY.md:97` — `styles/` 설명의 "Pretendard import"에 Geist Mono import 추가.
- **검증**:
  - [ ] `/push` 문서 신선도 검사에서 DESIGN·DIRECTORY가 diff에 걸려도 추가 지적 없음

## 테스트 계획

- **단위 테스트** (`src/styles/__tests__/fonts.test.ts`, node 트랙):
  - `mono[0]` ↔ globals.css `@font-face` family 일치
  - 폴백 보장: `length > 1` && 마지막이 `"monospace"`
  - Geist `@import`가 `@tailwind`보다 앞
  - `log-viewer/styles.css`에 Geist `@import` 부재(의도된 발산 고정)
- **e2e 시나리오**: **없음.** 폰트 렌더는 시각 속성이라 Playwright로 판정할 가치가 낮다. `getComputedStyle(el).fontFamily`가 스택 문자열을 돌려주는 건 확인할 수 있지만, 그건 위 단위 테스트가 이미 고정하는 사실의 중복이고 **실제 렌더 폰트(폴백 여부)는 알려주지 않는다** — e2e가 이 위험을 못 잡는다.
- **수동 테스트** (Chrome, `pnpm build` 후 언팩 로드):
  - [ ] 로그 탭 → 콘솔 항목 펼침: 본문·스택이 Geist Mono. DevTools **Computed → Rendered Fonts**에 `Geist Mono Variable` 표기(스택 문자열이 아니라 **실제 렌더 폰트** 확인 — 폴백을 잡는 유일한 방법)
  - [ ] 네트워크 항목 페이로드(`:576`) Geist Mono / 같은 화면 `:733`의 `<pre>`는 **여전히 sans**(의도적 역방향 — mono로 바뀌었으면 회귀)
  - [ ] `LogSeekChip` 상대시간 칩 정렬 유지(고정폭이라 오히려 개선돼야 정상)
  - [ ] CSS 세그먼트 토글 → 에디터 본문 Geist Mono 13px
  - [ ] **CSS 뷰 자동완성 팝업**(속성 입력 중) 폰트가 Geist Mono — CM 기본 monospace로 새지 않는지. jsdom으로 못 잡는 표면이라 눈이 유일한 안전망
  - [ ] CSS 뷰 토큰 툴팁(`:395`) 폰트 일치
  - [ ] DOM Tree Dialog: 태그·id·class가 Geist Mono, **CSS 코드 뷰와 같은 크기**(13px 통일 확인)
  - [ ] DOM Tree 깊게 중첩된 노드: `truncate` 경계·들여쓰기가 mono 폭 증가로 깨지지 않는지
  - [ ] DOM Tree 다이얼로그 **제목·트리거 버튼은 sans 유지**(mono로 샜으면 경계 실수)
  - [ ] 다크모드에서 위 표면 재확인 (얇은 획은 어두운 배경에서 더 묽게 읽힌다 — weight 판단의 실제 기준)
  - [ ] **11px 로그 텍스트 weight 400 체감** — 얇으면 Task 6대로 조정
  - [ ] **로그 내보내기 → `logs.html` 열기**: 코드 텍스트가 시스템 mono로 **정상 렌더**(깨짐·레이아웃 붕괴 없음). 사이드패널과 폰트가 다른 건 정상
  - [ ] `dist-log-viewer/index.html` 용량이 476KB 근방 유지(급증 시 폰트가 새어 들어간 것)
  - [ ] `dist/assets/`에 Geist woff2 emit 확인 + 사이드패널 Network 탭에서 **latin 하나만 로드**되는지(`unicode-range` 동작 확인)

## 구현 순서 권장

```
Task 1 (의존성)
   └→ Task 2 (테스트 red) → Task 3 (green)
                               ├→ Task 4 (CodeMirror)   ┐ 서로 독립 — 병렬 가능
                               └→ Task 5 (DOM Tree)     ┘ 단, 짝을 이루는 불변식이라 함께 검증
                                        └→ Task 6 (시각 검증 + weight)
                                                └→ Task 7 (문서)
```

- Task 2→3은 TDD red→green 순서를 지킨다(신규 인터페이스 = 폰트 스택 계약).
- **Task 4·5는 반드시 같은 커밋 범위에서 검증한다.** `CssCodeMirror.tsx:229`가 선언한 "DOM Tree Dialog와 통일" 불변식의 양쪽 절반이라, 하나만 바꾸면 문서화된 불변식이 깨진 상태가 된다.
- Task 6은 실기기 의존이라 마지막. weight 조정이 발생하면 그건 후속이지 회귀가 아니다.
- Task 7은 언제든 가능하나, Task 6에서 weight가 바뀌면 DESIGN.md에 반영해야 하므로 뒤에 둔다.

## 가이드 영향

**없음.** 폰트 교체는 가이드 본문의 설명 대상(기능·플로우·UI 라벨)이 아니다. `guide/`의 스크린샷(`guide/{ko,en}/assets/*.jpg`)에 로그·CSS 뷰 화면이 포함돼 있어 렌더 폰트가 미세하게 달라지지만, **UI 구조·라벨·플로우가 그대로**라 재촬영 대상이 아니다. `guide/AUTHORING.md`의 사실 스냅샷(플랫폼 표·단축키·로그 정책)도 무관.
