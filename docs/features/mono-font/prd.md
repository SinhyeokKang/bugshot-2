# 코드뷰 전용 mono 폰트 (Geist Mono)

## 배경

**코드를 보여주는 화면이 정작 mono가 아니다.** CSS 코드 뷰(CodeMirror)와 DOM Tree Dialog는 sans(Pretendard)로 렌더된다. 이건 사고가 아니라 기록된 결정이다 — `CssCodeMirror.tsx:229` 주석이 "폰트는 DOM Tree Dialog와 통일(앱 기본 Pretendard·13px)"이라 명시하고, `:330`은 CodeMirror 기본값인 `monospace`를 일부러 덮어 앱 폰트로 되돌린다.

다만 그 결정의 전제는 **"CM 기본 monospace 스택이 앱과 안 어울린다"**였지 "sans가 코드에 더 낫다"가 아니었다. 즉 제대로 고른 mono가 없어서 sans로 후퇴한 것이지, sans를 고른 게 아니다. 앱이 소유한 mono가 생기면 그 전제 자체가 사라진다.

이걸 하려면 **`font-mono`부터 정의해야 한다**. `tailwind.config.js`의 `theme.extend.fontFamily`는 `sans`만 잡고 있어(`:11-26`) `font-mono`가 미정의다. 그래서 Tailwind 기본 스택(`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`)이 나가고, 로그 화면은 OS마다 다른 폰트로 렌더된다 — macOS는 SF Mono, Windows는 Consolas, Linux는 ui-monospace/Liberation Mono.

**이건 품질 문제가 아니라 일관성 문제다.** 위 폴백들은 전부 양질의 mono이고 실제로 Courier New까지 밀릴 일은 사실상 없다(앞의 6개가 전부 없어야 도달). 지금 상태를 "열화"라고 부르는 건 과장이다. 문제는 앱이 자기 코드 타이포그래피를 소유하지 못한다는 것 — 통일할 기준점 자체가 없다는 것이다.

> **주의**: `fontFamily.mono`를 정의하는 행위는 `font-mono` 클래스에만 영향을 주지 않는다. Tailwind preflight(`tailwindcss/src/css/preflight.css:114-119`)가 `code, kbd, samp, pre { font-family: theme('fontFamily.mono', …) }`를 깔기 때문에, **클래스가 안 붙은 모든 `pre`·`code`·`kbd`·`samp`가 함께 바뀐다.** 파급 범위와 처리는 design.md "preflight 파급" 절 참조.

### 폰트 선정

Berkeley Mono(TX-02)의 사각형·터미널 계열 인상이 목표였으나 유료다. 무료(OFL-1.1) 후보 중 **Geist Mono**를 택했다 — 같은 계열의 중립적 그로테스크이고, 라운딩이 적으며 슬래시 제로가 기본이고, 무엇보다 11~13px 소구경에서 안정적이다. Martian Mono는 각진 인상이 더 강하지만 기본 폭이 넓어 네트워크 페이로드처럼 긴 줄에서 불리하고, Monaspace Argon은 Berkeley보다 부드러워 터미널 감이 덜하다.

## 목표

- 앱이 **소유한 mono**를 갖는다 — `font-mono`가 OS와 무관하게 Geist Mono로 고정 렌더된다(사이드패널 한정, log-viewer는 비목표 참조).
- CSS 코드 뷰(CodeMirror)와 DOM Tree Dialog가 **같은 mono·같은 13px로 통일**된다. `CssCodeMirror.tsx:229`가 선언한 "DOM Tree Dialog와 통일" 불변식은 폰트만 sans→mono로 갈아탄 채 유지된다.
- 기존 `font-mono` 5곳은 **코드 변경 없이** 새 폰트를 받는다.
- 다운로드된 `logs.html`은 `@font-face`가 없어도 **깨지지 않고** 시스템 mono로 정상 렌더된다(폴백).
- 확장 번들 증가 ≤ 80KB(실측 77,256B), 다운로드되는 `logs.html` 증가 **정확히 0바이트**.

## 비목표 (Non-goals)

- **log-viewer(`logs.html`)에 폰트를 번들하지 않는다.** `vite-plugin-singlefile`이 모든 애셋을 base64로 인라인하므로, 6개 subset을 실으면 **내보내는 파일마다 ~100KB가 붙는다**(실측 487,257B → ~590KB). log-viewer는 Pretendard도 번들하지 않는다(`log-viewer/styles.css:66`의 스택이 `-apple-system`부터 시작 — 다만 **의도를 기록한 주석은 없어 단순 누락과 구분되지 않는다**). 이 결정은 그 선례가 아니라 위 용량 논거만으로 선다. 사이드패널과 다운로드 파일이 다른 mono로 보이는 발산은 **의도된 트레이드오프**로 수용한다.
- **`JsonTreeViewer`(`src/sidepanel/components/JsonTreeViewer.tsx`)를 mono로 바꾸지 않는다.** 네트워크 로그의 JSON body는 `NetworkLogContent.tsx:574`에서 파싱 성공 시 이 트리 뷰어로 분기하고, 여기엔 `font-mono`가 **0곳**이다(13px sans 트리). 즉 이번 변경으로 mono가 되는 페이로드는 **파싱 실패한 non-JSON body 폴백 경로**(`:576`의 `<pre>`)뿐이다. DOM Tree Dialog와 구조적으로 같은 트리 뷰어인데 혼자 sans로 남는 건 인정된 비일관이다 — **이번 스코프에 넣지 않는 이유는 회귀 면적**이다(JSON 트리는 키·값·타입별 색상과 접힘 상태를 가진 별도 표면이고, 폭 변화가 트리 들여쓰기에 미치는 영향이 DOM 트리와 다르다). 후속으로 다룬다.
- **`src/content/overlay.ts`를 손대지 않는다.** 호스트 페이지에 주입되는 오버레이는 mono를 쓰지 않고, 폰트를 실으려면 `web_accessible_resources` + 페이지 CSP 문제가 생긴다. (`overlay.ts:157`이 호스트 페이지에서 로드될 리 없는 Pretendard를 이름만 부르는 기존 불일치가 있으나 이번 스코프 밖 — 관찰만 기록한다.)
- **`LogSeekChip`의 `w-8` 오버플로를 고치지 않는다.** 기존 버그다(design.md "위험 요소" 참조). 이번 변경이 Windows에서 악화시키지만 생성하지는 않는다.
- **전역 타이포 스케일을 건드리지 않는다.** DOM Tree의 13px 통일은 이미 선언된 값(`DomTreeDialog.tsx:201`)의 복원이지 새 스케일 도입이 아니다.
- **italic mono를 번들하지 않는다.** 패키지의 `index.css`는 normal 6 subset만 담는다(italic은 `wght-italic.css`에 분리). mono + italic 조합 사용처는 현재 없다.
- `NetworkLogContent.tsx:733`의 `font-sans` 지정(preflight가 `pre`를 mono로 되돌리는 걸 막는 의도적 역방향 처리)은 **그대로 둔다**.

### weight에 대하여 (비목표 아님 — 연기된 하위 작업)

기본 weight를 **이번 스코프에서 확정하지 않는다.** 초기값 400으로 넣고 Task 6의 시각 검증에서 **1회 조정 가능**하다. variable 폰트라 `@layer base` 한 줄로 바뀌고, 적정 weight는 실기기 눈으로만 정해진다. (이전 판에서 이걸 "비목표"로 적었으나, Task 6이 실제로 조정을 지시하므로 비목표가 아니라 연기된 작업이다.)

## 사용자 시나리오

1. **로그 확인** — 사용자가 로그 탭에서 콘솔 항목을 편다. 본문·스택이 Geist Mono로 렌더된다. macOS든 Windows든 같은 모양이다. (네트워크 페이로드는 JSON이면 sans 트리로 가고, non-JSON일 때만 mono `<pre>`다 — 비목표 참조.)
2. **CSS 코드 뷰** — 요소를 고르고 스타일 편집 → CSS 세그먼트로 토글한다. CodeMirror가 Geist Mono 13px로 렌더된다. 자동완성 팝업·토큰 툴팁도 같은 폰트다.
3. **DOM 트리 탐색** — DOM Tree Dialog를 연다. 태그·id·class가 Geist Mono 13px로 렌더되며, CSS 코드 뷰와 같은 크기·같은 폰트다. 라벨이 길어 잘리면 hover로 전체를 볼 수 있다(`title` 툴팁 — 이번에 추가).
4. **로그 내보내기(엣지)** — 사용자가 `logs.html`을 다운로드해 연다. `@font-face`가 없어 `font-mono`가 시스템 mono로 폴백된다. 사이드패널과 폰트는 다르지만 레이아웃·가독성은 정상이다. (오늘과 동일한 동작 — 회귀 아님)
5. **폰트 로드 전(엣지)** — `font-display: swap`이라 로드 전 폴백으로 먼저 그려지고 교체된다. `unicode-range` 덕에 latin 1개(~29KB)만 디스크 캐시에서 읽으므로 체감 지연은 없다. swap 시 metric 시프트는 `LogSeekChip`의 고정폭 `w-8`에 국한된다.

## 성공 기준

- `/build` 후 `dist/`에 Geist Mono woff2가 emit되고, 사이드패널 로그 탭·CSS 뷰·DOM 트리가 Geist Mono로 렌더된다. **판정은 DevTools의 Computed → Rendered Fonts**(스택 문자열이 아니라 실제 렌더 폰트 — 폴백을 잡는 유일한 수단).
- e2e에서 `document.fonts.check('13px "Geist Mono Variable"')`가 `true`다 — 빌드가 폰트를 실제로 실었음을 자동 검증.
- CSS 코드 뷰와 DOM Tree Dialog의 렌더 폰트·픽셀 크기가 서로 일치한다.
- `dist-log-viewer/index.html`에 Geist Mono `@font-face`가 **없고**, 바이트 수가 **487,257B에서 증가하지 않는다**.
- `pnpm test` 통과. 폴백 보장 테스트가 mono 스택이 시스템 폴백으로 끝나는지를 고정한다.
- `pnpm typecheck` 통과.
