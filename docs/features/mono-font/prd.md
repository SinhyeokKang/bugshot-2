# 코드뷰 전용 mono 폰트 (Geist Mono)

## 배경

`font-mono`가 `tailwind.config.js`에 **정의돼 있지 않다**. `theme.extend.fontFamily`는 `sans`만 잡고 있어서(`tailwind.config.js:11-24`), `font-mono`는 Tailwind 기본 스택(`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`)으로 떨어진다. 즉 로그 본문·페이로드가 **OS마다 다른 폰트로 렌더된다** — macOS는 SF Mono, Windows는 Consolas, 폴백이 밀리면 Courier New. 같은 리포트를 두 사람이 다른 모양으로 본다.

폰트를 고정하지 않은 대가는 로그 화면에서 특히 크다. `font-mono` 사용처 5곳은 전부 11~13px의 조밀한 텍스트다(`ConsoleLogContent.tsx:254,262`, `NetworkLogContent.tsx:576`, `LogSeekChip.tsx:11,22`). 이 크기대에서 Courier New 같은 폴백은 획이 가늘고 자간이 넓어 눈에 띄게 열화된다.

동시에, **코드를 보여주는 화면이 정작 mono가 아니다.** CSS 코드 뷰(CodeMirror)와 DOM Tree Dialog는 sans(Pretendard)로 렌더된다. 이건 사고가 아니라 기록된 결정이다 — `CssCodeMirror.tsx:229` 주석이 "폰트는 DOM Tree Dialog와 통일(앱 기본 Pretendard·13px)"이라 명시하고, `:329`는 CodeMirror 기본값인 `monospace`를 일부러 덮어 앱 폰트로 되돌린다. 다만 그 결정의 전제는 **"CM 기본 monospace 스택이 앱과 안 어울린다"**였지 "sans가 코드에 더 낫다"가 아니었다. 제대로 고른 mono가 생기면 전제 자체가 사라진다.

### 폰트 선정

Berkeley Mono(TX-02)의 사각형·터미널 계열 인상이 목표였으나 유료다. 무료(OFL-1.1) 후보 중 **Geist Mono**를 택했다 — 같은 계열의 중립적 그로테스크이고, 라운딩이 적으며 슬래시 제로가 기본이고, 무엇보다 11~13px 소구경에서 안정적이다. Martian Mono는 각진 인상이 더 강하지만 기본 폭이 넓어 네트워크 페이로드처럼 긴 줄에서 불리하고, Monaspace Argon은 Berkeley보다 부드러워 터미널 감이 덜하다.

## 목표

- `font-mono`가 OS와 무관하게 **Geist Mono로 고정 렌더**된다 (사이드패널 한정 — log-viewer는 비목표 참조).
- CSS 코드 뷰(CodeMirror)와 DOM Tree Dialog가 **같은 mono·같은 13px로 통일**된다. `CssCodeMirror.tsx:229`가 선언한 "DOM Tree Dialog와 통일" 불변식은 폰트만 sans→mono로 갈아탄 채 유지된다.
- 기존 `font-mono` 5곳은 **코드 변경 없이** 새 폰트를 받는다.
- 다운로드된 `logs.html`은 `@font-face`가 없어도 **깨지지 않고** 시스템 mono로 정상 렌더된다(폴백).
- 확장 번들 증가는 ~75KB 이내, 다운로드되는 `logs.html` 증가는 **0**.

## 비목표 (Non-goals)

- **log-viewer(`logs.html`)에 폰트를 번들하지 않는다.** `vite-plugin-singlefile`이 모든 애셋을 base64로 인라인하므로, 6개 subset을 실으면 **내보내는 파일마다 ~100KB가 붙는다**(476KB → ~576KB). log-viewer가 Pretendard도 일부러 뺀 선례(`log-viewer/styles.css:66-69`가 `-apple-system`부터 시작)와 같은 판단이다. 사이드패널과 다운로드 파일이 다른 mono로 보이는 발산은 **의도된 트레이드오프**로 수용한다.
- **기본 weight를 400에서 옮기지 않는다.** variable 폰트라 나중에 한 줄로 조절 가능하고, 적정 weight는 실기기 눈으로만 정해진다. 초기값 400으로 넣고 시각 검증에서 조정한다.
- **전역 타이포 스케일을 건드리지 않는다.** DOM Tree의 13px 통일은 이미 선언된 값(`DomTreeDialog.tsx:201`)의 복원이지 새 스케일 도입이 아니다.
- **`src/content/overlay.ts`를 손대지 않는다.** 호스트 페이지에 주입되는 오버레이는 mono를 쓰지 않고, 폰트를 실으려면 `web_accessible_resources` + 페이지 CSP 문제가 생긴다. (`overlay.ts:157`이 호스트 페이지에서 로드될 리 없는 Pretendard를 이름만 부르는 기존 불일치가 있으나 이번 스코프 밖 — 관찰만 기록한다.)
- **italic mono를 번들하지 않는다.** 패키지의 `index.css`는 normal 6 subset만 담는다. mono + italic 조합 사용처는 현재 없다.
- `NetworkLogContent.tsx:733`의 `font-sans` 지정(preflight가 `pre`를 monospace로 되돌리는 걸 막는 의도적 역방향 처리)은 **그대로 둔다**.

## 사용자 시나리오

1. **로그 확인** — 사용자가 로그 탭에서 콘솔·네트워크 항목을 편다. 본문·스택·페이로드가 Geist Mono로 렌더된다. macOS든 Windows든 같은 모양이다.
2. **CSS 코드 뷰** — 요소를 고르고 스타일 편집 → CSS 세그먼트로 토글한다. CodeMirror가 Geist Mono 13px로 렌더된다. 자동완성 팝업·토큰 툴팁도 같은 폰트다.
3. **DOM 트리 탐색** — DOM Tree Dialog를 연다. 태그·id·class가 Geist Mono 13px로 렌더되며, CSS 코드 뷰와 같은 크기·같은 폰트다.
4. **로그 내보내기(엣지)** — 사용자가 `logs.html`을 다운로드해 연다. `@font-face`가 없어 `font-mono`가 시스템 mono로 폴백된다. 사이드패널과 폰트는 다르지만 레이아웃·가독성은 정상이다. (오늘과 동일한 동작 — 회귀 아님)
5. **폰트 로드 전(엣지)** — `font-display: swap`이라 로드 전 폴백으로 먼저 그려지고 교체된다. 확장 내부 애셋이라 지연은 사실상 없다.

## 성공 기준

- `pnpm build` 후 `dist/`에 Geist Mono woff2가 emit되고, 사이드패널 로그 탭·CSS 뷰·DOM 트리가 Geist Mono로 렌더된다(Chrome DevTools의 Computed → Rendered Fonts로 확인).
- CSS 코드 뷰와 DOM Tree Dialog의 렌더 폰트·픽셀 크기가 서로 일치한다.
- `dist-log-viewer/index.html`에 Geist Mono `@font-face`가 **없고**, base64 인라인으로 인한 용량 증가가 없다(476KB 근방 유지).
- `pnpm test` 통과. 폰트 스택 회귀 테스트가 (a) mono 스택이 Geist로 시작하고 (b) 시스템 폴백으로 끝나는지를 고정한다.
- `pnpm typecheck` 통과.
