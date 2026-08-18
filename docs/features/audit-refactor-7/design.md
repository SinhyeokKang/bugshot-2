# audit-refactor-7 — 기술 설계

## 개요

30개 항목을 **P0(무음 유실·행·Privacy) → P1(계약·경계·단일 출처) → P2(컨벤션·그물)** 3단으로 나누고, 각 단 안에서 **같은 파일·같은 그물을 공유하는 것끼리** G그룹으로 묶는다. 그룹 단위로 커밋하면 하나가 회귀해도 되돌릴 반경이 그룹으로 한정된다.

정렬 축은 두 개다. **심각도**는 "고치지 않으면 사용자가 무엇을 잃는가"(무음 데이터 유실 > 계약 위반 > 컨벤션 이탈)이고, **논리 단위**는 "한 번 컨텍스트를 로드하면 몇 개를 같이 고칠 수 있는가"다. 둘이 충돌하면 심각도가 이긴다 — 예로 #10(activation 큐 경합)은 `tab-bindings.ts` 단독이라 논리 단위로는 P2에 어울리지만 경합이라 P1에 둔다.

이 배치는 **동작 보존이 기본값**이다. 의도적 동작 변경은 두 개(🔴#1 툴팁 노출, #17 빈 목록 안내)뿐이고 나머지는 전부 "같은 결과, 다른 경로"라 **골든 스냅샷이 안 흔들리는 것 자체가 검증**이 된다.

## 그룹 구성

| 단 | 그룹 | 항목 | 대표 파일 |
|---|---|---|---|
| P0 | G0. 회귀 그물 선행 | (테스트만) | `__tests__/` 신규 |
| P0 | G1. 응답 채널 행(hang) | #5 #11 #7 | `content/scroll-capture.ts`·`content/picker.ts`·`content/css-source-cache.ts` |
| P0 | G2. 마스킹 게이트 우회 | #12 | `content/action-recorder.ts` |
| P0 | G3. user gesture 소실 | #6 | `sidepanel/tabs/PreviewPanel.tsx` |
| P0 | G4. 🔴 비활성 이유 미노출 | #1 | `sidepanel/tabs/IssueCreateModal.tsx` |
| P1 | G5. 응답 계약 | #2 #3 #4 | `background/oauth.ts`·`notion-oauth.ts`·`messages.ts` |
| P1 | G6. 번들 경계 | #8 #9 | `store/editor-store.ts`·`store/issues-store.ts` |
| P1 | G7. 단일 출처 통합 | #22 #23 #25 #30 | `lib/escapeHtml.ts`(이동)·`issueBodyShared.ts`·`markdownIt.ts`(신규)·`lib/session-keys.ts` |
| P1 | G8. 콤보박스 수렴 | #28 #29 | `linearFields/*`·`RepoCombobox`·`ProjectCombobox`·`DatabaseCombobox` |
| P1 | G9. activation 큐 | #10 | `background/tab-bindings.ts` |
| P2 | G10. i18n 그물·문서 언어 | #13 #14 #15 #16 | `index.html` 2벌·`log-viewer/__tests__/i18n.test.ts` |
| P2 | G11. UI 패턴 이탈 | #17 #18 #19 #20 #21 | `statusBadges/`·`notionFields/`·`components/` |
| P2 | G12. 잔여 | #32 #33 #34 | `content/annotation.ts`·`background/lib/readErrorBody.ts`·경로 2건 |

## 변경 범위

### G0. 회귀 그물 선행

새 파일은 없다. 아래 그룹이 건드리는 **순수 함수의 현재 동작을 먼저 고정**한다(TDD red가 아니라 characterization test — 동작 보존이 목표라 "지금 값"을 박는 게 그물이다).

- `src/sidepanel/lib/__tests__/issueBodyShared.test.ts` — 기존. `imageCell` 통합 전 3벌의 출력이 같은지 대조하는 케이스를 먼저 추가(G7 착수 전 red).
- `src/content/__tests__/action-recorder-helpers.test.ts` — 기존이 있으면 확장, 없으면 신설. `labelForText`를 테스트 가능한 형태로 노출하는 것이 G2의 선행 작업이다.
- 골든 스냅샷 `bodyOutputGolden.test.ts.snap`은 **건드리지 않는다.** G7이 이 스냅샷을 흔들면 그건 통합이 동치가 아니라는 신호다.

### G1. 응답 채널 행(hang) — #5 #11 #7

**`src/content/scroll-capture.ts`** (현재: 페이지 전체 캡처의 content 실행자)
`settle()`이 `done = true`를 세운 **뒤** `mergePositionedCandidates`/`hideRepeatedElements`를 부르고 마지막에 `resolve`한다. 중간에 throw하면 `done`은 이미 true라 rAF·fallback 어느 쪽도 재진입 못 하고 `resolve`가 영영 안 불린다.

```ts
const settle = () => {
  if (done) return;
  done = true;
  if (fallback) clearTimeout(fallback);
  try {
    if (hideFixed) { /* 기존 그대로 */ }
  } catch (err) {
    // 후보 수집 실패는 타일 품질 문제이지 캡처 중단 사유가 아니다 — 로그만 남기고 진행.
    dlogOrConsole(err);
  }
  resolve({ y: window.scrollY });
};
```

**`src/content/picker.ts:316`** (현재: `picker.scrollCaptureTo` 수신부)
`void scrollCaptureTo(...).then(sendResponse)` — reject 시 `sendResponse` 미호출 + `return true`로 채널이 열린 채라 사이드패널 `await deps.send(...)`가 안 풀린다.

```ts
void scrollCaptureTo(scrollSession, msg.y, msg.hideFixed)
  .then(sendResponse, () => sendResponse(undefined));
```

`undefined`를 보내는 게 핵심이다. 오케스트레이터(`sidepanel/scroll-capture.ts:81`)가 이미 `if (!ack) throw new Error("scroll capture unavailable")`을 갖고 있어, **"무응답 = 중단"이라는 기존 계약을 그대로 타면서** 행만 없어진다. 성공한 척 ack를 지어내면 스크롤 안 된 화면이 성공으로 스티치되므로(그 파일 주석이 경고하는 바로 그것) 절대 `{y:...}`를 만들지 않는다.

**`src/content/picker.ts:142·1181`** (현재: css 캐시 보강 IIFE 2곳)
`void (async () => { await ensureCssCacheLoaded(); ... })()` — `.catch` 없음. 같은 파일의 `respondAfterPaint:377`, `area-select.ts:36`은 붙이고 있어 지배 패턴에서 이탈이다. `.catch(() => {})`를 붙인다(보강 실패는 인스펙터 값이 덜 풍부해질 뿐 캡처를 막지 않는다 — 삼키는 게 맞고, 삼킨다는 사실을 주석으로 남긴다).

**`src/content/css-source-cache.ts:57·1012`** (현재: `ensureLoaded`/`ensureCrossOriginLoaded` 메모이즈)
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

`ensureCrossOriginLoaded`도 같은 형태. **주의**: `invalidate()`가 이미 `loadPromise = null`을 하므로, 위 catch가 `loadPromise === p`를 확인하지 않으면 invalidate 뒤 새로 깔린 promise를 지운다.

### G2. 마스킹 게이트 우회 — #12

**`src/content/action-recorder.ts:263`**
`el.getAttribute("aria-labelledby")`는 공백 구분 **ID 리스트**인데 통째로 `getElementById`에 넘긴다. WAI-ARIA에서 다중 참조는 권장 패턴이라 실제 폼에서 흔하다.

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

`labelForText`는 현재 `action-recorder.ts` 내부 클로저다. 유닛으로 고정하려면 **`src/content/action-recorder-helpers.ts`로 옮긴다**(이미 존재하는 파일이고 `maskValue`·`shouldMaskField`가 거기 있다). 옮길 때 `document` 의존을 인자로 받지 말 것 — `*.test.tsx`(jsdom) 트랙으로 검증하면 실제 DOM으로 다중 ID를 재현할 수 있고, 인자 주입은 요청되지 않은 유연성이다.

### G3. user gesture 소실 — #6

**`src/sidepanel/tabs/PreviewPanel.tsx:294`**
`handleCopyMarkdown`의 첫 await가 `resolveSectionImages`(IndexedDB 왕복)다. 인라인 이미지가 많으면 5초 transient activation 창을 넘겨 `clipboard.write`가 무음 실패하고, 폴백 `writeText`도 같은 창을 쓰므로 함께 죽는다.

ARCHITECTURE.md "user gesture 보존"의 규칙은 **"gesture를 소비하는 API를 첫 await 앞에 둔다"**이다. 클립보드는 내용이 있어야 쓸 수 있으므로 순서를 못 바꾼다. 대신 **`ClipboardItem`에 Promise를 넘긴다** — 이건 정확히 이 문제를 위한 웹 표준이고, `navigator.clipboard.write`가 gesture 시점에 동기 호출되며 데이터 해결은 나중에 일어난다.

```ts
const handleCopyMarkdown = () => {
  // ClipboardItem에 Promise<Blob>을 넘기면 write는 제스처 시점에 동기로 걸리고 본문 해결은
  // 뒤로 미뤄진다. 첫 await를 앞세우면 IDB 왕복 동안 activation이 만료돼 복사가 무음 실패한다.
  const textPromise = buildMarkdownForCopy().then(
    (md) => new Blob([md], { type: "text/plain" }),
  );
  return navigator.clipboard
    .write([new ClipboardItem({ "text/plain": textPromise })])
    .then(onCopied, onCopyFailed);
};
```

기존 본문 조립(`resolveSectionImages` → `buildMarkdownContext` → 빌더)은 `buildMarkdownForCopy(): Promise<string>`로 **그대로 들어낸다**. 로직 변경 없음.

**위험**: `ClipboardItem`의 Promise 인자는 Chrome 66+에서 지원되고 `minimum_chrome_version: 116`이라 안전하다. 다만 **Promise가 reject되면 write 전체가 reject**되므로 `onCopyFailed` 경로가 기존 실패 처리와 같은지 확인해야 한다. jsdom에 `ClipboardItem`이 없어 **컴포넌트 테스트로는 못 잡는다** — e2e 또는 수동이 그물이다(tasks.md 참조).

### G4. 🔴 비활성 이유 미노출 — #1

**`src/sidepanel/tabs/IssueCreateModal.tsx:497`**
`disabled={!canOpen}` + native `title`. shadcn `Button` base가 `disabled:pointer-events-none`이라 hover가 죽어 툴팁이 **절대** 렌더되지 않는다.

정규 선례는 같은 저장소의 `IssueTab.tsx:368-386`이고 형태가 확정돼 있다 — `TooltipProvider delayDuration={0}` → `Tooltip` → `TooltipTrigger asChild` → `Button aria-disabled={x} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-background aria-disabled:hover:text-foreground"` → `onClick`에 `if (x) return;` 가드 → `{x && <TooltipContent>{이유}</TooltipContent>}`.

기존 `tooltip` 변수(`canOpen ? undefined : t("platform.empty.title")`)를 그대로 재사용한다. `data-testid="issue-submit-open"`은 유지 — e2e가 잡고 있다.

### G5. 응답 계약 — #2 #3 #4

**`src/background/oauth.ts:59`** — `serializeOAuthError`의 fallthrough가 `401 + oauthRefreshFailed`다. 이 함수는 `cancelled`/`notConfigured`/`launchFailed` 셋을 401 레인에서 빼내지만, 그 밖의 `OAuthError`(state mismatch·code 부재·토큰 저장 실패·Slack user token 부재 등 **최초 연결 단계** throw 전부)가 기본값으로 떨어져 `oauthRefreshFailed`를 달고 나간다. 사이드패널은 그걸 보고 `onOAuthExpired`를 발화해 **연동한 적 없는 사용자에게 "세션 만료" 배너**를 띄운다.

`oauth/errors.ts:65` 주석이 이미 이 문제를 인지하고 미뤄둔 상태다. 해법은 **refresh 실패를 기본값이 아니라 명시 플래그로 뒤집는 것**:

```ts
// 401 레인은 "토큰이 있었는데 갱신에 실패했다"만 탄다. 최초 연결 실패가 여기 섞이면
// 연동한 적 없는 사용자에게 재로그인 배너가 뜬다. 기본값이 아니라 명시 플래그로 판정한다.
if (error.refreshFailed) {
  return { status: 401, body: { oauthRefreshFailed: true, platform: error.platform } };
}
return { status: 400, body: { oauthConnectFailed: true, platform: error.platform } };
```

`OAuthError`에 `refreshFailed?: boolean`을 추가하고 **refresh 경로에서만** 세운다. 그 경로는 `background/lib/createRefreshRunner.ts`와 각 `*-oauth.ts`의 refresh 함수다. 판독부(`lib/bg-client.ts`의 `readErrorBodyFlag` 소비처)는 `oauthRefreshFailed`를 그대로 읽으므로 **변경 없음** — 새 플래그 `oauthConnectFailed`는 소비처를 만들지 않는다(위 파일 주석의 "소비처 없는 reader를 늘리지 말 것"과 같은 이유로, 400은 이미 일반 실패로 처리된다).

**`src/background/notion-oauth.ts:72`** — `exchangeCode`가 `res.ok`만 보고 본문 `error` 필드를 안 본다. 프록시 경유 6종 중 유일한 이탈이다. 200 + `{error: "invalid_grant"}` 본문이면 `access_token: undefined`가 저장으로 흘러가고, `classifyConnectReason`이 `other`로 뭉갠다. 다른 5종과 같은 형태로 `error` 검사를 추가한다(구현 시 형제 파일에서 정확한 관용구를 복사한다 — 새로 설계하지 않는다).

**`src/background/messages.ts:575`(asana)·`:492`(gitlab)·`:647`(clickup) + `github-upload.ts:139`** — 업로드 결과가 판별자 없이 nullable 필드 truthiness로 성공/실패를 가른다. 같은 파일의 Slack 경로만 `{ok: boolean}`을 쓴다(5개 중 1개 준수).

각 결과 원소에 `ok` 판별자를 추가한다:

```ts
type UploadResult =
  | { ok: true; filename: string; gid: string; viewUrl?: string }
  | { ok: false; filename: string };
```

**주의**: 이건 background↔sidepanel 메시지 응답 형태 변경이라 소비처를 함께 고쳐야 한다. `src/types/messages.ts`의 해당 응답 타입을 먼저 바꾸면 typecheck가 소비처를 전부 짚어준다 — **타입부터 바꾸고 컴파일러가 가리키는 곳만 따라간다.**

### G6. 번들 경계 — #8 #9

CLAUDE.md의 "store는 `sidepanel/tabs`를 import하지 않는다 / 사이드패널·store는 `@/background/*`를 value import하지 않는다"와 같은 축이다. 이 경계는 **typecheck도 테스트도 안 잡는다** — 어기면 번들만 조용히 커진다.

**`src/store/editor-store.ts:16`** — `DEFAULT_COLOR`·`DEFAULT_THICKNESS`를 `@/sidepanel/components/annotation/presets`에서 value import. 그 파일은 지금은 React-free지만 `components/` 트리에 있어, 누군가 거기에 컴포넌트를 하나 추가하는 순간 store가 React 그래프를 끈다(store는 background 번들에도 들어간다).

**해법**: `presets.ts`를 통째로 옮기지 않는다(그 파일은 `AnnotationTool` 등 UI 타입도 들고 있고 소비처가 많다). **store가 실제로 쓰는 값 2개 + `ThicknessKey` 타입만** `src/sidepanel/lib/annotationDefaults.ts`로 승격하고, `presets.ts`가 거기서 re-export한다. 기존 소비처는 안 건드린다(외과적 변경).

**`src/store/issues-store.ts:8`** — `clearPicker`를 `@/sidepanel/picker-control`에서 value import. 그 모듈은 `chrome.tabs`·`resolveDark`·`capture-basis`를 끈다. 선례가 같은 저장소에 있다 — `recorder-control.ts:2-4` 주석이 "editor-store가 clear를 직접 호출하므로 `useEditorStore`에 의존하는 picker-control과 분리해 순환 import를 끊는다"고 기록한 그 분리다.

**해법**: 같은 방식. `clearPicker`가 실제로 하는 일(탭에 정리 메시지 전송)을 `src/sidepanel/picker-clear.ts`로 떼고 `picker-control.ts`가 그걸 재수출한다. 단 `clearPicker`가 store를 읽거나 쓰면 분리가 안 되므로, **구현 착수 시 본문을 먼저 확인**하고 store 의존이 있으면 대안 B(아래)로 간다.

> `editor-store.ts:20`의 `@/sidepanel/recorder-control` import는 **위반이 아니다** — 그 파일이 위 주석대로 이미 분리된 leaf다. 건드리지 않는다.

### G7. 단일 출처 통합 — #22 #23 #25 #30

네 건 다 **이미 값이 갈렸거나 갈릴 준비가 된** 복제다. POSTMORTEM 2026-07-16("팔레트를 단일 출처로 승격했다는 주석·커밋 메시지가 거짓인 채 머지됨 — 복제본이 그대로 남아 있었다")이 이 그룹의 경고문이다. 각 태스크의 검증에 **잔존 사본을 세는 grep**을 박는다.

**#23 `escapeHtml`** — `content/overlay.ts:685` 사본이 정본(`sidepanel/lib/escapeHtml.ts`)과 **이미 다르다**(overlay만 `'` → `&#39;` 추가). 정본 파일 헤더가 "세 벌로 흩어져 있었고 그중 한 벌만 `"`를 빠뜨려 주입 직전까지 갔다"고 못박은 바로 그 패턴의 재현이다.

**해법**: 정본을 `src/lib/escapeHtml.ts`로 승격하고 양쪽이 import한다. content가 `@/lib/`를 끄는 건 이미 확립된 경로다(`css-source-cache.ts:15`·`css-resolve.ts:16`·`overlay.ts:1`·`picker.ts:79`가 이미 그렇게 한다). **pre-arm 제약과 무관하다** — 그 제약은 `recorders-entry` 청크(`log-throttle`·`recorder-globals`·`sentinel-registry` 3모듈)에만 걸리고 `overlay.ts`는 picker 청크다.

**동작 통일 방향은 `'` 포함**(넓은 쪽)이다. overlay는 값을 element content로 넣고 사이드패널 정본은 속성 문맥까지 흘러가므로, 좁히면 회귀이고 넓히면 안전하다. 단 `'` 추가가 **기존 골든 스냅샷을 흔드는지** 먼저 확인한다 — 흔들면 그건 정본 소비처 출력이 바뀐다는 뜻이라, 그 경우 정본은 그대로 두고 overlay만 정본을 쓰도록 좁힌다(overlay 출력에 `'`가 실제로 나타나는지 확인 후 결정).

**#22 `imageCell` 3벌** — `buildMarkdownIssueBody.ts:45`·`buildClickupIssueBody.ts:35`·`buildLinearIssueBody.ts:32`. 셋 중 markdown판만 `escapeMdLinkText`가 빠져 있고(같은 파일 `:51`·`:202`·`:206`은 쓴다) **이미 드리프트 상태**다. linear는 `media.assetUrl`, 나머지는 `media.url`을 읽는다.

**해법**: `sidepanel/lib/issueBodyShared.ts`(audit-refactor-6 G2가 만든 공용 leaf)에 url을 **인자로 받는** 형태로 올린다 — 미디어 타입 3종을 leaf가 알면 빌더를 되참조해 순환이 된다(그 파일 주석의 `LogSummaryContext` 선례와 같은 이유).

```ts
export function imageCell(filename: string, url: string | undefined): string {
  if (!url) return "";
  return `![${escapeMdLinkText(filename)}](${url})`;
}
```

호출부는 `imageCell(before.filename, before.url)` / linear는 `imageCell(before.filename, before.assetUrl)`. **`escapeMdLinkText` 편입은 동작 변경**이라 골든 스냅샷이 흔들릴 수 있다 — 흔들리면 그건 markdown 경로의 버그가 고쳐진 것이므로 스냅샷을 갱신하고 **무엇이 왜 바뀌었는지 커밋 메시지에 적는다**.

**#25 `MarkdownIt` 설정 4벌** — `markdownToAdf.ts:19`·`markdownToNotionBlocks.ts:7`·`markdownToAsanaHtml.ts:10`·`renderMarkdown.ts:16`이 `{html:false, breaks:true, linkify:true}` + `enable("strikethrough")`를 각자 반복한다. `renderMarkdown`만 `highlight: highlightJson`이 추가로 붙는다.

**해법**: `src/sidepanel/lib/markdownIt.ts` 신설.

```ts
// 4개 플랫폼 파서가 같은 설정을 각자 반복하면 한 곳만 바뀌었을 때 본문 파싱이 조용히 갈린다.
export function createMarkdownIt(options?: MarkdownIt.Options): MarkdownIt {
  const md = MarkdownIt({ html: false, breaks: true, linkify: true, ...options });
  md.enable("strikethrough");
  return md;
}
```

각 파일은 `const md = createMarkdownIt()` / `createMarkdownIt({ highlight: highlightJson })`. **인스턴스는 파일별로 유지한다** — 공유 인스턴스로 만들면 한 파일이 `md.use(plugin)`을 부르는 순간 나머지 셋이 영향을 받는다(요청되지 않은 결합).

**#30 frozen phase 3벌** — `lib/session-keys.ts:42`의 `FROZEN_PHASES`(단일 출처, background `tab-bindings.ts`·`log-merge.ts`가 사용) + `useEditorSessionSync.ts:46`의 로컬 `DRAFT_PHASES` + 같은 파일 `:269-272`의 인라인 재열거(자기 상수조차 안 쓴다). 원소는 현재 동일해 동작 버그는 아니지만, phase를 추가하면 background 보존 판정과 사이드패널 picker clear가 무음으로 갈린다.

**해법**: `DRAFT_PHASES` 삭제 + 인라인 재열거를 `FROZEN_PHASES.has(phase)`로 치환. `session-keys.ts`는 이미 양 realm이 공유하는 leaf라 import 방향에 문제가 없다.

### G8. 콤보박스 수렴 — #28 #29

**포함 근거**: 공용 컴포넌트가 이미 있고 **이미 쓰는 파일이 있다**. `githubFields/LabelCombobox.tsx`·`gitlabFields/LabelCombobox.tsx`가 `SingleLazyCombobox`를 채택했고, `jiraFields/useDebouncedSearch.ts`가 디바운스 훅을 갖고 있다. 이건 "수렴"이지 "새 추상화 설계"가 아니다.

**#28 — `useLazyListOnOpen` 미채택 6파일**: `linearFields/{Label,Team,Project,Assignee}Combobox.tsx`, `tabs/ProjectCombobox.tsx`, `tabs/IssueTypeCombobox.tsx`(합계 728줄). 각자 `open` 시 1회 로드를 재구현한다.

`SingleLazyCombobox`의 prop 표면은 이미 넓다(`load`·`getKey`·`getName`·`getItemValue`·`renderItem`·`selectedKey`·`onSelect`·`triggerLabel`·`searchPlaceholder`·`emptyLabel`·`pinSelected`). **prop을 새로 늘리지 않고 들어가는 것만 옮긴다** — 못 들어가는 파일은 남긴다. 파일별로 "옮겼다/남겼다 + 남긴 이유"를 태스크 결과에 적는다(전량 이행을 약속하지 않는다).

**#29 — 원격 검색 3벌**: `githubFields/RepoCombobox.tsx`(144줄)·`gitlabFields/ProjectCombobox.tsx`(143줄)·`notionFields/DatabaseCombobox.tsx`(150줄)이 `reqIdRef` + 300ms 디바운스 + seq 가드를 각자 인라인한다. `jiraFields/useDebouncedSearch.ts`가 정확히 같은 로직(`seqRef` + `setTimeout` + stale 무시)을 이미 갖고 있다.

**해법**: 훅을 `src/sidepanel/hooks/useDebouncedSearch.ts`로 승격(jiraFields에 갇힌 걸 꺼낸다)하고 3파일이 채택. 훅 본문은 **바꾸지 않는다** — 3파일의 인라인판과 동치인지 먼저 대조하고, 다르면(예: cleanup 반환 형태) 차이를 태스크에 적고 호출부를 훅에 맞춘다.

### G9. activation 큐 — #10

**`src/background/tab-bindings.ts:301-330`** — `activated` 셋의 write는 큐로 직렬화되지만 `apply()`의 read→`chrome.sidePanel.setOptions` 경로는 큐 밖이다. `onActivated`의 `apply`와 `onUpdated`의 `deactivatePanelIfCrossOrigin`이 `setOptions`를 역순으로 커밋하면 방금 닫은 패널이 잠깐 되살아난다. 다음 `apply`에서 자가 치유되므로 🔴이 아니다.

**해법**: `apply()`를 write와 같은 큐에 태운다. 큐 헬퍼는 이미 그 파일에 있으므로 새 구조를 만들지 않는다. **`apply`가 큐 안에서 자기 자신을 부르는 재진입이 없는지** 확인하는 게 유일한 함정이다(있으면 데드락).

### G10. i18n 그물·문서 언어 — #13 #14 #15 #16

**#13 `src/sidepanel/index.html:2`** — `<html lang="ko">` 하드코딩이고 런타임 `documentElement.lang` 갱신 코드가 0건이다. en 사용자에게도 문서 언어가 한국어로 선언돼 스크린리더 발음·폰트 선택에 영향을 준다.

**해법**: html은 중립값(`<html lang="en">`)으로 두고, 로케일이 정해지는 지점에서 `document.documentElement.lang = BCP47[locale]`을 세운다. `BCP47` 테이블은 `src/i18n/locales.ts`에 이미 있고 **폴백 금지 테이블**이라 컴파일러가 전 로케일을 채우게 강제한다. 세우는 위치는 `useThemeEffect`가 `documentElement`를 만지는 것과 같은 계층 — 테마 effect 옆에 lang effect를 둔다(그 파일이 이미 `resolveDark`를 쓰는 단일 진입점이다).

**#14 `src/log-viewer/index.html:2`** — 반대 방향. `lang="en"` 고정인데 본문은 `detectLocale(navigator.language)`로 독자 언어를 따른다. log-viewer는 별도 빌드라 `@/i18n` alias를 못 쓰므로 **상대경로로** 자기 사전의 로케일을 읽어 같은 방식으로 세운다.

**#15 `TimelinePanel.tsx:23` · #16 `markers.ts:147`** — 둘 다 log-viewer의 i18n 그물 사각이다. `log-viewer/__tests__/i18n.test.ts`의 스캐너 정규식이 `/\bt\(\s*["'`]([a-zA-Z][\w.]*)["'`]/g`라 **`t(` 직후 리터럴만** 잡는다. `FILTER_LABEL[filter]` 같은 테이블 조회와 `t(cond ? "a" : "b")` 삼항은 안 보인다. 메인 번들은 `TranslationKey` union이 잡아주지만 복제 사전엔 그 게이트가 없다.

**해법**: 코드를 스캐너에 맞추는 쪽이 싸다.
- `#15`: `FILTER_LABEL`의 타입을 `Record<TimelineFilter, string>`에서 log-viewer 사전 키 union으로 좁힌다. 사전 키 union이 없으면 만들지 말고(대공사) **스캐너가 보도록** 값을 `t()` 호출 지점으로 옮긴다 — `FILTER_LABEL`을 지우고 렌더에서 `filter === "all" ? t("timeline.filter.all") : ...` 형태로 펼치거나, 4개 리터럴을 `t()` 인자로 직접 쓰는 헬퍼를 둔다.
- `#16`: 삼항을 밖으로 빼서 `t()` 인자를 리터럴로 만든다 — `label = e.value === "checked" ? t("actionLog.verb.toggle.check", {field}) : t("actionLog.verb.toggle.uncheck", {field});`

두 수정 후 **스캐너가 실제로 그 키들을 잡는지** 확인한다(그 테스트 파일에 이미 "스캐너가 공용 로그 컴포넌트까지 도달한다 (자기검증 앵커)" 케이스가 있으니 같은 방식으로 4+2 키가 `referencedKeys`에 들어오는지 앵커를 추가한다).

### G11. UI 패턴 이탈 — #17 #18 #19 #20 #21

전부 **저장소 안에 정규 선례가 있는** 국소 수정이다. 새 패턴을 만들지 않는다.

| 항목 | 파일 | 선례 |
|---|---|---|
| #17 빈 목록 분기 | `LinearStatusBadge.tsx:97` | `JiraStatusBadge.tsx:100` (`transitions.length === 0` → `text-sm text-muted-foreground` 안내). i18n 키 신규 1개 필요(`issueList.linear.noStates`) — **ko/en 동시 갱신** |
| #18 `FieldRow` 손복제 | `notionFields/PropertiesFieldset.tsx:35` | `FieldRow`가 `grid gap-1.5` + `label text-xs text-muted-foreground`로 **바이트 동일**이라 drop-in. `htmlFor`를 함께 채운다(현재 누락) |
| #19 키보드 접근 불가 | `components/JsonTreeViewer.tsx:209` | 같은 파일 트리 행이 쓰는 `TreeChevronButton`이 `type="button"` + `aria-label` + `aria-expanded`를 갖춘 raw button 예외 계열. "n개 더"는 chevron이 아니므로 `<button type="button">`로 바꾸고 기존 className 유지(`<span className="inline-block h-4 w-4 shrink-0" />` 자리맞춤도 유지) |
| #20 muted 누락 | `settings/LlmConnectForm.tsx:81` | 다른 6곳 빈 상태가 전부 `text-muted-foreground`. `<Bot className="h-6 w-6" />` → `h-6 w-6 text-muted-foreground` |
| #21 raw button 직접 스타일링 | `tabs/DomTreeDialog.tsx:66` | DESIGN §1 shadcn 우선. 등재 예외 4계열(클리어 X·TreeChevronButton·드래그 핸들·vanilla DOM) 미해당. `Button variant="ghost"`로 교체하되 `data-testid="dom-tree-trigger"`·`title`·`truncate`·`text-2xl font-semibold` 유지 — **e2e가 이 testid를 잡는다** |

### G12. 잔여 — #32 #33 #34

**#32 `src/content/annotation.ts:252`** — `setAnnotationTool(tool, style)`의 `tool`이 `style.tool`과 완전 중복이고, 유일 호출부(`picker.ts:328-333`)가 같은 값을 두 번 넘긴다. 둘이 갈리면 on/off 게이트와 렌더 분기가 다른 값을 본다.

**해법**: `setAnnotationTool(style: PenStyle | null)` 단일 인자로 좁힌다. `tool === null` 게이트는 `style === null`로 대체된다(호출부가 이미 `msg.tool === null ? null : {...}`이라 동치다).

**#33 `src/background/lib/readErrorBody.ts`** — 8개 플랫폼 에러 직렬화의 공통 관문 순수 함수인데 테스트가 0이다(소비처 5파일: github·clickup·jira·gitlab·asana api). CLAUDE.md "테스트 우선" 대상. `__tests__/readErrorBody.test.ts` 신설 — JSON 본문 / 비-JSON 원문 / `res.text()` 자체 throw 3갈래.

**#34 import 경로** — 이탈 2건만 고친다.
- `src/background/lib/createRefreshRunner.ts:3` — background 내부에서 **유일하게** 자기 패키지를 `@/background/oauth/errors`로 되짚는다(같은 심볼을 `oauth.ts:11`·`connect-tracking.ts:4`는 `./`). → 상대경로.
- `src/types/picker.ts:1-3` — types 17파일 중 **유일하게** 형제를 `@/types/`로 부른다. → 상대경로.

**sidepanel 943건은 안 건드린다**(PRD 비목표). 대신 **이미 100% 깨끗한 패키지에 신규 유입만 막는** 소스 스캔 테스트를 `src/lib/__tests__/importConvention.test.ts`로 둔다: `src/background`·`src/types`·`src/store`·`src/i18n` 내부 파일이 자기 패키지를 `@/<pkg>/`로 import하면 red. **sidepanel은 검사 대상에서 뺀다**(현재 혼용이라 즉시 red가 되고, 예외 목록 70개를 박으면 그물이 아니라 장부가 된다).

## 데이터 흐름

이 배치는 새 데이터 흐름을 만들지 않는다. 흐름이 **바뀌는** 곳은 셋이다.

**① 스크롤 캡처 실패 전파 (G1)**
```
content: scrollCaptureTo reject
  → picker.ts: sendResponse(undefined)          ← 신규 (기존: 미호출 → 채널 열린 채)
  → sidepanel: deps.send resolves undefined
  → scroll-capture.ts:81 `if (!ack) throw`      ← 기존 경로 재사용
  → 캡처 실패 UI                                 ← 기존
```

**② OAuth 에러 레인 (G5)**
```
기존: OAuthError(무엇이든) → 기본값 401 + oauthRefreshFailed → onOAuthExpired(세션 만료 배너)
변경: OAuthError.refreshFailed === true → 401 + oauthRefreshFailed → onOAuthExpired
      그 외                            → 400 + oauthConnectFailed → 일반 연결 실패 처리
```
`refreshFailed`를 세우는 지점은 refresh 경로뿐(`createRefreshRunner` + 각 `*-oauth.ts`의 refresh). 판독부는 무변경.

**③ 클립보드 복사 (G3)**
```
기존: click → await resolveSectionImages(IDB) → ... → clipboard.write   (activation 만료 위험)
변경: click → clipboard.write([ClipboardItem({ "text/plain": Promise })]) (동기)
                                              └→ 본문 조립은 Promise 안에서 진행
```

## 인터페이스 설계

```ts
// src/lib/escapeHtml.ts  (sidepanel/lib에서 승격 — G7 #23)
export function escapeHtml(s: string): string;

// src/sidepanel/lib/issueBodyShared.ts  (추가 — G7 #22)
export function imageCell(filename: string, url: string | undefined): string;

// src/sidepanel/lib/markdownIt.ts  (신규 — G7 #25)
export function createMarkdownIt(options?: MarkdownIt.Options): MarkdownIt;

// src/sidepanel/lib/annotationDefaults.ts  (신규 — G6 #8)
export type ThicknessKey = "S" | "M" | "L";
export const DEFAULT_COLOR: string;
export const DEFAULT_THICKNESS: ThicknessKey;

// src/sidepanel/picker-clear.ts  (신규 — G6 #9)
export function clearPicker(tabId: number): Promise<void>;

// src/sidepanel/hooks/useDebouncedSearch.ts  (jiraFields에서 승격 — G8 #29)
export function useDebouncedSearch<T>(
  fetchFn: (query: string) => Promise<T[]>,
  delay?: number,
): { items: T[]; loading: boolean; error: string | null; search: (q: string) => () => void };

// src/content/action-recorder-helpers.ts  (추가 — G2 #12)
export function labelForText(el: Element): string | undefined;

// src/background/oauth/errors.ts  (필드 추가 — G5 #2)
export class OAuthError extends Error {
  refreshFailed?: boolean;   // 신규 — 401 레인 진입을 명시 플래그로 뒤집는다
}

// src/types/messages.ts  (응답 타입 변경 — G5 #4)
export type UploadFileResult =
  | { ok: true; filename: string; gid: string; viewUrl?: string }
  | { ok: false; filename: string };

// src/content/annotation.ts  (시그니처 축소 — G12 #32)
export function setAnnotationTool(style: PenStyle | null): void;
```

## 기존 패턴 준수

- **테스트 우선** — 신규 인터페이스 8개 전부 테스트 선행. 순수 함수는 `*.test.ts`(node), 렌더·DOM이 필요한 것(`labelForText`·`FieldRow` 이행·`aria-disabled` 툴팁)은 `*.test.tsx`(jsdom).
- **i18n 동시 갱신** — 신규 키는 `issueList.linear.noStates` 1개뿐이고 **등록 로케일 전부** 갱신한다. `src/i18n/` Edit 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행하므로 red가 즉시 뜬다.
- **로케일 테이블 폴백 분류** — G10이 `BCP47`을 소비한다. 그건 **폴백 금지 5개** 중 하나라 `Record<LocaleMode, …>`를 유지하는 쪽으로만 쓴다.
- **본문 언어 전역 스왑** — G7이 `issueBodyShared.ts`(빌더 leaf)를 건드린다. `builderLocaleWrap.test.ts`가 `sidepanel/lib` 전체를 훑어 새 파일이 래핑·면제 어느 분류에도 없으면 red를 낸다. **`markdownIt.ts` 신설이 여기 걸린다** — 면제 분류에 등록해야 한다(파서 팩토리라 로케일과 무관).
- **pre-arm 청크 격리** — G7이 content에 `@/lib/escapeHtml`을 끈다. 레코더 전용 3모듈(`log-throttle`·`recorder-globals`·`sentinel-registry`)과 무관하고 `overlay.ts`는 picker 청크라 안전하지만, **`pnpm check:prearm`을 검증에 넣는다**(빌드 후 사후 그물).
- **`chrome.scripting.executeScript({func})`** — 이 배치는 두 사용처(`github-upload.ts:pageBatchUploadFn`·`picker-control.ts:getTopViewport`)를 **건드리지 않는다**. G5가 `github-upload.ts:139`를 손대지만 그건 응답 형태이지 주입 함수가 아니다. 구현 중 주입 함수 본문에 손이 가면 그 순간 실탭 회귀가 필수가 되므로 **범위를 벗어난 것으로 보고 멈춘다**.
- **외과적 변경** — 각 그룹은 지정 항목만 고친다. 인접 코드가 눈에 거슬려도 안 고친다.

## 대안 검토

**대안 A — 71건을 한 배치에 전부 넣는다.** 기각. ⚪ 37건은 대부분 문서 등재·주석·미사용 export라 **검증이 "grep 0"으로 끝나는 것들**이고, 그게 30건의 실제 회귀 위험과 같은 PR에 섞이면 리뷰가 희석된다. audit-refactor-6의 tasks.md가 399줄이었고 그때도 P2를 5개 태스크로 압축했다.

**대안 B — G6을 "store에서 상수를 인라인 복제"로 푼다.** `DEFAULT_COLOR`·`DEFAULT_THICKNESS`를 store에 직접 박으면 import가 사라진다. 기각 — 값이 갈리는 순간 어노테이션 기본값이 UI와 store에서 달라지고, 그건 정확히 G7이 없애려는 종류의 드리프트다. 다만 **`clearPicker`가 store를 읽는다면** 이 대안이 유일한 길이 된다(그 경우 분리가 순환을 못 끊는다). 착수 시 본문 확인 후 판단하고, B로 가면 그 사실을 태스크 결과에 적는다.

**대안 C — #34에서 sidepanel 943건을 `@/` 또는 상대경로로 전량 통일한다.** 기각. POSTMORTEM 2026-08-15가 **정확히 이 혼용 때문에** 모듈 이동 반경을 79로 세고 실제 101을 놓친 전례를 기록하고 있어 동기는 충분하다. 그러나 943개 import 문 diff 안에서 진짜 회귀를 볼 수 없고, 이 배치의 나머지 29건이 그 diff에 묻힌다. **측정치를 기록하고 신규 유입만 막는다** — 전량 통일은 다른 작업과 섞이지 않는 단독 배치일 때만 안전하다.

**대안 D — G3을 "복사 전에 이미지를 미리 해석해 둔다"로 푼다.** 프리뷰 진입 시 `resolveSectionImages`를 미리 돌려 캐시하면 클릭 시점에 await가 없다. 기각 — 사용자가 복사를 안 해도 IDB를 돌리는 비용이 붙고, 캐시 무효화 시점(섹션 편집·이미지 교체)을 새로 관리해야 한다. 요청되지 않은 상태를 늘리는 방향이다. `ClipboardItem` + Promise는 **이 문제를 위해 설계된 웹 표준**이라 추가 상태가 0이다.

**대안 E — G10 #15를 "스캐너 정규식을 넓힌다"로 푼다.** 테이블 조회·삼항까지 잡도록 스캐너를 고치면 코드를 안 건드려도 된다. 기각 — 정규식으로 임의 식별자를 추적하려면 사실상 타입 체커를 다시 만드는 일이고, 못 잡는 다음 형태가 또 나온다. **코드를 스캐너가 볼 수 있는 형태로 두는 게 싸고 확실하다.**

## 위험 요소

**① 번들 경계(G6)는 검증 수단이 없다.** typecheck·테스트 둘 다 통과한 채로 어긋난다. 검증은 `pnpm build` 후 `dist/assets/` 청크 크기 비교 + `grep -rn '@/sidepanel' src/store`가 0인지뿐이다. **`pnpm build`는 사용자 요청 시에만 도는 규칙**이라, 이 그룹의 최종 확인은 `/build` 또는 사용자 승인이 있을 때 한다.

**② content 청크에 `@/lib` 유입(G7 #23).** 안전하다고 판단한 근거는 위에 적었지만, crxjs 청크 분할은 그래프 모양에 따라 바뀐다. **`pnpm check:prearm`으로 사후 확인**하고, 만약 `recorders-entry`가 공유 청크를 갖게 되면 즉시 되돌리고 overlay 사본을 유지한 채 **값만 정본과 일치**시킨다(사유 주석 필수).

**③ 골든 스냅샷이 흔들릴 수 있는 곳은 하나다 — G7 #22.** `escapeMdLinkText` 편입이 markdown 경로 출력을 바꾼다. 흔들리면 **버그가 고쳐진 것**이지만, 스냅샷을 무비판적으로 갱신하면 진짜 회귀가 같이 통과한다. 갱신 전에 `git diff` 스냅샷을 눈으로 읽고 **바뀐 줄이 전부 링크 텍스트 이스케이프인지** 확인한다. #23·#25·#30은 동치 통합이라 스냅샷이 흔들리면 그게 오히려 오류 신호다.

**④ 브라우저 실동작에 걸려 유닛으로 못 잡는 것 3건.**
- G3 클립보드 — jsdom에 `ClipboardItem` 없음. e2e 또는 수동.
- G6 번들 경계 — 위 ①.
- G9 activation 큐 경합 — 두 이벤트의 역순 커밋은 실제 탭 전환·네비게이션 타이밍에서만 난다. 큐 진입 여부는 유닛으로 고정하되 **경합 자체는 수동**이다.

**⑤ G5 #4는 메시지 응답 형태 변경이라 소비처가 딸려온다.** 타입을 먼저 바꿔 컴파일러가 짚게 하는 순서를 지키지 않으면 런타임에서만 터진다. 또 이 응답은 **이슈 제출 경로**라 회귀 시 첨부가 조용히 빠질 수 있다 — 4개 플랫폼(asana·gitlab·clickup·github) 각각의 업로드 성공/실패 판정 분기를 태스크 검증에서 개별로 확인한다.

**⑥ G5 #2의 `refreshFailed` 세우는 지점을 빠뜨리면 반대 방향 회귀가 난다.** 진짜 refresh 실패가 400으로 내려가 "세션 만료" 배너가 **안 뜨고**, 사용자는 왜 연동이 안 되는지 모른 채 남는다. refresh 경로 전수(`createRefreshRunner` + `{github,gitlab,linear,asana}-oauth.ts`의 refresh + Jira 직접 경로)를 grep으로 세어 태스크에 목록으로 박는다.

**⑦ POSTMORTEM 2026-08-16이 기록한 "계획-태스크 불일치".** 이 design.md가 언급한 항목이 tasks.md에 없으면 배치가 조용히 약속을 어긴다. `tasks.md`에 **항목↔태스크 대조표(30행)**를 두고 착수 전·완료 후 두 번 대조한다.
