# 감사 후속 정비 — 기술 설계

## 개요

63건의 발견을 **위험도가 아니라 "무엇이 무엇을 지켜주는가"의 의존 순서**로 6+1개 웨이브에 배정한다. 핵심 설계 결정은 하나다 — **그물(W0)이 수정보다 먼저 간다.** 감사가 드러낸 가장 값진 것은 개별 결함이 아니라 **두 개의 구조적 사각지대**였다: log-viewer 복제 사전의 키 스캐너가 공용 컴포넌트를 안 훑어 WS 키 10개가 v1.4.0부터 raw 노출돼 있었고, `pruneOrphanBlobs`는 테스트가 0건이라 fail-closed 위반이 POSTMORTEM 2026-07-23의 재발방지 항목을 통과해 버렸다. 이 두 그물을 먼저 치면 나머지 61건의 수정이 만드는 회귀도 함께 잡힌다.

그다음은 **회귀 귀속 가능성**이 순서를 정한다. content script 무간섭 규칙(W3)과 세션·데이터 흐름(W4)은 e2e·단위 테스트가 못 잡는 구간을 많이 포함하므로 웨이브를 잘게 끊어 커밋하고, 웨이브마다 `/e2e-run`을 통과시킨다.

## 변경 범위

이 트랙은 **문서만 산출**한다. 아래는 후속 구현이 건드릴 영역의 맵이며, 구현 시점의 참조표다.

### 그물 (W0) — 테스트 인프라

| 파일 | 현재 역할 | 변경 내용 |
|---|---|---|
| `src/log-viewer/__tests__/i18n.test.ts` | 복제 사전 ko/en 대칭·placeholder·메인 테이블 drift 검사. `walk(srcRoot)`가 **`src/log-viewer/`만** 스캔 | 스캔 범위를 log-viewer가 import하는 **공용 컴포넌트**(`src/sidepanel/components/{Network,Console,Action}LogContent.tsx`, `IssuePreviewView.tsx`와 그 하위 `OriginFilterBar`·`LogSeekChip`·`JsonTreeViewer`)까지 확장 |
| `src/store/__tests__/issues-store.test.ts` | 마이그레이션·CRUD 검사 | `pruneOrphanBlobs` fail-closed 케이스 신규 추가 (storage reject 시 삭제 0건) |

### 🔴 즉시 (W1)

| 파일 | 현재 역할 | 변경 내용 |
|---|---|---|
| `src/log-viewer/App.tsx:251` | logs.html 푸터의 이슈 링크 | `href`에 스킴 가드. 순수 헬퍼로 추출해 두 소비처(`IssueTitleOverlay.tsx:17`)가 공유 |
| `src/lib/`(신규) | — | `isSafeExternalUrl(url)` 순수 헬퍼 신설. `^https?://`만 통과 |
| `src/store/chrome-storage.ts:4-12` | zustand persist용 `StateStorage` | `getItem`이 실패를 삼켜 `null` 반환 → **rethrow**로 전환(fail-closed). zustand가 에러 경로로 인식해야 prune이 스킵된다 |
| `src/store/issues-store.ts:433` | `onRehydrateStorage: () => () => void pruneOrphanBlobs()` | 콜백 2번째 인자 `error`를 받아 **에러 시 prune 스킵**. 판정부를 export된 순수 함수로 분리해 테스트 가능하게 |
| `src/log-viewer/i18n.ts` | 복제 ko/en 사전 | WebSocket 키 10개 × 2 = 20개 항목 추가 |
| `src/background/messages.ts:204` | `captureVisibleTab` 핸들러 | 스로틀 슬롯 획득 **후** `tab.active` 재확인. `capture-throttle` 큐 안에서 검사해야 의미가 있다 |
| `src/content/network-recorder-helpers.ts:32-45` | `MASKED_QUERY_KEYS`(= `MASKED_BODY_KEYS` 별칭) | 두 Set을 **분리**하고 자격증명 키 확장. `code`는 query 전용(본문의 `code`는 오탐 많음). `maskBody`에 `text/plain` JSON 휴리스틱 추가 |
| `src/sidepanel/lib/ai-provider.ts:468-488, 541, 567` | Anthropic 프로바이더 | `x-api-key`를 싣는 fetch에 `redirect:"manual"` + opaqueredirect 명시 에러 |
| `src/sidepanel/video-recorder.ts:60-75, 190` | `onstop` / `cancelRecording` | `state=null` 이후 finalize 구간에도 취소가 닿도록 `finalizing` 상태 도입 |
| `oauth-proxy/worker.ts:279-320, 435` | Atlassian 토큰 핸들러 / CORS origin 해석 | Atlassian에 configured 가드 + client_id 화이트리스트 추가(나머지 7개와 대칭). `ALLOWED_ORIGINS`의 `*` 거부 |

### content script 무간섭 (W3)

| 파일 | 변경 내용 |
|---|---|
| `src/content/console-recorder.ts:90-231` | 16개 wrap의 `pushEntry(...)`를 try/catch로 감싸고, **`capturing` 게이트를 직렬화보다 앞으로** 이동 |
| `src/content/action-recorder.ts:367, 483, 511` | click·keydown·input/change 핸들러에 `if (!capturing) return;` 추가 (pointerdown `:392`·dragstart `:453`와 대칭) |
| `src/content/network-recorder.ts:287-293` | `setRequestHeader`가 **원본을 먼저** 호출하고 기록을 try/catch |
| `src/content/network-recorder.ts:426-462` | `sendBeacon` 기록 블록 try/catch |
| `src/content/network-recorder.ts:549-554` | `ws.send` 원본 우선 호출로 순서 교정 |
| `src/content/action-recorder-helpers.ts:6` | `SENSITIVE_NAME_RE`에 `key`·`otp`·`passphrase`·`mnemonic`·`credential` 추가 |

> **이 영역의 절대 제약**: `recorders-entry` 청크는 `src/content/` 밖으로 나가는 **runtime import가 0개**여야 crxjs가 동기 IIFE로 emit한다(감사에서 현재 0개 확인됨). 위 파일들을 고치며 공용 헬퍼를 `src/lib/`로 빼면 pre-arm이 무력화된다.

### 세션·데이터 흐름 (W4) · UI (W5) · 코드 헬스 (W6)

항목이 많아 `tasks.md`의 항목별 "대상"을 정본으로 둔다. 주요 파일: `src/store/issues-store.ts`, `src/store/blob-db.ts`, `src/content/css-source-cache.ts`, `src/content/css-resolve.ts`, `src/content/frame-geometry.ts`, `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/hooks/useEditorSessionSync.ts`, `src/sidepanel/tabs/DraftingPanel.tsx`, `src/sidepanel/lib/buildNotionIssueBody.ts`, `src/content/overlay.ts`, `src/sidepanel/lib/{buildIssueMarkdown,renderMarkdown,markdownToAsanaHtml}.ts`, `src/lib/session-keys.ts`.

## 데이터 흐름

정비 트랙 자체는 런타임 데이터 흐름을 바꾸지 않는다. **흐름이 바뀌는 항목은 셋뿐이고**, 셋 다 "실패를 삼키던 경로가 실패를 전파하게" 되는 방향이다.

```
① prune fail-closed (A-02)
   현재: storage.get 실패 → catch → null → zustand "저장분 없음" → issues:[] 
         → pruneOrphanBlobs가 currentIds=∅ 로 전 blob 삭제
   변경: storage.get 실패 → throw → zustand rehydrate 에러 경로
         → onRehydrateStorage(state, error) 의 error!=null → prune 스킵
   (원본 JSON은 그대로 남고, 다음 정상 오픈에서 복구된다)

② captureVisibleTab 소유권 (A-05)
   현재: sendBg → tabs.get(windowId 추출) → [큐 대기 최대 ~2.6s] → captureVisibleTab(windowId)
                                                                   └ "그 창에서 지금 보이는 탭"
   변경: sendBg → [큐 대기] → tabs.get 재조회 → !active면 throw → captureVisibleTab
   (호출부는 이미 전부 active 탭을 전제하므로, 조용한 오캡처가 명시적 실패로 바뀐다)

③ Anthropic BYOK redirect (A-07)
   현재: fetch(baseUrl/messages, {headers:{x-api-key}})  ── 302 ──▶ 타 호스트로 키 전달
         (Authorization과 달리 커스텀 헤더는 스펙상 제거 대상이 아님)
   변경: redirect:"manual" → opaqueredirect(status 0) → 명시적 에러로 중단
```

나머지 60건은 **동작 불변**(상수 추출·주석·aria 속성·테스트 추가)이거나 **결함 경로만 교정**(오탐 마스킹·소유권 재검사·리스너 게이트)이다.

## 인터페이스 설계

정비 트랙에서 신설되는 공개 인터페이스는 **2개뿐**이다. 나머지는 기존 함수의 내부 교정.

```ts
// src/lib/external-url.ts (신규) — A-01
// logs.html은 확장 페이지가 아니라 CSP가 없고, React 프로덕션 빌드는 javascript: href를 막지 않는다.
// 외부 URL을 href/tabs.create로 흘리는 지점의 단일 게이트.
export function isSafeExternalUrl(url: string | undefined | null): boolean;
export function safeExternalHref(url: string | undefined | null): string | undefined;

// src/store/issues-store.ts — A-02
// zustand postRehydration 콜백은 성공·에러 양쪽에서 발화하므로 판정을 순수 함수로 분리해 테스트한다.
export function shouldPruneAfterRehydrate(error: unknown): boolean;
```

기존 시그니처 변경:

```ts
// src/content/network-recorder-helpers.ts — A-06
// 현재: const MASKED_BODY_KEYS = MASKED_QUERY_KEYS  (별칭)
// 변경: 두 Set을 분리. query에만 있는 키(code)를 본문에 적용하면 오탐이 크다.
export const MASKED_QUERY_KEYS: Set<string>;   // + code, client_secret, session_token, …
const MASKED_BODY_KEYS: Set<string>;           // + client_secret, newPassword, currentPassword, …

// src/store/chrome-storage.ts — A-02
// getItem이 더 이상 실패를 삼키지 않는다. 반환 타입은 동일하나 reject 가능.
async getItem(name: string): Promise<string | null>;  // throws on storage error
```

## 기존 패턴 준수

이 트랙에서 특히 걸리는 CLAUDE.md·ARCHITECTURE.md 규약:

- **`recorders-entry` 동기 IIFE 제약** — W3가 손대는 3개 레코더는 self-contained 청크의 구성원이다. 공용 헬퍼 추출 금지. (A-43이 이 제약 때문에 "수정하면 안 되는 항목"이 된다.)
- **log-viewer 복제 사전** — `src/log-viewer/i18n.ts`는 별도 빌드라 메인 i18n을 import 못 한다. 공용 컴포넌트에 키를 추가하면 **두 사전을 함께** 갱신한다. W0가 이걸 테스트로 강제한다.
- **i18n ko/en 동시 갱신** — `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행한다. log-viewer 사전은 이 훅에 **안 걸리고** `pnpm test`에서만 잡힌다.
- **fail-closed GC** — ARCHITECTURE "로컬 orphan GC는 fail-closed다". 참조 집합 계산이 실패하면 prune 전체를 스킵한다. A-02·A-30·A-47이 이 원칙의 적용이다.
- **`sameElementKey` 복합키** — selector 단독 비교 금지(감사에서 위반 0건 확인). W4 수정 중 새로 도입하지 않는다.
- **`bodyBlocks` 단일 출처** — A-31(Notion 번호 목록)이 빌더를 건드리므로 8개 빌더 대칭을 깨지 않는지 확인한다.
- **`captureVisibleTab` 단일 관문** — A-05는 관문 자체를 강화한다. 호출부에 검사를 추가하는 방향(현재 `scroll-capture.ts`만 갖고 있는 방식)으로 가면 또 호출부마다 빠뜨린다.
- **DESIGN.md §14 진행 중 잠금** — A-34·A-38이 `disabled` → `aria-disabled` + 핸들러 가드로 바꾼다. `aria-disabled`는 클릭이 실제로 들어오므로 **핸들러 가드를 반드시 함께** 넣는다.
- **주석 최소화·`@/` 경로·외과적 변경** — 전 항목 공통.

## 대안 검토

**대안 1 — 63건 일괄 수정 후 한 번에 e2e.**
채택 안 함. 회귀가 나면 귀속이 불가능하다. 이 저장소는 캡처·picker 경로에서 "특정 모드만 깨짐"이 원인 추적의 결정적 단서였던 전례(POSTMORTEM 2026-07-17)가 있는데, 63건이 섞이면 그 단서가 사라진다. 또 `DraftDetailDialog`·`ai-provider` 같은 핵심 파일이 동시에 바뀌면 diff 리뷰 자체가 불가능해진다.

**대안 2 — 위험도 순서(🔴 → 🟡 → ⚪)로만 진행.**
채택 안 함. 위험도는 "얼마나 나쁜가"이지 "무엇이 무엇을 지켜주는가"가 아니다. 🔴 A-03(WS i18n 키 누락)을 그냥 고치면 **같은 사각지대가 다음 키 추가에서 또 뚫린다** — 스캐너 범위 확장(W0)이 먼저 가야 키 추가가 영구히 잠긴다. 마찬가지로 A-02를 테스트 없이 고치면 POSTMORTEM 2026-07-23이 이미 "회귀 테스트를 반드시 둔다"고 적어둔 항목을 또 테스트 없이 통과시키는 것이다. 그래서 W0을 위험도 밖에 따로 뒀다.

**대안 3 — 발견을 GitHub 이슈로 쪼개 추적.**
채택 안 함. 이 저장소의 확립된 흐름은 `docs/features/<slug>/`에 문서를 두고 다른 환경에서 pull 받아 잇는 것이다(`ai-draft-matching-log`·`log-viewer-timeline` 선례). 이슈 트래커를 새로 끌어들이면 추적면이 둘로 갈린다.

**대안 4 — 구조 리팩터(A-40·A-41·A-45)를 함께 처리.**
채택 안 함. CLAUDE.md "요청하지 않은 추상화 추가 금지"에 정면으로 걸리고, `DraftDetailDialog.tsx`(1285줄) 같은 제출 경로 핵심 파일이 통째로 바뀌면 8개 플랫폼 제출이 전부 회귀 후보가 된다. 중복 자체는 사실이지만 **지금 깨져 있지 않다.** 별도 트랙 승격 여부만 `tasks.md`에 기록한다.

## 위험 요소

**함정 1 — FIFO 캡 상수를 중앙화하면 pre-arm이 죽는다 (A-43).**
`log-merge.ts`(5000/2000/1000)와 `content/*-recorder.ts`의 같은 값은 **중복이 아니라 번들 격리의 결과**다. 공용 상수 모듈로 빼는 순간 `recorders-entry` 청크에 외부 static import가 생겨 crxjs가 async loader로 되돌리고, document_start 후크가 페이지 인라인 스크립트보다 늦게 깔려 pre-arm 버퍼링이 통째로 무력화된다. **허용되는 수정은 동기화 주석 추가뿐이다.**

**함정 2 — `encodeURIComponent` 일괄 적용은 GitLab을 깬다 (A-62).**
`gitlab-api.ts`의 `/projects/${projectId}` 자리에는 숫자 ID뿐 아니라 이미 URL-encoded된 project path(`group%2Fsub%2Frepo`)가 올 수 있다. 일괄 인코딩하면 `%` → `%25` 이중 인코딩으로 404가 된다. 감사도 "공격 경로 미확인"으로 분류했다. **일관성만을 위해 건드리지 않는다.**

**함정 3 — 마스킹 강화는 재현값을 죽인다 (A-06·A-18).**
POSTMORTEM 2026-07-14가 정확히 이 오탐을 회고한다 — `pin`⊂ship**pin**g, `auth`⊂**auth**or, 구분자에 `.`을 넣으면 소수·IP가 9자리 숫자열로 승격. 그래서 A-06은 **부분일치가 아니라 exact-match Set 확장**으로 제한하고, `code`는 query 전용으로 좁힌다. 마스킹을 늘릴 때는 **오탐 negative case를 반드시 함께** 고정한다(기존 `action-recorder-helpers.test.ts`의 "부분일치 오탐 방지"·"소수·IP는 원문 유지" 케이스가 선례).

**함정 4 — `redirect:"manual"`은 정상 게이트웨이를 깰 수 있다 (A-07).**
baseUrl 끝 슬래시 차이 등으로 301/308을 내는 프록시가 있으면 요청이 실패한다. 그래서 **키가 실제로 새는 Anthropic 경로에만** 적용하고, OpenAI-compatible(`Authorization`은 스펙상 cross-origin에서 제거됨)은 그대로 둔다. opaqueredirect는 status 0이라 일반 에러와 구분되지 않으므로 **전용 에러 메시지**를 붙인다.

**함정 5 — `aria-disabled` 전환은 클릭을 통과시킨다 (A-34·A-38).**
`disabled`를 떼면 버튼이 실제로 클릭 가능해진다. 핸들러 가드를 빠뜨리면 진행 중 재클릭으로 **중복 제출·중복 캡처**가 난다. 기존 8개 커넥트 폼이 쓰는 패턴을 그대로 복제한다.

**함정 6 — statusBadges raw `<button>` → shadcn 전환은 e2e 셀렉터를 흔든다 (A-34).**
7개 파일의 DOM 구조·클래스가 바뀐다. e2e가 `data-testid`로 잡고 있는지 먼저 확인하고, 아니면 testid를 **먼저** 추가한 뒤 전환한다(`/e2e-write`가 src에 허용하는 유일한 수정이 testid 추가다).

**함정 7 — A-04(frameToken)는 부분 수정이 더 위험하다.**
`postMessage`의 targetOrigin을 조이거나 토큰을 회전시켜도 **수신 window의 페이지 스크립트가 여전히 읽는다** — 공유 secret을 postMessage로 나르는 구조 자체가 문제다. 어설픈 완화는 "고쳤다"는 착시만 남긴다. 설계 교체(chrome 경로 frameId registry) 전까지 **열어두는 것이 정직하다.**

**함정 8 — `chrome-storage.getItem` rethrow의 파급 (A-02).**
이 스토리지는 `issues-store`뿐 아니라 `settings-store`도 쓴다. rethrow하면 설정 rehydrate도 에러 경로를 타므로, **두 스토어의 에러 경로 동작을 함께 확인**해야 한다. 사용자 눈에 보이는 결과는 "빈 상태"로 동일하되, 조용한 데이터 삭제가 사라지는 것이 목적이다.

**함정 9 — 이미 내보낸 `logs.html`은 소급되지 않는다 (A-03).**
`pnpm build:log-viewer` 후 재내보내기해야 반영된다. 기존 첨부 파일의 raw 키 노출은 고쳐지지 않는다(POSTMORTEM 2026-06-28의 같은 지적).
