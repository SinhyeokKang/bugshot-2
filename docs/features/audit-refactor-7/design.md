# audit-refactor-7 — 기술 설계

## 개요

28개 항목을 **P0(무음 유실·행·Privacy) → P1(계약·경계·단일 출처) → P2(컨벤션·그물)** 3단으로 나누고, 각 단 안에서 **같은 파일·같은 그물을 공유하는 것끼리** G그룹으로 묶는다. 그룹 단위로 커밋하면 하나가 회귀해도 되돌릴 반경이 그룹으로 한정된다.

정렬 축은 두 개다. **심각도**는 "고치지 않으면 사용자가 무엇을 잃는가"(무음 데이터 유실 > 계약 위반 > 컨벤션 이탈)이고, **논리 단위**는 "한 번 컨텍스트를 로드하면 몇 개를 같이 고칠 수 있는가"다. 둘이 충돌하면 심각도가 이긴다 — 예로 #10(activation 큐 경합)은 `tab-bindings.ts` 단독이라 논리 단위로는 P2에 어울리지만 경합이라 P1에 둔다.

이 배치는 **동작 보존이 기본값**이지만 **노출 변화가 7건**이고 그 목록은 prd.md "사용자에게 보이는 변화" 표가 단일 출처다. 나머지 21건은 "같은 결과, 다른 경로"인데 **골든 스냅샷은 그 증명 수단이 못 된다** — 아래 위험 ③이 그 이유를 적는다.

## 그룹 구성

| 단 | 그룹 | 항목 | 대표 파일 |
|---|---|---|---|
| P0 | G0. 회귀 그물 선행 | (테스트 + `labelForText` 이관) | `content/action-recorder-helpers.ts`·`__tests__/` |
| P0 | G1. 응답 채널 행(hang) + shape | #5 #11 #7 | `content/scroll-capture.ts`·`content/picker.ts`·`content/css-source-cache.ts`·`sidepanel/scroll-capture.ts` |
| P0 | G2. 마스킹 게이트 우회 | #12 | `content/action-recorder-helpers.ts` |
| P0 | G3. user gesture 소실 | #6 | `sidepanel/tabs/PreviewPanel.tsx` |
| P0 | G4. 🔴 비활성 이유 미노출 | #1 | `sidepanel/tabs/IssueCreateModal.tsx` |
| P1 | G5. 응답 계약 | #2 #3 #4 | `background/oauth.ts`·`notion-oauth.ts`·`messages.ts` |
| P1 | G6. 번들 경계 | #8 #9 | `store/editor-store.ts`·`store/issues-store.ts` |
| P1 | G7. 단일 출처 통합 | #22 #23 #25 #30 M1 | `lib/escapeHtml.ts`(이동)·`issueBodyShared.ts`·`markdownIt.ts`(신규)·`lib/session-keys.ts`·`ActionLogContent.tsx` |
| P1 | G9. activation 큐 | #10 | `background/tab-bindings.ts` |
| P2 | G10. i18n 그물·문서 언어 | #13 #14 #15 #16 | `index.html` 2벌·`log-viewer/__tests__/i18n.test.ts` |
| P2 | G11. UI 패턴 이탈 | #17 #18 #19 #20 | `statusBadges/`·`notionFields/`·`components/`·`DESIGN.md` |
| P2 | G12. 잔여 | #32 #33 #34 | `content/annotation.ts`·`background/lib/readErrorBody.ts`·경로 2건 |

> **G8(콤보박스 수렴)은 삭제됐다** — prd.md "검수 드랍" 참조. 그룹 번호는 재정렬하지 않는다(태스크 번호와의 대응을 유지하려면 gap이 낫다).

## 변경 범위

### G0. 회귀 그물 선행 + `labelForText` 이관

**순서가 중요하다.** 원안은 "테스트만 먼저"였지만 `labelForText`는 `actionRecorderScript()`(`action-recorder.ts:21`) **내부 클로저**(`:258`)이고 그 파일의 `export`는 0건이다 — **이관 없이는 import 자체가 안 되므로 테스트를 쓸 수 없다.** 따라서 G0의 첫 단계가 순수 이관이다.

1. **`labelForText` + `cleanText`를 `src/content/action-recorder-helpers.ts`로 이관** (동작 무변경, 순수 이동). 그 파일엔 이미 `maskValue`·`shouldMaskField`가 있고 **import가 0줄**이라 pre-arm 그래프에 새 edge를 만들지 않는다(`action-recorder.ts:1-14`가 이미 그 파일을 static import 중).
2. **현재 동작 고정** — characterization test(TDD red가 아니다. 동작 보존이 목표라 "지금 값"을 박는 게 그물이다):
   - `src/content/__tests__/action-recorder-helpers.test.tsx` **신규**(`.tsx` — jsdom 트랙). 기존 `action-recorder-helpers.test.ts`는 node 환경이고 76케이스가 이미 있으므로 **신설이 아니라 별 파일 추가**다. `labelForText`는 `document.getElementById`·`CSS.escape`·`closest`를 쓰므로 node 트랙에선 못 돈다.
   - 고정 대상: 단일 ID · `label[for]` · 래핑 label 3경로. **다중 ID는 red로 둔다**(G2가 green으로 만든다).
   - `src/sidepanel/lib/__tests__/issueBodyShared.test.ts` — 기존. `escapeMdLinkText` 미적용을 드러내는 **단일 케이스**를 추가한다.
3. **커버리지 실측** — `coverage/baseline.json`이 2026-08-14 생성이라 stale하다. 착수 시점의 로직 스코프 %를 다시 재고 그 값을 기준으로 삼는다(prd 성공기준 5).

> **원안의 "imageCell 3벌 출력 대조" 게이트는 삭제한다.** 세 사본(`buildMarkdownIssueBody.ts:45`·`buildClickupIssueBody.ts:35`·`buildLinearIssueBody.ts:32`)은 url 프로퍼티명(`url`/`url`/`assetUrl`)만 다르고 **셋 다 escape가 없다** — 같은 입력 대조는 green이라 약속한 red가 안 뜬다. 진짜 비대칭은 **파일 내부**다: 같은 `buildMarkdownIssueBody.ts`의 `defaultVideoEmbed:51`·첨부 라인 `:202`/`:206`은 `escapeMdLinkText`를 쓴다. 그래서 red는 "3벌이 다르다"가 아니라 "`imageCell`이 형제 함수와 달리 escape를 안 한다" 1종이다. **"red가 정확히 2종"이라는 게이트도 "정확히 2종(다중 ID 1 + escape 1)"으로 유지되지만 근거가 달라졌다.**

### G1. 응답 채널 행(hang) + shape — #5 #11 #7

**#5는 실패 모드가 둘이고 픽스도 둘이다.** 원안은 이걸 한 픽스처럼 서술했다.

**(a) `src/content/scroll-capture.ts`** — `settle()`(`:90-110`)이 `done = true`(`:92`)와 `clearTimeout(fallback)`(`:93`)을 세운 **뒤** `mergePositionedCandidates`(`:98`)/`hideRepeatedElements`(`:104`)를 부르고 마지막에 `resolve`(`:109`)한다. 중간에 throw하면 `done`은 이미 true이고 폴백 타이머도 이미 해제돼 rAF·fallback 어느 쪽도 재진입 못 하고 `resolve`가 영영 안 불린다. **이 throw는 rAF 콜백 안**(`:111`)이라 promise가 reject되지도 않는다 — 즉 아래 (b)의 rejection 핸들러로는 **절대** 안 잡힌다.

```ts
const settle = () => {
  if (done) return;
  done = true;
  if (fallback) clearTimeout(fallback);
  try {
    if (hideFixed) { /* 기존 그대로 */ }
  } catch {
    // 후보 수집 실패는 타일 품질 문제이지 캡처 중단 사유가 아니다 — 삼키고 진행한다.
    // 이 파일엔 로거가 없다(import 3개뿐) — 로거를 들이면 새 의존성이라 삼키는 사실만 주석으로 남긴다.
  }
  resolve({ y: window.scrollY });
};
```

**(b) `src/content/picker.ts:316`** — `void scrollCaptureTo(...).then(sendResponse)`이고 `return true`가 `:317`이다. reject 시 `sendResponse` 미호출 + 채널이 열린 채라 사이드패널 `await deps.send(...)`가 안 풀린다.

```ts
void scrollCaptureTo(scrollSession, msg.y, msg.hideFixed)
  .then(sendResponse, () => sendResponse(undefined));
```

`undefined`를 보내는 게 핵심이다. 성공한 척 ack를 지어내면 스크롤 안 된 화면이 성공으로 스티치되므로 절대 `{y:...}`를 만들지 않는다.

**(c) `src/sidepanel/scroll-capture.ts:81` — shape 가드 추가.** 원안은 "오케스트레이터가 이미 `if (!ack) throw`를 갖고 있어 기존 계약을 그대로 탄다"고 했는데 **그 전제가 틀렸다.** `picker.ts:344-347`의 switch 전역 catch가 `sendResponse({ok:false, error})`를 보내고 이건 **truthy**라 `!ack`를 통과한다 → `ack.y === undefined` → `scroll-capture-plan.ts`의 `tilePixelRect`가 `NaN`을 내고 → `drawImage(img, 0, NaN, …)`는 스펙상 **무음 no-op** → **빈 밴드가 있는 스크린샷이 성공으로 스티치된다.**

저장소는 이 함정을 이미 알고 있다 — 6줄 위 형제 호출이 `if (!begun?.viewport) throw`이고 `:58-61` 주석이 "content가 throw하면 `{ok:false}` 응답이라 truthy — metrics 유무로 판정해야 한다"고 못박았다. 같은 판정을 쓴다:

```ts
// content가 동기 구간에서 throw하면 전역 catch가 {ok:false}를 보내고 그건 truthy다 —
// begin 경로가 이미 viewport 유무로 판정하는 것과 같은 이유로 shape을 본다.
if (!ack || typeof ack.y !== "number") throw new Error("scroll capture unavailable");
```

> `sendResponse(undefined)`는 Chrome 직렬화 경계를 지나면 통상 **`null`로 관측**된다. `!ack` 판정엔 무해하나 `=== undefined`를 쓰면 깨진다. 부수로 `picker-control.ts:106-119`의 `send`가 `catch { return undefined }`로 `lastError`를 지워 **포트 닫힘과 의도적 `undefined`가 구별 불가**하다 — G1엔 무해(둘 다 "중단")하지만 그래서 새 경로는 실 전송로로 테스트할 수 없고 판별은 호출부의 명시적 shape 검사에 둬야 한다.

**#11 — `src/content/picker.ts`의 무보호 async IIFE는 2곳이 아니라 3곳이다.**
`grep -c "void (async () =>" src/content/picker.ts` → **4**: `:142`·`:239`·`:1181`·`:1216`. `:239`만 내부 `try/catch`로 보호되고 **`:1216`이 감사가 놓친 세 번째 무보호 IIFE**다(`ensureCssCacheLoaded`+`ensureCrossOriginLoaded` await, catch 없음, `selectionUpdateTimer` 경로). 셋 다 `.catch(() => {})`를 붙인다 — 같은 파일 `respondAfterPaint`(정의 `:369`, `.catch` `:380`)·`area-select.ts`(`.catch` `:42`)가 지배 패턴이다. 보강 실패는 인스펙터 값이 덜 풍부해질 뿐 캡처를 막지 않으므로 삼키는 게 맞고, 삼킨다는 사실을 주석으로 남긴다.

**#7 — `src/content/css-source-cache.ts:57`(`ensureLoaded`)·`:1013`(`ensureCrossOriginLoaded`)**
실패한 promise가 그대로 캐시돼 세션 내내 같은 rejection을 반환하고 `isReady`가 영영 안 선다. 실패 시 슬롯을 비운다.

```ts
export function ensureLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  const started = epoch;
  const controller = new AbortController();
  loadAbortController = controller;
  const p = loadAll(started, controller.signal).then(() => {
    if (isStaleLoad(started)) return;
    isReady = true;
  });
  // 실패한 promise를 캐시에 남기면 다음 요소 선택도 같은 rejection을 받는다 — 재시도 가능하게 비운다.
  loadPromise = p.catch((err) => {
    if (loadPromise === p) loadPromise = null;
    throw err;
  });
  return loadPromise;
}
```

`ensureCrossOriginLoaded`도 같은 형태. **주의**: `invalidate()`(`:85-90`)가 이미 `loadPromise = null`을 하므로, 위 catch가 `loadPromise === p`를 확인하지 않으면 invalidate 뒤 새로 깔린 promise를 지운다. `epoch`·`isStaleLoad`·`loadAbortController`·`isReady`는 **이미 존재하는 것들**이다(위 스니펫이 신규처럼 보이지만 아니다) — epoch·stale 판정 로직엔 손대지 않는다.

### G2. 마스킹 게이트 우회 — #12

**`src/content/action-recorder-helpers.ts`** (G0이 이관을 끝낸 뒤)
`el.getAttribute("aria-labelledby")`(`:263`)는 공백 구분 **ID 리스트**인데 통째로 `getElementById`(`:265`)에 넘긴다. WAI-ARIA에서 다중 참조는 권장 패턴이라 실제 폼에서 흔하다.

```ts
const labelledBy = el.getAttribute("aria-labelledby");
if (labelledBy) {
  // 공백 구분 다중 ID가 정상 문법이다 — 통째로 넘기면 항상 null이고, 그러면
  // shouldMaskField의 라벨 근거가 사라져 민감 필드가 원문으로 로그에 실린다.
  const ref = labelledBy
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => cleanText(document.getElementById(id)))
    .filter(Boolean)
    .join(" ");
  if (ref) return ref;
}
```

`document` 의존을 인자로 받지 말 것 — jsdom 트랙(`*.test.tsx`)이 실제 DOM으로 다중 ID를 재현하므로 인자 주입은 요청되지 않은 유연성이다.

**스코프 밖으로 남기는 잔여 비대칭 2건** (다음 배치 후보로 기록):
- `rawFieldLabel`(`action-recorder.ts:196-210`)·`rawAccessibleName`(`:170-190`)은 `aria-labelledby`를 **아예 안 읽는다**. POSTMORTEM 2026-07-14 재발방지 (2)가 "마스킹 판정 소스는 라벨 추출 소스와 같아야 한다"를 요구하는데 이 배치는 판정 쪽만 넓힌다.
- `document.getElementById`는 shadow DOM 타깃(`composedPath()`로 들어온다 — `:452`·`:475`·`:539`)에서 틀린 트리를 본다. `el.getRootNode()`가 정답이고 `:386`도 같은 문제다. iframe은 프레임별 인스턴스라 전역 `document`가 맞다.

### G3. user gesture 소실 — #6

**`src/sidepanel/tabs/PreviewPanel.tsx:293`**(`handleCopyMarkdown`)
첫 await가 `resolveSectionImages`(IndexedDB 왕복, `:294`)다. 인라인 이미지가 많으면 그 왕복 동안 창 포커스가 빠져 `clipboard.write`가 무음 실패하고, 폴백 `writeText`도 같은 조건을 쓰므로 함께 죽는다.

> **원인 서술 정정**: 원안은 "5초 transient activation 창"이라 했지만 Chrome은 clipboard write에 user activation을 요구하지 않는다(`crbug 40846300`, w3c/clipboard-apis#182). 실게이트는 `ClipboardPromise::ValidatePreconditions`의 `hasFocus()`다. 리팩터의 이득은 그대로다 — **포커스 검사를 클릭 순간으로 당긴다**.

**현재 코드가 이미 하고 있는 것을 지우지 않는다.** `:378-388`은 **이미** `ClipboardItem`으로 `text/plain` **+ `text/html`** 두 flavor를 쓰고 `catch { await navigator.clipboard.writeText(md) }` 폴백을 갖고 있다. 단일 flavor로 바꾸면 Jira·Notion·Asana에 붙여넣을 때 헤딩·스타일 diff 표·`<img>`가 전부 사라진다 — 동작 보존을 기본값으로 선언한 배치의 사용자 노출 회귀다.

```ts
const handleCopyMarkdown = () => {
  // 두 flavor를 하나의 공유 promise에서 파생시킨다 — 따로 만들면 IDB 왕복이 2회다.
  // write를 제스처 시점에 동기로 걸어야 hasFocus() 검사가 클릭 순간에 통과한다.
  const built = buildForCopy(); // Promise<{ md: string; html: string }>
  return navigator.clipboard
    .write([
      new ClipboardItem({
        "text/plain": built.then((b) => new Blob([b.md], { type: "text/plain" })),
        "text/html": built.then((b) => new Blob([b.html], { type: "text/html" })),
      }),
    ])
    .catch(() => built.then((b) => navigator.clipboard.writeText(b.md)));
};
```

기존 본문 조립(`resolveSectionImages` → 모드별 `buildMarkdownContext` → `buildIssueMarkdown`/`buildIssueHtml`)은 `buildForCopy(): Promise<{md, html}>`로 **그대로 들어낸다**. 로직 변경 없음. **폴백이 `built`를 참조**하는 게 핵심이다 — `md`를 deferred promise 안에서만 만들면 `catch` 스코프에 없어 폴백이 컴파일조차 안 된다.

**위험**: promise-valued `ClipboardItem`은 **Chrome 98+**(원안의 "Chrome 66+"는 오류다. `ClipboardItem` 자체가 76+), `minimum_chrome_version: 116`이라 안전하다. Promise가 reject되면 `write` 전체가 reject되고 그 태스크의 클립보드 트랜잭션이 닫히므로 **뒤이은 `writeText`는 gesture 지원을 못 받는다** — 위 `.catch`는 "write가 지원 안 되는 브라우저" 경로용이고 "본문 조립 실패" 경로에선 둘 다 실패한다. 현재 코드도 같으므로 실패 처리는 무변경이다(오늘 복사는 토스트·상태 표면이 아예 없다 — `IssuePreviewView.tsx:76-80,95`가 `void handleCopy()`로 부르고 rejection은 unhandled다).

**그물**: jsdom에 `ClipboardItem`이 없어 컴포넌트 테스트로는 못 잡는다. **유일한 실현 가능한 그물은 e2e 스텁 확장**이다 — 기존 3개 스펙(`freeform-draft.spec.ts:43-48`·`issue-body-locale.spec.ts:55-62`·`code-block-collapse.spec.ts:42-47`)이 `getType("text/plain")`만 읽으므로 **`getType("text/html")` 검증을 추가한다.** 안 하면 `text/html` 소실이 green으로 머지된다.

### G4. 🔴 비활성 이유 미노출 — #1

**`src/sidepanel/tabs/IssueCreateModal.tsx:495-499`**
`disabled={!canOpen}`(`:497`) + native `title={tooltip}`(`:499`). shadcn `Button` base가 `disabled:pointer-events-none`(`components/ui/button.tsx:8`)이라 hover가 죽어 툴팁이 **절대** 렌더되지 않는다. `tooltip` 변수는 `:489-491`, `canOpen = available.length > 0`은 `:488`.

정규 선례는 `IssueTab.tsx:368-389`다 — `TooltipProvider delayDuration={0}` → `Tooltip` → `TooltipTrigger asChild` → `Button aria-disabled` → `onClick`에 가드 → `{x && <TooltipContent>}`. 상위에 `TooltipProvider`가 없으므로(App.tsx에 Provider 0건) 이 자리에 직접 둔다.

**className은 선례를 그대로 복사하지 않는다.** 선례는 `variant="outline"`(base `bg-background`)이라 `aria-disabled:hover:bg-background aria-disabled:hover:text-foreground` 2종이 **outline의 `hover:bg-accent`를 되돌리기 위한 변종 종속 코드**다. 대상 버튼은 **default(primary)**로 `bg-primary hover:bg-primary/90`이라 그 2종을 얹으면 비활성 제출 버튼이 hover에서 **배경색으로 하얗게 뒤집힌다**. `DESIGN.md:311`의 정본이자 실측 지배형은 2종이다:

```tsx
className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
```

**추가 지시 3개**:
- **`title={tooltip}`을 제거한다** — Radix 툴팁과 native OS 툴팁이 이중으로 뜬다. 선례엔 `title`이 없다.
- `TooltipContent`에 `max-w-60`을 준다 — 400px 패널이고 같은 저장소 선례가 있다(`StyleEditorPanel.tsx:562`).
- `aria-disabled={!canOpen}`를 **실 boolean으로** 넘긴다 — 활성 시 `"false"`가 렌더돼 Playwright의 조상 탐색을 끊는다. 그래야 이 testid를 클릭하는 5개 스펙이 안전하다.
- `data-testid="issue-submit-open"`(`:496`)은 유지 — e2e 6곳이 잡고 있다. `onboarding.spec.ts:109`의 `toBeDisabled()`는 Playwright ^1.60의 `getAriaDisabled`가 `aria-disabled="true"`를 인정하므로 통과한다. 다만 `e2e/COVERAGE.md:59`의 "disabled 공존" 문구가 stale이 된다.

### G5. 응답 계약 — #2 #3 #4

**`src/background/oauth.ts:43-60`(`serializeOAuthError`)** — fallthrough(`:59`)가 `401 + oauthRefreshFailed`다. 이 함수는 `cancelled`(`:47`)/`notConfigured`(`:52`)/`launchFailed`(`:56`) 셋을 401 레인에서 빼내지만, 그 밖의 `OAuthError`(state mismatch·code 부재·토큰 저장 실패·Slack user token 부재 등 **최초 연결 단계** throw 전부)가 기본값으로 떨어져 `oauthRefreshFailed`를 달고 나간다. 사이드패널은 그걸 보고 `onOAuthExpired`를 발화해 **연동한 적 없는 사용자에게 "세션 만료" 배너**를 띄운다.

`oauth/errors.ts:60-63` 주석이 이미 "근본 해법은 401 기본값을 뒤집는 것"이라 적고 미뤄둔 상태다. 해법:

```ts
// 401 레인은 "토큰이 있었는데 갱신에 실패했다"만 탄다. 최초 연결 실패가 여기 섞이면
// 연동한 적 없는 사용자에게 재로그인 배너가 뜬다. 기본값이 아니라 명시 플래그로 판정한다.
if (error.refreshFailed) {
  return { status: 401, body: { oauthRefreshFailed: true, platform: error.platform } };
}
return { status: 400, body: { platform: error.platform } };
```

`OAuthError`에 `refreshFailed?: boolean`을 추가한다 — 기존 필드가 전부 options bag + `?? false`(`errors.ts:66-81`)이므로 그 패턴에 맞춰 `this.refreshFailed = options.refreshFailed ?? false`로 두고 **construction site는 안 건드린다**.

> **`oauthConnectFailed` 플래그는 만들지 않는다.** `oauth.ts:40-42` 주석이 "소비처 없는 reader를 늘리지 말 것"을 명시하고, 400은 이미 일반 실패로 처리된다. `oauthLaunchFailed`도 reader가 없는 선례다.

**태깅 지점을 사람 손 열거에 맡기지 않는다.** github/gitlab/linear/asana의 refresh는 **전부 `createRefreshRunner`의 `refreshHook` 호출(`:29`·`:41`)을 통과**하므로 그 두 지점 + jira 직접 경로(`oauth.ts:249-276`)만 태깅하면 열거 대상이 20여 곳 → **3곳**으로 줄어든다. 누락은 `background/__tests__/connect-reason-coverage.test.ts` 패턴의 **소스 전수 스캔 규칙**으로 잠근다 — 그 파일 주석이 "여기서 막아야 할 건 로직이 아니라 호출부 누락이므로 원문 전수 대조로 잠근다"고 적었고 `HTTP_LANE`이 이미 `token(Exchange|Refresh)`를 매칭하므로 델타가 작다.

**경계가 갈리지 않는 지점 2건 — 이게 위험 ⑥의 실체다:**
- **`createRefreshRunner.ts:44`의 단일 throw가 최초 연결 401과 refresh 소진을 공유한다**(그 파일 `:42-43` 주석이 명시). 여기 무조건 플래그를 세우면 고치려던 🔴이 그대로 남는다 → **레인을 갈라야 한다**: 저장된 토큰이 있었는지(refresh 시도였는지)를 runner가 알고 있으므로 그 조건으로 분기한다.
- **`notion-api.ts:80`은 refresh 함수가 없는데 401 fallthrough에 의존한다** — 파일 주석이 "refresh가 없으므로 즉시 재인증으로 안내"라고 못박았다. 반전 후 Notion 권한 박탈이 400으로 내려가 안내가 사라진다 → 이 경로는 `refreshFailed: true`로 명시 태깅한다(notion/clickup/slack엔 refresh 함수가 없다).
- `oauth.ts:277-285`의 `persistOAuthTokens`는 최초 연결·refresh 양쪽에서 불린다 → **최초 연결 레인(400)** 으로 보낸다. 저장 실패는 재로그인으로 풀리지 않는다.

**`src/background/notion-oauth.ts:72`(`exchangeCode`)** — `res.ok`(`:82`)만 보고 본문 `error` 필드를 안 본다. 200 + `{error: "invalid_grant"}` 본문이면 `access_token: undefined`가 저장으로 흘러가고 `classifyConnectReason`이 `other`로 뭉갠다.

**갭은 1건이 아니라 2건이다** — 원안은 "프록시 경유 6종 중 유일한 이탈"이라 했지만 **`oauth.ts:196`(jira `exchangeCodeForTokens`)도 `res.ok`만 본다.** 둘 다 고친다. 형제 5종(`github`·`gitlab`·`linear`·`asana`·`clickup`)이 `if ("error" in data && data.error)` + `grantRejection(is<X>CancellationCode(...))` 형태를 쓰므로 그 관용구를 복사한다(slack은 `if (!data.ok)`로 형태가 또 다르다 — 참조하지 않는다).

> **기존 그물이 red가 된다.** `connect-reason-coverage.test.ts:65-79`가 `GRANT_LANE_FILES` 6개를 **집합으로 고정**(`expect(owners).toEqual(GRANT_LANE_FILES)`)하고 주석에 "200+본문 error 레인은 6개 파일에만 있다 — jira·notion은 그 분기 자체가 없다"고 박아뒀다. 두 파일을 추가하면 `owners`가 8개가 되어 `:78`이 red다 → **`GRANT_LANE_FILES`와 그 주석을 함께 갱신**한다.

**`src/background/messages.ts:492`(gitlab)·`:573-577`(asana)·`:647`(clickup) + `github-upload.ts:139`** — 업로드 결과가 판별자 없이 nullable 필드 truthiness로 성공/실패를 가른다. 같은 파일의 Slack 경로만 named type `{filename, ok}`(`src/types/slack.ts:56-59`)를 쓴다.

**형태**: github+gitlab+clickup은 `prepareUpload.ts:35`가 이미 정본(`{filename, href: string|null}`)을 갖고 있고 gitlab이 이미 `href: r.url ?? null`로 적응 중이라 셋이 그쪽으로 수렴한다. asana만 `gid`+`viewUrl`이 필요하고 slack은 locator가 없다.

```ts
type UploadFileResult =
  | { ok: true; filename: string; href: string }
  | { ok: false; filename: string };
// asana는 { ok: true; filename; gid; viewUrl? } | { ok: false; filename }
```

**결정적 주의 — "타입부터 바꾸면 컴파일러가 소비처를 전부 짚어준다"는 거짓이다.** `handleMessage`는 `Promise<unknown>`(`messages.ts:201-204`)을 반환하고, `sendBg<T>`(`src/lib/bg-client.ts:17`)의 `T`는 **호출자가 주장하는 단언**이라 핸들러와 대조되지 않으며, `src/types/messages.ts`엔 **요청 타입만** 있고(union `:117-237`) 응답 타입은 봉투(`:253-254`) 하나뿐이다. **typecheck는 어느 쪽을 바꿔도 green이다.**

그래서 게이트를 셋 둔다:
1. **양단을 함께 명시** — 핸들러 반환에 `): Promise<UploadFileResult[]>` annotation을 **붙이고**(그래야 컴파일러가 production 쪽을 본다) 각 소비처의 `sendBg<UploadFileResult[]>`도 같이 바꾼다. **둘 다 필요하다** — 한쪽만 바꾸면 다른 쪽은 조용히 남는다.
2. **목을 갱신** — `submitTo*.test.ts` 10개가 `sendBg`를 spec별로 mock하므로(`submitToGitlab.test.ts:55,97,128,…`) 목 반환을 새 형태로 바꾸지 않으면 **구 형태로 계속 green**이다. 4플랫폼 × 성공/실패 8분기를 여기서 박는다 — **이게 유일한 실질 그물이다.**
3. 소비처 손감사 목록을 태스크 결과에 적는다: `prepareUpload.ts:50,92-93,111-114` · `submitToGitlab.ts:38-43,82-89` · `submitToAsana.ts:46,181-199` · `submitToGithub.ts:33-38` · `submitToClickup.ts:90-105,113` · `submitToSlack.ts:76-83`.

### G6. 번들 경계 — #8 #9

CLAUDE.md의 "store는 `sidepanel/tabs`를 import하지 않는다 / 사이드패널·store는 `@/background/*`를 value import하지 않는다"와 같은 축이다. 이 경계는 **typecheck도 테스트도 안 잡는다**.

**`src/store/editor-store.ts:16`** — `DEFAULT_COLOR`·`DEFAULT_THICKNESS`·`ThicknessKey`를 `@/sidepanel/components/annotation/presets`에서 value import. 그 파일은 지금은 React-free(84줄, 유일한 import가 type-only `TranslationKey`)지만 `components/` 트리에 있어, 누군가 거기에 컴포넌트를 하나 추가하는 순간 store가 React 그래프를 끈다(store는 background 번들에도 들어간다).

**해법**: `presets.ts`를 통째로 옮기지 않는다(`AnnotationTool` 등 UI 타입도 들고 있고 소비처가 4곳이다). **store가 실제로 쓰는 값 2개 + `ThicknessKey` 타입만** `src/sidepanel/lib/annotationDefaults.ts`로 승격하고, `presets.ts`가 거기서 re-export한다. 기존 소비처는 안 건드린다.

> `editor-store.ts:19`의 `@/sidepanel/recorder-control` import는 **위반이 아니다** — 그 파일이 `:3-4` 주석대로 이미 분리된 leaf다. 건드리지 않는다. 같은 파일 `:13 initialJiraFields`·`:15 attachmentLimits`도 같은 경계를 넘지만 `sidepanel/lib`은 CLAUDE.md가 승격 목적지로 지정한 곳이라 의도된 것이다.

**`src/store/issues-store.ts:8`** — `clearPicker`를 `@/sidepanel/picker-control`에서 value import. 그 모듈은 `@/store/editor-store`(`:3`)·`@/store/settings-ui-store`(`:4`)·`resolveDark`·`capture-basis`를 끈다(순환).

**진짜 블로커는 store 의존이 아니다.** `clearPicker`(`picker-control.ts:290-293`)는 store를 **읽지도 쓰지도 않는다** — 원안의 분기 기준("store를 읽으면 대안 B")은 통과한다. 문제는 본문이 `tabFrameTokens.delete(tabId)` + `sendAll(...)`이고, `tabFrameTokens`(`:145`)는 `isCurrentPickerSession:148`·`newFrameToken:153`·`currentOrNewFrameToken:158`·`stopPicker:254`·`restartPickerInFrame:303,307`이 **함께 쓰는 module-level Map**이라는 것이다. `picker-clear.ts`가 자기 Map을 갖게 되면 **다른 Map을 지운다** — typecheck·테스트 모두 green인 채로, `clearPicker` 뒤에도 `picker-control` 쪽 토큰이 살아 `restartPickerInFrame`이 방금 정리한 프레임에 `picker.start`를 재주입한다(유령 blocker가 페이지 클릭을 먹는다).

**해법**: `tabFrameTokens` + `sendAll` + `clearPicker`를 **함께** `src/sidepanel/picker-clear.ts`로 내리고 `picker-control.ts`가 그걸 import한다(leaf가 상태를 소유 → Map 1개). `sendAll`은 `chrome.tabs.sendMessage`만 만지므로 `issues-store`가 store·`resolveDark`·`capture-basis` 그래프를 끊는 목적은 그대로 달성된다. `picker-control.ts`는 `clearPicker`를 re-export해 기존 호출부 28곳(9파일)을 안 건드린다.

**부수 발견**: `stopPicker`(`:253-256`)가 `clearPicker` 본문을 바이트 단위로 복제하고 있다 — G6가 여는 파일 안의 G7급 중복이지만 **이번 배치에선 사실만 기록**한다(외과적 변경).

**커버리지 등록 필수**: `picker-control.ts`는 `coverage-report.mjs`의 `BROWSER_BOUND_EXACT`(`:52`)에 등재돼 로직 분모에서 빠져 있다(1.8%). 새 `picker-clear.ts`는 미등록이라 `isBrowserBound()` 4규칙 어디에도 안 걸려 **로직 스코프에 ~0%로 편입**되고, 소비처가 전부 `vi.mock`이라 커버가 안 올라간다 → prd 성공기준 5를 자기 손으로 깬다. **`BROWSER_BOUND_EXACT`에 추가한다.**

### G7. 단일 출처 통합 — #22 #23 #25 #30 M1

다섯 건 다 **이미 값이 갈렸거나 갈릴 준비가 된** 복제다. POSTMORTEM 2026-07-16("팔레트를 단일 출처로 승격했다는 주석·커밋 메시지가 거짓인 채 머지됨 — 복제본이 그대로 남아 있었다")이 이 그룹의 경고문이다.

**#23 `escapeHtml`** — 구현이 정확히 2벌이고 **차이는 `'` 하나뿐**이다. `sidepanel/lib/escapeHtml.ts:3`이 `& < > "` 4문자, `content/overlay.ts:685`가 거기에 `'` → `&#39;`를 더한다. 정본 파일 헤더가 "세 벌로 흩어져 있었고 그중 한 벌만 `"`를 빠뜨려 주입 직전까지 갔다"고 못박은 바로 그 패턴의 재현이다.

**해법**: 정본을 `src/lib/escapeHtml.ts`로 승격하고 양쪽이 import한다. content가 `@/lib/`를 끄는 건 이미 확립된 경로다(`css-source-cache.ts:15`·`css-resolve.ts:16`·`overlay.ts:1`·`picker.ts:79`가 이미 그렇게 한다). **pre-arm 제약과 무관하다** — 그 제약은 `recorders-entry` 청크(레코더 전용 4모듈: `log-throttle`·`recorder-globals`·`sentinel-registry`·`recorder-prearm`)에만 걸리고 `overlay.ts`는 picker 청크다.

**동작 통일 방향은 `'`를 빼는 쪽(narrowing)이다.** 원안은 "넓히면 안전"이라 했지만 실측이 반대를 가리킨다:
- `overlay.ts`에 **단일인용 속성이 0건**이다(`grep -n "='"` → 0). 유일한 속성 보간이 `:705 style="background:${escapeHtml(swatch)}"`로 이중인용이라 `'` 이스케이프가 **방어적으로 불필요**하다. 나머지 출력은 shadow DOM label의 element content라 `'`/`&#39;` 렌더가 동일하다.
- 반대로 **넓히면 정본 출력이 모든 아포스트로피에서 바뀐다** — `buildIssueHtml` → 클립보드 `text/html`(`PreviewPanel.tsx:379`)·`logs.html`(`buildReportData.ts:81`)·Asana `html_notes`(`markdownToAsanaHtml.ts`)·라이브 프리뷰(`renderMarkdown.ts:11`) **4개 실제 산출물의 바이트**가 움직인다. 그물은 0이다(골든 스냅샷에 `'` 0건, `escapeHtml.test.ts` 4케이스에 `'` 없음, `text/html`을 검사하는 e2e 0).
- `markdownToAsanaHtml.ts:227-229`의 `escapeAttr` 주석이 이미 "`escapeHtml`이 `"`까지 처리하므로 속성용 추가 치환이 필요 없다"고 판단을 기록해 뒀다.

**즉 overlay를 정본 4문자에 맞춘다.** 출력 변화 0, 테스트 수정 0. 결정을 못 박기 위해 `escapeHtml.test.ts`에 **`'`가 이스케이프되지 않는다는 케이스를 명시적으로 추가**한다(다음 배치가 같은 계산을 반복하지 않게).

**#22 `imageCell` 3벌** — `buildMarkdownIssueBody.ts:45`·`buildClickupIssueBody.ts:35`·`buildLinearIssueBody.ts:32`. **셋 다 escape가 없고** url 프로퍼티명만 다르다(`url`/`url`/`assetUrl`). 드리프트는 3벌 사이가 아니라 **파일 내부**에 있다 — 같은 `buildMarkdownIssueBody.ts`의 `defaultVideoEmbed:51`·첨부 라인 `:202`/`:206`은 `escapeMdLinkText`를 쓴다.

**해법**: `sidepanel/lib/issueBodyShared.ts`(audit-refactor-6 G2가 만든 공용 leaf)에 url을 **인자로 받는** 형태로 올린다 — 미디어 타입 3종을 leaf가 알면 빌더를 되참조해 순환이 된다(그 파일 `:8-10` 주석의 `LogSummaryContext` 선례).

**순환을 만들지 않으려면 `escapeMdLinkText`도 함께 내려야 한다.** 그 함수는 지금 `buildIssueMarkdown.ts:223`에 있고 `buildIssueMarkdown.ts:19`가 `issueBodyShared`를 import한다 → leaf가 그걸 부르면 **`issueBodyShared → buildIssueMarkdown → issueBodyShared` 순환**이다(그 파일 헤더가 금지한 형태 그대로). `escapeMdLinkText`를 `issueBodyShared.ts`로 옮기고 `buildIssueMarkdown.ts`가 re-export한다(기존 소비처 무변경).

```ts
export function imageCell(filename: string, url: string | undefined): string {
  if (!url) return "";
  return `![${escapeMdLinkText(filename)}](${url})`;
}
```

호출부는 `media ? imageCell(media.filename, media.url) : ""` / linear는 `media.assetUrl`. (원 시그니처는 현행 `media | undefined` 가드를 표현하지 못한다 — 가드를 호출부로 올린다.)

**`escapeMdLinkText` 편입은 동작 변경이지만 골든 스냅샷으로는 확인할 수 없다** — 아래 위험 ③.

**#25 `MarkdownIt` 설정 4벌** — `markdownToAdf.ts:19`·`markdownToNotionBlocks.ts:7`·`markdownToAsanaHtml.ts:10`·`renderMarkdown.ts:16`이 `{html:false, breaks:true, linkify:true}`를 각자 반복하고 **넷 다 다음 줄에서 `md.enable("strikethrough")`를 부른다**. `renderMarkdown`만 `highlight: highlightJson`이 추가로 붙는다.

**해법**: `src/sidepanel/lib/markdownIt.ts` 신설.

```ts
// 4개 플랫폼 파서가 같은 설정을 각자 반복하면 한 곳만 바뀌었을 때 본문 파싱이 조용히 갈린다.
export function createMarkdownIt(options?: MarkdownIt.Options): MarkdownIt {
  const md = MarkdownIt({ html: false, breaks: true, linkify: true, ...options });
  md.enable("strikethrough"); // 4곳 전부 이걸 불렀다 — 빠뜨리면 넷 다 회귀한다.
  return md;
}
```

각 파일은 `const md = createMarkdownIt()` / `createMarkdownIt({ highlight: highlightJson })`. **인스턴스는 파일별로 유지한다** — 공유 인스턴스로 만들면 한 파일이 `md.use(plugin)`을 부르는 순간 나머지 셋이 영향을 받는다(현재 `.use()`/`.disable()`은 0건이지만 결합을 만들 이유가 없다).

> **`builderLocaleWrap.test.ts`에 아무것도 등록하지 않는다.** 원안은 "면제 분류에 등록해야 한다"고 했지만 그 테스트의 대상 집합은 `IMPORTS_T`(`:13`)로 걸러진 **`import { t | dateBcp47 } from "@/i18n"` 파일들**이고 완결성 검사(`:83-85`)도 그 집합만 본다. 파서 팩토리는 `t`를 안 쓰므로 애초에 대상이 아니다. 반대로 `EXEMPT`(`:37-43`)에 넣으면 **유령 항목 검사(`:87-88`)에 걸려 red**다. 증거: `escapeHtml.ts`·`renderMarkdown.ts`·`markdownToAsanaHtml.ts`가 지금 두 목록 어디에도 없고 스위트는 green이다. `annotationDefaults.ts`도 동일하다.

**#30 frozen phase 3벌** — `lib/session-keys.ts:42-46`의 `FROZEN_PHASES`(`ReadonlySet<string>`, 단일 출처. background `tab-bindings.ts:1→:80`·`log-merge.ts:5→:134`가 사용) + `useEditorSessionSync.ts:47`의 로컬 `DRAFT_PHASES` + 같은 파일 `:270-272`의 인라인 재열거(자기 상수조차 안 쓴다). **세 집합의 원소가 동일**해 동작 버그는 아니지만, phase를 추가하면 background 보존 판정과 사이드패널 picker clear가 무음으로 갈린다.

**해법**: `DRAFT_PHASES` 삭제 + 인라인 재열거를 `FROZEN_PHASES.has(phase)`로 치환. `useEditorSessionSync.ts:2`가 이미 `@/lib/session-keys`를 import하므로 방향 문제 없다. **`ACTIVE_CAPTURE_PHASES`(`:50`)는 건드리지 않는다.**

**M1 `ActionLogContent` 톤 드리프트**(회고 이월) — `src/sidepanel/components/ActionLogContent.tsx:91,97`의 `text-sky-600`·`text-red-700`이 `@/lib/log-colors`의 `TONE_TEXT`와 갈려 있다. 같은 파일 `:69`는 이미 `TONE_TEXT.blue`를 쓴다. `docs/POSTMORTEM.md:143`이 이월로 남긴 항목이고 목표 6에 정확히 해당한다. `TONE_TEXT`로 수렴하되 **색 값이 실제로 같은지 먼저 대조**한다 — 다르면 그건 동작(시각) 변경이므로 prd 노출 변화 표에 추가한다.

### G9. activation 큐 — #10

**`src/background/tab-bindings.ts`** — `activated` 셋의 write는 큐로 직렬화되지만(`:24 activatedWriteQueue`, `setActivated:26-35`) `apply()`(`:40-70`)의 read(`:41 getActivatedSet`)→`chrome.sidePanel.setOptions` 경로는 큐 밖이다. `onActivated`의 `apply`(`:310`)와 `onUpdated`의 `deactivatePanelIfCrossOrigin`(`:321`)이 `setOptions`를 역순으로 커밋하면 방금 닫은 패널이 잠깐 되살아난다. 다음 `apply`에서 자가 치유되므로 🔴이 아니다.

**해법**: `apply()`를 write와 같은 큐에 태운다. **실제 수정 지점은 `apply`(`:40`)와 큐 헬퍼(`:24-35`)다** — `:301-330`은 리스너 범위일 뿐이다.

**함정 4개**:
1. **재진입은 없다** — `apply()`는 `getActivatedSet()`만 읽고 `setActivated`를 부르지 않으며, `setActivated` 호출부(`:233`·`:268`·`:338`) 중 `apply`를 await하는 것이 없다. 원안이 지목한 유일한 함정은 깨끗하다.
2. **`activatedWriteQueue = task.catch(() => {})`(`:32`) 관용구를 반드시 재사용한다** — 안 쓰면 `apply` 한 번의 reject로 **이후 모든 activation write가 무음 사망**한다. P2 수정이 P0급 실패를 심는 경로다.
3. **`activateTab`(`:253-269`)의 gesture 경로 `setOptions`/`open`은 큐 밖에 유지한다** — 그 위 주석이 await 금지를 명시한다. 큐에 넣으면 사이드패널 열기가 증도로 막힌다.
4. **경합은 완전히 사라지지 않는다** — `activateTab:257-263`과 `deactivatePanelIfCrossOrigin:234`의 `setOptions`가 여전히 큐 밖이다. 유닛은 큐 내부 순서만 고정하므로 **green이 되면서 실경합이 일부 남는다**. 그 사실을 태스크에 적고 수동 확인을 로드베어링으로 삼는다.

부수: 탭 20개 동시 종료 시 `onRemoved`의 write가 대기 중 `apply` 뒤로 밀린다(허용 가능한 비용).

### G10. i18n 그물·문서 언어 — #13 #14 #15 #16

**#13 `src/sidepanel/index.html:2`** — `<html lang="ko">` 하드코딩이고 런타임 `documentElement.lang` 갱신 코드가 **0건**이다. en 사용자에게도 문서 언어가 한국어로 선언돼 스크린리더 발음·폰트 선택에 영향을 준다.

**해법**: html은 `<html lang="en-US">`(런타임 `BCP47.en`과 일치하는 값)로 두고, 로케일이 정해지는 지점에서 `document.documentElement.lang = BCP47[locale]`을 세운다. `BCP47`(`src/i18n/locales.ts:17-20`)은 **폴백 금지 테이블**이라 `Record<LocaleMode, …>`를 유지한 채 소비한다.

**호스트는 `useThemeEffect`가 아니라 형제 훅 `useDocumentLangEffect`를 신설한다.** `useThemeEffect.ts:5`가 `documentElement`를 만지는 건 맞지만(`:8`, `:14 classList.toggle("dark")`) 그 훅은 `theme` 단일 축만 구독하고 `system`일 때 `matchMedia` 리스너를 등록/해제한다(`:17-20`) — locale을 같은 훅에 넣으면 **로케일 전환마다 matchMedia를 재구독**한다. `settings-ui-store`가 `detectLocale`로 초기값을 주므로 hydration 게이트는 불필요하다.

> **`locale-registry.test.ts` 위반이 아니다.** 그 순수성 검사는 `locales.ts` **자신의 outgoing import가 0**인지만 본다(`import type`은 negative lookahead로 허용). 소비 방향엔 제약이 없고 `BCP47`은 이미 `i18n/index.ts:3`에서 value import된다.

부수: `index.html`을 `en-US`로 바꾸면 ko 사용자에게 마운트 전 짧은 오선언 구간이 생긴다(테마 flash와 동급, 수용).

**#14 `src/log-viewer/index.html:2`** — 반대 방향. `lang="en"` 고정인데 본문은 `detectLocale(navigator.language)`로 독자 언어를 따른다. log-viewer는 별도 빌드지만 `log-viewer/i18n.ts:3`이 이미 `../i18n/locales`를 상대경로로 끌고 있고 `main.tsx:10-15`에 `syncDarkClass` 선례가 있어 저비용이다.

**#15 `TimelinePanel.tsx:23` · #16 `markers.ts:147`** — 둘 다 log-viewer의 i18n 그물 사각이다. `log-viewer/__tests__/i18n.test.ts:111`의 스캐너 정규식이 `/\bt\(\s*["'`]([a-zA-Z][\w.]*)["'`]/g`라 **`t(` 직후 리터럴만** 잡는다. `FILTER_LABEL[filter]`(`:23`, `Record<TimelineFilter, string>`의 raw key 문자열 `:24-27`) 같은 테이블 조회와 `t(cond ? "a" : "b")` 삼항(`markers.ts:147`)은 안 보인다. 메인 번들은 `TranslationKey` union이 잡아주지만 복제 사전엔 그 게이트가 없다.

**해법**: 코드를 스캐너에 맞추는 쪽이 싸다(대안 E).
- **#15**: `FILTER_LABEL`을 지우고 렌더에서 4개 리터럴을 `t()` 인자로 직접 쓴다. **원안의 "log-viewer 사전 키 union으로 좁힌다"는 불가능하다** — log-viewer에 키 union이 없다(`i18n.ts:5-8`이 `key: string`, `koDict: Record<string, string>`이고 테스트가 `:207`·`:212`에서 `as any`로 캐스트 중이다). 만들려면 대공사다.
- **#16**: 삼항을 밖으로 빼서 `t()` 인자를 리터럴로 만든다 — `label = e.value === "checked" ? t("actionLog.verb.toggle.check", {field}) : t("actionLog.verb.toggle.uncheck", {field});`

두 수정 후 **스캐너가 실제로 그 키들을 잡는지** 확인한다 — 그 파일에 자기검증 앵커가 이미 둘 있다(`:120` 스캐너 도달 범위, `:195` 대조 교집합 비어있지 않음). 같은 방식으로 4+2 키가 `referencedKeys`에 들어오는지 앵커를 추가한다.

### G11. UI 패턴 이탈 — #17 #18 #19 #20

전부 **저장소 안에 정규 선례가 있는** 국소 수정이다. 새 패턴을 만들지 않는다.

| 항목 | 파일 | 선례 · 지시 |
|---|---|---|
| #17 빈 목록 분기 | `LinearStatusBadge.tsx:97` | `JiraStatusBadge.tsx:100-103`(`transitions.length === 0` → `px-3 py-2 text-sm text-muted-foreground` 안내). 신규 키 `issueList.linear.noStates` — 반경은 정확히 **2파일 3편집**(`i18n/namespaces/issue.ts` ko ~`:130` + en ~`:271`, 배지 `:98`). log-viewer 복제 사전(`issueList.*` 0건)·`public/_locales`(manifest 4키)는 **불필요**. **`:42`의 `.catch(() => setStates([]))` 때문에 조회 실패도 이 분기로 떨어진다** — 문구는 1개로 유지하되 그 사실을 태스크에 적는다(Jira `:100`·Notion `:103`도 같은 구조라 에러/빈목록 분리는 3곳 계열 변경으로 별건) |
| #18 `FieldRow` 손복제 | `notionFields/PropertiesFieldset.tsx:35` | `FieldRow`가 `grid gap-1.5` + `label text-xs text-muted-foreground`로 **바이트 동일**이라 drop-in. **`htmlFor`는 쓰지 않는다** — `PropertySelectCombobox` Props(`:20-24`)에 `id`가 없어 그대로 채우면 없는 id를 가리키는 label이 되고, `role="combobox"` 버튼은 accname이 contents 우선이라 `<label for>`가 이름을 못 준다. **저장소가 이미 이 결론에 도달해 `ariaLabel` prop을 쓴다**(`jiraFields/FieldCombobox.tsx:52-54` 주석 + `ProjectField.test.tsx:151-159`가 고정) → `PropertySelectCombobox`에 `ariaLabel`을 추가해 트리거 `Button`에 입힌다. 부수: 부모 `:29`가 `gap-3`인데 형제 폼은 `gap-4`(`NotionIssueFields.tsx:108`)라 이 행만 4px 좁다 — **같이 맞춘다** |
| #19 키보드 접근 불가 | `components/JsonTreeViewer.tsx:209` **+ `:246-252`** | `<div onClick>`/`<span onClick>`을 `<button type="button">`로. **쌍둥이가 둘이다** — `:209`의 "n개 더"와 `:246-252`의 `json.showAll`("모두 보기") 둘 다 키보드 접근이 0이므로 함께 고친다(하나만 고치면 한 컴포넌트 안에서 접근성이 갈린다). `aria-expanded`는 **붙이지 않는다**(disclosure가 아니라 다음 청크 추가라 상태 속성이 거짓말이 된다). 기존 className과 자리맞춤 `<span className="inline-block h-4 w-4 shrink-0" />`를 유지하되 **`w-full text-left`를 추가**한다(button은 `display:flex`를 줘도 shrink-to-fit이라 클릭 영역이 텍스트 폭으로 좁아진다). **기존 `JsonTreeViewer.test.tsx:20`("행에 임의 크기 클래스가 남지 않는다")이 red가 될 수 있다** — button은 UA font를 상속하지 않으므로 `font-[inherit]`·`text-inherit`이 필요한지 확인 |
| #20 muted 누락 | `settings/LlmConnectForm.tsx:81` | 실측 빈 상태 아이콘은 사이드패널 **18곳** + log-viewer 2곳이고 전부 `h-6 w-6 text-muted-foreground`(예외 0 — 원안의 "다른 6곳"은 과소 계수). `<Bot className="h-6 w-6" />` → `h-6 w-6 text-muted-foreground`. 검증 grep은 `settings/`가 아니라 **사이드패널 전역**으로 넓힌다. 부수 기록: `LlmOnboarding` 자체가 공용 `EmptyState`(`IssueTab.tsx:757-770`)의 손복제다(`mx-auto`/max-width 누락, `mt-5` vs `mt-4`) — #18과 같은 계열이지만 **이번엔 색만 고치고** 이행은 다음 배치 후보로 기록 |
| ~~#21~~ | `DESIGN.md` | **드랍**(prd "검수 드랍"). 대신 **DESIGN.md의 raw `<button>` 예외에 5번째 계열 "sticky 헤더의 클릭 가능한 제목"을 등재**해 항목 자체를 소멸시킨다. 현재 등재는 2계열(`:204` 입력 내 클리어 X, `:205` `TreeChevronButton`)뿐이고 design 원안이 인용한 "4계열"은 문서에 없었다 |

### G12. 잔여 — #32 #33 #34

**#32 `src/content/annotation.ts:251-268`** — `setAnnotationTool(tool, style)`의 `tool`이 `style.tool`과 완전 중복이고 **on/off 판별자로만 쓰인다**(`:256 tool === null || !style`). 실제 그리기 도구는 `style`에서 온다(`:264 handle.pen = style`).

**해법**: `setAnnotationTool(style: PenStyle | null)` 단일 인자로 좁힌다. `tool === null` 게이트는 `style === null`로 대체된다.

**호출부는 2곳이다**(원안은 "유일 호출부"라 했다): `picker.ts:328-333`(`msg.tool === null ? null : {...}`이라 동치)과 **`content/annotation.ts:186`(`setAnnotationTool(null, null)`)**. 메시지 형태(`annotation.setTool{tool, color, strokeWidth, opacity}`)는 **안 바뀐다**.

> **동명 심볼이 3개다** — `content/annotation.ts:251`(대상)·`sidepanel/annotation-control.ts:17`(메신저, `(tabId, tool, color, thickness)`)·`store/editor-store.ts:292`(store action). grep 검증 시 오탐 주의. 그리고 "어노테이션 on/off 유닛 무회귀"는 `editor-store.test.ts:247,1664-1684`로 해석되는데 그건 **store 사본**을 테스트한다 → 이 항목은 사실상 유닛 미커버이고 **수동 검증이 로드베어링**이다.

**#33 `src/background/lib/readErrorBody.ts`** — 8개 플랫폼 에러 직렬화의 공통 관문 순수 함수(13줄)인데 테스트가 0이다(소비처 5파일: `github-api.ts:120`·`jira-api.ts:142,155`·`clickup-api.ts:75`·`gitlab-api.ts:116`·`asana-api.ts:114`, 전부 기존 api 테스트 보유). CLAUDE.md "테스트 우선" 대상. `__tests__/readErrorBody.test.ts` 신설 — **4갈래**: JSON 본문 / 비-JSON 원문 / `res.text()` 자체 throw / **빈 본문**(`JSON.parse("")`이 throw해 `""`를 반환 — 원안의 3갈래에 없던 것).

**#34 import 경로** — 이탈 2건만 고친다.
- `src/background/lib/createRefreshRunner.ts:3` — background 내부에서 **유일하게** 자기 패키지를 `@/background/oauth/errors`로 되짚는다(grep 확인: 전 패키지에서 정확히 1건. 같은 심볼을 `oauth.ts:11`·`connect-tracking.ts:4`는 `./`). → 상대경로.
- `src/types/picker.ts:1-3` — types 17파일 중 **유일하게** 형제 3개를 `@/types/`로 부른다(정확히 3건). → 상대경로.

> **`createRefreshRunner.ts`를 G5(#2 태깅)와 G12(#34 경로)가 둘 다 고친다** — 그룹당 1커밋 정책과 충돌한다. **G5를 먼저** 하고 G12가 경로만 얹는다.

**sidepanel은 안 건드린다**(PRD 비목표). 대신 **이미 깨끗한 패키지에 신규 유입만 막는** 소스 스캔 테스트를 `src/lib/__tests__/import-convention.test.ts`로 둔다: `src/background`·`src/types`·`src/store`·`src/i18n` 내부 파일이 자기 패키지를 `@/<pkg>/`로 import하면 red.

**정의에 두 조건이 필요하다**:
1. **`__tests__` 카브아웃** — `store/__tests__/editor-store.test.ts:47,65,66,73`이 `vi.mock("@/store/…")`·`import("@/store/settings-store")`를 쓴다. `vi.mock`은 SUT와 같은 specifier여야 맞으므로 "상대경로로 고쳐라"가 정답이 아니다. `i18n/locales.ts:2`·`locale-registry.test.ts:202`의 주석 언급도 같은 이유로 제외한다.
2. **매칭은 `from "…"` 형태만** — `vi.mock`/동적 import/주석을 세면 그물이 아니라 오탐기가 된다.

**sidepanel은 검사 대상에서 뺀다**(혼용이라 즉시 red가 되고, 예외 목록을 박으면 그물이 아니라 장부가 된다 — 그 사실을 테스트 파일 주석에 남긴다).

> **파일명은 kebab-case다.** `src/lib/`은 모듈↔테스트 1:1 kebab-case 컨벤션이므로(`element-label.ts`·`named-colors.ts` …) `importConvention.test.ts`가 아니라 `import-convention.test.ts`이고, 승격하는 파일도 **`src/lib/escape-html.ts`**가 맞다(#23).

## 데이터 흐름

이 배치는 새 데이터 흐름을 만들지 않는다. 흐름이 **바뀌는** 곳은 셋이다.

**① 스크롤 캡처 실패 전파 (G1)**
```
(a) content: settle() 내부 throw
      → try/catch가 삼키고 resolve({y})          ← 신규 (기존: resolve 미호출 → 영구 대기)

(b) content: scrollCaptureTo reject
      → picker.ts: sendResponse(undefined)        ← 신규 (기존: 미호출 → 채널 열린 채)
      → sidepanel: deps.send resolves undefined/null

(c) content: 동기 구간 throw → 전역 catch가 {ok:false} 응답 (truthy!)
      → sidepanel: typeof ack.y !== "number"      ← 신규 (기존: !ack를 통과 → NaN → 빈 밴드 성공)

(b)(c) 공통 → scroll-capture.ts:81 throw → 캡처 실패 UI   ← 기존
```

**② OAuth 에러 레인 (G5)**
```
기존: OAuthError(무엇이든) → 기본값 401 + oauthRefreshFailed → onOAuthExpired(세션 만료 배너)
변경: OAuthError.refreshFailed === true → 401 + oauthRefreshFailed → onOAuthExpired
      그 외                            → 400 (플래그 없음) → 일반 연결 실패 처리
```
`refreshFailed`를 세우는 지점은 **3곳**: `createRefreshRunner`의 `refreshHook` 호출 2지점(단 최초 연결 레인과 갈라서) + jira `oauth.ts:249-276`. 추가로 refresh가 없는 `notion-api.ts:80`은 명시 태깅. 판독부(`bg-client.ts:41→:47→:30`)는 무변경.

**③ 클립보드 복사 (G3)**
```
기존: click → await resolveSectionImages(IDB) → … → clipboard.write([2 flavor])  (그 사이 포커스 상실 위험)
변경: click → clipboard.write([2 flavor, 값은 공유 Promise])                      (동기)
                            └→ 본문 조립은 Promise 안에서 진행
```

## 인터페이스 설계

```ts
// src/lib/escape-html.ts  (sidepanel/lib에서 승격 — G7 #23. 값 무변경: & < > " 4문자)
export function escapeHtml(s: string): string;

// src/sidepanel/lib/issueBodyShared.ts  (추가 — G7 #22)
export function imageCell(filename: string, url: string | undefined): string;
export function escapeMdLinkText(text: string): string;   // buildIssueMarkdown에서 이동(순환 회피)

// src/sidepanel/lib/markdownIt.ts  (신규 — G7 #25)
export function createMarkdownIt(options?: MarkdownIt.Options): MarkdownIt;

// src/sidepanel/lib/annotationDefaults.ts  (신규 — G6 #8)
export type ThicknessKey = "S" | "M" | "L";
export const DEFAULT_COLOR: string;
export const DEFAULT_THICKNESS: ThicknessKey;

// src/sidepanel/picker-clear.ts  (신규 — G6 #9. Map 소유권이 함께 이동)
export const tabFrameTokens: Map<number, string>;
export function sendAll(tabId: number, msg: PickerMessage): Promise<void>;
export function clearPicker(tabId: number): Promise<void>;

// src/sidepanel/hooks/useDocumentLangEffect.ts  (신규 — G10 #13)
export function useDocumentLangEffect(): void;

// src/content/action-recorder-helpers.ts  (추가 — G0 이관 + G2 확장)
export function labelForText(el: Element): string | undefined;
export function cleanText(el: Element | null): string | undefined;

// src/background/oauth/errors.ts  (필드 추가 — G5 #2)
export class OAuthError extends Error {
  refreshFailed: boolean;   // 신규 — options bag + `?? false` 기존 패턴에 맞춘다
}

// src/types/messages.ts  (응답 타입 신설 — G5 #4. 핸들러·소비처 양단에 명시해야 효과가 있다)
export type UploadFileResult =
  | { ok: true; filename: string; href: string }
  | { ok: false; filename: string };
export type AsanaUploadResult =
  | { ok: true; filename: string; gid: string; viewUrl?: string }
  | { ok: false; filename: string };

// src/content/annotation.ts  (시그니처 축소 — G12 #32. 호출부 2곳)
export function setAnnotationTool(style: PenStyle | null): void;

// src/sidepanel/components/PropertySelectCombobox  (prop 추가 — G11 #18)
interface Props { schema; value; onChange; ariaLabel: string }
```

## 기존 패턴 준수

- **테스트 우선** — 신규 인터페이스 전부 테스트 선행. 순수 함수는 `*.test.ts`(node), 렌더·DOM이 필요한 것(`labelForText`·`FieldRow` 이행·`aria-disabled` 툴팁·`documentElement.lang`)은 `*.test.tsx`(jsdom).
- **컴포넌트 테스트 3벌은 파일 신설** — `IssueCreateModal.test.tsx`·`LinearStatusBadge.test.tsx`·`useThemeEffect.test.tsx`(또는 `useDocumentLangEffect.test.tsx`)가 없다. prd 성공기준 7 참조.
- **i18n 동시 갱신** — 신규 키는 `issueList.linear.noStates` 1개뿐이고 `LOCALES = ["ko","en"]` 둘 다 갱신한다. `src/i18n/` Edit 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행하므로 red가 즉시 뜬다.
- **로케일 테이블 폴백 분류** — G10이 `BCP47`을 소비한다. 그건 **폴백 금지 5개** 중 하나라 `Record<LocaleMode, …>`를 유지하는 쪽으로만 쓴다.
- **본문 언어 전역 스왑** — G7이 `issueBodyShared.ts`를 건드린다. `builderLocaleWrap.test.ts`는 `t`를 import하는 파일만 보므로 `markdownIt.ts`·`annotationDefaults.ts`는 **어느 목록에도 등록하지 않는다**(위 G7 인용 박스).
- **pre-arm 청크 격리** — 레코더 전용 모듈은 **4개**다(`log-throttle`·`recorder-globals`·`sentinel-registry`·`recorder-prearm` — 세 레코더 모두 `./recorder-prearm`을 import한다). G7이 content에 `@/lib/escape-html`을 끄는 건 picker 청크라 무관하고, G0/G2의 `action-recorder-helpers.ts`는 이미 static import 중이라 **새 edge가 0개**다.
- **`chrome.scripting.executeScript({func})`** — 이 배치는 두 사용처(`github-upload.ts:pageBatchUploadFn`·`picker-control.ts:getTopViewport`)를 **건드리지 않는다**. G5가 `github-upload.ts:139`를 손대지만 그건 반환 타입이지 주입 함수(`:158`)가 아니다. 구현 중 주입 함수 본문에 손이 가면 그 순간 실탭 회귀가 필수가 되므로 **범위를 벗어난 것으로 보고 멈춘다**.
- **외과적 변경** — 각 그룹은 지정 항목만 고친다. 인접 코드가 눈에 거슬려도 안 고친다(발견한 것은 prd "검수 신설"·본문 "부수 기록"에 남긴다).

## 대안 검토

**대안 A — 71건을 한 배치에 전부 넣는다.** 기각. ⚪ 37건은 대부분 문서 등재·주석·미사용 export라 **검증이 "grep 0"으로 끝나는 것들**이고, 그게 28건의 실제 회귀 위험과 같은 PR에 섞이면 리뷰가 희석된다.

**대안 B — G6을 "store에서 상수를 인라인 복제"로 푼다.** 기각 — 값이 갈리는 순간 어노테이션 기본값이 UI와 store에서 달라지고, 그건 정확히 G7이 없애려는 종류의 드리프트다. (`clearPicker`가 store를 안 만지는 것이 확인됐으므로 이 대안이 필요한 조건 자체가 사라졌다.)

**대안 C — #34에서 sidepanel 전량을 `@/` 또는 상대경로로 통일한다.** 기각. POSTMORTEM 2026-08-15가 **정확히 이 혼용 때문에** 모듈 이동 반경을 79로 세고 실제 101을 놓친 전례를 기록하고 있어 동기는 충분하다. 그러나 수백 개 import 문 diff 안에서 진짜 회귀를 볼 수 없고, 이 배치의 나머지 27건이 그 diff에 묻힌다. **신규 유입만 막는다** — 전량 통일은 다른 작업과 섞이지 않는 단독 배치일 때만 안전하다.

**대안 D — G3을 "복사 전에 이미지를 미리 해석해 둔다"로 푼다.** 기각 — 사용자가 복사를 안 해도 IDB를 돌리는 비용이 붙고, 캐시 무효화 시점(섹션 편집·이미지 교체)을 새로 관리해야 한다. 요청되지 않은 상태를 늘리는 방향이다.

**대안 E — G10 #15를 "스캐너 정규식을 넓힌다"로 푼다.** 기각 — 정규식으로 임의 식별자를 추적하려면 사실상 타입 체커를 다시 만드는 일이고, 못 잡는 다음 형태가 또 나온다. **코드를 스캐너가 볼 수 있는 형태로 두는 게 싸고 확실하다.**

**대안 F — G8(콤보박스)을 이행하고 `DESIGN.md:270`을 같은 커밋에서 뒤집는다.** 기각. 이행 자체가 동작 변경 4종 이상을 끌고 오고(prd "검수 드랍" 표), 대상 9파일에 **테스트 0·e2e 0**이라 그 변경들을 잡을 그물이 없다. 게다가 수렴 목적지인 `SingleLazyCombobox`가 `query` 리셋 부재라는 자기 결함을 갖고 있어 **이미 11파일이 그 결함을 공유하는 중**이다 — 그걸 6파일 더 늘리는 것보다 먼저 고치는 게 이득이 크다. "지배 패턴이 저장소에 있다"만으로 수렴을 정당화하지 않고, **대상이 그 패턴의 전제(로드 모델)를 공유하는지**까지 본다는 판별 기준을 이 기각에서 얻었다.

**대안 G — #4를 `BgResponseMap`으로 근본 해결한다.** 기각(보류). `BgRequest["type"]` → 응답 타입 map을 만들어 `sendBg`가 추론하게 하면 이 계열 버그가 구조적으로 불가능해진다. 그게 정답이지만 **8개 플랫폼 × 수십 개 메시지 타입의 응답 형태를 전부 명시하는 작업**이라 이 배치 규모를 넘고, 그 diff 안에서 업로드 판별자 회귀를 볼 수 없다. 이번엔 양단 명시 + 목 갱신으로 국소 처리하고 map은 단독 배치로 남긴다.

**대안 H — G7 #23을 "넓은 쪽(`'` 포함)으로 통일"한다.** 기각. 원안이 이 방향이었지만 실측이 반대를 가리킨다 — overlay에 단일인용 속성이 0건이라 넓힐 실익이 없고, 넓히면 정본 소비처 4개(클립보드 `text/html`·`logs.html`·Asana `html_notes`·라이브 프리뷰)의 출력이 모든 아포스트로피에서 바뀌는데 **그걸 잡는 그물이 하나도 없다**(스냅샷 `'` 0건, 유닛 4케이스에 `'` 없음, `text/html` e2e 0). 좁히는 쪽은 출력 변화 0·테스트 수정 0이다.

## 위험 요소

**① 번들 경계(G6)는 검증 수단이 없다.** typecheck·테스트 둘 다 통과한 채로 어긋난다. 유효한 검증은 `grep -rn '@/sidepanel/components' src/store` 하나뿐이고 **그것도 0이 되지 않는다** — `editor-store.ts:17`의 `recording-pen`이 #8 범위 밖이다. `grep '@/sidepanel' src/store/`는 현재 9건이고 두 태스크 후에도 **7건 잔존**한다(`sidepanel/lib` 경유는 의도된 것). 게이트를 "0건"이 아니라 **"`annotation/presets`·`picker-control` 참조 0건"**으로 좁힌다. 청크 크기 비교는 사전 캡처 단계가 없으면 측정 불가하므로, 하려면 배치 전 값을 먼저 기록한다. **`pnpm build`는 사용자 요청 시에만 도는 규칙**이라 이 그룹의 최종 확인은 `/build` 또는 승인이 있을 때 한다.

**② content 청크에 `@/lib` 유입(G7 #23)은 실질 위험이 낮지만 검증 도구가 없다.** picker 청크는 **이미** `@/lib`를 4개 끈다(`overlay.ts:1 element-label`·`picker.ts:79 session-keys`·`css-resolve.ts:16 named-colors`·`css-source-cache.ts:15 bg-client`) — 선례가 확립돼 있다. 다만 **`pnpm check:prearm`은 이 질문에 답할 수 없다**: `scripts/check-prearm-chunk.mjs:20`이 `ENTRY = "recorders-entry"`를 하드코딩하고 그 entry만 검사한다. 음성 대조군(레코더 청크가 안 오염됐다)으로만 유효하고 **picker 청크의 그래프를 지키는 게이트는 저장소에 0건**이다(`vite.config.ts`에 `manualChunks` 자체가 없다).

**③ 골든 스냅샷은 이 배치의 검증 수단이 못 된다.** 원안은 "골든이 안 흔들리는 것 자체가 검증"이라 했지만 실측하면 **세 게이트 모두 공허하다**:
- #23: 스냅샷에 `'`·`&#39;`가 **0건**이라 어느 방향으로 가도 green이다.
- #22: `imageCell`의 유일한 호출부가 `styleTable.snapshot` 행인데 스냅샷에 그 섹션이 **0건**이다(골든 픽스처가 `before-N`/`after-N` 파일명 패턴에 안 맞아 `hasSnapshots`가 false). 게다가 픽스처 파일명이 전부 escape-char-free(`capture-0.webp`·`recording.mp4`·`logs.html`)라 `escapeMdLinkText` 편입이 **스냅샷을 움직이지 않는다**. "diff를 눈으로 읽는다"는 완화책이 **읽을 diff가 없어** 거짓 안심을 준다.
- #25·#30: 동치 통합이라 안 흔들리는 게 맞지만, 위 두 사례와 구별이 안 된다.

→ **G7의 실질 그물은 (a) Task 0이 박는 `escapeMdLinkText` 케이스 (b) `escapeHtml.test.ts`에 추가하는 `'` 케이스 (c) `pnpm test` 전체다.** 스냅샷 무변경은 부수 확인으로만 취급하고, 확인 항목의 문구를 "흔들리면 오류 신호"에서 "흔들릴 수 없다(그래서 이걸로 판정하지 않는다)"로 바꾼다.

**④ 브라우저 실동작에 걸려 자동화로 못 잡는 것 5건.**
- G3 클립보드 — jsdom에 `ClipboardItem` 없음. **e2e 스텁 확장이 유일한 자동 그물**이고 붙여넣기 실제 확인은 수동.
- G6 번들 경계 — 위 ①.
- G9 activation 큐 경합 — 두 이벤트의 역순 커밋은 실제 탭 전환·네비게이션 타이밍에서만 난다. 큐 진입 여부는 유닛으로 고정하되 **경합 자체는 수동**이고, 큐 밖에 남는 `setOptions` 2곳 때문에 수동이 로드베어링이다.
- G12 #32 어노테이션 — 캔버스. 유닛이 가리키는 테스트는 store 사본이라 **실질 미커버**.
- **G1 (a) `settle()` throw — e2e로 유도 불가.** ISOLATED world 결함 주입 seam이 없다(`e2e/fixtures/extension.ts`는 `evalInExt`/`fixtureTabId`/`openPanel`만 노출하고, 페이지가 content script의 프로토타입을 못 건드린다). 그래서 성공기준 3에서 이 시나리오를 뺐다 — 유닛(`scroll-capture.test.ts`)이 유일한 그물이다.

**⑤ G5 #4는 타입이 소비처를 짚어주지 않는다.** 위 G5 인용 참조. 이슈 제출 경로라 회귀 시 첨부가 조용히 빠지고, **`submitTo*.test.ts` 목을 갱신하지 않으면 "무회귀 green"이 그 자체로 놓친 신호**가 된다. 4플랫폼 8분기를 목 수준에서 박는 게 필수다.

**⑥ G5 #2의 `refreshFailed` 레인 분리를 틀리면 반대 방향 회귀가 난다.** 진짜 refresh 실패가 400으로 내려가 "세션 만료" 배너가 **안 뜨고**, 사용자는 왜 연동이 안 되는지 모른 채 남는다. 특히 `createRefreshRunner.ts:44`가 최초 연결 401과 refresh 소진을 **공유**하므로 여기를 무조건 태깅하면 고치려던 🔴이 잔존한다. 태깅은 3곳으로 줄이고 누락은 소스 전수 스캔으로 잠근다.

**⑦ POSTMORTEM 2026-08-16이 기록한 "계획-태스크 불일치".** 이 design.md가 언급한 항목이 tasks.md에 없으면 배치가 조용히 약속을 어긴다. `tasks.md`에 **항목↔태스크 대조표(28행)**를 두고 착수 전·완료 후 두 번 대조한다. **이번 검수에서 3건이 드랍되고 1건이 편입됐으므로 대조표·목표 병기·스코프 표 셋이 함께 움직였는지도 확인 대상이다.**

**⑧ 예고 없는 red 2건.** (a) G11 #19의 `<div>`→`<button>`이 기존 `JsonTreeViewer.test.tsx:20`을 깰 수 있다(button UA font 미상속). (b) G5 #3이 `connect-reason-coverage.test.ts:78`을 깬다(`GRANT_LANE_FILES` 집합 고정). 둘 다 "구현이 틀렸다"가 아니라 "그물이 정상 작동한 것"이므로 테스트를 함께 갱신하고, **갱신했다는 사실을 커밋 메시지에 적는다**.
