# 재현 환경에 API 호스트 표시 — 기술 설계

## 개요

새 순수 함수가 네트워크 로그에서 API 호스트 origin 하나를 파생하고, **draft 최초 생성 시점에
`draft.environment` 배열의 단독 원소로 주입**한다. `draft.environment`는 이미 재현 환경의
"사용자 커스텀 행" 배열이고, **화면 2곳 · 본문 빌더 8벌(소비 지점 9곳) · 저장 이슈 상세 ·
`logs.html` Report 탭이 전부 이 배열 하나를 흘려보내므로 배선 수정이 0곳**이다.
`MarkdownContext`에 필드를 추가하지 않고, `IssueRecord` 스키마도 건드리지 않는다.

주입 시점에 `draft`는 `null`이라 `environment`는 항상 빈 배열이다 — "사용자 커스텀 행보다
앞"이라는 순서 정책은 대상이 없다. 결과적 배치는 readonly 6행 직후이고, 그건 파생값 그룹에
인접하므로 그대로 둔다.

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
| AI 메타 주석 | `buildIssueMarkdown.ts:437` | `meta.environment = Object.fromEntries(envRows.map(...))` |
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

**타이밍도 안전하다:** `usePickerMessages.ts:245`의 `isLogFrozen(phase)`(정의는
`sidepanel/lib/log-merge.ts:133`, `FROZEN_PHASES`는 `lib/session-keys.ts:37`)가 drafting/
previewing/done에서 로그 갱신을 멈춘다. drafting 진입 시점에 `networkLog`는 이미 확정 상태다.

**오라벨 리스크가 구조적으로 완화된다:** 커스텀 행은 값 수정·행 삭제가 가능하다. readonly 축은
삭제 버튼이 disabled라 틀린 값을 사용자가 못 지운다. 단, **이 완화는 사용자가 값을 본다는 전제
위에 있다** — 재현 환경 섹션이 기본 접힘이므로 주입 시 펼침이 필요하다(아래 변경 범위).

## 변경 범위

### 새 파일

**`src/sidepanel/lib/apiHostRow.ts`** — 순수 함수 3개 + 상수. 의존성은 타입 import과
`captureLogSupport`뿐.

### 수정 파일

**`src/sidepanel/tabs/DraftingPanel.tsx`** — 세 곳:

1. **`:123-133` draft 생성 `useEffect`** — `environment: []`를 `environment: apiRow ? [apiRow] : []`로.
   `apiRow`는 `apiHostRowFor({ captureMode, logsAttach, networkLog, pageUrl: target?.url })`.
   **selector 추가는 필요 없다** — `captureMode`(`:63`)·`networkLog`(`:79`)·`logsAttach`(`:82`)·
   `target`(`:88`) 전부 이미 구독 중이고 `supportsConsoleNetworkLog`도 이미 import돼 있다(`:42`).
   실질 변경은 import 1줄 + `apiRow` 계산 + deps 3개 추가.
2. **`:588` `defaultOpen={false}` → `defaultOpen={customRows.length > 0}`** — `ReproEnvironmentSection`
   안이고 `customRows`는 `:555`에 이미 있다. 자동 주입 행이 있으면 섹션이 펼쳐져 열린다(사용자가
   직접 추가한 행이 있을 때도 펼쳐지는데, 그쪽도 원하는 동작이다). 이 한 줄이 없으면 PRD 목표 2가
   무력해진다 — 사용자는 Badge 카운트 변화만 보고 값의 존재를 모른 채 제출한다.
3. **`:631-634` 값 `Input`** — `className="flex-1 text-sm"` → `"min-w-0 flex-1 text-sm"` +
   `title={row.value}`. `<input>`은 `truncate` ellipsis가 안 되고, 이 행은 "행 추가" 버튼이
   인라인으로 붙는 마지막 행이라(`:652`) 값 가용폭이 400px 패널에서 ≈152px(21~23자)까지 좁아진다.
   PRD 예시 origin은 46자로 **꼬리(`.qa.skillflo.io` — 이 기능이 전달하려는 환경 식별자)가 잘린다.**
   `title`이 hover 전문 확인 경로를 만들고, `min-w-0`이 좁은 폭에서 행이 컨테이너를 넘겨 가로
   스크롤을 만드는 것을 막는다(`docs/DESIGN.md:219`). 전체 커스텀 행이 함께 이득을 본다.

**`guide/ko/screenshot/issue.md` · `guide/ko/video/issue.md` · `guide/en/...` (4개 파일)**
- 재현 환경 자동 채움 설명에 API Host 설명 추가 + **"안 나오는 경우"**(자기 origin으로만 요청 /
  로그 첨부 off / 요소 스타일 편집 모드). 부재 조건이 전부 "행 없음"으로 관측이 동일해 사용자가
  정상/실패를 구분할 수 없으므로 가이드가 그 역할을 맡는다. element는 제외(게이트 대상).
- `/guide` 스킬로 처리(`guide/AUTHORING.md` 규칙 준수).

**`docs/privacy.ko.md` · `docs/privacy.en.md`**
- 네트워크 로그 파생값이 **이슈 본문 평문**에 새로 실린다 → 대조·갱신. `:82`(로그 첨부 기본 on)·
  `:84`(로그 1건 본문 삽입) 문단 계열에 붙인다. 첨부가 아니라 본문이라는 점, 로그 첨부가 켜진
  상태로 캡처한 screenshot/video/freeform에 한정된다는 점을 함께 적는다.

**`docs/DIRECTORY.md`**
- `:87`이 `src/sidepanel/lib/` 파일을 개별 열거하므로 새 파일 추가는 `/push` 신선도 검사 트리거다.

**`e2e/fixtures/extension.ts`**
- launch args에 `--host-resolver-rules=MAP *.bugshot.test 127.0.0.1` 추가 — 아래 "e2e 인프라" 참조.

### 수정하지 않는 파일 (명시)

`buildIssueMarkdown.ts` · `buildIssueAdf.ts` · `buildNotionIssueBody.ts` ·
`buildLinearIssueBody.ts` · `buildAsanaIssueBody.ts` · `buildClickupIssueBody.ts` ·
`buildMarkdownIssueBody.ts` · `buildSlackBody.ts` · `buildEditorCapture.ts` ·
`buildMarkdownContext.ts` · `buildReportData.ts` · `PreviewPanel.tsx` ·
`DraftDetailDialog.tsx` · `environmentRows.ts` · `editor-store.ts` · `issues-store.ts`
— 전부 `draft.environment`를 흘려보내므로 무수정. **여기를 고치고 있으면 설계에서 이탈한 것이다.**

## 데이터 흐름

```
캡처 종료 (phase → drafting)
  └ isLogFrozen(phase) → networkLog 확정
       │
DraftingPanel useEffect (draft === null일 때 1회)
  └ apiHostRowFor({ captureMode, logsAttach, networkLog, pageUrl })
       ├ 게이트: supportsConsoleNetworkLog(captureMode) && logsAttach && networkLog
       └ deriveApiHostRow(networkLog.requests, pageUrl)
            ├ pageUrl 1회 파싱 → http(s)가 아니면 null
            ├ 페이지 hostname의 registrable domain 계산
            ├ 요청 URL 파싱 (실패 skip), http(s)만
            ├ 후보 조건: { 페이지 origin ≠ } ∧ { registrable 동족 }
            ├ origin별 요청 수 집계 → 최다 1개 (동률이면 먼저 나온 것)
            └ 후보 0개 → null
  └ setDraft({ title, sections: {}, environment: row ? [row] : [] })
       │
       ▼
draft.environment ──┬─→ ReproEnvironmentSection (편집·삭제 UI, 행 있으면 펼쳐서 열림)
                    ├─→ PreviewPanel envRows (미리보기 표)
                    ├─→ buildEditorMarkdownContext → 8개 플랫폼 submit 본문
                    ├─→ buildMarkdownContext ×4 → 마크다운 복사
                    ├─→ deriveContextEnvRows → logs.html Report 탭
                    ├─→ bugshot-meta-for-ai 주석 (buildIssueMarkdown:437)
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

export const API_HOST_LABEL = "API Host";

// 마지막 2레이블을 registrable domain으로 보되, 여기 걸리면 3레이블.
// public suffix list 전량을 번들하지 않는 근사 — 미등재 다단 접미사(github.io 등)는
// 서로 다른 주체의 도메인을 동족으로 **과대포함**한다(위험 1). 반대로 접미사를
// 과다 등록하면 정상 후보가 탈락한다. 둘 다 사용자 수정으로 흡수되는 대가다.
const TWO_LEVEL_SUFFIXES: ReadonlySet<string>;

// hostname → registrable domain. 판정 불가·IP·2레이블 이하는 정규화만 해 그대로 반환.
export function registrableDomain(hostname: string): string;

// 네트워크 요청에서 대표 API origin을 파생해 환경 행으로. 후보 없으면 null.
export function deriveApiHostRow(
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
```

### `registrableDomain` 규칙

```
1. 소문자화 + 트레일링 닷 제거
2. IPv4 형태 / 대괄호 IPv6 / 레이블 2개 이하 → 그대로 반환
3. 마지막 2레이블이 TWO_LEVEL_SUFFIXES에 있으면 마지막 3레이블 (레이블이 3개 미만이면 그대로)
4. 그 외 마지막 2레이블
```

```
api.acme.com          → acme.com
acme.com              → acme.com
api.acme.co.kr        → acme.co.kr      (co.kr ∈ TWO_LEVEL_SUFFIXES)
co.kr                 → co.kr           (레이블 2개 — 규칙 2)
o1.ingest.sentry.io   → sentry.io
localhost             → localhost       (단일 레이블 그대로)
127.0.0.1             → 127.0.0.1       (IPv4 형태면 그대로)
[::1]                 → [::1]
API.Acme.com.         → acme.com        (정규화)
```

`TWO_LEVEL_SUFFIXES` 초안(19개, 실사용 빈도순):
`co.kr` `or.kr` `ne.kr` `co.jp` `ne.jp` `or.jp` `co.uk` `org.uk` `com.au` `com.br`
`com.cn` `com.tw` `com.hk` `com.sg` `co.in` `co.nz` `co.za` `com.mx` `com.tr`

### `deriveApiHostRow` 규칙

1. `pageUrl`을 `new URL()`로 **1회** 파싱한다. throw하거나 `protocol`이 `http:`/`https:`가
   아니면 `null`. `originOf`(`@/lib/session-keys.ts:43`)를 쓰지 않는 이유가 둘이다: ① origin만
   반환해 규칙 2가 필요한 hostname을 못 얻어 같은 문자열을 두 번 파싱해야 한다 ②
   `new URL("file:///x").origin`은 문자열 `"null"`이라 `originOf`가 `null`이 아닌 `"null"`을
   돌려주고, "실패하면 null" 게이트가 발화하지 않은 채 뒤에서 `new URL("null")`이 throw한다
   (`about:blank`·`data:` 동일).
2. 각 요청 URL을 `new URL()`로 파싱, 실패하면 건너뛴다. `protocol`이 `http:`/`https:`가
   아니면 건너뛴다.
3. 후보 조건: `origin !== pageOrigin` **그리고**
   `registrableDomain(reqHostname) === registrableDomain(pageHostname)`.
4. 후보 origin별 요청 수를 세어 최다 1개 선택. 동률이면 배열에서 먼저 등장한 origin.
5. `{ label: API_HOST_LABEL, value: origin }` 반환. 값은 origin 문자열
   (`https://api.acme.com` — 포트가 있으면 포함). 라벨이 `Host`인데 값이 origin인 건 의도다 —
   스킴·포트가 있어야 "붙여서 바로 열 수 있는 값"이 된다.

**포함/제외 판단이 없는 축(의도적 단순화):** status·phase(실패 여부)를 보지 않는다. 실사례가
물은 것은 "이 화면이 어느 API를 보는가"이지 "무엇이 실패했나"가 아니었다. `preArm` 엔트리는
포함한다.

**WebSocket 제외:** `wss://api.acme.com`은 `https://api.acme.com`과 **다른 origin**이라 같은
호스트의 REST 요청과 별개로 집계돼 표를 쪼개고, 본문에 `API Host: wss://…`가 찍힌다. 규칙 2의
스킴 필터가 ws/wss를 걷어낸다. WS-only 백엔드는 이 기능 범위 밖이다.

### `apiHostRowFor` 규칙

```
supportsConsoleNetworkLog(captureMode) && logsAttach && networkLog
  ? deriveApiHostRow(networkLog.requests, pageUrl)
  : null
```

`networkLog.captured > 0`을 게이트에 넣지 않는다 — `captured`는 `requests.length`와 별개
카운터(캡 트림 시 갈린다)이고, `deriveApiHostRow([])`가 이미 `null`이라 방어가 아니라
미검증 분기를 하나 더할 뿐이다.

게이트를 컴포넌트에 인라인하지 않고 이 함수로 내리는 이유: `DraftingPanel`에는 테스트 파일이
없다(`src/sidepanel/tabs/__tests__/`에 부재). 게이트가 거기 있으면 element 모드 누출·
`logsAttach` 무시 같은 회귀가 typecheck·유닛·골든 62개 **전부 green으로 통과한다.**

### 호출부

```tsx
// DraftingPanel.tsx — 기존 useEffect 내부
const apiRow = apiHostRowFor({ captureMode, logsAttach, networkLog, pageUrl: target?.url });
setDraft({
  title: defaultTitle(titlePrefix),
  sections: {},
  environment: apiRow ? [apiRow] : [],
});
```

## e2e 인프라

현재 e2e는 워커 내부 `http.createServer` 1대(`e2e/fixtures/extension.ts`, `listen(0)`)뿐이고
launch args에 `--host-resolver-rules`가 없다. 기존 cross-origin 선례는 `127.0.0.1` vs
`localhost` 하나(`e2e/logs-origin-filter.spec.ts`)인데 **그 조합으로는 이 기능의 행이 생기지
않는다** — `registrableDomain("127.0.0.1") !== registrableDomain("localhost")`라 비동족이다.

`--host-resolver-rules=MAP *.bugshot.test 127.0.0.1`을 추가하면 페이지
`http://app.bugshot.test:PORT` / 요청 `http://api.bugshot.test:PORT/...`가 둘 다
`bugshot.test`로 동족이 된다(`.test`는 예약 TLD라 `TWO_LEVEL_SUFFIXES` 무관, Node http 서버는
Host 헤더를 검사하지 않는다). 공용 픽스처 변경이라 CI 4샤드 전체에 영향이 가고, 기존
`127.0.0.1`/`localhost` spec은 규칙에 안 걸려 무변경이다.

판정은 **미리보기 화면 기준**으로 한다 — 작성 화면 재현 환경 UI에는 `data-testid`가 0개인데
`IssuePreviewView.tsx:113-114`에 `data-testid="env-row"` + `data-env-label`이 이미 있다.
`--lang=ko`가 워커별로 비결정적이라는 기존 함정(`e2e/GOTCHAS.md`) 때문에 placeholder 기반
locator는 쓰지 않는다.

## 기존 패턴 준수

- **CLAUDE.md 캡처 로그 매트릭스 단일 출처**: 모드 게이트는 `supportsConsoleNetworkLog()`를
  쓴다. 새 판정식을 만들지 않는다. 이 축을 빼면 `editor-store.preserveLogs`가 element 진입 시
  로그를 보존하는 경로에서 이전 세션 로그 파생값이 element 이슈에 실려,
  `guide/*/logs/README.md`가 문서화한 "요소 스타일 편집은 로그 미첨부" 약속을 깬다. 실보존
  경로는 `cancelRecording`·`cancelPicking`·`startPicking`·`startElementShot`이다 —
  `reset()`을 타는 취소는 `networkLog`를 `null`로 만들어 게이트를 exercise하지 못한다.
- **테스트 우선**: 신규 순수 함수 3개는 `/tdd interface`로 테스트를 먼저 박는다
  (`src/sidepanel/lib/__tests__/apiHostRow.test.ts`).
- **라벨 하드코딩 영문**: 기존 env 라벨 6종(OS/Browser/Page/DOM/Viewport/Captured)이 전부
  i18n 미사용 하드코딩 영문이다(`environmentRows.ts` · `PreviewPanel.tsx` ·
  `DraftDetailDialog.tsx` · `buildReportData.ts` 4곳 중복). `API Host`도 같게 둬 본문 라벨이
  작성자 로케일에 따라 갈리지 않게 한다. 사용자가 라벨을 `API 호스트`로 고치면 그 값이 그대로
  본문에 나가고 되살아나지 않는다 — 커스텀 행의 기존 동작이다. `src/i18n/` 키 추가가 0개이므로
  i18n PostToolUse 훅·`src/log-viewer/i18n.ts` 복제 사전 대조 대상이 아니다.
- **자동 주입임을 UI에 마킹하지 않는다**: 자동 주입 행은 사용자가 직접 추가한 행과 시각적으로
  동일하다(readonly 행만 `bg-muted`로 구분된다). 마킹을 넣지 않는 이유는 `EnvironmentRow`에
  자동/커스텀 구분 필드가 없어(label·value뿐) 타입 확장이 필요하고, 그 확장이 영속·마이그레이션
  으로 번지기 때문이다. 파생 출처 설명은 가이드(Task 4)가 맡는다.
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

### 대안 D — `tldts` 등 public suffix 라이브러리 도입

정확한 eTLD+1을 얻지만 번들에 수백 KB의 suffix 테이블이 들어오고, `pnpm-workspace.yaml`의
`minimumReleaseAge` 정책 대상이 되며, 사이드패널 초기 로드에 부담이다. 오판정의 대가가
"행이 하나 안 뜬다" 수준이라 근사로 충분하다.

## 위험 요소

1. **`registrableDomain` 근사의 과대포함.** 미등재 다단 접미사(`github.io`, `vercel.app`,
   `pages.dev`)에서 `a.github.io`와 `b.github.io`가 동족으로 판정된다. 서로 다른 주체의
   origin이 API 호스트로 뜰 수 있다(실패 방향은 "행이 안 뜬다"가 아니라 **"틀린 행이 뜬다"**다).
   완화: 값이 커스텀 행이라 사용자가 지울 수 있다. `TWO_LEVEL_SUFFIXES`에 플랫폼 도메인을 넣지
   않는 이유는, 넣으면 오히려 자사 서비스가 그런 호스팅에 있을 때 정상 후보가 탈락하기 때문이다.

2. **draft 생성 시점의 `networkLog` 미도착.** `useEditorSessionSync.ts:144`의 tail sync가
   비동기로 늦게 `setNetworkLog`를 호출할 수 있다. `superseded()` 가드가 보는
   `ACTIVE_CAPTURE_PHASES`는 `{picking, capturing, recording}`뿐이라 **`drafting`에서 통과한다.**
   그 경우 draft가 먼저 만들어져 행이 비고, draft는 1회만 생성되므로 되메우지 않는다.
   `startFreeform`이 `draft=null` + `phase:"drafting"`을 한 커밋에 세팅해 useEffect가 즉시
   발화하므로 **freeform이 이 레이스에 가장 취약하다** — 수동 검증 대상(Task 3 체크리스트).

3. **cross-page 누적 로그가 대표 origin을 오염시킨다.** 로그는 `webNavigation` tail sync +
   `mergeLogItems`로 페이지를 넘어 누적되고 `preArm` 엔트리도 포함된다. 즉 `networkLog.requests`에
   **직전 페이지의 요청**이 섞이고, 그것이 동족이면 요청 수 집계에 들어가 대표 origin을 뒤집을 수
   있다. `req.pageUrl` 필터를 넣지 않는 이유는 캡처 중 이동한 페이지의 요청도 리포트 범위 안이라고
   보기 때문이다(로그 자체가 그 전제로 누적된다). 사용자 수정으로 흡수한다.

4. **영상 트리밍과의 순서.** `sidepanel/30s-replay/apply-trim.ts:77`·
   `sidepanel/30s-replay/use-30s-replay.ts:177`이 `setNetworkLog`로 로그를 좁힌다. `IssueTab.tsx`가
   트림 중 `DraftingPanel`을 언마운트하고 `resolveTrim()`이 그 뒤에 발화하므로 `setNetworkLog`가
   draft 생성보다 항상 앞선다 — 이 경로는 사실상 무해다. 트림으로 API 요청이 전부 잘려나가면 행이
   사라진다(의도된 동작 — 잘린 구간의 요청은 리포트 범위 밖).

5. **사용자가 지운 뒤 되살아나는 경로.** draft가 `null`로 리셋되는 흐름(새 캡처 시작·세션
   초기화)에서는 다시 주입된다. 같은 draft 안에서는 되살아나지 않는다.

6. **`filterEnvironmentRows`의 빈 값 제거.** 사용자가 값을 지워 빈 문자열로 만들면 화면엔
   빈 행이 남고 본문에선 제외된다 — 기존 커스텀 행과 동일한 동작이라 새 위험은 아니다.

7. **중복 `API Host` 라벨.** `filterEnvironmentRows`는 dedupe를 하지 않고(trim + 빈 값 제거만),
   라벨 입력에도 유일성 검증이 없다. 사용자가 `API Host` 라벨 행을 직접 더하면 본문에 두 줄이
   찍힌다(기존 커스텀 행과 동일한 기존 동작). 더 조용한 쪽은 `buildIssueMarkdown.ts:437`의
   `bugshot-meta-for-ai` 주석 — `Object.fromEntries`라 **중복 라벨이 last-wins로 붕괴한다.**
   이 기능이 `API Host`를 사실상 예약 라벨로 만든다는 점만 수용하고 검증은 넣지 않는다.

8. **본문 평문 노출 면적.** `logsDropped`(`background/messages.ts:786-814`) 경로에서 용량 캡으로
   `logs.html`이 빠져도 본문의 `API Host` 줄은 남는다. Slack은 채널 메시지 본문이라 첨부를 열지
   않는 멤버에게도 내부 QA/스테이징 호스트명이 보인다. origin에는 토큰이 없어 `MASKED_QUERY_KEYS`
   관련 위험은 없다. privacy 문안에 "첨부가 아니라 본문 텍스트에 실린다"를 명시한다(Task 5).

9. **privacy 문서 갱신 누락.** 로그 파생값이 본문에 새로 실리므로 manifest diff가 0이어도
   `docs/privacy.{ko,en}.md` 대조가 필수다. 30s Replay가 같은 검사를 빠져나가 웹스토어 심사에
   탈락한 전례가 있다(`docs/POSTMORTEM.md`).

10. **삭제 버튼 `aria-label`이 행을 식별하지 않는다(범위 밖, 수용).** 재현 환경의 삭제 버튼 7개가
    전부 `t("common.delete")` 하나라 스크린 리더로 "어느 행의 삭제"인지 분간할 수 없다. 이 기능은
    "삭제로 오판정에 대응하라"를 완화책으로 삼으므로 그 접근성이 전제로 승격되지만, 기존 결함이고
    `readonly` 행까지 함께 건드려야 하는 인접 개선이라 이 스코프에 넣지 않는다.
