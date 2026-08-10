# audit-refactor-5 — UI 접근성·디자인 토큰·i18n 정합

> 제품 기능이 아니라 코드베이스 감사(2026-08-11 `/audit`) 후속 정리다.

**앞선 배치들과 달리 이 배치는 사용자에게 보인다.** 접근성 속성 추가는 스크린리더·키보드 사용자에게, 색상 통일은 **모든 사용자에게 픽셀 단위로** 보인다. "동작 변경 없음"이라고 뭉뚱그리면 안 되므로 여기 명시한다.

| 항목 | 사용자에게 보이는 변화 |
|---|---|
| 🟡19·20 | 로그 필터 pill(출처·WS 방향)이 스크린리더에서 "눌림/안 눌림"으로 읽힌다. 시각 변화 없음. |
| 🟡21 | 스타일링 AI 배너가 진행 중일 때 흐려지고 커서가 `not-allowed`가 된다(초안 AI 배너와 동일). |
| 🟡22·23 | 재현 절차 삭제 버튼·어노테이션 텍스트 입력이 스크린리더에서 이름을 갖는다. 시각 변화 없음. |
| 🟡24·25 | 스타일 편집기의 link 토글·값 콤보박스가 shadcn `Button`으로 바뀐다 — **높이·radius·hover·포커스 링이 미세하게 달라질 수 있다.** |
| 🟡26·27 | 콘솔 로그 상세의 코드블럭 배경, 네트워크 선택 행 배경이 **한 단계 옅어진다**(`-200` → `-100` 계열). 라이트에서 눈에 띈다. |
| 🟡28 | CSS 뷰 경고 배너의 amber가 앱 전역 amber 관용구로 바뀐다(배경 진해지고 글자 색조 변경). |
| 🟡29 | **OS는 다크인데 앱 설정이 라이트**인 사용자: 페이지 위 picker 인스펙터 카드가 이제 앱과 같이 흰 카드로 뜬다(반대 조합도 대칭). |
| 🟡30 | box-model gap 채움색이 pink → violet 계열로 바뀌어 gap 라벨 색과 맞는다. |
| ⚪72 | 프리뷰 빈 섹션 문구가 제출 본문과 같아진다(택일에 따라 `비어 있음` 또는 `(없음)`). |
| ⚪78 | AI 배너 그라디언트에서 indigo/cyan이 빠지면 배너 글자 그라디언트가 단색조로 보인다. |
| ⚪80 | 네트워크 상세 상태 dot이 다크에서 한 톤 밝아진다. |
| ⚪84 | 검색 하이라이트·Slack DM 아바타 모서리가 1px 덜 둥글어진다(사실상 인지 불가). |

나머지(32~34·60·81~83·85~92)는 내부 타입 강제·중복 제거·문서 갱신이라 화면에 나타나지 않는다.

## 배치 지도

이 감사는 6개 배치로 쪼개 순차 처리한다. 배치 간 파일 충돌이 없도록 계열별로 묶었다.

| 배치 | 주제 | 항목 | 규모 |
|---|---|---|---|
| audit-refactor-1 | 요청 경계·자격증명 가드 | 🔴1 · 🟡3~5,10,11,36~41 · ⚪63~65,69,70 | 소 |
| audit-refactor-2 | 콤보박스 race·lazy-load 단일 출처 이행 | 🔴2 · 🟡42 | 중 |
| audit-refactor-3 | 레코더 게이트·무결성 | 🟡6~9,15,16,31,35 · ⚪66,67,77 | 중 |
| audit-refactor-4 | 세션·데이터 정합 | 🟡12~14,17,18 · ⚪71,73~76 | 중 |
| **audit-refactor-5** | **UI 접근성·디자인 토큰·i18n 정합** | **🟡19~30,32~34,60 · ⚪72,78~92** | **중** |
| audit-refactor-6 | 중복 제거·데드 코드 | 🟡43~59,61,62 · ⚪68,93~114 | 대 |

## 배경

`docs/DESIGN.md`는 스스로를 이렇게 규정한다:

> 이 문서는 코드베이스에서 역추출한 **현재 상태 스냅샷 + 권장 가이드**다. lint/test로 강제되는 규칙은 아니므로 "권장"으로 읽되, 합리적 이유 없이 벗어나지 않는다.

이 배치가 다루는 게 정확히 그 문장의 그림자다. **린터가 없으므로**(CLAUDE.md: "스타일 게이트는 `pnpm typecheck` + `pnpm test`뿐") DESIGN.md의 관용구는 사람이 지키거나 안 지키거나 둘 중 하나고, 감사가 잡은 건 안 지켜진 쪽이다. 성격이 넷으로 갈린다.

**(1) 관용구를 "선례"로 지목당한 파일 자신이 관용구를 어긴다.** DESIGN §10이 토글 관용구 ①을 이렇게 정의한다:

> ① **약대비** `data-active={active||undefined}` + `aria-pressed` + `cn(..., active && "bg-muted")` — 사이드패널 아이콘 토글의 지배적 패턴. … 그 외 텍스트 pill은 `OriginFilterBar`·`NetworkLogContent`

정규 선례로 이름이 박힌 두 파일이 **3요소 중 `aria-pressed`만 빠져 있고**(🟡19·20), 덤으로 `cn()` 대신 템플릿 concat을 쓴다(⚪85 — §15 위반). 관용구의 레퍼런스가 관용구를 부분적으로만 구현하고 있으니, 이걸 보고 만드는 다음 토글도 같은 구멍을 복제한다.

**(2) 쌍둥이 컴포넌트가 비대칭이다.** `StyleEditorPanel`(teal)과 `DraftingPanel`(purple)의 AI 배너는 DESIGN §2가 "AI 기능 액센트 색쌍"으로 짝지어 놓은 대칭 구조인데, 잠금 처리만 한쪽에 있다(🟡21). `JsonTreeViewer`와 `DomTreeDialog`의 트리 chevron은 className이 **바이트 동일**한데 `aria-expanded`가 한쪽에만 있고 i18n 키도 갈렸다(⚪83).

**(3) "단일 출처"라고 못박은 표 바깥에서 값이 손조립된다.** DESIGN §2:

> 로그 semantic 색(console 레벨·network 메서드·action 톤): `src/lib/log-colors.ts` **단일 출처**. … `TONE_BG`(행 배경 틴트 → `bg-<c>-100 dark:bg-<c>-950/50`, `consoleLevelBgClass` 포함)

`ConsoleLogContent.tsx:38`의 `levelCodeBg`는 같은 레벨 축(error/warn/info)에 `bg-red-200 dark:bg-red-950/70`이라는 **제3의 스케일**을 로컬 정의한다(🟡26). `NetworkLogContent.tsx:50-62`는 더 노골적이다 — 같은 함수 안에서 비선택 행은 `TONE_BG.red`를 쓰고 선택 행은 `bg-red-200 dark:bg-red-950/70`을 손으로 적는다(🟡27). amber는 §2 등재 관용구(`IntegrationsCta`)와 `StyleCssView`가 갈려 표면이 2종이다(🟡28).

**(4) 타입이 있는데 `as`로 뚫려 있다.** `src/i18n/ko.ts:21`이 `TranslationKey = keyof typeof ko`로 닫힌 union을 만들어 놨는데, 두 곳이 캐스트로 그걸 무력화한다 — `LINEAR_STATE_I18N`(🟡33)과 `settings-ui-store.ts`의 섹션 키 헬퍼 4종(⚪60). 그리고 `src/i18n/index.ts:39`의 `t()`에는 폴백이 없어(🟡32), 캐스트로 들어온 키가 미정의면 params 유무에 따라 **TypeError 또는 `undefined` 렌더**로 갈린다. 복제 사전 `src/log-viewer/i18n.ts:282`는 `if (!text) return key;`가 있어 같은 상황에서 키 문자열을 렌더한다 — **두 사전의 실패 모드가 다르다.**

여기에 content script 오버레이 계열(🟡29·30·⚪88·89), shadcn 미사용 raw 마크업(🟡24·25·⚪81~83), 잔여 raw 색·radius·복제(⚪78~80·84·86·87·90·91), DESIGN.md 자체의 수치 드리프트(⚪92)를 얹었다.

### 감사 리포트와 실제 코드가 어긋난 6곳 (기획 중 확인)

전 항목을 Grep/Read로 대조했고, 다음은 감사 원문을 그대로 따르면 안 된다.

1. **항목 81의 aria 지적은 사실이 아니다.** `statusBadges/*StatusBadge.tsx`의 raw `<button>`은 전부 `<PopoverTrigger asChild>`의 자식이고, Radix가 `aria-haspopup: "dialog"`·`aria-expanded: context.open`을 자식에 머지한다(`node_modules/@radix-ui/react-popover/dist/index.mjs:90-91` 확인). **접근성 결함은 없다.** 남는 건 "7개 파일에 같은 raw 버튼 마크업이 복제됐다"는 중복 문제뿐이고, 그건 `<Badge>`를 감싸는 얇은 focus 링 래퍼라 shadcn `Button`으로 못 바꾼다(§10의 `size`·padding이 배지를 부풀린다). → **이 배치에서 제외**하고 audit-refactor-6(중복 제거)으로 넘긴다.

2. **경로 오류 2건**(⚪92 안) — `components/ReplayTrimDialog.tsx`는 실제로 `src/sidepanel/tabs/ReplayTrimDialog.tsx`, `tabs/StyleChangesDialog.tsx`는 실제로 `src/sidepanel/tabs/styleEditor/StyleChangesDialog.tsx`다.

3. **⚪92의 `lockedClass` 인라인 리터럴은 6곳이 아니라 7곳이다.** 감사 본문이 "6곳"이라 쓰고 실제로는 7개 위치를 나열했다. `grep -rn "aria-disabled:cursor-not-allowed"` 실측으로 `cursor-not-allowed` + `opacity-50` **완전 쌍**이 인라인으로 박힌 곳은 7곳(`IssueTab.tsx:375,422,505`·`ReplayTrimDialog.tsx:394,407`·`StyleChangesDialog.tsx:310`·`DraftingPanel.tsx:471`). 추가로 **`opacity-50` 없이 `cursor-not-allowed`만** 쓰는 곳이 19곳 더 있다(connect 폼 8종 + `IssueTab.tsx:556`·`StyleEditorPanel.tsx:206`·`LlmConnectForm.tsx:252`) — DESIGN §14가 언급하지 않는 **제3의 변형**이다.

4. **⚪92의 FieldRow "실측 34곳"은 세는 단위가 다르다.** DESIGN §13의 "42곳"은 `grep -c "flex flex-col gap-1.5" tabs/connect/*.tsx` = **42**와 정확히 일치한다. 감사의 34는 `grep -c "<label"` = **34**(라벨을 실제로 동반한 필드 쌍)다. 즉 둘 다 맞고 **세는 대상이 다르다** — 문서를 고칠 게 아니라 문장을 정밀화해야 한다("동일 마크업 42곳 중 라벨 동반 필드 쌍 34곳").

5. **⚪87의 수치가 과소하다.** 실측(8개 namespace 파일 파싱): 총 키 **875개**, top-level prefix **52개**(감사 "27+"), 리프이자 prefix인 키 **34개**(감사 "4쌍"). `logViewer.*` 소유권 분산은 사실 — 메인 `logs.ts`에 2개, `log-viewer/i18n.ts`에 38개.

6. **⚪83의 "바이트 동일 복제"는 className 한정이다.** `JsonTreeViewer.tsx:150`과 `DomTreeDialog.tsx:265`의 className은 `inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/15`로 바이트 동일하지만, **props는 갈린다** — JsonTreeViewer만 `aria-expanded`를 갖고(DomTreeDialog는 없다), i18n 키도 `common.expand/collapse` vs `dom.expand/collapse`로 다르다. 공용화하면 두 차이를 **먼저 결정**해야 한다.

## 목표

1. **DESIGN §10 토글 관용구 ①의 정규 선례가 관용구를 온전히 구현한다**(🟡19·20·⚪85) — `OriginFilterBar`·`NetworkLogContent`의 pill 2종이 `data-active` + `aria-pressed` + `cn()` 3요소를 전부 갖는다.
2. **AI 배너 쌍둥이가 대칭이 된다**(🟡21) — `StyleEditorPanel`의 teal 배너가 `DraftingPanel`의 purple 배너와 같은 `aria-disabled` + 잠금 클래스 + 핸들러 early-return을 갖는다(§14).
3. **아이콘 전용 버튼·자유 입력에 접근명이 있다**(🟡22·23) — §9의 "`aria-label`을 반드시 붙인다"가 `OrderedListEditor` 삭제 버튼과 `AnnotationOverlay` 텍스트 편집 `<textarea>`에도 적용된다.
4. **스타일 편집기의 raw 컨트롤 2종이 shadcn으로 수렴한다**(🟡24·25) — §1의 "UI 컴포넌트는 직접 스타일링하기보다 shadcn/ui를 우선"과 §13의 콤보박스 표준을 따른다.
5. **로그 행/코드블럭 배경이 `log-colors.ts` 단일 출처만 참조한다**(🟡26·27) — `TONE_BG` 밖에서 조립된 `bg-<c>-200 dark:bg-<c>-950/70` 3벌이 사라지고, 필요한 변형(선택/hover)은 그 표를 확장해서 얻는다.
6. **amber 표면이 1종이 된다**(🟡28) — `StyleCssView` 경고 배너가 §2 등재 amber 관용구(`bg-amber-100/80` / `dark:bg-amber-950`)를 따른다.
7. **picker 인스펙터 카드가 앱 theme 설정을 따른다**(🟡29) — OS 설정이 아니라 `useSettingsUiStore.theme`(기본 `light`)이 카드 색을 정한다. §3의 "theme(`light`|`dark`|`system`)을 `useSettingsUiStore`에서 읽어"가 content script 표면까지 확장된다.
8. **box-model 오버레이의 채움색과 라벨색이 세 축 모두 같은 계열이다**(🟡30) — margin=amber / padding=green / gap=violet.
9. **미정의 i18n 키가 화면에 `undefined`로 나타나지 않는다**(🟡32) — `t()`가 폴백을 갖되, **폴백에 의존할 일이 없도록 `as` 캐스트 2곳을 먼저 제거**한다(🟡33·⚪60). 키 리네임은 런타임이 아니라 `pnpm typecheck`에서 잡힌다.
10. **복제 사전 drift 그물에 구멍이 없다**(🟡34) — `MAIN_NAMESPACES`가 복제 사전이 실제로 복제하는 모든 namespace를 덮는다.
11. **⚪ 9건이 정리된다** — 빈 값 문구 통일(72), AI 배너 그라디언트 팔레트 정리(78), 상태 dot `dark:` 짝(80), 트리 chevron 공용화(83), `rounded-[4px]` → 등재값(84), dead i18n 키 정리(86), overlay 죽은 CSS 훅 제거(88), `editor-store`의 컴포넌트 디렉터리 import 승격(90), 미등재 role 무음 생략(91).
12. **DESIGN.md의 수치·목록이 실측과 맞는다**(⚪92·79·89) — §9 title-only 레거시 목록, §13 FieldRow 수치, §14 `lockedClass` 복제 수치, §2 raw 색 등재 목록, §4 오버레이 폰트 스택.

## 비목표 (Non-goals)

- **`statusBadges/*StatusBadge.tsx` 7개의 Popover 트리거를 손대지 않는다**(⚪81). 위 "어긋난 6곳" 1번대로 접근성 결함이 없고, 남은 중복은 audit-refactor-6 소관이다.
- **`connect/*ConnectForm.tsx`를 `FieldRow`로 이행하지 않는다**(⚪92 관련). DESIGN §13이 "**⚠ `tabs/connect/`는 아직 안 따른다** … 신규 필드는 `FieldRow`를 쓴다"로 이미 **의도된 현상 유지**를 선언했다. 이번엔 문서의 **수치만** 정밀화한다. "토큰 발급" 링크 수렴(⚪82)은 별개 판단으로 아래에서 다룬다.
- **`lockedClass` 단일 출처화를 하지 않는다**(⚪92). DESIGN §14가 지적한 복제 3곳 + 인라인 7곳 + 변형 19곳은 **중복 제거 계열**이라 audit-refactor-6이 맞는 자리다. 이번엔 §14의 수치를 실측으로 고치고 제3 변형(`opacity-50` 없는 형)의 존재를 문서에 남긴다.
- **`--ring`을 `--border`와 분리하지 않는다.** §9가 "개선 후보"로 남긴 항목이고, 토큰 값 변경은 `tokens.test.ts` 3표 동기 + 전 화면 시각 회귀라 이 배치의 국소 수정 성격과 규모가 다르다.
- **i18n 네임스페이스를 재편하지 않는다**(⚪87). 875개 키의 prefix 재구성은 **전 파일 리네임 + ko/en 동시 갱신 + log-viewer 복제 사전 동기**를 부르는 대공사고, 얻는 게 정연함뿐이다. 이번엔 **측정치를 기록**하고 실제 버그가 있는 조각(86 dead key·91 열린 집합)만 고친다.
- **`t()`를 async·lazy·plural 지원으로 확장하지 않는다**(🟡32). 폴백 한 줄만 추가한다.
- **overlay의 폰트 스택을 semantic화하지 않는다**(⚪89). Shadow DOM `all: initial`이라 CSS 변수를 못 받는 게 원인이고, DESIGN §2가 이미 "`hsl()` 리터럴로 복제"를 불가피한 사본으로 인정했다. **문서에 등재만** 한다.
- **`theme` 변경을 picking 세션 중에 실시간 반영하지 않는다**(🟡29). picker.start 시점 스냅샷으로 충분하다 — 요소를 고르는 중에 설정 탭으로 가서 테마를 바꾸는 플로우는 존재하지 않는다(picker 활성 중 사이드패널은 캡처 화면에 있다).

## 회귀 감시 지점

`/feature` 템플릿의 "사용자 시나리오"를 이 성격에 맞게 대체한다. **고치다가 깨질 수 있는 기존 동작과 그 확인법**이다.

### R1. `tokens.test.ts`의 overlay 파서가 계속 동작한다 (🟡29 최대 리스크)

`src/styles/__tests__/tokens.test.ts:17`이 **문자열 `"@media (prefers-color-scheme: dark)"`를 overlay.ts에서 찾아** 라이트/다크 영역을 가르고, 없으면 `throw new Error("overlay.ts에 다크 미디어쿼리가 없다")`로 하드 실패한다. 미디어쿼리를 속성 셀렉터로 바꾸면 **DESIGN §2가 "세 표의 일치"를 지키라고 세워둔 그물이 통째로 죽는다.**

- 확인: `parseOverlayTokens`의 분할 앵커를 새 셀렉터로 함께 바꾸고, `pnpm test src/styles` green. 앵커 문자열을 바꾼 뒤 **overlay의 다크 토큰 값을 일부러 틀리게 만들면 red가 나는지** 한 번 확인한다(그물이 살아있음 증명).

### R2. picker가 미등록 theme·구버전 content script에서도 뜬다 (🟡29 리스크)

`picker.start`에 필드를 추가해도 content script가 **이전 빌드**(탭 리로드 전)면 그 필드를 무시한다. `theme`이 `undefined`일 때 카드가 검정/흰색 중 하나로 **깨지지 않고** 폴백해야 한다.

- 확인: `data-theme` 미설정 시 라이트 값(기본 블록)이 적용되는 CSS 구조인지 — 다크를 `[data-theme="dark"]`로만 얹고 라이트를 기본으로 둔다. 유닛으로는 못 잡으니 수동: 확장 리로드 없이 기존 탭에서 picker 실행.

### R3. iframe 자식 프레임의 인스펙터 카드도 같은 theme을 받는다 (🟡29 리스크)

`picker-control.ts:297`이 커밋된 iframe에 `picker.start`를 **재전송**한다(frameToken 실어서). 여기에 `theme`을 안 실으면 부모 프레임 카드와 iframe 카드가 다른 색으로 뜬다.

- 확인: `picker.start`를 보내는 3곳(`:227` 요소 선택, `:297` iframe 재전송, `:633` element shot)이 **전부** theme을 싣는지 grep.

### R4. 로그 행 선택/hover 대비가 유지된다 (🟡26·27 최대 시각 리스크)

`NetworkLogContent.rowBg`는 3단계 대비를 만든다 — 기본(`TONE_BG` = `-100`) < hover(`-200/70`) < 선택(`-200`). 선택 배경을 `TONE_BG`로 내리면 **선택 행과 hover 행이 구별되지 않는다.** `ConsoleLogContent.levelCodeBg`도 같다 — 그건 행이 아니라 **행 안의 `<pre>` 코드블럭**이라, 이미 틴트된 행 배경 위에서 한 단계 더 진해야 블록으로 읽힌다(DESIGN §2의 "비교 대상이 페이지 배경이 아니라 이웃 행" 논리와 같은 축).

- 확인: `log-colors.ts`에 **선택/강조 단계를 추가**하는 방향으로 가고 값을 낮추지 않는다(design.md 참조). 수동: 라이트·다크 각각에서 error 행을 선택했을 때 이웃 hover 행과 구별되는지.

### R5. 콘솔 코드블럭이 `default` 레벨에서 계속 `bg-muted`다 (🟡26 리스크)

`levelCodeBg`의 `default:` 분기는 `bg-muted`(semantic 토큰)다. `TONE_BG.neutral`은 **빈 문자열**이라 그대로 갈아끼우면 코드블럭 배경이 사라져 본문과 붙는다.

- 확인: `src/sidepanel/components/__tests__/ConsoleLogContent.test.tsx`(존재 여부 확인 필요)에 log/debug 레벨 케이스 추가. 없으면 신규.

### R6. AI 배너 잠금이 다이얼로그를 못 열게 막지 않는다 (🟡21 리스크)

`DraftingPanel:472`의 잠금은 `if (aiDraftLoading || reproPrefillLoading) return;`이다. `StyleEditorPanel`엔 대응하는 로딩 플래그가 무엇인지 **먼저 확인**해야 한다 — 없는 플래그를 걸면 배너가 영구 잠기거나 잠금이 무효가 된다.

- 확인: `StyleEditorPanel`의 AI 스타일링 진행 상태 변수를 특정한 뒤 그것만 건다. `e2e/`에 스타일링 AI 진입 spec이 있으면 green 유지.

### R7. `ValueCombobox` 트리거의 grid 최소폭 해제가 유지된다 (🟡25 최대 리스크)

`ValueCombobox.tsx:207-209`에 **주석으로 못박힌 제약**이 있다:

> `min-w-0`: grid item(FieldRow/quad 4-col)의 automatic minimum size를 풀어야 안쪽 `TokenChip`의 truncate가 살아난다 — 없으면 버튼이 트랙을 뚫는다.

shadcn `Button`으로 바꾸면 base cva에 `min-w-0`이 없으므로 **반드시 className으로 다시 넣어야** 한다. 안 넣으면 4열 quad 편집기(margin/padding 4방향)가 가로로 터진다.

- 확인: 수동 — 스타일 편집기에서 `margin`을 4방향 개별 편집으로 펼치고 긴 토큰 값(`var(--spacing-xxx)`)을 넣어 트랙이 안 뚫리는지. 사이드패널 폭 320px로 좁혀서도 확인.

### R8. `LinkToggle`의 강대비 토글 색이 유지된다 (🟡24 리스크)

DESIGN §10 관용구 ②:

> **강대비** on=`bg-foreground text-background`, off=기본 + `hover:bg-muted`(`LinkToggle`)

이 파일이 관용구 ②의 **유일한 선례**다. `Button variant="outline"`으로 바꾸면 base가 `bg-background hover:bg-accent`를 깔고, §2가 경고한 대로 `--accent == --muted`라 hover 방향이 뒤집히거나 무효가 될 수 있다.

- 확인: on/off 두 상태를 라이트·다크 각각에서 눈으로 확인. `aria-pressed`는 이미 있으므로 `*.test.tsx`로 상태별 클래스 존재를 고정한다.

### R9. i18n 키 존재 검사가 계속 green이다 (🟡33·⚪60 리스크)

`sectionLabelKey` 등에서 `as TranslationKey`를 제거하면 tsc가 템플릿 리터럴 타입(`section.${IssueSectionId}`)을 실제 union과 대조한다. **지금까지 캐스트가 가리고 있던 누락 키가 있으면 typecheck가 red로 터진다** — 그게 이 변경의 목적이지만, 그때 "키를 추가할지 / id union을 좁힐지"를 판단해야 한다.

- 확인: `pnpm typecheck`. red가 나면 어떤 id에 어떤 키가 없는지 나열하고 design.md의 결정 규칙을 따른다.

### R10. log-viewer가 계속 빌드·통과한다 (🟡34·⚪86 리스크)

`MAIN_NAMESPACES`에 `common`을 추가하면 지금까지 검사 밖이던 `common.expand/collapse/clearSearch` 3키가 **값 일치 대조에 들어온다.** 두 사전의 값이 이미 다르면 즉시 red다. ⚪86의 dead 키 삭제도 위험하다 — `actionLog.role.*` 7키는 **메인 dict에선 도달 불가지만 drift 테스트의 원본 역할**이라, 지우면 복제 사전 쪽 대응 키가 대조 상대를 잃는다.

- 확인: `pnpm test src/log-viewer`. `common` 추가는 **먼저 값 대조를 돌려보고** 불일치가 있으면 값을 맞춘 뒤 테스트를 넣는다.

### R11. `common.empty` 소비처 3곳이 함께 움직인다 (⚪72 리스크)

`common.empty`는 `PreviewPanel:396`뿐 아니라 `DocSectionBody.tsx:31,44`·`DraftDetailDialog.tsx:904`도 쓴다. 프리뷰 문구를 `md.noValue`로 바꾸려면 **`IssuePreviewView`의 `emptyValue` prop을 타고 log-viewer(`App.tsx:204`의 `logViewer.report.empty`)까지** 3표면을 함께 결정해야 한다(현재 값: `common.empty`=`비어 있음`, `md.noValue`=`(없음)`, `logViewer.report.empty`=`비어 있음`).

- 확인: design.md의 택일 결론을 따르고, 세 소비처를 grep으로 전수 확인.

### R12. 어노테이션 텍스트 편집이 계속 focus를 잡는다 (🟡23 리스크)

`AnnotationOverlay.tsx:665`의 `<textarea ref={(el) => el?.focus()}>`는 마운트 즉시 포커스한다. `aria-label`·`placeholder` 추가는 무해하지만 **placeholder를 넣으면 빈 텍스트 박스에 문구가 보이므로**, 캔버스 위 텍스트 도형의 시각에 영향이 있다.

- 확인: `aria-label`만 붙이고 placeholder는 시각 영향이 없다고 판단될 때만. 수동: 텍스트 도구로 새 박스를 만들 때 문구가 도형처럼 보이지 않는지.

## 성공 기준

- `pnpm typecheck` + `pnpm test` green.
- **`as Parameters<typeof t>[0]` / `as TranslationKey` 캐스트가 0개다** — `grep -rn "as TranslationKey\|as Parameters<typeof t>" src/` 결과가 비어 있다(신규 예외는 사유 주석 필수).
- **키를 리네임하면 tsc가 잡는다** — `src/i18n/namespaces/issue.ts`의 `section.description`을 임시로 리네임하면 `settings-ui-store.ts`가 typecheck를 깬다(확인 후 되돌린다).
- **`t()`가 어떤 입력에도 `undefined`를 반환하지 않는다** — 미정의 키 + params 조합으로 호출해도 throw하지 않는 단위 테스트가 `src/i18n/__tests__/`에 있다.
- **복제 사전 drift 그물이 `common`을 덮는다** — `log-viewer/i18n.ts`의 `common.expand` 값을 일부러 바꾸면 `pnpm test`가 red다.
- **`TONE_BG` 밖에서 조립된 로그 배경이 0개다** — `grep -rn "bg-\(red\|amber\|blue\|green\)-200" src/sidepanel/components/` 결과가 비어 있다.
- **overlay 토큰 3표 대조 테스트가 살아 있다** — R1의 "일부러 틀리게 하면 red" 확인 완료.
- **`aria-pressed` 3요소가 갖춰진다** — `*.test.tsx`가 `OriginFilterBar`·`NetworkLogContent` WS 필터의 활성/비활성 `aria-pressed`를 고정한다.
- DESIGN.md §2·§4·§9·§13·§14의 갱신분이 실측치와 일치한다(수치는 grep으로 재확인 가능한 형태로 쓴다).
- `pnpm coverage:report`에서 로직 스코프 라인 %가 베이스라인 대비 하락하지 않는다.
- 위 회귀 감시 R1~R12 중 자동화 가능한 R1·R3·R5·R9·R10·R11은 green, 시각 판정인 R2·R4·R6·R7·R8·R12는 수동 체크리스트 완료.

## 가이드 영향

**있다 — 스크린샷 재촬영이 필요할 수 있다.** 색상 변경(🟡26·27·28·⚪78·80)과 컨트롤 교체(🟡24·25)가 로그 탭·스타일 편집기 화면에 나타난다. 구현 후 `guide/{ko,en}` 중 아래 페이지의 스크린샷이 stale인지 `/guide-shots`의 stale 탐지로 확인한다(본문 텍스트 변경은 없을 것으로 예상 — UI 라벨이 안 바뀐다).

- 로그(console/network) 화면이 실린 페이지 — 🟡26·27·⚪80
- 요소 스타일 편집 화면이 실린 페이지 — 🟡24·25·🟡28
- picker 인스펙터 카드가 실린 페이지 — 🟡29 (촬영 환경의 OS 다크모드 설정에 따라 기존 컷이 달라 보일 수 있다)

**확인 필요**: 위 페이지의 정확한 파일명은 `guide/AUTHORING.md`의 IA를 읽고 `/guide-shots` 실행 시 확정한다. 본문 문구 갱신은 없을 것으로 보므로 `/guide`가 아니라 `/guide-shots`만 필요할 가능성이 높다.
