# 재현 환경에 API 호스트 표시 — 기술 설계

## 개요

새 순수 함수가 네트워크 로그에서 동족 API hostname 목록을 파생하고, 요청 횟수 내림차순으로
`, ` 연결해 `draft.environment`에 자동 행 하나로 주입한다. `draft.environment`는 이미 재현 환경의
"사용자 커스텀 행" 배열이고, **화면 2곳 · 본문 빌더 8벌(소비 지점 9곳) · 저장 이슈 상세 ·
`logs.html` Report 탭이 전부 이 배열 하나를 흘려보내므로 배선 수정이 0곳**이다.
`MarkdownContext`에 필드를 추가하지 않고, `IssueRecord` 스키마도 건드리지 않는다.

주입 시점에 `draft`는 `null`이라 `environment`는 항상 빈 배열이다 — "사용자 커스텀 행보다
앞"이라는 순서 정책은 대상이 없다. 결과적 배치는 readonly 6행 직후이고, 그건 파생값 그룹에
인접하므로 그대로 둔다.

삭제 미부활 래치(`apiHostsDismissed`)와 마지막 파생값(`apiHostsDerived`)은 **editor-store
persist 필드 2개**로 유지한다(`reproPrefillDone` 동형) — 컴포넌트 로컬에 두면 미리보기
왕복(`backToDraft`)·패널 재오픈에서 `DraftingPanel`이 언마운트돼 래치가 증발하고 삭제한 행이
부활한다. 동기화 판정 자체는 순수 리듀서 `syncApiHostsRow`가 맡아 단위 트랙에서 테스트한다.

## 왜 이 구조인가 (선행 조사 결과)

2026-07-30 이전 시도는 `MarkdownContext.apiOrigin` 필드를 추가해 9개 소비 지점을 개별 수정하는
경로를 택했다가 ctx 팩토리 배선을 놓쳐 "화면엔 보이고 제출 본문엔 없는" 비대칭을 만들고
롤백됐다. 그 전제를 재검증한 결과가 아래다.

**`ctx.environment`는 모든 조립 지점을 관통한다:**

| 지점 | 코드 | 소비 방식 |
|---|---|---|
| 작성 화면 | `DraftingPanel.tsx:555` (파일 내부 `ReproEnvironmentSection`, `:501`) | `customRows = draft.environment ?? []` |
| 미리보기 화면 | `PreviewPanel.tsx:151` | `filterEnvironmentRows(draft.environment ?? [])` |
| 마크다운 emitter | `buildIssueMarkdown.ts:247` | `for (const row of filterEnvironmentRows(ctx.environment))` |
| HTML emitter | `buildIssueMarkdown.ts:346` | 동일 |
| ADF·Notion·Linear·Asana·ClickUp·Slack·GFM 빌더 | 각 빌더 | 동일 패턴 (github/gitlab은 `buildMarkdownIssueBody` 위임) |
| AI 메타 주석 | `buildIssueMarkdown.ts:439` | `meta.environment = Object.fromEntries(envRows.map(...))` |
| `logs.html` Report 탭 | `buildReportData.ts:28` | `rows.push(...filterEnvironmentRows(ctx.environment))` |
| 저장 이슈 상세 | `DraftDetailDialog.tsx:1232` | `rows.push(...filterEnvironmentRows(issue.draft.environment ?? []))` |
| 저장 이슈 재제출 ctx | `DraftDetailDialog.tsx:351` | `environment: issue.draft.environment ?? []` |
| 제출 ctx 팩토리 | `buildEditorCapture.ts:52` | `environment: draft.environment ?? []` |
| 복사 ctx 팩토리 | `PreviewPanel.tsx:295,311,327,351` | `environment: draft.environment ?? []` |

즉 `draft.environment`에 행을 하나 넣으면 **위 전부가 자동으로 출력한다.** 이전 시도가
"결정해야 한다"고 남긴 5개 조립 지점 배선·`IssueRecord` 영속·팩토리 누락 그물이 전부 소멸한다.

**영속도 자동이다:** 저장 이슈는 `issue.draft.environment`를 그대로 읽는다 — 스키마 변경·
마이그레이션 불필요. 세션 스냅샷도 `draft`를 통째로 직렬화한다.

**그물도 이미 있다:** `bodyOutputGolden.test.ts:105`의 픽스처가
`environment: [{ label: "Locale", value: "ko-KR" }]`로 커스텀 행을 넣어 62개 스냅샷 전수를
봉인 중이다. 커스텀 행이 전 소비 지점에 나온다는 사실은 이미 테스트로 고정돼 있다.

**대부분의 캡처 타이밍은 안전하다:** `usePickerMessages.ts:245`의 `isLogFrozen(phase)`(정의는
`sidepanel/lib/log-merge.ts:133`, `FROZEN_PHASES`는 `lib/session-keys.ts:37`)가 drafting/
previewing/done에서 로그 갱신을 멈춘다. 다만 세션 hydrate와 tail sync는 drafting 뒤에도 로그가
도착할 수 있으므로 자동 행 동기화가 그 지연을 흡수한다.

**오라벨 리스크가 구조적으로 완화된다:** 커스텀 행은 값 수정·행 삭제가 가능하다. readonly 축은
삭제 버튼이 disabled라 틀린 값을 사용자가 못 지운다. 단, **이 완화는 사용자가 값을 본다는 전제
위에 있다** — 재현 환경 섹션이 기본 접힘이므로 주입 시 펼침이 필요하다(아래 변경 범위).

## 변경 범위

### 새 파일

**`src/sidepanel/lib/apiHostRow.ts`** — 순수 함수 4개 + 상수. 의존성은 타입 import과
`captureLogSupport`뿐.

### 수정 파일

**`src/types/environment.ts`**
- `EnvironmentRow`에 선택적 `source: "api-hosts"`를 추가한다. 화면에는 표시하지 않는 내부
  메타데이터이며, 로그 토글 off·지연 로그 도착·사용자 삭제를 일반 커스텀 행과 구분하는 데 쓴다.
  선택 필드라 기존 저장 데이터 마이그레이션은 없다.

**`src/store/editor-store.ts` · `src/sidepanel/hooks/useEditorSessionSync.ts`**
- `apiHostsDismissed: boolean`(삭제 래치) · `apiHostsDerived: string | null`(마지막 파생값)
  2개 필드를 `reproPrefillDone` 동형으로 추가한다 — 선언·initial·setter·`EditorSnapshot`
  pick(`editor-store.ts`) + 세션 pick(`useEditorSessionSync.ts:98` 인접). ARCHITECTURE.md의
  함정대로 **`EditorSnapshot` Pick 목록과 `snapshotFromState()` 두 곳을 함께** 손대지 않으면
  조용히 초기값으로 리셋된다. draft 뮤테이터·본문 경로는 계속 무수정이다.

**`src/sidepanel/tabs/DraftingPanel.tsx`** — 네 곳:

1. **draft 자동 행 동기화 `useEffect`** — `apiHostRowFor({ captureMode, logsAttach, networkLog,
   pageUrl: target?.url })` 결과를 `syncApiHostsRow` 리듀서에 넘겨 `source === "api-hosts"` 행을
   주입·갱신·제거한다. effect는 배선만 하고 판정은 전부 리듀서(순수 함수)에 있다:
   - **등가 short-circuit**: 리듀서가 변화 없으면 `rows` 참조를 그대로 반환하고, effect는 그때
     write를 생략한다. 유일한 draft 뮤테이터 `setDraft`(`editor-store.ts:738`)가 전체 교체라
     무조건 write하면 draft identity가 매번 바뀌어 **무한 루프**다.
   - **write 시점 `getState().draft` 읽기**: stale closure로 쓰면 `useReproPrefill.ts:107-115`의
     비동기 AI prefill `setDraft`와 last-write-wins 경합으로 prefill된 sections를 조용히 지운다.
     deps 규율은 `useReproPrefill.ts:150-153` 주석("deps는 발화 판정용 원시 값만")을 따른다.
   - **삭제 래치는 추론하지 않는다**: 행 부재로 삭제를 감지하는 대신, 커스텀 행 삭제 버튼
     핸들러가 `source === "api-hosts"` 행일 때 `apiHostsDismissed`를 직접 세운다. 로그 첨부
     off로 리듀서가 행을 제거한 경우와 구분할 필요가 없어진다.
   - 로그 첨부 off → 자동 행 제거. 다시 on(캡처 시 off였던 경우 포함) → **재주입한다** —
     사용자가 능동적으로 첨부를 켠 상황이라 파생값도 함께 제공한다. 미부활은 명시 삭제
     래치에만 걸린다.
   selector 추가는 래치 2개(`apiHostsDismissed`·`apiHostsDerived`)뿐이다 — `captureMode`(`:63`)·
   `networkLog`(`:79`)·`logsAttach`(`:82`)·`target`(`:88`)은 이미 구독 중이고
   `supportsConsoleNetworkLog`도 이미 import돼 있다(`:42`).
2. draft 최초 생성은 빈 environment로 시작할 수 있으며 위 동기화가 현재 또는 지연 도착 로그를
   반영한다. 자동 행 source는 사용자가 값을 수정한 뒤에도 유지하되, **사용자가 고친 행(값 ≠
   `apiHostsDerived`)은 이후 파생 결과로 덮지 않는다**(목표 2 — 리듀서 규칙 참조).
3. 재현 환경 섹션을 controlled `open`/`onOpenChange`로 전환하고, 자동 행을 **주입하는 시점**에
   `setOpen(true)`한다 — 같은 파일 `SectionTextarea`(`:679`)의 "삽입 전 먼저 펼침" 선례.
   defaultOpen을 ref로 고정하는 방식은 주입이 useEffect(최초 렌더 이후)라 접힌 채 굳고, 지연
   주입(freeform — 위험 2)에서 성공 기준(펼쳐진 채 표시)을 깬다. controlled 전환은 `Section`의
   defaultOpen→state 재동기화가 사용자 수동 조작을 덮는 함정도 회피한다. 펼침은 스크롤 위치까지
   보장하지 않는다 — 섹션이 뷰포트 밖이면 스크롤 도달 시 보이는 것으로 수용한다(자동
   scrollIntoView는 과잉).
4. 값 `Input`에 `min-w-0`을 추가하고 **모든 커스텀 행**의 값 Input을 Radix Tooltip으로 감싸
   hover·focus 모두에서 전문을 보여준다. 값이 비면 `TooltipContent`를 렌더하지 않는다
   (`IssueTab.tsx:368-389` 조건부 렌더 선례). Provider는 전역이 아니라 컴포넌트 로컬로 둔다
   (`TooltipIconButton.tsx` 관례 — `delayDuration` 지정). 긴 값이 패널을 뚫지 않도록
   `TooltipContent`에 `max-w-*` + `break-all`을 건다(`StyleEditorPanel.tsx:535-542`의
   `max-w-60` 선례). `<input>`은 `truncate` ellipsis가 안 되고, 이 행은 "행 추가" 버튼이
   인라인으로 붙는 마지막 행이라(`:652`) 값 가용폭이 400px 패널에서 ≈152px(21~23자)까지 좁아진다.
   PRD 예시 origin은 46자로 **꼬리(`.qa.skillflo.io` — 이 기능이 전달하려는 환경 식별자)가 잘린다.**
   Tooltip이 전문 확인 경로를 만들고, `min-w-0`이 좁은 폭에서 행이 컨테이너를 넘겨 가로
   스크롤을 만드는 것을 막는다(`docs/DESIGN.md:219`). 전체 커스텀 행이 함께 이득을 본다.

**`guide/ko/screenshot/issue.md` · `guide/ko/video/issue.md` · `guide/en/...` (4개 파일)**
- 재현 환경 자동 채움 설명에 API Hosts 설명 추가 + **"안 나오는 경우"**(자기 hostname으로만 요청 /
  로그 첨부 off / 요소 스타일 편집 모드). 부재 조건이 전부 "행 없음"으로 관측이 동일해 사용자가
  정상/실패를 구분할 수 없으므로 가이드가 그 역할을 맡는다. element는 제외(게이트 대상).
- `/guide` 스킬로 처리(`guide/AUTHORING.md` 규칙 준수).

**`docs/privacy.ko.md` · `docs/privacy.en.md`**
- 네트워크 로그 파생값이 **이슈 본문 평문**에 새로 실린다 → 대조·갱신. `:82`(로그 첨부 기본 on)·
  `:84`(로그 1건 본문 삽입) 문단 계열에 붙인다. 첨부가 아니라 본문이라는 점, 로그 첨부가 켜진
  screenshot/video/freeform draft에 한정되고 토글 off 시 자동 행도 제거된다는 점을 함께 적는다.

**`docs/DIRECTORY.md`**
- `:87`이 `src/sidepanel/lib/` 파일을 개별 열거하므로 새 파일 추가는 `/push` 신선도 검사 트리거다.

**`e2e/fixtures/extension.ts`**
- launch args에 `--host-resolver-rules=MAP *.bugshot.test 127.0.0.1` 추가 — 아래 "e2e 인프라" 참조.

### 수정하지 않는 파일 (명시)

`buildIssueMarkdown.ts` · `buildIssueAdf.ts` · `buildNotionIssueBody.ts` ·
`buildLinearIssueBody.ts` · `buildAsanaIssueBody.ts` · `buildClickupIssueBody.ts` ·
`buildMarkdownIssueBody.ts` · `buildSlackBody.ts` · `buildEditorCapture.ts` ·
`buildMarkdownContext.ts` · `buildReportData.ts` · `PreviewPanel.tsx` ·
`DraftDetailDialog.tsx` · `environmentRows.ts` · `issues-store.ts`
— 전부 `draft.environment`를 흘려보내므로 무수정. **여기를 고치고 있으면 설계에서 이탈한 것이다.**
(`editor-store.ts`는 래치 필드 2개 추가에 한정해 수정 대상이다 — draft 뮤테이터·본문 경로를
고치고 있으면 마찬가지로 이탈.)

## 데이터 흐름

```
캡처 종료 (phase → drafting)
  └ isLogFrozen(phase) → networkLog 확정
       │
DraftingPanel 자동 행 동기화 useEffect
  └ apiHostRowFor({ captureMode, logsAttach, networkLog, pageUrl })
       ├ 게이트: supportsConsoleNetworkLog(captureMode) && logsAttach && networkLog
       └ deriveApiHostsRow(networkLog.requests, pageUrl)
            ├ pageUrl 1회 파싱 → http(s)가 아니면 null
            ├ 페이지 hostname의 registrable domain 계산
            ├ 요청 URL 파싱 (실패 skip), http(s)만
            ├ 후보 조건: { 페이지 hostname ≠ } ∧ { registrable 동족 }
            ├ hostname별 요청 수 집계 → count 내림차순, 첫 등장 순 tie-break
            ├ hostname을 `, `로 연결
            └ 후보 0개 → null
  └ syncApiHostsRow(rows, apiRow, dismissed, lastDerived) — 행 주입·갱신·제거·보존 판정
       │
       ▼
draft.environment ──┬─→ ReproEnvironmentSection (편집·삭제 UI, 행 있으면 펼쳐서 열림)
                    ├─→ PreviewPanel envRows (미리보기 표)
                    ├─→ buildEditorMarkdownContext → 8개 플랫폼 submit 본문
                    ├─→ buildMarkdownContext ×4 → 마크다운 복사
                    ├─→ deriveContextEnvRows → logs.html Report 탭
                    ├─→ bugshot-meta-for-ai 주석 (buildIssueMarkdown:439)
                    └─→ IssueRecord.draft.environment (영속)
                          └─→ DraftDetailDialog EnvBlock + buildCtxForSubmit
```

## 인터페이스 설계

```ts
// src/sidepanel/lib/apiHostRow.ts
import type { CaptureMode } from "@/sidepanel/lib/buildCaptureFiles";
import type { EnvironmentRow } from "@/types/environment";
import type { NetworkLog, NetworkRequest } from "@/types/network";
import { supportsConsoleNetworkLog } from "@/sidepanel/lib/captureLogSupport";

export const API_HOSTS_LABEL = "API Hosts";

// hostname → registrable domain. PSL 판정은 tldts에 위임한다(대안 D 참조).
// IP·판정 불가는 정규화만 해 그대로 반환.
export function registrableDomain(hostname: string): string;

// 네트워크 요청에서 동족 hostname 목록을 파생해 환경 행으로. 후보 없으면 null.
export function deriveApiHostsRow(
  requests: readonly Pick<NetworkRequest, "url">[],
  pageUrl: string | undefined,
): EnvironmentRow | null;

// 게이트 + 파생을 묶은 단일 진입점. DraftingPanel은 이것만 호출한다.
export function apiHostRowFor(input: {
  captureMode: CaptureMode;
  logsAttach: boolean;
  networkLog: NetworkLog | null;
  pageUrl: string | undefined;
}): EnvironmentRow | null;

// 자동 행 동기화 판정 — effect는 반환 rows가 입력과 참조 동일하면 write를 생략한다.
// dismissed 전이는 여기서 하지 않는다(삭제 버튼 핸들러가 직접 세움).
export function syncApiHostsRow(input: {
  rows: readonly EnvironmentRow[];
  apiRow: EnvironmentRow | null;   // apiHostRowFor 결과
  dismissed: boolean;              // apiHostsDismissed (store persist)
  lastDerived: string | null;      // apiHostsDerived (store persist)
}): { rows: readonly EnvironmentRow[]; lastDerived: string | null };
```

### `syncApiHostsRow` 규칙

```
apiRow == null                                  → source 행 제거(있으면), lastDerived = null
apiRow != null ∧ 행 없음 ∧ dismissed             → 무변화
apiRow != null ∧ 행 없음 ∧ !dismissed            → 주입, lastDerived = apiRow.value
apiRow != null ∧ 행 있음 ∧ 행 값 == lastDerived  → 값 갱신 (사용자 미수정)
apiRow != null ∧ 행 있음 ∧ 행 값 != lastDerived  → 무변화 (사용자 수정 보존 — 목표 2)
```

무변화 분기는 입력 `rows` 참조를 그대로 반환한다 — 호출부 short-circuit의 근거.

### `registrableDomain` 규칙

```
1. 소문자화 + 트레일링 닷 제거
2. 빈 문자열 / IPv4 형태 / 대괄호 IPv6 → 그대로 반환 (PSL 대상이 아니다)
3. 그 외 tldts의 getDomain(host, { allowPrivateDomains: true }) — 실패하면 입력 그대로
```

`allowPrivateDomains`가 핵심이다. PSL private 섹션을 접미사로 인정해야 `me.github.io`·
`myapp.vercel.app`·`my-bucket.s3.amazonaws.com`이 **각각 자기 자신**을 도메인으로 갖고,
그래서 형제 배포·남의 버킷이 동족 판정에서 자동으로 탈락한다.

```
api.acme.com                → acme.com
acme.com                    → acme.com
api.acme.co.kr              → acme.co.kr
co.kr                       → co.kr                      (접미사 자체)
cs.snu.ac.kr                → snu.ac.kr                   (ac.kr — 하드코딩 없이)
o1.ingest.sentry.io         → sentry.io
me.github.io                → me.github.io                (private 접미사)
myapp.vercel.app            → myapp.vercel.app            (private 접미사)
my-bucket.s3.amazonaws.com  → my-bucket.s3.amazonaws.com  (private 접미사)
localhost                   → localhost
127.0.0.1                   → 127.0.0.1                   (규칙 2)
[::1]                       → [::1]                       (규칙 2)
API.Acme.com.               → acme.com                    (정규화)
```

### `deriveApiHostsRow` 규칙

1. `pageUrl`을 `new URL()`로 **1회** 파싱한다. throw하거나 `protocol`이 `http:`/`https:`가
   아니면 `null`. `originOf`(`@/lib/session-keys.ts:43`)를 쓰지 않는 이유가 둘이다: ① origin만
   반환해 규칙 2가 필요한 hostname을 못 얻어 같은 문자열을 두 번 파싱해야 한다 ②
   `new URL("file:///x").origin`은 문자열 `"null"`이라 `originOf`가 `null`이 아닌 `"null"`을
   돌려주고, "실패하면 null" 게이트가 발화하지 않은 채 뒤에서 `new URL("null")`이 throw한다
   (`about:blank`·`data:` 동일).
2. 각 요청 URL을 `new URL()`로 파싱, 실패하면 건너뛴다. `protocol`이 `http:`/`https:`가
   아니면 건너뛴다.
3. 후보 조건: `hostname !== pageHostname` **그리고**
   `registrableDomain(reqHostname) === registrableDomain(pageHostname)`. 비교 전 양쪽
   hostname을 소문자화 + 트레일링 닷 제거로 정규화한다 — `new URL().hostname`은 트레일링
   닷을 보존하므로 raw 비교면 `app.acme.com.` 요청이 자기 페이지인데도 후보로 재포함된다.
4. 후보 hostname별 요청 수를 세어 count 내림차순으로 정렬한다. 동률이면 배열에서 먼저 등장한
   hostname 순서를 유지한다.
5. `{ label: API_HOSTS_LABEL, value: hostnames.join(", "), source: "api-hosts" }` 반환.
   hostname만 실어 scheme·port·path·query를 제외하고 내부 환경 식별에 필요한 면적만 노출한다.

**포함/제외 판단이 없는 축(의도적 단순화):** status·phase(실패 여부)를 보지 않는다. 실사례가
물은 것은 "이 화면이 어느 API를 보는가"이지 "무엇이 실패했나"가 아니었다. `preArm` 엔트리는
포함한다.

**WebSocket 제외:** `wss://api.acme.com`은 `https://api.acme.com`과 **다른 origin**이라 같은
호스트의 REST 요청과 별개로 집계돼 표를 쪼개므로 규칙 2의
스킴 필터가 ws/wss를 걷어낸다. WS-only 백엔드는 이 기능 범위 밖이다.

### `apiHostRowFor` 규칙

```
supportsConsoleNetworkLog(captureMode) && logsAttach && networkLog
  ? deriveApiHostsRow(networkLog.requests, pageUrl)
  : null
```

`networkLog.captured > 0`을 게이트에 넣지 않는다 — `captured`는 `requests.length`와 별개
카운터(캡 트림 시 갈린다)이고, `deriveApiHostsRow([])`가 이미 `null`이라 방어가 아니라
미검증 분기를 하나 더할 뿐이다.

게이트를 컴포넌트에 인라인하지 않고 이 함수로 내리는 이유: `DraftingPanel`에는 테스트 파일이
없다(`src/sidepanel/tabs/__tests__/`에 부재). 게이트가 거기 있으면 element 모드 누출·
`logsAttach` 무시 같은 회귀가 typecheck·유닛·골든 62개 **전부 green으로 통과한다.**

### 호출부

```tsx
// DraftingPanel.tsx — 자동 행 동기화 effect 내부
const apiRow = apiHostRowFor({ captureMode, logsAttach, networkLog, pageUrl: target?.url });
syncAutoApiHostsRow(apiRow);
```

## e2e 인프라

현재 e2e는 워커 내부 `http.createServer` 1대(`e2e/fixtures/extension.ts`, `listen(0)`)뿐이고
launch args에 `--host-resolver-rules`가 없다. 기존 cross-origin 선례는 `127.0.0.1` vs
`localhost` 하나(`e2e/logs-origin-filter.spec.ts`)인데 **그 조합으로는 이 기능의 행이 생기지
않는다** — `registrableDomain("127.0.0.1") !== registrableDomain("localhost")`라 비동족이다.

`--host-resolver-rules=MAP *.bugshot.test 127.0.0.1`을 추가하면 페이지
`http://app.bugshot.test:PORT` / 요청 `http://api.bugshot.test:PORT/...`가 둘 다
`bugshot.test`로 동족이 된다(`.test`는 PSL에 등재된 예약 TLD라 `tldts`가 `bugshot.test`를
registrable domain으로 돌려준다 — 실측 확인. Node http 서버는 Host 헤더를 검사하지 않는다). 공용 픽스처 변경이라 CI 4샤드 전체에 영향이 가고, 기존
`127.0.0.1`/`localhost` spec은 규칙에 안 걸려 무변경이다. **함정**: `fixtureTabId`의 기본
매치 패턴이 `http://127.0.0.1/*`라 `bugshot.test` 페이지는 **명시 패턴을 넘기지 않으면 탭
식별이 실패한다** — spec에서 match 패턴을 전달할 것.

판정은 **미리보기 화면 기준**으로 한다 — 작성 화면 재현 환경 UI에는 `data-testid`가 0개인데
`IssuePreviewView.tsx:113-114`에 `data-testid="env-row"` + `data-env-label`이 이미 있다.
작성 화면의 "섹션이 펼쳐진다" 단언은 `Section`에 `testId` 부착(`DraftingPanel.tsx:575`에서
prop 미전달 — `/e2e-write`가 부착)이 **선행돼야** 스크립트 판정이 가능하다.
`--lang=ko`가 워커별로 비결정적이라는 기존 함정(`e2e/GOTCHAS.md`) 때문에 placeholder 기반
locator는 쓰지 않는다.

## 기존 패턴 준수

- **CLAUDE.md 캡처 로그 매트릭스 단일 출처**: 모드 게이트는 `supportsConsoleNetworkLog()`를
  쓴다. 새 판정식을 만들지 않는다. 이 축을 빼면 `editor-store.preserveLogs`가 element 진입 시
  로그를 보존하는 경로에서 이전 세션 로그 파생값이 element 이슈에 실려,
  `guide/*/logs/README.md`가 문서화한 "요소 스타일 편집은 로그 미첨부" 약속을 깬다. 실보존
  경로는 6곳(`startPicking`·`cancelPicking`·`startCapturing`·`startFreeform`·
  `startElementShot`·`cancelRecording`)이고, element 누출을 exercise하는 경로는
  `startPicking`(기본 `captureMode: "element"`)이다 — `startElementShot`은
  `captureMode: "screenshot"`을 세팅하므로 게이트 검증에 못 쓴다. `reset()`을 타는 취소는
  `networkLog`를 `null`로 만들어 역시 게이트를 exercise하지 못한다.
- **테스트 우선**: 신규 순수 함수 4개(`registrableDomain`·`deriveApiHostsRow`·`apiHostRowFor`·
  `syncApiHostsRow`)는 `/tdd interface`로 테스트를 먼저 박는다
  (`src/sidepanel/lib/__tests__/apiHostRow.test.ts`).
- **라벨 하드코딩 영문**: 기존 env 라벨 6종(OS/Browser/Page/DOM/Viewport/Captured)이 전부
  i18n 미사용 하드코딩 영문이다(`environmentRows.ts` · `PreviewPanel.tsx` ·
  `DraftDetailDialog.tsx` · `buildReportData.ts` · `buildIssueAdf.ts` 5곳 중복). `API Hosts`도 같게 둬 본문 라벨이
  작성자 로케일에 따라 갈리지 않게 한다. 사용자가 라벨을 `API 호스트`로 고치면 그 값이 그대로
  본문에 나가고 되살아나지 않는다 — 커스텀 행의 기존 동작이다. `src/i18n/` 키 추가가 0개이므로
  i18n PostToolUse 훅·`src/log-viewer/i18n.ts` 복제 사전 대조 대상이 아니다.
- **자동 주입임을 UI에 마킹하지 않는다**: 자동 주입 행은 사용자가 직접 추가한 행과 시각적으로
  동일하다(readonly 행만 `bg-muted`로 구분된다). `source` 필드는 이 설계가 이미 추가하지만
  **동기화용 내부 메타데이터로만** 쓴다 — UI 마킹까지 하려면 배지·아이콘 등 시각 언어를 새로
  정의해야 하는데, 기존 커스텀 행과 동일 취급이 학습 비용 0이고 파생 출처 설명은 가이드(Task 4)가
  맡는다.
- **store가 컴포넌트 그래프를 안 끌어들인다**: `apiHostRow.ts`는 `sidepanel/lib/`에 두고
  store에서 import하지 않는다(호출은 컴포넌트에서).

## 대안 검토

### 대안 A — `MarkdownContext.apiOrigin` 필드 + readonly 행 (이전 시도 경로)

`deriveReadonlyEnvRows`에 행을 추가하고 9개 소비 지점의 하드코딩 라인에 각각 배선. 채택하지 않은
이유가 셋이다: ① 수정 지점이 15곳 이상으로 늘고 그중 하나라도 놓치면 화면↔본문 비대칭이 생긴다
(실제로 이전 시도가 그렇게 실패했다) ② 저장 이슈 표시에 `IssueRecord` 스키마 확장 + 마이그레이션이
필요하다 ③ readonly 행은 삭제 버튼이 disabled라 휴리스틱 오판정을 사용자가 지울 수 없다.

### 대안 B — ctx 조립 시점에 `environment` 배열과 합성

`environment: [apiRow, ...draft.environment]` 형태로 4개 팩토리 + 화면 2곳에서 합성. 소비 지점은
무수정이지만 조립 지점이 6곳으로 늘고, 사용자가 값을 고칠 방법이 없다(파생값이 매번 덮어씀).
draft 주입 방식이 이 둘을 동시에 해결한다.

### 대안 C — 실패 요청만 후보 (이전 시도의 판정 로직)

`status >= 400 || phase === "error"`인 요청만 본다. 정상 동작 중 캡처한 리포트에서는 행이 아예
안 뜨고, 실사례의 질문("어느 URL에서 확인하냐")에 답하지 못한다. 실패 축은 API 호스트 식별과
직교한다.

### 대안 D — `tldts` public suffix 라이브러리 도입 (**채택**)

초안은 이걸 기각했다. 사유는 "번들 부담 vs 오판정의 대가가 '행이 하나 안 뜬다' 수준"이었는데,
**그 대가 산정이 틀렸다.** 근사가 틀리는 방향은 부재가 아니라 **과대포함**이다 — `a.github.io`
페이지에서 `b.github.io`가, `my-bucket.s3.amazonaws.com`에서 남의 버킷이 동족으로 잡히면
**남의 조직 hostname이 이슈 본문과 Slack 채널 메시지에 실린다.** 유출 방향 실패를 "사용자가
지우면 된다"로 흡수할 수 없다(이미 제출했으면 늦다).

그래서 `tldts@7.4.8`을 도입하고 `registrableDomain`을 `getDomain(host, { allowPrivateDomains: true })`
위임으로 바꿨다. `allowPrivateDomains`가 PSL private 섹션(`github.io`·`vercel.app`·`s3.amazonaws.com`
등)을 접미사로 인정하므로, 하드코딩 목록 두 벌(`TWO_LEVEL_SUFFIXES` 19개 + 호스팅 도메인 가드)이
통째로 사라진다. IPv4·대괄호 IPv6·빈 문자열은 여전히 앞단에서 그대로 반환한다.

대가는 **사이드패널 엔트리 청크 +122 kB(gzip +45 kB, 1,711→1,834 kB)**. background·picker·
pre-arm 청크는 무영향이다. 정책 위반 없음 — 2018년 패키지라 `minimumReleaseAge` 통과, 빌드
스크립트가 없어 `onlyBuiltDependencies` 무관, 정확한 버전으로 핀.

## 위험 요소

1. **~~`registrableDomain` 근사의 과대포함~~ — 해소됨(대안 D 채택).** 하드코딩 접미사 목록이
   미등재 다단 접미사에서 남의 조직 hostname을 동족으로 끌어오던 문제(실패 방향이 "행이 안
   뜬다"가 아니라 **"틀린 hostname이 포함된다"**였다)는 `tldts` PSL 위임으로 사라졌다.
   잔여 위험은 PSL 자체의 지연뿐이다 — 갓 등록된 private 접미사는 다음 `tldts` 릴리스까지
   반영되지 않는다. 그 창에서는 값이 커스텀 행이라 사용자가 지울 수 있다는 기존 완화가 남는다.

2. **draft 생성 시점의 `networkLog` 미도착.** `useEditorSessionSync.ts:144`의 tail sync가
   비동기로 늦게 `setNetworkLog`를 호출할 수 있다. `superseded()` 가드가 보는
   `ACTIVE_CAPTURE_PHASES`는 `{picking, capturing, recording}`뿐이라 **`drafting`에서 통과한다.**
   `startFreeform`이 `draft=null` + `phase:"drafting"`을 한 커밋에 세팅해 useEffect가 즉시
   발화하므로 **freeform이 이 레이스에 가장 취약하다.** 자동 행 동기화는 늦게 도착한 로그를
   최초 1회 반영해야 하며, 비어 있으면 성공 기준 실패다.

3. **cross-page 누적 로그가 hostname 목록을 오염시킨다.** 로그는 `webNavigation` tail sync +
   `mergeLogItems`로 페이지를 넘어 누적되고 `preArm` 엔트리도 포함된다. 즉 `networkLog.requests`에
   **직전 페이지의 요청**이 섞이고, 그것이 동족이면 hostname 목록과 정렬에 들어갈 수 있다.
   `req.pageUrl` 필터를 넣지 않는 이유는 캡처 중 이동한 페이지의 요청도 리포트 범위 안이라고
   보기 때문이다(로그 자체가 그 전제로 누적된다). 사용자 수정으로 흡수한다.

4. **영상 트리밍과의 순서.** `sidepanel/30s-replay/apply-trim.ts:77`·
   `sidepanel/30s-replay/use-30s-replay.ts:177`이 `setNetworkLog`로 로그를 좁힌다. `IssueTab.tsx`가
   트림 중 `DraftingPanel`을 언마운트하고 `resolveTrim()`이 그 뒤에 발화하므로 `setNetworkLog`가
   draft 생성보다 항상 앞선다 — 이 경로는 사실상 무해다. 트림으로 API 요청이 전부 잘려나가면 행이
   사라진다(의도된 동작 — 잘린 구간의 요청은 리포트 범위 밖).

5. **사용자가 지운 뒤 되살아나는 경로.** draft가 `null`로 리셋되는 흐름(새 캡처 시작·세션
   초기화)에서는 `...initial`이 래치도 리셋해 다시 주입된다 — 의도된 동작. 같은 draft
   안에서는 래치가 store persist라 미리보기 왕복(`backToDraft`의 `DraftingPanel` 언마운트)·
   사이드패널 재오픈에도 되살아나지 않는다.

6. **`filterEnvironmentRows`의 빈 값 제거.** 사용자가 값을 지워 빈 문자열로 만들면 화면엔
   빈 행이 남고 본문에선 제외된다 — 기존 커스텀 행과 동일한 동작이라 새 위험은 아니다.

7. **중복 `API Hosts` 라벨.** `filterEnvironmentRows`는 dedupe를 하지 않고(trim·빈 값 제거·
   값 개행→공백 치환만, `environmentRows.ts:15-22`), 라벨 입력에도 유일성 검증이 없다. 사용자가
   `API Hosts` 라벨 행을 직접 더하면 본문에 두 줄이 찍힌다(기존 커스텀 행과 동일한 기존 동작).
   더 조용한 쪽은 `buildIssueMarkdown.ts:439`의 `bugshot-meta-for-ai` 주석 —
   `Object.fromEntries`라 **중복 라벨이 last-wins로 붕괴한다.** 이 기능이 `API Hosts`를 사실상
   예약 라벨로 만든다는 점만 수용하고 검증은 넣지 않는다. (참고: 이 함수는 행을
   `{label, value}`로 재조립하므로 `source`는 모든 출력에서 벗겨진다 — 내부 메타데이터 의도와
   부합. 역으로 `source`를 출력·필터에 쓰는 확장은 이 함수 확장이 선행돼야 한다.)

8. **본문 평문 노출 면적.** `logsDropped`(`background/messages.ts:786-814`)는 **첨부 업로드
   실패**(`uploadAttachment` catch) 시 세팅된다 — 그렇게 `logs.html`이 빠진 리포트에도 본문의
   `API Hosts` 줄은 남는다. Slack은 채널 메시지 본문이라 첨부를 열지 않는 멤버에게도 내부
   QA/스테이징 호스트명이 보인다. hostname에는 토큰이 없어 `MASKED_QUERY_KEYS` 관련 위험은
   없다. privacy 문안에 "첨부가 아니라 본문 텍스트에 실린다"를 명시한다(Task 5).

9. **privacy 문서 갱신 누락.** 로그 파생값이 본문에 새로 실리므로 manifest diff가 0이어도
   `docs/privacy.{ko,en}.md` 대조가 필수다. 30s Replay가 같은 검사를 빠져나가 웹스토어 심사에
   탈락한 전례가 있다(CLAUDE.md "문서 신선도" 절에 기록).

10. **삭제 버튼 `aria-label`이 행을 식별하지 않는다 — 범위 밖으로 확정.**

    재현 환경의 삭제 버튼은 readonly 6개(`DraftingPanel.tsx:609`)·커스텀 행(`:647`) 전부
    `aria-label={t("common.delete")}` 하나이고 `title`도 같다. 스크린 리더로는 "어느 행의
    삭제"인지 분간할 수 없다. 이 기능이 "오판정은 삭제로 대응하라"를 유일한 완화책으로 삼으므로
    삭제 어포던스의 접근성이 기능 전제로 승격된다 — 그래서 위험으로 남긴다.

    **"기존 관행이라 유지"는 근거가 되지 않는다.** 저장소에 행 식별 `aria-label` 선례가 3건
    있다 — `SettingsTab.tsx:430`의 `t("settings.reorder.handle", { label })`은 이것과 같은
    "반복 행 + 행마다 하나씩 있는 컨트롤" 형태에서 라벨을 보간한다(그 외
    `IntegrationsTab.tsx:231`·`LogSeekChip.tsx:21`). 플랫 라벨은 하우스 스타일이 아니라 이
    섹션만의 예외다.

    그럼에도 범위 밖인 이유는 셋이다:

    - **이 기능이 만드는 상태에서는 모호성이 발생하지 않는다.** readonly 6개는 `disabled`
      (`:610`)라 포커스를 받지 않고, 자동 주입 직후 커스텀 행은 1개다 — 즉 스크린 리더
      사용자가 탭으로 만나는 **활성 삭제 버튼이 정확히 하나**다. "휴리스틱 값을 지운다"는
      경로는 이 기능이 만드는 상태에서 온전히 작동한다.
    - **깨지는 조건은 사용자가 직접 행을 추가한 뒤**이고, 그건 이 기능과 무관하게 오늘도
      같다. 이 변경이 만든 결함이 아니다(CLAUDE.md 외과적 변경 — 인접 개선 금지).
    - 고치려면 `readonly` 분기까지 함께 손대야 하고 새 i18n 키 쌍(ko/en)이 필요해,
      이 기능이 0건으로 유지하는 i18n 표면을 열게 된다.

    **다만 개선이 사소하다는 점은 인정한다** — 리뷰에서 다시 제안될 경우의 형태를 미리 적어
    둔다: `draft.envRowDelete`(`{label}` 보간) 키를 ko/en에 추가하고 두 분기의 `aria-label`을
    그걸로 교체(약 4줄 + 키 2개). 별도 커밋으로 분리하면 이 기능의 diff를 오염시키지 않는다.
    **이 스코프에서는 하지 않는다.**
