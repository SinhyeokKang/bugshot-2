# 재현 환경에 API 호스트 표시 — 기술 설계

## 개요

새 순수 함수가 네트워크 로그에서 API 호스트 origin 하나를 파생하고, **draft 최초 생성 시점에
`draft.environment` 배열의 첫 원소로 주입**한다. `draft.environment`는 이미 재현 환경의
"사용자 커스텀 행" 배열이고, **화면 2곳 · 본문 emitter 9곳 · 저장 이슈 상세 · `logs.html`
Report 탭이 전부 이 배열 하나를 흘려보내므로 배선 수정이 0곳**이다. `MarkdownContext`에 필드를
추가하지 않고, `IssueRecord` 스키마도 건드리지 않는다.

## 왜 이 구조인가 (선행 조사 결과)

2026-07-30 이전 시도는 `MarkdownContext.apiOrigin` 필드를 추가해 9개 emitter를 개별 수정하는
경로를 택했다가 ctx 팩토리 배선을 놓쳐 "화면엔 보이고 제출 본문엔 없는" 비대칭을 만들고
롤백됐다. 그 전제를 재검증한 결과가 아래다.

**`ctx.environment`는 모든 조립 지점을 관통한다:**

| 지점 | 코드 | 소비 방식 |
|---|---|---|
| 작성 화면 | `DraftingPanel.tsx:556` | `customRows = draft.environment ?? []` |
| 미리보기 화면 | `PreviewPanel.tsx:151` | `filterEnvironmentRows(draft.environment ?? [])` |
| 마크다운 emitter | `buildIssueMarkdown.ts:247` | `for (const row of filterEnvironmentRows(ctx.environment))` |
| HTML emitter | `buildIssueMarkdown.ts:346` | 동일 |
| ADF·Notion·Linear·Asana·ClickUp·Slack·md 공용 | 각 빌더 | 동일 패턴 |
| `logs.html` Report 탭 | `buildReportData.ts:28` | `rows.push(...filterEnvironmentRows(ctx.environment))` |
| 저장 이슈 상세 | `DraftDetailDialog.tsx:1232` | `rows.push(...filterEnvironmentRows(issue.draft.environment ?? []))` |
| 저장 이슈 재제출 ctx | `DraftDetailDialog.tsx:351` | `environment: issue.draft.environment ?? []` |
| 제출 ctx 팩토리 | `buildEditorCapture.ts:53` | `environment: draft.environment ?? []` |
| 복사 ctx 팩토리 | `PreviewPanel.tsx:295,311,327,351` | `environment: draft.environment ?? []` |

즉 `draft.environment`에 행을 하나 넣으면 **위 전부가 자동으로 출력한다.** 이전 시도가
"결정해야 한다"고 남긴 5개 조립 지점 배선·`IssueRecord` 영속·팩토리 누락 그물이 전부 소멸한다.

**영속도 자동이다:** 저장 이슈는 `issue.draft.environment`를 그대로 읽는다 — 스키마 변경·
마이그레이션 불필요.

**그물도 이미 있다:** `bodyOutputGolden.test.ts:105`의 픽스처가
`environment: [{ label: "Locale", value: "ko-KR" }]`로 커스텀 행을 넣어 62개 스냅샷 전수를
봉인 중이다. 커스텀 행이 9개 emitter 전부에 나온다는 사실은 이미 테스트로 고정돼 있다.

**타이밍도 안전하다:** `usePickerMessages.ts:249`의 `isLogFrozen(phase)`가 drafting/previewing/
done에서 로그 갱신을 멈춘다(`FROZEN_PHASES`, `lib/session-keys.ts:37`). drafting 진입 시점에
`networkLog`는 이미 확정 상태다.

**오라벨 리스크가 구조적으로 완화된다:** 커스텀 행은 값 수정·행 삭제가 가능하다. readonly 축은
삭제 버튼이 disabled라 틀린 값을 사용자가 못 지운다.

## 변경 범위

### 새 파일

**`src/sidepanel/lib/apiHostRow.ts`** — 순수 함수 2개 + 상수. 의존성은 타입 import뿐.

### 수정 파일

**`src/sidepanel/tabs/DraftingPanel.tsx`** (`:124-135`)
- 현재 역할: draft가 없고 캡처 산출물이 준비되면 초기 draft를 1회 생성하는 `useEffect`.
- 변경: `environment: []`를 `environment: apiRow ? [apiRow] : []`로. `apiRow`는 게이트 통과 시
  `deriveApiHostRow(...)` 결과. store에서 `networkLog`·`logsAttach`를 읽는 selector 2줄 추가
  (`captureMode`는 이미 이 컴포넌트가 구독 중).

**`guide/ko/screenshot/issue.md` · `guide/ko/video/issue.md` · `guide/en/...` (4개 파일)**
- 재현 환경 자동 채움 설명에 API Host 한 문장 추가. element는 제외(게이트 대상).
- `/guide` 스킬로 처리(`guide/AUTHORING.md` 규칙 준수).

**`docs/privacy.ko.md` · `docs/privacy.en.md`**
- 네트워크 로그 파생값이 이슈 본문에 새로 실린다 → 대조·갱신 + 시행일 bump. 로그 첨부가
  켜진 캡처에 한정된다는 조건을 함께 적는다.

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
  ├ 게이트: supportsConsoleNetworkLog(captureMode)
  │        && logsAttach && networkLog.captured > 0
  ├ deriveApiHostRow(networkLog.requests, target.url)
  │    ├ 페이지 hostname의 registrable domain 계산
  │    ├ 요청 origin 중 { 페이지 origin ≠ } ∧ { registrable 동족 } 만 후보
  │    ├ origin별 요청 수 집계 → 최다 1개 (동률이면 먼저 나온 것)
  │    └ 후보 0개 → null
  └ setDraft({ title, sections: {}, environment: row ? [row] : [] })
       │
       ▼
draft.environment ──┬─→ ReproEnvironmentSection (편집·삭제 UI)
                    ├─→ PreviewPanel envRows (미리보기 표)
                    ├─→ buildEditorMarkdownContext → 8개 플랫폼 submit 본문
                    ├─→ buildMarkdownContext ×4 → 마크다운 복사
                    ├─→ deriveContextEnvRows → logs.html Report 탭
                    └─→ IssueRecord.draft.environment (영속)
                          └─→ DraftDetailDialog EnvBlock + buildCtxForSubmit
```

## 인터페이스 설계

```ts
// src/sidepanel/lib/apiHostRow.ts
import type { EnvironmentRow } from "@/types/environment";
import type { NetworkRequest } from "@/types/network";

export const API_HOST_LABEL = "API Host";

// 마지막 2레이블을 registrable domain으로 보되, 여기 걸리면 3레이블.
// public suffix list 전량을 번들하지 않는 근사 — 미등재 다단 접미사(github.io 등)는
// 서로 다른 도메인을 동족으로 오판할 수 있으나, 그 경우 행이 생기는 방향이 아니라
// "생기지 않는" 방향으로 보수적으로 틀린다(아래 registrableDomain 주석 참조).
const TWO_LEVEL_SUFFIXES: ReadonlySet<string>;

// hostname → registrable domain. 판정 불가·IP·단일 레이블은 입력 그대로 반환.
export function registrableDomain(hostname: string): string;

// 네트워크 요청에서 대표 API origin을 파생해 환경 행으로. 후보 없으면 null.
export function deriveApiHostRow(
  requests: readonly Pick<NetworkRequest, "url">[],
  pageUrl: string,
): EnvironmentRow | null;
```

### `registrableDomain` 규칙

```
api.acme.com          → acme.com
acme.com              → acme.com
api.acme.co.kr        → acme.co.kr      (co.kr ∈ TWO_LEVEL_SUFFIXES)
o1.ingest.sentry.io   → sentry.io
localhost             → localhost       (단일 레이블 그대로)
127.0.0.1             → 127.0.0.1       (IPv4 형태면 그대로)
```

`TWO_LEVEL_SUFFIXES` 초안(약 16개, 실사용 빈도순):
`co.kr` `or.kr` `ne.kr` `co.jp` `ne.jp` `or.jp` `co.uk` `org.uk` `com.au` `com.br`
`com.cn` `com.tw` `com.hk` `com.sg` `co.in` `co.nz` `co.za` `com.mx` `com.tr`

### `deriveApiHostRow` 규칙

1. `originOf(pageUrl)`(`@/lib/session-keys.ts` 재사용)로 페이지 origin·hostname 확보.
   실패하면 `null`.
2. 각 요청 URL을 `new URL()`로 파싱, 실패하면 건너뛴다.
3. 후보 조건: `origin !== pageOrigin` **그리고**
   `registrableDomain(reqHostname) === registrableDomain(pageHostname)`.
4. 후보 origin별 요청 수를 세어 최다 1개 선택. 동률이면 배열에서 먼저 등장한 origin.
5. `{ label: API_HOST_LABEL, value: origin }` 반환. 값은 origin 문자열
   (`https://api.acme.com` — 포트가 있으면 포함).

**포함/제외 판단이 없는 축(의도적 단순화):** status·phase(실패 여부)를 보지 않는다. 실사례가
물은 것은 "이 화면이 어느 API를 보는가"이지 "무엇이 실패했나"가 아니었다. WebSocket 엔트리
(`webSocket` 필드 보유)도 별도 분기 없이 같은 규칙을 탄다 — 그 origin이 동족이면 후보다.
`preArm` 엔트리도 포함한다.

### 호출부

```tsx
// DraftingPanel.tsx — 기존 useEffect 내부
const apiRow =
  supportsConsoleNetworkLog(captureMode) && logsAttach && networkLog && networkLog.captured > 0
    ? deriveApiHostRow(networkLog.requests, target?.url ?? "")
    : null;
setDraft({
  title: defaultTitle(titlePrefix),
  sections: {},
  environment: apiRow ? [apiRow] : [],
});
```

## 기존 패턴 준수

- **CLAUDE.md 캡처 로그 매트릭스 단일 출처**: 모드 게이트는 `supportsConsoleNetworkLog()`를
  쓴다. 새 판정식을 만들지 않는다. 이 축을 빼면 `editor-store.preserveLogs`가 element 진입 시
  로그를 보존하는 경로(스크린샷 캡처 → element 픽)에서 이전 세션 로그 파생값이 element 이슈에
  실려, `guide/*/logs/README.md`가 문서화한 "요소 스타일 편집은 로그 미첨부" 약속을 깬다.
- **테스트 우선**: 신규 순수 함수 2개는 `/tdd interface`로 테스트를 먼저 박는다
  (`src/sidepanel/lib/__tests__/apiHostRow.test.ts`).
- **`originOf` 재사용**: `@/lib/session-keys.ts:43`. import 0의 순수 모듈이고
  `sidepanel/lib/logOrigin.ts`가 이미 쓴다. `safeOrigin` 류를 새로 만들지 않는다.
- **라벨 하드코딩 영문**: 기존 env 라벨 6종(OS/Browser/Page/DOM/Viewport/Captured)이 전부
  i18n 미사용 하드코딩 영문이다. `API Host`도 같게 둬 본문 라벨이 작성자 로케일에 따라
  갈리지 않게 한다.
- **store가 컴포넌트 그래프를 안 끌어들인다**: `apiHostRow.ts`는 `sidepanel/lib/`에 두고
  store에서 import하지 않는다(호출은 컴포넌트에서).

## 대안 검토

### 대안 A — `MarkdownContext.apiOrigin` 필드 + readonly 행 (이전 시도 경로)

`deriveReadonlyEnvRows`에 행을 추가하고 9개 emitter의 하드코딩 라인에 각각 배선. 채택하지 않은
이유가 셋이다: ① 수정 지점이 15곳 이상으로 늘고 그중 하나라도 놓치면 화면↔본문 비대칭이 생긴다
(실제로 이전 시도가 그렇게 실패했다) ② 저장 이슈 표시에 `IssueRecord` 스키마 확장 + 마이그레이션이
필요하다 ③ readonly 행은 삭제 버튼이 disabled라 휴리스틱 오판정을 사용자가 지울 수 없다.

### 대안 B — ctx 조립 시점에 `environment` 배열과 합성

`environment: [apiRow, ...draft.environment]` 형태로 4개 팩토리 + 화면 2곳에서 합성. emitter는
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

1. **`registrableDomain` 근사의 오판정.** 미등재 다단 접미사(`github.io`, `vercel.app`,
   `pages.dev`)에서 `a.github.io`와 `b.github.io`가 동족으로 판정된다. 이 경우 서로 다른
   주체의 origin이 API 호스트로 뜰 수 있다. 완화: 값이 커스텀 행이라 사용자가 지울 수 있다.
   `TWO_LEVEL_SUFFIXES`에 플랫폼 도메인을 넣지 않는 이유는, 넣으면 오히려 자사 서비스가
   그런 호스팅에 있을 때 정상 후보가 탈락하기 때문이다.

2. **draft 생성 시점의 `networkLog` 미도착.** `useEditorSessionSync.ts:144`의 tail sync가
   비동기로 늦게 `setNetworkLog`를 호출할 수 있다. 그 경우 draft가 먼저 만들어져 행이 비게
   된다. draft는 1회만 생성되므로 되메우지 않는다 — 수동 검증 대상(Task 3 체크리스트).

3. **영상 트리밍과의 순서.** `apply-trim.ts:77`·`use-30s-replay.ts:177`이 `setNetworkLog`로
   로그를 좁힌다. draft 생성 `useEffect`는 `videoBlob`/`videoThumbnail` 존재로 게이트되므로
   트림 확정 후 실행되는 것이 정상 경로지만, 트림으로 API 요청이 전부 잘려나가면 행이
   사라진다(의도된 동작 — 잘린 구간의 요청은 리포트 범위 밖).

4. **사용자가 지운 뒤 되살아나는 경로.** draft가 `null`로 리셋되는 흐름(새 캡처 시작·세션
   초기화)에서는 다시 주입된다. 같은 draft 안에서는 되살아나지 않는다.

5. **`filterEnvironmentRows`의 빈 값 제거.** 사용자가 값을 지워 빈 문자열로 만들면 화면엔
   빈 행이 남고 본문에선 제외된다 — 기존 커스텀 행과 동일한 동작이라 새 위험은 아니다.

6. **privacy 문서 갱신 누락.** 로그 파생값이 본문에 새로 실리므로 manifest diff가 0이어도
   `docs/privacy.{ko,en}.md` 대조가 필수다. 30s Replay가 같은 검사를 빠져나가 웹스토어 심사에
   탈락한 전례가 있다(`docs/POSTMORTEM.md`).
