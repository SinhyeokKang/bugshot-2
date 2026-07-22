# 로그 첨부 단일 토글 — 기술 설계

## 개요

세션별 3개 첨부 플래그(`networkLogAttach`/`consoleLogAttach`/`actionLogAttach`)를 editor-store의 **단일 `logsAttach: boolean`**로 대체한다. `LogAttachmentCards`는 타입별 3카드에서 **단일 카드**로, 3개 preview 다이얼로그는 **탭형 단일 `LogPreviewDialog`**로 합친다. 저장 계층(per-type blob 키)·logs.html 빌드는 건드리지 않는다. 본문 삽입 다이얼로그(`LogInsertDialog`)는 **기본 활성 탭 로직만** 신규 다이얼로그와 통일(아래 "기본 탭 로직 통일")하고 그 외 동작은 무변경.

## 변경 범위

### `src/store/editor-store.ts` — 단일 플래그로 교체

- **현재 역할**: 로그 데이터(`networkLog`/`consoleLog`/`actionLog`)와 타입별 첨부 플래그 3개 + 세터 3개 보유. `selectAttachedLogs`가 플래그별로 첨부 대상 선별.
- **변경**:
  - 상태 필드 `networkLogAttach`/`consoleLogAttach`/`actionLogAttach` (161-166) → `logsAttach: boolean` 하나.
  - 세터 `setNetworkLogAttach`/`setConsoleLogAttach`/`setActionLogAttach` (239-244, 965-973) → `setLogsAttach: (on: boolean) => void` 하나.
  - `initial` (327-332): 세 `false` → `logsAttach: false`.
  - `preserveLogs` 대상 타입(353): `"networkLogAttach" | "consoleLogAttach" | "actionLogAttach"` → `"logsAttach"`.
  - 진입점 4곳의 `networkLogAttach: true, consoleLogAttach: true, actionLogAttach: true` → `logsAttach: true`:
    - `startCapturing` (519-521), `startFreeform` (530-532), `startElementShot` (541-543), `onRecordingComplete` (557).
  - `selectAttachedLogs` (423-442): 각 타입 게이트를 `state.logsAttach && log && log.captured > 0`으로 변경(플래그를 `logsAttach` 공통으로). 셀렉터는 **순수 통짜 게이트**이며 `supportsActionLog`는 참조하지 않는다 — 모드 가드는 build 단계(`buildEditorCapture`)의 책임(게이트 책임 분리).
  - `EditorSnapshot` (285-287): 3필드 → `logsAttach`.
  - `confirmDraft`/`persistAttachedLogs`: **호출 시그니처·blob 키 저장 로직 불변**. `persistAttachedLogs`는 `selectAttachedLogs` 반환 3필드(`networkLog`/`consoleLog`/`actionLog`)만 소비하고 개별 attach 플래그를 재참조하지 않음(검증 확인) — 그래서 `selectAttachedLogs`가 통짜 게이트가 된 것만으로 on이면 캡처된 모든 타입 blob 키가 저장되고 off면 전부 undefined가 된다.

### `src/sidepanel/hooks/useEditorSessionSync.ts` — 스냅샷·복원 단일화

- **현재 역할**: editor 상태를 `chrome.storage.session`에 스냅샷하고 복원. 복원 시 타입별 attach 플래그가 true인 로그만 pending IDB에서 로드(103-126).
- **변경**:
  - 스냅샷 빌더(60-62): 3필드 → `logsAttach: s.logsAttach`.
  - 복원(103-126): **첨부 상태와 무관하게** 세 로그를 pending IDB에서 로드해 store에 세팅한다(카드 건수·다이얼로그가 off 상태에서도 뜨도록). `logsAttach` 값은 `hydrate`로 스냅샷에서 복원.
    - 로드 성공 시 `setNetworkLog/setConsoleLog/setActionLog`, 없으면 그대로 null.
    - (개선) 기존엔 off 후 재오픈 시 해당 카드가 사라졌으나, 데이터 로드를 attach와 분리해 해결.
  - **레거시 스냅샷 호환**: 구 3필드 → `logsAttach` 파생을 **순수 함수 `deriveLogsAttach(snap)`**로 추출(단위 테스트 대상)하고 `migrateLegacyDraft` 안에서 호출한다(위치 확정 — hydrate 직전 인라인 아님). semantic은 **OR(any-true)**: 셋 중 하나라도 `true`면 `true`, 셋 다 정의됐고 모두 `false`면 `false`, 구 필드가 아예 없으면(전부 `undefined`, = 신규 스냅샷) 기본 `true`. (`??` first-defined가 아니라 `||` — 부분 첨부였던 구 데이터에서 "하나라도 켜져 있었으면 on"이 통합 의미에 맞다.) session storage는 탭 종료 시 소멸하는 휘발성이라 마이그레이션 버전은 없음.

### `src/sidepanel/components/LogAttachmentCards.tsx` — 단일 카드

- **현재 역할**: 타입별 카드 3개 + 스위치, desc는 `logCard.description`/`actionLog.cardDescription`.
- **변경**: 파일 유지, **단일 카드**를 렌더한다.
  - Props를 단일화(아래 인터페이스 참조): `networkLog`/`consoleLog`/`actionLog`(건수 파생용) + `logsAttach` + `onToggle` + `onClick` + `readOnly`.
  - 렌더 조건: `network|console|action` 중 하나라도 `captured > 0`이면 카드 1개, 아니면 null.
  - 카드 title: `t("logCard.title")`(신규, "로그"/"Logs"), 아이콘 1개(예: lucide `ScrollText`).
  - 카드 desc: `logCardTypeCounts()` 순수 헬퍼가 캡처된 타입만 `"네트워크 12(에러 3)"` 세그먼트로 만들어 ` · `로 join. 존재하는 타입만 포함. 세그먼트 순서는 **console → network → action**(탭·로그뷰어 관례와 통일). 에러 건수는 raw 로그에 필드가 없으므로 기존 export 순수 헬퍼(`src/sidepanel/lib/buildLogSummary.ts`의 `buildNetworkLogSummary().errors`·`buildConsoleLogSummary().errorCount`)로 파생해 입력한다(자체 계산 금지 — 단일 출처).
  - desc는 기존 `truncate text-sm` **단일 라인 유지**. 결합 desc(3타입+에러, en 더 김)가 ~400px에서 뒤 세그먼트가 잘릴 수 있음은 **수용**한다 — 실물 시각 확인 후 심하면 후속 대응(wrap/축약). 이번 스코프에선 truncate 그대로.
  - `readOnly`가 아니면 우측 `<Switch checked={logsAttach} onCheckedChange={onToggle}>`, `readOnly`면 스위치 숨김.
  - **키보드 접근성**: 단일 카드가 탭형 상세 진입의 **유일 경로**가 되므로, 카드 컨테이너에 `role="button"` + `tabIndex={0}` + `onKeyDown`(Enter/Space → `onClick`)을 부여한다(기존 3카드엔 없던 개선). 스위치는 이미 `onClick={(e)=>e.stopPropagation()}`이라 포커스·클릭 충돌 없음.
  - `data-testid`: 단일 `"log-attachment-card"`(기존 `network-log-card`/`console-log-card`/`action-log-card` 대체 — e2e 갱신 필요).
  - 컴포넌트/파일명은 `LogAttachmentCards` 유지(3개 import처: `DraftingPanel`/`PreviewPanel`/`DraftDetailDialog` — churn 최소화). 내부는 단일 카드.

### `src/sidepanel/components/LogPreviewDialog.tsx` — 신규 (탭형 단일 상세 다이얼로그)

- **역할**: console/network/action 탭형 로그 상세 다이얼로그. 기존 3개 preview 다이얼로그를 대체.
- **탭 UI는 `LogInsertDialog`(본문 로그 추가 다이얼로그) 스타일을 그대로 따른다** — `CollapsingTabsList` + 개수 `Badge` + `forceMount TabsContent`, 사이즈 `w-[80vw] max-w-[80vw] h-[80vh] rounded-3xl p-6`(3개 preview 다이얼로그·LogInsertDialog와 바이트 단위 동일). **캡처된 타입 탭만** 노출.
- **`LogInsertDialog`와의 차이 (핵심)**:
  1. **탭에 action 포함** — insert는 console/network 2탭(action 로그는 코드블록 직렬화기가 없어 삽입 불가), 이 다이얼로그는 캡처된 console/network/action 최대 3탭.
  2. **선택 상태 없음(조회 전용)** — insert는 행 선택(`activeConsoleId`/`activeNetworkId`)으로 삽입 대상을 고르지만, 이 다이얼로그는 조회라 **console은 선택 상태 자체가 없다**. network는 선택 개념이 아니라 **영상 스크롤 동기화**(`syncBaseMs`/`scrollToEntryId`)만 유지(기존 `NetworkLogPreviewDialog`와 동일 — video 모드 상대시각 seek).
  3. **푸터 = 첨부/첨부 해제** — insert는 `[닫기]` + `[삽입]`(선택 없으면 비활성), 이 다이얼로그는 `[닫기]` + `onToggleAttach`가 있으면 `[첨부/첨부 해제]`(`logsAttach ? t("common.detach") : t("common.attach")`, 누르면 토글 후 닫힘). `readOnly`(=`onToggleAttach` 미공급)면 닫기만.
- 내부 콘텐츠: `ConsoleLogContent`/`NetworkLogContent`/`ActionLogContent` 재사용(뷰 모드).
- **기본 활성 탭 = 캡처된 탭 중 `console → network → action` 순 첫 번째** — log-viewer(`src/log-viewer/App.tsx:44-45` `hasConsole ? "console" : hasNetwork ? "network" : "action"`)와 동일 로직. (아래 "기본 탭 로직 통일" 참조.)

### `src/sidepanel/components/LogInsertDialog.tsx` — 기본 탭 로직만 통일

- **현재 동작**: 기본 활성 탭이 **network 우선**(`useState<LogTab>("network")`, `useEffect`에서 `requests.length === 0 && entries.length > 0`일 때만 console로 전환, 49-54).
- **변경**: 기본 활성 탭을 **`console → network` 순 첫 번째(캡처된 탭 기준)**로 바꿔 log-viewer·신규 `LogPreviewDialog`와 통일. (insert에는 action 탭이 없으므로 console→network까지.) 그 외 로직(선택·삽입·직렬화·forceMount)은 무변경.
- 이 다이얼로그의 유일한 사용자 노출 변화라 회귀 위험은 "기본 탭이 network→console로 바뀜" 하나. e2e/수동에서 기본 탭 확인.

### 기본 탭 로직 통일 (3곳)

로그 뷰어·로그 상세(신규)·로그 추가 세 곳의 기본 활성 탭 규칙을 **캡처된 탭 중 `console → network → action` 순 첫 번째**로 통일한다. 근거: log-viewer가 이미 이 순서(`App.tsx:44-45`). "폴백"은 앞 타입이 미캡처(탭 부재)일 때 다음으로 넘어가는 것. LogInsertDialog만 기존이 network-first라 이번에 맞춘다.

### 삭제 대상 파일

- `src/sidepanel/components/NetworkLogPreviewDialog.tsx`
- `src/sidepanel/components/ConsoleLogPreviewDialog.tsx`
- `src/sidepanel/components/ActionLogPreviewDialog.tsx`

(내 변경이 만든 고아이므로 제거 — CLAUDE.md "내 변경이 만든 고아만 제거" 준수.)

### `src/sidepanel/tabs/DraftingPanel.tsx` — 편집 경로 배선

- **변경**:
  - store 구독(83-90): 3 attach/세터 → `logsAttach`/`setLogsAttach`.
  - 다이얼로그 open state 3개(`networkDialogOpen`/`consoleDialogOpen`/`actionDialogOpen`, 110-112) → `logDialogOpen` 1개.
  - `<LogAttachmentCards>`(312-325): 단일 props로 교체. `onToggle={setLogsAttach}`, `onClick`은 `setLogDialogOpen(true)`.
  - preview 다이얼로그 3블록(475-506) → `<LogPreviewDialog>` 1개. `logsAttach`/`onToggleAttach={setLogsAttach}`/`syncBaseMs={videoStartedAt ?? undefined}` + 3 로그 전달.

### `src/sidepanel/tabs/PreviewPanel.tsx` — 읽기 전용 경로

- **변경**:
  - store 구독(63-67): 3 attach → `logsAttach`.
  - `attachedNetwork/attachedConsole/attachedAction`(126-129): `logsAttach && log && captured>0 ? log : null`로 통짜 게이트.
  - `<LogAttachmentCards>`(242-254): 단일 props(readOnly). `logsAttach` 전달, `onToggle` 불필요(readOnly).
  - preview 3블록(418-440) → `<LogPreviewDialog readOnly>`(첨부 버튼 없음) 1개. 다이얼로그 open state 1개로 통합.

### `src/sidepanel/tabs/DraftDetailDialog.tsx` — 저장 이슈 읽기 전용

- **변경**:
  - `<LogAttachmentCards>`(1173-1185): 단일 props(readOnly). 저장 레코드엔 `logsAttach` 개념이 없으므로 `logsAttach`는 **로드된 로그 데이터가 하나라도 있는지**(`!!(networkLogData || consoleLogData || actionLogData)`)로 파생한다 — attach 플래그로 게이트하면 안 됨(그런 플래그가 없다). readOnly라 스위치·토글이 없어 `logsAttach` 값 자체는 카드 렌더에 실질 영향 없음(표시 조건은 로그 데이터 존재). 건수·탭은 로드된 `networkLogData/consoleLogData/actionLogData`로 파생.
  - preview 3블록(994-1016) → `<LogPreviewDialog readOnly>` 1개. open state 1개로 통합.

### `src/sidepanel/lib/buildEditorCapture.ts` — 통짜 게이트

- **변경** (괄호 line은 함수 선언이 아니라 attach 게이트 블록 위치):
  - `buildEditorMarkdownContext`(함수 선언 line 19, 게이트 블록 37-40): `networkLogAttach`/`consoleLogAttach`/`actionLogAttach` → `logsAttach` 하나로 게이트. `hasNetworkLog = logsAttach && !!networkLog && networkLog.captured > 0` 식. **action은 이 함수에 있는 `supportsActionLog(captureMode)` 모드 가드를 유지**(`hasActionLog = supportsActionLog(captureMode) && logsAttach && ...`).
  - `buildEditorLogsCaptureInput`(함수 선언 line 132, 게이트 블록 152-154): 동일하게 `logsAttach` 통짜 게이트. **주의**: 이 함수의 현재 `hasAct`는 `supportsActionLog` **없이** `actionLogAttach`만으로 게이트한다(모드 가드는 markdown context에만 존재) — 여기선 `actionLogAttach → logsAttach` 치환만 하고 `supportsActionLog`를 새로 추가하지 않는다(현행 비대칭 유지, 동작 불변).

### `src/i18n/namespaces/logs.ts` — 문자열

- **추가**: `logCard.title`("로그" / "Logs"), `logCard.typeCount`류(타입별 세그먼트 조립용 — 예: `logCard.networkCount`="네트워크 {captured}(에러 {errors})", `logCard.consoleCount`, `logCard.actionCount`="액션 {captured}"). ko/en 동시.
- **제거 후보**: `actionLog.cardDescription`(70/196) — 단일 카드에서 미사용 시 고아. `logCard.description`(119/245)도 세그먼트 방식으로 대체되면 고아. (실제 미사용 확인 후 제거 — 내 변경이 만든 고아.)
- 이 키들은 log-viewer 복제 사전(`src/log-viewer/i18n.ts`)에 **없음**(조사 확인) — 메인 사전만 갱신.

### `src/sidepanel/tabs/ReplayTrimDialog.tsx` — 영향 없음(확인용)

- ReplayTrimDialog는 preview 다이얼로그가 아니라 `ConsoleLogContent`/`NetworkLogContent`/`ActionLogContent`를 직접 인라인 마운트하고 `scrollToEntryId`를 자체 전달한다(242/254/267). preview 다이얼로그 삭제와 무관 — **변경 없음**.

## 데이터 흐름

```
[캡처 진입] startCapturing/startFreeform/startElementShot/onRecordingComplete
    → editor-store: logsAttach = true

[drafting] DraftingPanel
    LogAttachmentCards(logsAttach, onToggle=setLogsAttach, onClick=open dialog)
    LogPreviewDialog(logsAttach, onToggleAttach=setLogsAttach)   ← 탭: console/network/action

[제출] confirmDraft → selectAttachedLogs(state)  // logsAttach 통짜 게이트
    → persistAttachedLogs: 캡처된 타입 blob 키 저장 (per-type 저장 스키마 불변)
    IssueCreateModal → buildEditorLogsCaptureInput → buildCaptureFiles → logs.html 1개

[세션 복원] useEditorSessionSync
    스냅샷: logsAttach
    복원: 세 로그 항상 로드(카드 건수용) + logsAttach hydrate
```

## 인터페이스 설계

### editor-store

```ts
interface EditorState {
  // ...
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog: ActionLog | null;
  logsAttach: boolean;                 // 3 플래그 대체
  setLogsAttach: (on: boolean) => void; // 3 세터 대체
}

type EditorSnapshot = Pick<EditorState, /* ... */ | "logsAttach">;

function selectAttachedLogs(state: EditorState): {
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog: ActionLog | null;
}; // 각 필드 = state.logsAttach && log && log.captured > 0 ? log : null
```

### LogAttachmentCards

```ts
interface LogAttachmentCardsProps {
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog?: ActionLog | null;
  logsAttach: boolean;
  onToggle?: (on: boolean) => void; // readOnly면 미공급
  onClick: () => void;
  readOnly?: boolean;
}

// 순수 헬퍼(같은 파일 또는 lib): 캡처된 타입만 세그먼트 조립
function logCardTypeCounts(
  args: { networkLog: NetworkLog | null; consoleLog: ConsoleLog | null; actionLog: ActionLog | null },
  t: TranslationFn,
): string;
```

### LogPreviewDialog

```ts
interface LogPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog?: ActionLog | null;
  logsAttach?: boolean;
  onToggleAttach?: (attach: boolean) => void; // 미공급 = 읽기 전용(첨부 버튼 숨김)
  attachDisabled?: boolean;
  syncBaseMs?: number; // 영상 모드 상대시각 0점
}
```

## 기존 패턴 준수

- **세션 영속화**: 첨부 상태는 editor-store 세션 필드 + `EditorSnapshot`(chrome.storage.session) — 기존 3필드와 동일 레인, 단일화만.
- **탭 UI 관례**: `LogPreviewDialog`는 `LogInsertDialog`와 같은 `CollapsingTabsList` + 개수 `Badge` + `forceMount TabsContent` 패턴을 따른다.
- **shadcn 우선**: `Card`/`Switch`/`Dialog`/`Tabs`/`Button`/`Badge` 기존 컴포넌트 재사용, 직접 스타일링 없음.
- **i18n 동시 갱신**: ko/en 양쪽 키를 함께 추가/제거. PostToolUse 훅(`locales.test.ts`)이 대칭·placeholder 검사.
- **테스트 우선**: 신규 순수 헬퍼(`logCardTypeCounts`)와 변경된 `selectAttachedLogs` 게이트에 단위 테스트 먼저.
- **고아만 제거**: 단일화로 미사용이 된 preview 다이얼로그 3파일·i18n 키만 제거.

## 대안 검토

### 대안 A: `LogInsertDialog`에 `mode: "insert" | "attach"` prop을 더해 단일 컴포넌트로 통합

- **장점**: 다이얼로그 컴포넌트 1개로 유지보수 지점 최소화(사용자 선호).
- **채택 안 함 이유**: `mode`가 컴포넌트를 재구성하는 안티패턴이 된다 —
  - 탭셋 차이(insert=console/network 2탭, attach=console/network/action 3탭. action 로그는 코드블록 직렬화기가 없어 insert 불가),
  - 행 선택 상태(`activeNetworkId`/`activeConsoleId`)가 attach 모드에선 완전히 죽은 상태,
  - 푸터가 3갈래(insert 버튼 / 첨부·해제 토글 / readOnly 닫기만).
  이 3축이 mode로 분기되면 "안 쓰는 props·state가 절반"인 컴포넌트가 된다. 사용자도 "디메리트가 크면 분리 OK"라 함.

### 대안 B: 공통 탭 셸(`LogTabsView`)을 추출해 두 다이얼로그가 공유

- **장점**: 탭 마크업 중복(~30줄) 제거.
- **채택 안 함 이유**: 셸이 selection 콜백(insert)·scrollTo(view)·탭셋을 전부 forward받는 props-heavy presentational 컴포넌트가 되어, 각 다이얼로그의 선형 가독성을 오히려 해친다. 제거되는 중복은 탭 리스트 마크업뿐이라 이득이 작다. **외과적·최소 설계** 원칙상 표준 다이얼로그 2개를 독립적으로 두는 편이 낫다.

### 채택: 독립 `LogPreviewDialog` 신설 + `LogInsertDialog`는 기본 탭 로직만 통일

3→1(preview) 통합은 명확히 이득이고, insert 다이얼로그는 선택+삽입이라는 다른 상호작용이라 컴포넌트를 합치지 않는다(탭 UI 스타일만 공유). 유일한 예외로 **기본 활성 탭 로직**만 세 곳(뷰어·상세·추가)을 `console→network→action` 순으로 통일한다. 탭 마크업 소량 중복은 감수(두 컴포넌트 각각 선형·단순).

## 위험 요소

- **e2e testid 변경**: `network-log-card`/`console-log-card`/`action-log-card` → `log-attachment-card` 단일. `e2e/action-log-scope.spec.ts`가 이 testid를 참조 — spec 갱신 필요(`/e2e-write`). 카드가 3개→1개라 "타입별 카드 존재" 검증 로직은 "단일 카드 + desc 건수/탭"으로 재작성.
- **세션 복원 회귀**: 로그 로드를 attach 상태와 분리하는 변경. pending IDB 조회 3건이 항상 돌므로, 실패/부재 처리(null 유지)를 놓치면 카드가 안 뜨거나 예외. 복원 경로 실동작(패널 닫았다 열기) 수동 확인 필요.
- **레거시 스냅샷**: 구 3필드 스냅샷에서 `logsAttach` 파생 누락 시 첨부가 조용히 off. `deriveLogsAttach`(OR any-true, 전부 undefined면 true) 순수 함수 + 단위 테스트로 방어.
- **읽기 전용 카드 파생**: DraftDetailDialog에서 `logsAttach` 개념이 없으므로(저장 레코드엔 blob 키만), 카드/탭을 로드된 로그 데이터 존재로 파생해야 한다 — attach 플래그로 잘못 게이트하면 카드가 안 뜬다.
- **desc·탭 순서**: 카드 desc 세그먼트·다이얼로그 탭·기본 활성 탭 순서를 모두 `console → network → action`으로 통일해야 시각 일관성 유지. (PRD 시나리오 예시 desc가 네트워크-first로 적혀 있으나 실제 구현 순서는 console-first — PRD 예시는 표기일 뿐.)
- **LogInsertDialog 기본 탭 회귀**: network-first → console-first 변경. 기존 e2e/수동에서 "열면 network 탭"을 가정한 곳이 있는지 확인.
