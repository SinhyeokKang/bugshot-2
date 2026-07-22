# DESIGN.md

bugshot-2의 디자인 시스템·UI 컨벤션 단일 출처. 신규 화면·컴포넌트를 만들 때 여기 패턴을 먼저 본다. 권한·아키텍처는 [ARCHITECTURE.md](./ARCHITECTURE.md), 파일별 역할은 [DIRECTORY.md](./DIRECTORY.md) 참조.

> 이 문서는 코드베이스에서 역추출한 **현재 상태 스냅샷 + 권장 가이드**다. lint/test로 강제되는 규칙은 아니므로 "권장"으로 읽되, 합리적 이유 없이 벗어나지 않는다. 일부는 아직 코드가 따라오지 못한 **개선 후보(⚠)**로 표시한다. 컨벤션을 바꾸면 여기도 함께 갱신한다.

## 1. 기반 스택

- **Tailwind CSS v3** + **shadcn/ui** (style `new-york`, CSS 변수 모드) — `components.json`. base color는 **테마별로 다르다**(라이트 `slate` / 다크 `neutral`) — 아래 §2 색상 참조. `components.json`의 `baseColor`는 CLI 시드일 뿐이다.
- **`@tailwindcss/container-queries`** — 컨테이너 기반 리플로우용(현재 활성 사용처 없음 — 이전 유일 사용처 `LogAttachmentCards`가 단일 카드로 전환되며 제거, 플러그인은 유지)
- **`tailwindcss-animate`** — Radix data-state 진입/퇴장 애니메이션
- **lucide-react** — 일반 UI 아이콘 / **`@icons-pack/react-simple-icons`** — 플랫폼 브랜드 마크 (`Si{Name}`)
- **Pretendard Variable** — 본문 폰트 (`globals.css`에서 dynamic-subset import)
- **Geist Mono Variable** — 코드 표면용: `font-mono`(코드뷰·로그 본문) + preflight 경유 `pre`/`code` (`globals.css`에서 import)
- 컴포넌트 정의: `src/components/ui/` (shadcn 생성물), 합성 컴포넌트: `src/sidepanel/components/`

UI 컴포넌트는 직접 스타일링하기보다 shadcn/ui를 우선 쓰고, 없으면 `npx shadcn@latest add <component>`로 설치한 뒤 `src/components/ui/`에 위치하는지 확인한다(shadcn이 `@/` 루트에 생성할 수 있음).

> **예외 — React가 닿지 않는 DOM.** ProseMirror NodeView·`dangerouslySetInnerHTML` 후처리 walk처럼 React 밖에서 만든 DOM은 `<Button>`을 못 쓴다. 그땐 vanilla CSS로 variant를 **재현**하되 ① 치수·상태는 shadcn 원본을 그대로 베끼고 ② 색은 반드시 semantic 토큰(`hsl(var(--x))`)으로 쓴다. 선례: `src/sidepanel/components/code-collapse.css`(Button `outline`+`size="sm"` 재현 — 코드블럭 pill이 NodeView·훅 양쪽에서 쓰이는 vanilla DOM이라). **재현이지 새 디자인이 아니다** — 원본 variant가 바뀌면 함께 따라간다.

## 2. 색상 (디자인 토큰)

색상은 **semantic 토큰을 기본**으로 쓴다. `tailwind.config.js`가 다음 토큰을 `hsl(var(--X))`로 노출하고, `src/styles/globals.css`의 `:root`(light) / `.dark`(dark)가 값을 정의한다.

- **⚠ base 팔레트가 테마별로 다르다 — 라이트=`slate`(푸른 틴트) / 다크=`neutral`(무채색). 실수가 아니라 의도다.** 같은 채도가 명도에 따라 정반대로 읽히기 때문: 고명도(라이트)에선 순백 배경 위 `--border`(`rgb(226,232,240)`)·muted 표면이 **"맑게"** 읽히지만, 저명도(다크)에선 같은 채도가 배경 자체를 남색으로 물들여 **"칙칙하게"** 읽힌다. 그래서 다크만 무채색으로 내렸다. **표만 보면 갈린 게 지저분해 보여 "일관성" 명목으로 한쪽을 미는 실수가 나오기 쉽다**(실제로 라이트를 neutral로 밀었다가 되돌린 이력이 있다) — `tokens.test.ts`가 **라이트 채도>0 / 다크 채도=0**으로 양방향을 막으므로, 한쪽을 밀면 테스트가 red로 잡는다. 순백 표면(`--background`·`--card`·`--popover` = `0 0% 100%`)은 틴트가 들어갈 여지가 없어 라이트 검사에서 제외.
  - `components.json`의 `"baseColor": "slate"`는 **shadcn CLI 생성 시드일 뿐**이다(`cssVariables: true`라 생성 컴포넌트는 semantic 토큰만 참조). 값이 하나뿐이라 위 비대칭을 표현할 수 없다 — **실제 표는 손으로 관리하며 이 파일이 아니라 `globals.css`가 진실이다.** `shadcn add`가 새 토큰을 append하면 한쪽 테마는 손으로 맞춰야 한다.
- **토큰 표는 두 벌이다** — `src/styles/globals.css`(사이드패널)와 `src/log-viewer/styles.css`(다운로드되는 `logs.html`, 별도 Vite 빌드라 globals를 import 못 해 수작업 복제). **한쪽만 고치면 사이드패널과 첨부 logs.html이 다른 톤으로 갈린다.** `src/styles/__tests__/tokens.test.ts`가 두 표의 완전 일치 + 위 테마별 채도 규칙 + destructive 대비 하한을 고정한다 — 토큰 값을 바꾸면 두 파일을 함께 고쳐야 이 테스트가 통과한다. (같은 "별도 번들이 복제" 함정 계열: log-viewer i18n dict·recorder pre-arm 청크 — docs/POSTMORTEM.md)
- **`--destructive`는 이 앱에서 글자색 전용**이다(`text-destructive`·`destructive-outline`. shadcn의 `variant="destructive"`=`bg-destructive`는 미사용). 그래서 shadcn 기본값을 안 쓰고 **테마별로 갈라 글자 대비를 맞춘다 — 라이트 `red-600`(4.83:1) / 다크 `red-500`(5.26:1), 둘 다 AA(4.5:1) 충족**. `log-colors.ts`의 `text-<c>-600 dark:text-<c>-400`과 같은 원리(흰 배경엔 진한 빨강, 검은 배경엔 밝은 빨강)다. shadcn 기본값을 그대로 두면 다크는 배경용 어두운 빨강이라 ~2:1, 라이트는 red-500이라 3.76:1로 **양쪽 다 미달**이었다. 대비 하한은 `tokens.test.ts`가 양 테마 모두 4.5로 고정.

| 토큰 | 용도 |
|---|---|
| `background` / `foreground` | 페이지 바탕 / 기본 텍스트 |
| `primary` (+`-foreground`) | 주요 CTA·강조 |
| `secondary` (+`-foreground`) | 보조 버튼·탭 바 바탕 |
| `muted` (+`-foreground`) | 보조 텍스트·비활성 배경 |
| `accent` (+`-foreground`) | hover 강조 |
| `destructive` (+`-foreground`) | 삭제·위험 |
| `card` / `popover` (+`-foreground`) | 카드·팝오버 표면 |
| `border` / `input` / `ring` | 테두리 · 입력 테두리 · 포커스 링 |

- ⚠ **`--accent` == `--secondary` == `--muted`가 라이트·다크 모두 같은 값이다**(라이트 `210 40% 96.1%` / 다크 `0 0% 14.9%` — `globals.css`). 위 표의 "용도"는 **의미 구분이지 시각 구분이 아니다.** 귀결: **`muted`·`secondary` 표면 위에 얹은 컨트롤에는 `hover:bg-accent`가 무효**다(hover 피드백 0). 다크에선 `--border`·`--input`·`--ring`까지 같은 `0 0% 14.9%`라 **테두리·포커스 링도 그 표면 위에선 사라진다**. shadcn `outline` 버튼의 `bg-background → hover:bg-accent`는 **`background` 표면 위를 전제한 관용구**라, muted 표면으로 옮기면 방향이 뒤집힌다. 그런 자리의 hover는 배경이 아니라 **등장(opacity)·글자색·그림자**로 낸다 — 선례 `src/sidepanel/components/code-collapse.css`(코드블럭 pill이 `--muted` 배경 위라 hover 배경 변경을 포기하고 등장으로 대체). (§9의 `--ring`==`--border` 경고와 같은 뿌리다.)

- 커스텀 raw 색(`text-blue-600` 등)은 semantic 토큰으로 표현 못 하는 **상태/기능 색**에만 쓰고, 가능하면 `dark:` 짝을 함께 둔다. 현재 사용처:
  - 상태 배지 팔레트: `src/sidepanel/tabs/statusBadges/constants.ts` (new=무색, done=green, deleted=red … `bg`/`text`/`dark:bg`/`dark:text` 묶음). **`new`만 테마별 스케일이 갈린다**(`bg-slate-100`/`dark:bg-neutral-500/15`) — 기능색과 달리 base 팔레트를 따라가므로 위 §2 비대칭이 그대로 적용된다.
  - 로그 semantic 색(console 레벨·network 메서드·action 톤): `src/lib/log-colors.ts` **단일 출처**. `TONE_TEXT`(red/amber/blue/green/neutral → `text-<c>-600 dark:text-<c>-400`) + `CONSOLE_LEVEL_TONE`/`NETWORK_METHOD_TONE`. 사이드패널 로그 탭·다이얼로그(Console/Network/ActionLogContent 아이콘 색)와 log-viewer `markers.ts` 툴팁이 공유해 라이트/다크 모두 일치. row bg tint·마커 핀 색·content-type 아이콘·syntax highlight는 스코프 밖(각 컴포넌트 로컬)
  - 삽입 로그 코드블럭의 JSON syntax 색: `src/sidepanel/lib/highlightJson.ts`의 `JSON_TOKEN_CLASS`(key `purple-700/400` · string `red-700/400` · number·boolean `blue-700/400` · null `text-muted-foreground italic`). `log-colors.ts`(로그 semantic 색)와 **별개 스코프**지만 같은 원리 — 라이트만 600이 아니라 700. tiptap decoration(`TiptapEditor`)·markdown-it highlight(`renderMarkdown`)·로그 선택 다이얼로그의 JSON 트리(`JsonTreeViewer`) **세 화면**이 공유해, 같은 응답이 에디터·프리뷰·다이얼로그에서 다른 색으로 안 보인다. CSS 뷰 하이라이트(`cssHighlightLight/Dark`)는 CodeMirror 전용이라 여전히 로컬.
  - 외부 링크: `text-blue-600 underline dark:text-blue-400` (`InlineLink.tsx`)
  - 주석(annotation) 색 팔레트: `src/sidepanel/components/annotation/presets.ts` (`ANNOTATION_COLORS` — 캔버스 그리기용 고정 5색 raw hex, `dark:` 짝 없음)
  - **AI 기능 액센트 색쌍**: 스타일링 AI = **teal** / 초안 AI = **purple**. AI 진입 버튼·배너·로딩 오버레이 틴트를 관통하는 기능 색이다 — `StyleEditorPanel.tsx`(teal), `DraftingPanel.tsx`(purple), `App.tsx`(오버레이 틴트 `bg-<c>-500/5` + radial ripple `<c>-400@0.1`). 재현 자동작성(repro) 오버레이는 draft·styling과 구분해 **amber**로 뗀다(오버레이 색은 표면별 3분기 — `App.tsx`의 `AI_OVERLAY_STYLE` 맵 단일 출처). **배너 명도 쌍 관용: light `bg-<c>-100/80 text-<c>-700` / dark `bg-<c>-950 text-<c>-300`(hover `bg-<c>-900`)**.
    - ⚠ **다크 배너 배경에 알파를 얹지 말 것**(`bg-<c>-950/50`이었다가 뺐다). 저명도에선 사람 눈이 색조를 거의 구분 못 해 배경에 묻힌다 — 명도 대비 문제가 아니다(라이트 배너 1.10:1 < 당시 다크 1.13:1인데도 라이트는 멀쩡했다). 950을 불투명으로 둬야 `bg-muted`(다크 1.31:1)와 같은 수준으로 표면이 인지된다. 로그 행 tint(`ConsoleLogContent`·`NetworkLogContent`의 `bg-amber-950/50` 등)는 **비교 대상이 페이지 배경이 아니라 이웃 행**이라 이 규칙 밖이다.
  - 연동 유도 CTA: **amber** (`IntegrationsCta.tsx` — 위 AI 액센트와 **배경만** 같은 명도 쌍(`bg-<c>-100/80` / `dark:bg-<c>-950`, hover `-100`/`-900`). 글자는 AI 배너(700/300)와 달리 `text-amber-600`/`dark:text-amber-400`)
  - 로그 검색어 하이라이트: `<mark class="bg-blue-300/50 dark:bg-blue-400/30">` (`HighlightedText.tsx`)
  - 연동 완료 배지: **green** (`ConnectedBadge.tsx` — `bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-400`)
- ⚠ 상태 배지·기능 색의 light/dark 대비(WCAG AA)는 따로 검증돼 있지 않다. 새 raw 색 추가 시 대비를 눈으로라도 확인.

## 3. 다크 모드

- `darkMode: ["class"]` — `<html>`에 `.dark` 클래스 토글.
- 토글 로직: `src/sidepanel/hooks/useThemeEffect.ts`. theme(`light`|`dark`|`system`)을 `useSettingsUiStore`에서 읽어 `classList.toggle("dark", …)`, `system`이면 `matchMedia("(prefers-color-scheme: dark)")` 변화를 구독.
- 영속: `src/store/settings-ui-store.ts` (Zustand persist, key `bugshot-app-settings`).
- semantic 토큰을 쓰면 다크가 자동 대응되므로 `dark:` variant는 raw 색·invert 등 토큰으로 안 되는 경우에만.
- **서드파티 에디터(CodeMirror)도 semantic 토큰으로 통일한다** — `CssCodeMirror.tsx`는 preset을 안 쓰고(`theme="none"`), `editorTheme`가 배경·텍스트·캐럿·거터·선택색·자동완성/툴팁 표면을 전부 semantic 토큰(`hsl(var(--foreground))`·`--muted`·`--muted-foreground`·`--popover`·`--accent`·`--primary`·`--border`)으로 지정해 라이트/다크가 같은 구성으로 자동 대응한다(사이드패널 DOM에서 CSS 변수 resolve). `useSettingsUiStore.theme` + `matchMedia`로 계산한 `dark` 불리언은 preset 선택이 아니라 **syntax highlight 액센트**(`cssHighlightDark`/`cssHighlightLight`)만 고른다.

## 4. 타이포그래피

- `font-sans` 스택: Pretendard Variable → Pretendard → 시스템 한/영 폴백 (`tailwind.config.js`). body에 `font-feature-settings: "rlig" 1, "calt" 1`. **log-viewer(`logs.html`)는 Pretendard `@import`가 없어 시스템 sans로 폴백한다** — `log-viewer/styles.css`가 body 스택을 Pretendard 없이 따로 하드코딩한다. 아래 mono와 같은 구조의 의도된 발산이다(내보낸 파일에 폰트를 base64로 싣지 않으려는 것).
- `font-mono` 스택: Geist Mono Variable → Tailwind 기본 mono 폴백 (`tailwind.config.js`). **폴백을 지우지 말 것** — `@font-face`는 `globals.css`의 `@import`로만 들어와 사이드패널에만 있고, 별도 빌드인 log-viewer(`logs.html`)는 **늘 시스템 mono로 폴백한다**(의도된 발산 — 내보낸 파일에 폰트를 base64로 실으면 ~100KB가 붙는다). `__tests__/tokens.test.ts`가 폴백 존재를 고정한다.
- **Tailwind preflight가 `pre`·`code`·`kbd`·`samp`에도 `fontFamily.mono`를 깐다** — 클래스 없는 코드블록(Tiptap 등)이 자동으로 Geist가 된다. sans여야 하는 `<pre>`가 있으면 `font-sans`를 명시해 되돌린다 — 다만 현재 코드성 로그 `<pre>`는 전부 mono가 의도라(WS `FrameBody` 포함, v1.6.x에서 로그 표면 mono 일관화) sans로 되돌린 `<pre>`는 남아 있지 않다.
- 크기 관용: **`text-xs`·`text-sm`이 지배적**(UI 라벨·필드·보조 텍스트). `text-base`=본문, `text-lg`=섹션/빈 상태 제목, `text-xl`=큰 헤딩.
- **임의값(`text-[…]`)은 스케일에 대응값이 없을 때만.** 12px은 `text-xs`, 14px은 `text-sm`이 있으므로 임의값으로 쓰지 않는다. 실제로 남은 임의값은 10·11·**13**px처럼 스케일 밖 값뿐이다. 그중 **13px이 지배적**이다 — 로그 행(네트워크 요청 행 등)과 소형 텍스트 버튼의 관용값(`h-7 px-2.5 text-[13px] font-normal` — `OriginFilterBar`·`NetworkLogContent` 등)이라 12/14 사이 자리를 메운다.

### mono 표면 불변식

**모든 mono 표면은 13px / 행간 18px이다.** 값은 `globals.css`(+ `log-viewer/styles.css`) `:root`의 **CSS 변수 단일 출처** `--mono-size: 13px` / `--mono-leading: 18px`에서 나온다 — 여기 두 줄만 바꾸면 전 표면이 함께 이동한다. 표면들:

| 표면 | 소비 경로 |
|---|---|
| DOM 트리 · 콘솔 본문/스택/인라인 요약/출처 URL · 액션 로그 행·값 칩 · LogSeekChip 2 · 네트워크 본문 · JSON 트리 · WS 프레임 프리뷰/본문 · 마커 툴팁 | Tailwind `fontSize.mono` 토큰 → **`text-mono`** 유틸(과거 `text-xs`) |
| CSS 코드 뷰 본문 · CM 자동완성 리스트 행 | `CssCodeMirror.tsx` 인라인 theme의 `var(--mono-size)`/`var(--mono-leading)` |
| Tiptap `pre`·인라인 `code` · 프리뷰 `pre`·인라인 `code` | `tiptap-editor.css`·`doc-section-body.css`의 `var(--mono-*)` |

- **`text-[13px]`가 아니라 `text-mono`를 쓴다** — 이전엔 `text-xs`(12px에 `line-height: 16px` 동반)와 코드블럭 CSS 1.5(=18px)로 행간이 **두 그룹으로 갈렸으나**, 이제 전 표면이 `--mono-leading: 18px` 단일값으로 **수렴**했다. `text-mono`는 그 13px/18px을 토큰 하나로 실어 로그 표면이 임의값·행간 드리프트 없이 단일 출처를 따른다.
- **`text-mono`는 `cn()`의 twMerge에 font-size 그룹으로 등록돼 있다**(`src/lib/utils.ts`의 `extendTailwindMerge`). 안 하면 twMerge가 커스텀 `text-*`를 **text-color로 오분류**해, `Kbd` 같은 `cn()` 경유 컴포넌트에서 `text-foreground`와 만나면 `text-mono`를 조용히 제거하고 base `text-xs`와도 dedupe되지 않는다(액션 로그 값 칩이 이 함정을 밟았다).
- 축이 달라 제외: **인라인 `code`**(font-size만 주고 행간은 문단 상속) · **CM 자동완성 detail**(`11px` — 우측 muted 보조 라벨) · **CM 토큰 hover 툴팁**(`12px` — primary 배경 transient chrome). 뒤 둘은 본문과 한 줄에 안 놓여 위계 유지가 자연스럽다.
- 13px로 올린 이유: 12px이 좁은 패널에서도 작았다. 14px로 안 올리는 이유: mono는 자폭이 sans의 1.2배라 트렁케이션·가로 스크롤이 함께 늘어난다.
- **자간은 건드리지 않는다**(브라우저 기본 0). 13px에서 유의미한 차이를 내려면 그리드를 흐트러뜨리는 구간이 필요하다.

**⚠ 단일 출처는 하나지만 소비 경로가 여럿이라 — 하나만 놓치면 조용히 갈라진다.** v1.6.0이 "13px 통일"을 선언하고 Tiptap을 빠뜨린 게 정확히 이 구조 때문이다. 변수를 바꿔도 그 변수를 **참조하지 않는** 표면은 안 따라온다:

1. **진입 경로 2개** — `.font-mono` 유틸(CSS 뷰·DOM 트리·로그 12곳: 콘솔 본문·스택·인라인 요약·출처 URL, 액션 행, LogSeekChip 2, 네트워크 raw body, WS 프레임 프리뷰·본문, JSON 트리, 마커 툴팁)과 **Tailwind preflight**(`pre`/`code` — Tiptap·프리뷰). 만나는 지점이 없다. 전자는 `text-mono` 토큰, 후자는 CSS의 `var(--mono-*)`로 **같은 두 변수**에 묶인다. mono 전역 규칙(`globals.css @layer base`의 `font-variant-ligatures: none`)은 두 경로를 한 셀렉터 리스트로 묶어 준다.
2. **클론 파일 2개** — `tiptap-editor.css`(에디터)와 `doc-section-body.css`(프리뷰)의 `code`·`pre` 규칙은 `var(--mono-*)` 참조까지 **바이트 동일**하고, `pre`는 에디터 쪽에만 **`white-space: pre` 한 줄이 더 있다**(@tiptap/core가 런타임 주입하는 `.ProseMirror pre { white-space: pre-wrap }`을 특이도로 이기려는 것 — 프리뷰엔 그 주입이 없어 불필요. 의도된 발산이다). 나머지는 같은 마크다운의 편집 화면/프리뷰라 **항상 함께** 움직인다.
3. **log-viewer는 `globals.css`를 안 받는다**(별도 빌드) — `log-viewer/styles.css`의 `:root`에 `--mono-size`/`--mono-leading` **손복사본**이 있다. `App.tsx`가 사이드패널 컴포넌트를 import해 mono 표면이 실재하므로 필요하다. `__tests__/tokens.test.ts`가 두 `:root` 표(변수 포함)의 완전 일치를 강제한다.
4. **`code-collapse.css`가 그 `pre`의 행간·패딩에 묶인다** — 코드블럭 접기 높이 `max-height` calc가 줄 높이로 **`var(--mono-leading)`을 직접 참조**하고(과거 `1.5em` 하드코딩), 패딩·테두리 상수에도 침묵으로 묶여 있다. 행간을 바꾸면(=변수를 바꾸면) 접힘 클램프가 함께 따라오지만, 패딩·테두리를 손대면 어긋난다. `sidepanel/lib/__tests__/codeCollapse.test.ts`가 **세 파일을 읽어**(변수를 px로 resolve해) 접힘이 임계값+1줄을 실제로 자르는지 대조해 red로 잡는다.

- **리거처는 반드시 끈다** — Geist Mono의 `liga`에 `hyphen + hyphen → hyphen_hyphen.liga`가 있고 브라우저 기본 ON이라, `--`가 **2셀에서 1셀로 붕괴**한다(advance 600). CSS 커스텀 프로퍼티가 전부 이걸 밟는다. `font-feature-settings`가 아니라 **`font-variant-ligatures: none`**을 쓴다 — 전자는 가산이 아니라 통째로 덮어써서 다른 feature를 날린다.
- 코드블럭·인라인 코드가 부모(`text-sm`) 변화를 **안 따라간다** — `em`이 아니라 `--mono-size` 절대값을 쓰기 때문. 전 표면 단일값이 불변식이라 의도한 트레이드오프다(부모에 묶으면 선언 위치가 값을 바꾼다).
- 라벨 기본형: `text-xs text-muted-foreground` (FieldRow), 강조 라벨 `text-sm font-medium` (shadcn Label).
- **설정 행(카드 안 라벨+설명+컨트롤 한 줄)**: 라벨 `text-sm font-medium`, 설명 `text-sm text-muted-foreground`. 굵기로 위계를 주고 색은 보조다 — 둘 다 `text-sm`/400이면 색 하나로만 갈려 제목·본문이 평평해진다. 사용처: `SettingsTab`(본문 구성·기타), `RecordingSettingsCard`.

## 5. 간격 (Spacing)

Tailwind 4px 스케일을 그대로 쓴다. 자주 쓰는 값(관용):

| 맥락 | 값 |
|---|---|
| 라벨 ↔ 필드 (FieldRow) | `gap-1.5` |
| 아이콘 ↔ 텍스트 (인라인) | `gap-1.5` ~ `gap-2` |
| 섹션 세로 패딩 (`Section`) | `py-6` |
| 패널/탭 영역 가로 패딩 | `px-4` |
| 빈 상태 아이콘 원형 패딩 | `p-3` |

새 레이아웃은 이 값들을 먼저 재사용한다. 임의의 `gap-3.5` 같은 비표준 값은 이유가 있을 때만.

## 6. Radius & Elevation

**Radius** — `--radius: 0.75rem` 기준. `rounded-lg`=radius, `md`=−2px, `sm`=−4px. 표면 종류별 관용:

| 표면 | radius |
|---|---|
| 기본 컨트롤(버튼·인풋·select) | `rounded-md` |
| 카드·팝오버·콘텐츠 박스 | `rounded-lg` |
| 다이얼로그 | `rounded-2xl` |
| 토스트 | `rounded-xl` |
| 칩·스와치 등 작은 인라인 요소 | `rounded-sm` / `rounded-[3px]` |
| 원형(스위치 thumb·pill 배지·아바타) | `rounded-full` |

**Elevation (그림자)** — 표면이 떠 있을수록 강한 그림자. 단계:

| 단계 | 클래스 | 쓰임 |
|---|---|---|
| 1 | `shadow-sm` | 기본 컨트롤·인풋·outline/secondary 버튼 |
| 2 | `shadow` / `shadow-md` | default 버튼·팝오버·select 콘텐츠 |
| 3 | `shadow-lg` | 다이얼로그·토스트 |

**콘텐츠 위에 떠 있는 컨트롤** (캔버스·미디어 등 임의 픽셀 위에 얹히는 오버레이 컨트롤): `bg-background/90 shadow-md backdrop-blur-sm` + `rounded-md`. 불투명 배경(`TrimTimeline`처럼 muted 여백 위에 놓이는 경우)과 달리 배경이 무엇일지 모르므로 반투명 + 블러로 대비를 확보한다. 히트 영역 밖은 `pointer-events-none` 레이어로 통과시켜 아래 콘텐츠 조작을 막지 않는다(선례: `annotation/ZoomControl.tsx`, `AnnotationToolbar` 캔버스 오버레이).

## 7. Z-index 레이어

오버레이가 많은 확장이므로 레이어를 단순하게 유지한다.

- **Radix 오버레이(Dialog·Popover·Tooltip·Select)는 모두 `z-50` 공통.** 같은 평면에서 뒤에 열린 것이 위로 온다.
- 로컬 sticky/겹침은 `z-10` 수준.
- 그 위로 강제로 떠야 하는 예외는 `z-[60]` (현재 2곳 — `AnnotationOverlay` 텍스트 편집 입력, `ReplayTrimDialog` 작성취소 AlertDialog). 새로 만들 땐 `z-50` 기준으로 잡고, 꼭 필요할 때만 `z-[60]`.
- **전체화면 비-Radix 오버레이 패턴**: 사이드패널 위 풀스크린은 `inset-0 z-50 bg-background` + `flex h-full flex-col`로 만든다. 풀스크린 컴포넌트 오버레이(`AnnotationOverlay`·`ReplayTrimDialog`)는 `fixed`로 패널 뷰포트를 덮고, App root(`h-screen`) 직속 임시 오버레이(App AI 로딩·Suspense fallback)는 `absolute`를 쓴다. Radix Dialog가 아니라 컨테이너 직접 렌더 + `lazy`/`Suspense`. 이 오버레이들은 **사이드패널 z축 안**(z-50, 필요 시 내부 모달 z-[60])이다.
- content script의 picker·overlay(`src/content/`)는 **페이지 쪽**에서 별도 최상위 z로 뜬다 — 사이드패널 z축과 무관하니 헷갈리지 말 것. (`AnnotationOverlay`는 페이지가 아니라 사이드패널 컴포넌트 — 위 전체화면 오버레이 항목.)

## 8. 모션 & 트랜지션

- Radix data-state 진입/퇴장은 `tailwindcss-animate`(`data-[state=open]:animate-in` / `…animate-out` + `fade`/`zoom`/`slide`)로 처리.
- 현재 duration 관용: 다이얼로그 `duration-300`, accordion `0.2s`, AI 로딩 ripple `ai-ripple 3s`(문구 전환 주기 3s마다 replay) + 문구 슬라이드 `duration-700`, hover 류는 `transition-colors` 기본.
- ⚠ **`prefers-reduced-motion` 부분 대응.** AI 로딩 오버레이(`animate-ai-ripple`·문구 슬라이드 `animate-in`/`animate-out`)는 `motion-reduce:animate-none`을 단다. 새 애니메이션을 추가할 땐 같은 방식으로 `motion-reduce:` variant를 함께 붙인다.

## 9. 접근성 (a11y)

- 키보드·역할·포커스 트랩은 **Radix 프리미티브**가 기본 제공한다(shadcn 컴포넌트를 쓰면 따라옴).
- 포커스 표시는 `focus-visible:ring-2 focus-visible:ring-ring` 컨벤션.
  - ⚠ **현재 `--ring`이 `--border`와 같은 값**이라(`globals.css`) 키보드 포커스 링이 잘 안 보인다. 개선 후보 — 별도 대비색으로 분리하면 좋다. 그 전까진 중요한 인터랙션에 포커스가 보이는지 직접 확인.
- **아이콘 전용 버튼**(`size="icon"`)은 텍스트가 없으므로 `aria-label`(또는 `sr-only` 텍스트)을 붙인다 — 안 그러면 스크린리더에서 무명 버튼. **툴바 아이콘 버튼의 hover 툴팁은 native `title`이 아니라 `TooltipIconButton`(Radix Tooltip + `aria-label`, §13)을 기본으로 한다** — 캡처 방식 툴바·어노테이션 툴바(이미지·녹화)가 전부 이걸 쓴다. `title`-only는 레거시(`AnnotationToolbar`의 액션부·`IssueRow` 등 — 접근명은 `title`이 대체하나 개선 후보. `DraftingPanel` 문단 섹션 헤더는 `[로그 추가][영역 캡처][이미지 추가]` ButtonGroup 재구성 때 `TooltipIconButton`으로 승급됨). 새 아이콘 버튼은 `TooltipIconButton`을 쓰거나, 직접 만들면 `aria-label`을 반드시 붙인다.
- 보조 정보용 저대비 텍스트(`text-muted-foreground/70`)는 본문 핵심 정보에 쓰지 않는다.
- 다이얼로그를 **코드로(프로그램적으로) 열 때**는 `blurActiveElement()`(`App.tsx`)로 포커스를 먼저 떼야 Radix `aria-hidden` 경고를 피한다 — 새 전역 다이얼로그 추가 시 참고.

## 10. 버튼 & 사이즈

shadcn `Button` (`src/components/ui/button.tsx`, cva):

**variant**: `default`(primary) · `destructive` · `destructive-outline` · `outline` · `secondary` · `ghost` · `link`
**size**: `default`(h-9 px-4) · `sm`(h-8 px-3 text-xs) · `lg`(h-10 px-5) · `xl`(h-11 px-10 text-base, 아이콘 `size-5`) · `icon`(h-9 w-9)
기본 `variant="default" size="default"`. 아이콘 기본 `[&_svg]:size-4 [&_svg]:shrink-0`(`xl`만 `size-5`).

### Slider

shadcn `Slider` (`src/components/ui/slider.tsx`, Radix). 표준에서 **멀티 thumb 확장** — `value`/`defaultValue` 배열 길이로 thumb 개수를 파생해 N개 렌더(미지정 시 1), `thumbAriaLabels?: string[]`로 thumb별 aria-label 주입. 추가로 **슬롯 override props** — `trackClassName`/`rangeClassName`/`thumbClassName`(트랙·선택 범위·thumb 비주얼 교체), `thumbContent`(인덱스별 커스텀 핸들 렌더), `onThumbClick`(드래그 아닌 thumb 클릭=seek). 현재 사용처는 `TrimTimeline`의 trim 듀얼 핸들 — 투명 트랙 + outline 핸들(`thumbContent`) + range=`bg-background`로 트림 바를 완전 커스텀.

- **CTA는 `default`(h-9)로 통일** — 대개 `size` 생략(기본값이 h-9).
- `xl`은 랜딩/온보딩 같은 특수 CTA 전용.
- `sm`은 텍스트 포함 보조 버튼(복사·필터 등).
- 위험 동작(텍스트 버튼): **`variant="destructive-outline"`**로 통일한다 — outline 골격 + idle·hover 모두 빨간 글자(hover 배경만 accent 연회색). `variant="outline" className="text-destructive"`는 hover에서 `text-accent-foreground`에 덮여 빨강이 사라지므로 쓰지 않는다. 빨강 채움 버튼이 필요하면 `variant="destructive"`.

**아이콘 버튼(`size="icon"`) 두 사이즈**
- `h-8 w-8` (32px): 패널/섹션 헤더·행 액션의 기본.
- `h-9 w-9` (36px): Input/Textarea 우측에 직접 붙거나, **인접한 h-9 컨트롤(텍스트 버튼 등)과 높이를 맞춰야 할 때**(예: `DraftingPanel`의 입력 우측 액션). 항상 `shrink-0` 동반.

**아이콘 버튼 색**
- idle은 **`foreground`(기본 검정)**. 아이콘 *버튼*의 idle에 `text-muted-foreground`(회색)를 쓰지 않는다 — 비활성처럼 보여 클릭 가능성이 약해진다.
- 삭제·연결 해제 등 파괴적 액션: idle은 foreground 그대로, **`hover:text-destructive`**(호버 시 빨강)로만 위험을 표현한다.
- 토글류(`aria-pressed`)도 off의 아이콘은 `foreground`(검정). on/off 대비는 색이 아니라 **배경·테두리**로 표현한다. 두 관용구: ① **약대비** `data-active={active||undefined}` + `aria-pressed` + `cn(..., active && "bg-muted")` — 사이드패널 아이콘 토글의 지배적 패턴. 툴바류는 `TooltipIconButton`(§13)이 단일 출처(캡처 방식 툴바·어노테이션 툴바), 그 외 텍스트 pill은 `OriginFilterBar`·`NetworkLogContent`, ② **강대비** on=`bg-foreground text-background`, off=기본 + `hover:bg-muted`(`LinkToggle`).
- 예외: empty state·로딩 스피너·상태 표시 아이콘은 *버튼이 아니므로* `text-muted-foreground` 허용(장식·저대비 정보).
- 예외: **드래그 핸들**(`SettingsTab`의 본문 구성 재정렬 `GripVertical`)은 idle `text-muted-foreground` + `hover:text-foreground`. 행마다 하나씩 세로로 쌓여 전부 풀 대비면 목록이 시끄럽고, 위 금지의 근거인 "비활성처럼 보임"은 **hover에서 foreground로 올라오는 전이**가 해소한다. 면색 hover(`hover:bg-accent`)는 끄고 글자색 전이만 쓴다(§2의 muted 표면 관용구와 같은 방향). 키보드 어포던스는 `focus-visible:ring-primary`가 별도로 담당.

**관련 변형 컴포넌트**
- `Badge`: variant `default`/`secondary`/`destructive`/`outline`, size 없음, `[&>svg]:size-3`.
- `Toggle`/`ToggleGroup`: variant `default`/`outline`/`segment`/`underline`, size `sm`(h-8)/`default`(h-9)/`lg`(h-10). **현재 앱 사용처 0** — 미사용 primitive다(세그먼트 뷰 토글은 `Tabs`로 구현). `size="xl"`·`variant="destructive"`도 같은 상태.
- `ButtonGroup`: `orientation` `horizontal`/`vertical`. 서브 export `ButtonGroupText`·`ButtonGroupSeparator`.
- `Kbd`: 인라인 keycap 칩 — `bg-muted text-muted-foreground rounded-sm inline-flex h-5`. 액션 로그의 값·태그·드래그·마스킹 칩이 단일 출처로 사용(`ActionLogContent`의 `CHIP_CLS` = `font-mono text-mono align-middle text-foreground`로 mono 표면 override[`text-mono`로 Kbd 기본 `text-xs`까지 덮어 형제 행과 13px 통일] + 텍스트 라인 중앙 정렬 + Kbd 기본 muted를 foreground로 또렷하게, 긴 값은 내부 `min-w-0 truncate` span). 마스킹은 `border border-dashed`로만 구분(라벨색은 동일 foreground). `KbdGroup` 미사용.

## 11. 레이아웃 & 반응형

사이드패널은 폭이 좁고 가변(min 320px)이라 **컨테이너 기반·flex 오버플로우** 패턴을 기본으로 한다.

### 앱 셸 (`src/sidepanel/App.tsx`)
```
<div class="relative flex h-screen flex-col">     // relative = AI 로딩 오버레이 앵커
  <div class="flex min-h-0 flex-1 flex-col gap-0">
    <div class="border-b px-4 py-4"> … 탭 바(CollapsingTabsList) … </div>
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden" …> … 탭 콘텐츠 … </div>
  </div>
  … AlertDialog 모달들 … <Toaster/>
</div>
```
핵심 관용구:
- **`h-screen flex-col`**: side panel 전체 높이를 수직 스택으로.
- **`flex min-h-0 flex-1 flex-col`**: `min-h-0`이 있어야 flex 자식이 고유 높이를 넘겨 내부 스크롤이 생긴다(스크롤 영역 공식). 이 패턴은 `PageShell`/`PageScroll`/`PageFooter`(아래 §13)로 표준화돼 있어, raw 클래스 대신 그 조합을 기본으로 쓴다.
- **`min-w-0`**: 가로 flex 자식이 콘텐츠 최소 폭을 고집해 레이아웃이 깨지는 것 방지. 아이콘은 `shrink-0`, 텍스트는 절단.

### 탭 시스템
- `tabs.tsx` (Radix 래핑): `TabsList` = `inline-flex h-9 … bg-muted p-1`.
- **비활성 탭 콘텐츠 숨김은 두 가지 경우**가 있다:
  - Radix `Tabs`가 콘텐츠까지 감싸는 영역(DebugTab·SettingsTab·IntegrationsTab 등) → `TabsContent` 자신에 **`data-[state=inactive]:hidden`**.
  - App 최상위처럼 `Tabs`가 탭 바만 감싸는 구조 → 콘텐츠 `<div>`를 상태값으로 **수동 `hidden` 토글**(`App.tsx`). Radix data-state가 닿지 않기 때문.
  - 어느 쪽이든 비활성 탭을 언마운트하지 않고 숨겨 동시 렌더 버그를 피하는 게 의도.
- **세그먼트 뷰 토글**(`StyleEditorPanel.tsx` 편집/CSS 스위치): shadcn `Tabs`를 `TabsContent` 없이 `grid grid-cols-2` 세그먼트 바(트리거에 아이콘 Paintbrush/Code2 `h-3.5 w-3.5` + `gap-1.5`)로만 쓰고, 활성 상태를 로컬 state가 아니라 **store 값**(`useSettingsUiStore.styleEditorView`, 값은 그대로 `"form"|"code"`)에서 읽는다. **스왑은 비대칭**이다: 편집(폼) 영역 wrapper는 `cn(styleEditorView !== "form" && "hidden")`으로 `display:none` 토글(위 "수동 hidden" 계열 — 언마운트 안 함, collapsible 접힘 보존)하지만, **CSS 뷰는 `{styleEditorView === "code" && <StyleCssView key={elementKey(selection)} />}`로 조건부 마운트**한다(비활성 시 언마운트, 요소 전환 시 remount — doc는 store에서 재파생해 무손실 + CodeMirror lazy 청크를 CSS 탭 진입 시에만 로드). class·Text 섹션은 **편집 뷰 전용**(폼 hidden wrapper 안), 변경사항·AI 배너·푸터만 두 뷰 공통이라 토글 wrapper **밖**에 둔다. hidden wrapper가 `Section`의 `:last-child`(`last:border-b-0`, 아래 §합성 컴포넌트) 스코프를 나눠 마지막 섹션의 하단 구분선이 사라지므로 그 wrapper에 **`[&>section:last-child]:border-b`**로 복원한다.
- `collapsing-tabs.tsx` (`CollapsingTabsList`): ResizeObserver/MutationObserver로 폭을 감시해, 트리거가 넘치면 **모든 탭 라벨을 동시에 숨기고 아이콘+배지만** 남긴다. 측정 중엔 `group-data-[measuring]/tabs:inline`로 라벨을 강제 노출해 자연 폭 계산. 사용처: 메인 탭 바, 서브탭.

### 컨테이너 쿼리
부모 폭 기준 리플로우로, 같은 컴포넌트를 좁은 패널과 넓은 다이얼로그 양쪽에서 재사용하는 패턴.
- 현재 활성 사용처는 없다(이전 유일 예 `LogAttachmentCards`가 단일 카드로 전환되며 `@container`/grid 제거). 플러그인은 설치돼 있어 필요 시 재도입 가능.

### 오버레이 컴포넌트
- **Dialog** (`dialog.tsx`): 기본 `DialogContent` = `rounded-2xl`, `w-full max-w-[calc(100%-2rem)]`, `duration-300`. 넓게 띄워야 하면 override(예: `SubmitFieldsDialog`의 `w-[90vw] max-w-[90vw] max-h-[80vh] rounded-3xl`). `DialogFooter`는 `flex-col-reverse sm:flex-row` + `rounded-b-2xl`.
- **Popover** (`popover.tsx`): 기본 `align=center sideOffset=4 collisionPadding=8`, `w-72`, 높이는 `--radix-popover-content-available-height`. 콤보박스에 다수 사용.
- **ScrollArea** (`scroll-area.tsx`): 로그 콘텐츠 패널 공통. 커스텀 스크롤바는 `globals.css`의 `::-webkit-scrollbar`(10px, thumb=border 색, hover 시 muted-foreground/0.5)와 일관.
- **Resizable** (`resizable.tsx`): 분할 레이아웃(주로 log-viewer 비디오+로그 패널).

## 12. 아이콘 & 브랜드

- **일반 UI 아이콘 = lucide-react.** 표준 `h-4 w-4`(인라인), 큰 아이콘 `h-6 w-6`. 색은 semantic(`text-muted-foreground` 등).
- **플랫폼 브랜드 = `@icons-pack/react-simple-icons`**, `Si{Name}` + **`color="default"`**(브랜드 색 유지). 크기는 className.
  - **GitHub·Notion만 `dark:invert`**(어두운 단색 마크). 동적 케이스는 플래그 + `cn(…, flag && "dark:invert")` — `SubmitFieldsDialog`의 `PLATFORM_TABS`는 `invertOnDark`, `LlmConnectDialog`는 같은 개념을 `darkInvert`로 부른다(OpenAI·Anthropic·Groq·OpenRouter·Ollama — gemini·together는 미적용). ⚠ 한 개념에 두 이름 — **새 코드는 `invertOnDark`로 통일**.
- **커스텀 SVG는 simple-icons가 미지원일 때만**. 공용은 `src/components/icons/SlackIcon.tsx` 하나(simple-icons v13이 Slack 마크를 브랜드 가이드라인 사유로 삭제). 단일 화면 전용은 그 파일에 인라인 정의 허용 — `LlmConnectDialog`(`tabs/settings/`)의 `OpenAIIcon`·`GroqIcon`·`TogetherIcon`. className으로 크기 제어.

## 13. 공용 합성 컴포넌트 (`src/sidepanel/components/`)

레이아웃·반복 UI는 아래 합성 컴포넌트로 표준화한다. 새 폼/섹션은 이들을 조합한다.

| 컴포넌트 | 표준화 대상 |
|---|---|
| `PageShell`/`PageScroll`/`PageFooter` (`Section.tsx`) | 탭 페이지 골격 — Shell=`flex min-h-0 flex-1 flex-col`, Scroll=`min-h-0 flex-1 overflow-y-auto`(내부 스크롤 영역), Footer=`shrink-0 flex flex-col gap-2 border-t bg-muted/50 p-4`(하단 고정 액션 — 자식을 세로로 쌓는다. 가로 배치가 필요하면 자식 쪽에서 감쌀 것). 전 탭 공용. **취소·제출 같은 액션이 없는 순수 툴바 footer는 `bg-muted/50`이 아니라 `bg-background`**(캡처 방식 툴바·녹화 그리기 툴바 — `PageFooter`엔 className override prop이 없어 이 경우는 raw div로 짠다) |
| `TooltipIconButton` | 툴바 아이콘 버튼 — `size="icon"` + `h-8 w-8` + `variant="outline"` + Radix 툴팁(Provider 내장 — 툴바가 오버레이·footer로 흩어져 상위 Provider 보장이 없다) + 토글(`data-active`/`aria-pressed`/`bg-muted`) + `ariaDisabled` 잠금. 캡처 방식 툴바·어노테이션 툴바(이미지·녹화) 공용 |
| `Section.tsx` | 섹션 구획 — `<section>` 래퍼에 `border-b border-border py-6 last:border-b-0`(섹션 간 구분선, 마지막은 제거) + optional 헤더(title/action 둘 다 없으면 미렌더) + optional collapsible. collapsible은 **비제어(`defaultOpen`)/제어(`open`+`onOpenChange`) 둘 다** — 제어는 접힌 섹션의 자식이 언마운트되는 걸 부모가 풀어야 할 때 쓴다(`DraftingPanel`이 로그 추가 전 섹션을 펼치는 경로). 헤더는 제목 `min-w-0 truncate` + 액션 컨테이너 `shrink-0`이라 액션이 늘어도 제목이 밀리지 않고 절단된다(§11 관용구의 정규 선례). 토글 wrapper로 섹션을 그룹화하면 `:last-child`가 재스코프되니 wrapper에 `[&>section:last-child]:border-b`로 복원(위 §탭 시스템 세그먼트 토글) |
| `SingleLazyCombobox.tsx` / `CcMultiCombobox.tsx` | 플랫폼 필드 콤보박스 — Popover+Command 기반 단일 선택(lazy fetch) / 다중 선택(CC 멘션). **8개 플랫폼 필드 폼의 표준 primitive**(jira/github/gitlab/linear/notion/asana/clickup/slack `*Fields/`) — 새 플랫폼 필드는 직접 만들지 말고 이 둘을 조합한다. 선택 항목 상단 고정은 `ccOptions.ts`(`pinSelectedFirst`/`orderSelectedFirst`) 공유 |
| `HighlightedText.tsx` / `JsonTreeViewer.tsx` / `LogSeekChip.tsx` | 로그 표시 위젯 — 검색어 `<mark>` 하이라이트(+`HighlightQueryContext`로 JSON 트리 leaf까지 전달) / 네트워크 body JSON 트리 / 영상-로그 동기화 점프 칩. 사이드패널 로그 탭·다이얼로그·log-viewer 공용 |
| `FieldRow.tsx` | 라벨+필드 쌍 — `grid gap-1.5`, 라벨 `text-xs text-muted-foreground`, `required` 시 빨간 별. **⚠ `tabs/connect/`는 아직 안 따른다** — 8개 폼이 동일 마크업을 raw `div.flex flex-col gap-1.5` + `<label>`로 42곳 반복(시각 결과는 같지만 규칙 미준수). 신규 필드는 `FieldRow`를 쓴다 |
| **Connect 폼 기본값 필드** (`tabs/connect/*ConnectForm.tsx` — 표 헤더의 `components/` 아님) | 연결 후 기본값(위치·담당자·라벨·이슈 타입) 편집 — **이슈 모달의 콤보박스를 그대로 재사용**한다(`*Fields/AssigneeCombobox` 등). 새 콤보박스를 만들지 말 것. 상위 값(저장소·프로젝트·팀·워크스페이스) 콤보박스의 `onChange`는 **하위 담당자·라벨 defaults를 함께 비운다**(다른 스코프의 멤버라 무효). 후보 조회에 상위 값이 필요한 콤보박스는 `ready` 가드로 비활성 + "먼저 선택하세요" 안내를 트리거 라벨에 노출 |
| `InlineLink.tsx` | 외부 링크 — `target=_blank rel=noopener noreferrer`, `text-blue-600 underline dark:text-blue-400` |
| `LinkifiedText.tsx` | 로그 본문 텍스트 linkify — `tokenizeLogText`로 URL 토큰만 `InlineLink`로 렌더(클릭 시 행 토글 방지 stopPropagation). Console 로그 본문·stack 사용 |
| `ConnectedBadge.tsx` | 연결됨 상태 배지 — CircleCheck + green 톤 |
| `ColorSwatch.tsx` | 색/이미지 미리보기 — 12×12, `rounded-[3px] border`(picker 인스펙터와 시각 통일). `shape="round"`면 `rounded-full` — 라벨 색 dot(github/gitlab/linear LabelCombobox) |
| `DocTable.tsx` | 표 — `table-fixed`, `rounded-lg border`, 셀/헤더/행 클래스 상수(`docTableCell`/`docTableHead`/`docTableRow`) export |
| `StyleChangesTable.tsx` | 스타일 diff 표 — DocTable과 별개의 두 번째 테이블 primitive(before/after·변경 토큰 강조) |
| `OriginFilterBar.tsx` | 출처별 로그 필터 바 — Console/Network/Action 로그 공용, origin 2개+ 일 때만 노출 |
| `{Console,Network,Action}LogContent.tsx` + `*LogPreviewDialog.tsx` | 로그 목록·상세 렌더와 그 다이얼로그 셸 — 사이드패널 로그 탭·리플레이 트림·로그 추가 다이얼로그·log-viewer가 공유(§14 로그 행 심각도 규칙의 구현체). `NetworkLogContent`는 `onActiveChange`, `ConsoleLogContent`는 `selectedId`+`onActiveChange`로 선택을 노출한다(미공급 시 표시 전용 — 비침습) |
| `LogAttachmentCards.tsx` | logs.html 단일 첨부 토글 카드(Switch + 스위치 영역 hover-suppress, IssueRow 패턴) — 클릭 시 LogPreviewDialog |
| `IssuePreviewView.tsx` | 이슈 본문 프리뷰 — 제목·재현 환경·섹션 + 마크다운 복사, `media`/`logCards` 슬롯. PreviewPanel과 log-viewer Report 탭 공용(두 표면이 같은 본문을 그리도록 강제) |
| `SubmitSuccessView.tsx` | 제출 완료 화면 — 성공 아이콘 + 이슈 링크 + 후기·확인 버튼. IssueTab(작성)·IssueListTab(목록) 공용 |
| `AttachmentSection.tsx` / `AttachmentList.tsx` | 사용자 파일 첨부 — 편집형(추가·삭제 카드) / 읽기 전용 카드 목록(클릭 시 로컬 재다운로드, `CATEGORY_ICON` 보유). 후자는 PreviewPanel·DraftDetailDialog 공용 |
| `TiptapEditor.tsx` | WYSIWYG 본문 에디터 (ProseMirror + tiptap-markdown 양방향) — 이슈 본문 paragraph 섹션 |
| `CancelConfirmDialog.tsx` | 취소 확인 다이얼로그 공용 — 진행 중 작업 폐기 전 확인 |
| `ZoomControl.tsx` (`annotation/`) | 캔버스 배율 컨트롤 — 플로팅 `[−][n% ▾][+]`(ButtonGroup + shadcn Select). 어노테이션 캔버스 하단 고정. 컨트롤 밖 통과는 부모 `AnnotationToolbar`가 `pointer-events-none` 레이어 + 컨트롤에 `pointer-events-auto` 재활성으로 구현(§6 오버레이 컨트롤과 동일 기법) |
| `DocSectionBody.tsx` | 이슈 섹션 본문 렌더 — 마크다운(`renderMarkdown`) 또는 orderedList. 긴 코드블럭은 `useCodeCollapse`가 렌더 후 접기 셸을 부착 |
| `OrderedListEditor.tsx` | 재현 절차 orderedList 편집 (`DraftingPanel`·`DraftEditDialog` 공용 — `DocSectionBody`의 orderedList 렌더와 짝) |

### 폼 요소 (shadcn)
`Input`/`Textarea`/`Select`/`Checkbox`/`Switch`/`Label` 모두 shadcn 기본 치수(`Input` h-9, `Checkbox` h-4 w-4, `Switch` h-5 w-8 등). 표면은 `Card`(+`CardHeader`/`CardContent`) — 연결 폼 8개·설정 카드·로그 첨부 카드 등 18개+ 파일의 기본 컨테이너다(§6 radius 표의 "카드=`rounded-lg`"가 이것). **라벨+필드는 `FieldRow`로 감싸는 것을 기본**으로 한다:
```tsx
<FieldRow label="프로젝트" required>
  <Select …>…</Select>
</FieldRow>
```

## 14. 상태 표현

- **토스트**: `sonner` (`src/components/ui/sonner.tsx`, theme 동기화). `toast.success/error/warning(t(...))`. 스타일은 토큰 기반(`bg-background … rounded-xl`).
- **툴팁**: `tooltip.tsx` (Radix). `TooltipProvider > Tooltip > TooltipTrigger asChild + TooltipContent`. 내용 `bg-primary text-primary-foreground text-xs`.
- **로딩 스피너**: lucide `Loader2` + `animate-spin`(`h-4 w-4` 또는 `h-3 w-3`). 오버레이는 `absolute inset-0 flex items-center justify-center`.
- **진행 중 잠금**: `disabled` 대신 **`aria-disabled` + 핸들러 early-return 가드**를 쓴다 — shadcn Button base의 `disabled:pointer-events-none` 때문에 `disabled`면 툴팁·hover가 죽고 스피너까지 흐려진다. 스타일은 `aria-disabled:cursor-not-allowed aria-disabled:opacity-50`(스피너를 든 버튼은 `opacity-50`을 뺀다). 선례: `ReplayButton`·캡처 방식 툴바(`IssueTab`)·`TooltipIconButton`의 `ariaDisabled`.
- **AI 로딩 오버레이**: `App.tsx`(`absolute inset-0 z-50`, 전체 오버레이 + `backdrop-blur-[2px]`). 표면별 틴트(styling=teal / draft=purple / repro=amber, `bg-<c>-500/5` — `AI_OVERLAY_STYLE` 맵) 위에 **중앙 문구(18px semibold) + 중앙에서 퍼지는 도넛 물결 ripple**. 문구는 `useAiLoadingStep`이 3s마다 step을 올려 `aiLoadingPhraseKey`로 표면당 5개를 무한 루프(홀드 없음), 전환은 `AiLoadingText`가 이전 문구를 위로 이탈(`animate-out slide-out-to-top`)·새 문구를 아래에서 진입(`animate-in slide-in-from-bottom`, `duration-700`)시킨다. ripple은 `tailwind.config.js`의 `ai-ripple` keyframe(scale 0→1 + opacity, 3s)을 `key={step}` 리마운트로 매 전환마다 replay 하고, 링(도넛)은 arbitrary radial-gradient(`transparent→<c>-400@0.1→transparent`) `h-[240vh] w-[240vh]`가 화면 밖까지 커지며 물결처럼 번지고(`blur-3xl`로 끝단 부드럽게), 문구는 래퍼 `animate-text-breathe`(opacity 0.5↔0.45)로 은은하게 숨쉰다. 정렬은 래퍼 div(`-translate-x-1/2 -translate-y-1/2`)가 맡고 키프레임은 scale만 한다.
- **빈 상태(empty state)** 관용형:
  ```tsx
  <div class="flex … items-center justify-center px-4 text-center">
    <div class="mb-3 rounded-full bg-muted p-3"><Inbox class="h-6 w-6 text-muted-foreground"/></div>
    <h3 class="text-lg font-semibold">…</h3>
  </div>
  ```
  콘텐츠 단위 빈 값은 `text-sm text-muted-foreground/70`.
- **인라인 에러**(폼 검증 등)는 `text-xs text-destructive`를 기본으로 한다.
- **로그 행 심각도/종류**: 본문은 중립색(`text-foreground`), 심각도(console level)·종류(action kind)·상태(network)는 **행 배경 틴트 + 좌측 아이콘**으로 신호하고 **URL은 파란 클릭 링크**(`InlineLink`/`LinkifiedText`). 본문 전체를 레벨색으로 칠하지 않는다(Console/Network/Action 통일 — Network가 레퍼런스). 다크 배경 틴트는 거의 검정이라 변별은 좌측 아이콘 색이 사실상 전담.

## 15. className & 변형

- **`cn()`** (`src/lib/utils.ts`) = `twMerge(clsx(...))`. 조건부 클래스 + Tailwind 충돌 해소. shadcn·합성 컴포넌트 **대부분**이 외부 `className`을 받아 `cn("기본…", className)`로 병합한다(일부 단순 컴포넌트는 템플릿 concat — 예 `InlineLink`).
- 변형이 많은 컴포넌트는 **cva**로 variant/size를 정의(button/badge/toggle/label 등 shadcn 표준).

---

## 빠른 체크리스트 (새 UI 만들 때)

1. shadcn 컴포넌트 우선, 없으면 `npx shadcn@latest add`.
2. 색은 semantic 토큰. raw 색은 상태/기능 색에만 + 가능하면 `dark:` 짝.
3. 간격·radius·그림자·z-index는 §5–7의 관용값 먼저 재사용.
4. CTA는 `Button`(기본 h-9). 아이콘 버튼은 `h-8 w-8`(헤더/행) 또는 `h-9 w-9`(필드 부착) + `aria-label`.
5. 스크롤 영역은 `flex min-h-0 flex-1 flex-col` + 내부 overflow. 가로 깨짐은 `min-w-0`.
6. 비활성 탭 콘텐츠 숨김: Radix 영역이면 `TabsContent`에 `data-[state=inactive]:hidden`, App 최상위형이면 수동 `hidden` 토글.
7. 좁은 폭 리플로우는 컨테이너 쿼리(`@container` + `@[…]:`).
8. 새 애니메이션엔 `motion-reduce:` 고려, 포커스가 보이는지 확인.
9. 알림은 `sonner` toast, 외부 className은 `cn()`로 병합.
