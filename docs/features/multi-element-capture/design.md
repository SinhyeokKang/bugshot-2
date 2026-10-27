# 다중 요소 캡처 — 기술 설계

## 개요

요소 캡처에만 순서 있는 `elementShots` 배열을 추가한다. 일반 스크린샷은 기존 단일 필드를 유지한다. 각 캡처는 selector와 무관한 ID로 식별하고 원본·주석·메타데이터를 함께 가진다. 새 배열이 있는 요소 캡처의 모든 소비처는 배열을 기준으로 읽으며, 구 단일 요소 캡처는 읽기 경계에서 한 항목으로 정규화한다. CSS 편집의 `bufferedElements`를 재사용하지 않는다.

## 현재 구현에서 확인한 제약

- `editor-store.ts:onElementShot`은 `screenshotRaw`·`shotSelector`를 덮어쓴다. `startElementShot`은 `...initial`로 작성 상태를 초기화한다.
- `picker-control.ts:startElementShot` 및 `usePickerMessages.ts:captureElementShot`의 실패 경로는 `reset()`한다. 추가 선택에는 이 경로를 그대로 적용할 수 없다.
- 세션의 `picking`은 `useEditorSessionSync.ts`에서 idle로 강등한다. 추가 선택은 보존된 캡처가 있는 경우 drafting으로 복귀해야 한다.
- `confirmDraft`, `IssueRecord.snapshot`, `useIssueImages`, `DraftDetailDialog`는 스크린샷을 `before` 슬롯 하나로 읽고 쓴다.
- `buildCaptureFiles.ts`는 `screenshot.webp` 한 장, `submissionRecovery.ts:expectedSubmissionSources`는 `capture:screenshot` 한 파일만 기대한다.
- `LogViewerData.screenshot`와 `log-viewer/App.tsx`도 정적 이미지 하나만 표현한다.
- `AiDraftDialog.tsx:getModeImages`는 스크린샷 한 장만 반환한다. `PROMPT_CAPS`의 기존 이미지 상한(compact 2, rich 8)은 변경하지 않는다.

## 인터페이스 설계

아래는 새 인터페이스의 제안 시그니처이며 아직 구현되지 않았다.

```ts
// src/types/element-shot.ts (new)
export interface ElementShotMeta {
  id: string;
  selector: string;
  tagName: string;
  viewport: { width: number; height: number };
  capturedAt: number;
}
export interface ElementShot extends ElementShotMeta {
  raw: string | null;
  annotated: string | null;
}
export interface SavedElementShot extends ElementShotMeta {
  imageSlot: `shot-${string}-v-${string}` | "before";
  hasImage: boolean;
}

// EditorState additions
// Null means legacy single capture or another capture mode.
// An element capture in drafting must contain at least one item.
elementShots: ElementShot[] | null;
elementShotPick: { requestId: string; kind: "initial" | "append" } | null;
startAdditionalElementShot(): Promise<string | null>;
cancelElementShotPick(requestId: string): void;
appendElementShot(requestId: string, shot: ElementShot): Promise<boolean>;
removeElementShot(id: string): void;
setElementShotAnnotation(id: string, image: string | null): Promise<boolean>;

// src/sidepanel/lib/elementShots.ts (new, pure helpers)
resolveElementShots(input: LegacyOrCurrentShotInput): ElementShot[];
joinElementShotSelectors(shots: readonly ElementShotMeta[]): string;
elementShotImage(shot: ElementShot): string | null;
// Local input type combining legacy fields and elementShots.

// IssueRecord addition
// Undefined uses the legacy before slot; an empty list is not a valid capture.
elementShots?: SavedElementShot[];
// New token on each successful media metadata commit.
elementShotsRevision?: string;
```

주석 언어는 구현 시 저장소 코드 컨벤션을 따른다. 레거시 입력 타입은 실제 `EditorState`/`IssueRecord`에서 필요한 필드만 Pick해 정의하고 순수 헬퍼에서 store를 읽지 않는다.

- 새 항목 ID는 캡처 성공 시 `crypto.randomUUID()`로 생성한다. 같은 selector도 다른 ID다.
- 구 세션의 `shotSelector`와 단일 이미지가 있으면 결정적인 `legacy` ID 한 항목으로 승격한다. 새 데이터가 있으면 레거시 필드와 병합하지 않는다.
- 새 요소 캡처는 단일 이미지 필드를 비워 같은 base64가 세션에 중복 저장되지 않게 한다. 구 세션 변환도 원자적으로 배열 생성과 단일 필드 정리를 수행한다.
- `annotated ?? raw`가 표시·다운로드·AI·제출 이미지의 유일한 선택 규칙이다.
- `elementShotPick`은 요청 식별과 복귀 의도를 담는다. 스냅샷에 저장해 hydrate가 append 중단을 알아보되, hydrate 직후 토큰은 폐기한다. null로 되돌린 뒤 새 requestId를 쓰므로 이전 비동기 작업은 커밋할 수 없다.

## 변경 범위

| 파일/모듈 | 현재 역할 및 변경 |
|---|---|
| `src/types/element-shot.ts`, `src/sidepanel/lib/elementShots.ts` (신규) | 항목 타입, 구 데이터 정규화, 표시 이미지·selector 결합의 순수 함수 |
| `src/store/editor-store.ts` | 요소 캡처 배열·추가 전이·ID 기반 수정/삭제, snapshot 키, confirmDraft 저장과 reset/done 정리 |
| `src/background/tab-bindings.ts`, `src/background/index.ts` | append-picking 세션 보존 판정 및 navigation/정리 호출 경로 검증 |
| `src/sidepanel/picker-control.ts` | 기존 최초 시작 유지, 추가 시작 경로와 요청별 취소/실패 복귀 추가; `stopPickerOrResume` 연결 |
| `src/sidepanel/hooks/usePickerMessages.ts` | 결과 requestId 소유 검증, 추가 성공 append, 취소·실패 시 보존, 늦은 정리 방지 |
| `src/sidepanel/hooks/useEditorSessionSync.ts`, `src/sidepanel/lib/liteSnapshot.ts` | snapshot·hydrate·탭 종료·언로드 경로, 요소 캡처의 lite 폴백 차단과 직렬 저장, append-picking 복원 |
| `src/sidepanel/tabs/DraftingPanel.tsx`, `src/sidepanel/tabs/IssueTab.tsx` | 추가 버튼, 이미지별 액션, ID 기반 어노테이션 대상, 피커 전후 스크롤·포커스 복원 |
| `src/sidepanel/components/ElementShotMedia.tsx` (신규) | 작성·미리보기·상세에서 공유하는 순서 있는 이미지 목록. 편집 콜백 제공 여부로 액션 제한 |
| `src/sidepanel/tabs/PreviewPanel.tsx`, `DraftDetailDialog.tsx`, `src/sidepanel/hooks/useIssueImages.ts` | 복수 이미지 표시·읽기·다운로드와 저장 초안 제출 데이터 |
| `src/store/issues-store.ts`, `src/store/blob-db.ts` | optional 메타 배열·저장 리비전, 버전별 불변 이미지 슬롯, 기대 파일 보존과 정리 |
| `src/sidepanel/lib/buildEditorCapture.ts`, `buildMarkdownContext.ts`, `buildReportData.ts` | selector 결합과 복수 이미지 입력 연결. 본문 헤딩 형식은 유지 |
| `src/sidepanel/lib/buildCaptureFiles.ts`, `buildLogsHtml.ts` | 복수 파일, 로그 HTML의 복수 정적 이미지 |
| `src/sidepanel/lib/submissionRecovery.ts`, `uploadPayload.ts`, `submissionAdapter.ts` | ID/파일명/원본 슬롯 대응, 준비·재첨부·Jira 본문 매핑 검증 |
| `src/sidepanel/lib/submitTo{Jira,Github,Linear,Notion,Gitlab,Asana,Clickup,Slack,Webhook}.ts` | 기존 images 배열 경로 사용. 필요한 입력 배선만 수정하고 플랫폼 로직 일반화 금지 |
| `src/types/log-viewer.ts`, `src/log-viewer/App.tsx` | optional 복수 정적 이미지 필드 및 세로 목록; 구 screenshot 입력 폴백 |
| `src/sidepanel/tabs/AiDraftDialog.tsx` | getModeImages가 전체 캡처의 유효 이미지를 순서대로 반환, 기존 예산 적용 |
| `src/i18n/*`, 필요 시 `src/log-viewer/i18n.ts` | 기존 키 우선 재사용, 새 키는 등록된 전체 로케일 대칭 |

## 데이터 흐름과 상태 전이

1. 최초 선택은 기존 picker 메시지와 캡처 트랜잭션을 이용한다. 성공한 이미지로 배열 한 항목을 만들고 drafting으로 이동한다. `CaptureMode`나 메시지 union은 추가하지 않는다.
2. 추가 클릭 시 현재 `target.tabId`와 drafting·요소 캡처 여부를 검증하고 `chrome.tabs.get`으로 읽은 URL과 보고서 원점 `target.url`을 기존 `pageKeyOf` 규칙으로 비교한다. 조회 실패·지원 불가·페이지 키 불일치면 시작하지 않고 기존 자료를 보존한다. 불일치에는 원래 페이지로 돌아온 뒤 재시도하라는 안내를 제공한다. 패널 재열기 후에도 같은 진입 검사를 수행한다. 최초 시작 액션을 호출하지 않고 draft·target·미디어·로그·첨부·선택한 플랫폼을 유지한 채 picking 및 append 요청 토큰만 설정한다.
3. 비동기 주입/캡처 전후에 requestId·target.tabId·phase를 검증한다. 기존 frameToken/document 검증과 `captureElementSnapshot`의 `isCurrent`도 유지한다. 같은 탭에서 취소 후 재진입하는 ABA 경합을 phase 비교만으로 판정하지 않는다.
4. 성공 후보는 아래 저장 계약에 따라 먼저 영속화하고, 소유 검증 뒤 배열 append와 drafting 복귀를 같은 set으로 수행한다. 취소·실패는 요청 토큰을 무효화하고 기존 배열을 유지한다. 이전 요청의 `clearPicker`나 실패 reset이 새 피커를 정리하지 않게 정리 작업에도 소유 검증을 적용한다.
5. 페이지 이동·지원 불가 전환은 추가 작업을 취소하고 기존 보고서의 URL·제목·자료를 유지한다. 이동한 페이지를 기존 보고서의 대상으로 조용히 바꾸지 않는다. 별도 대상 변경 UI는 만들지 않는다. `background/tab-bindings.ts:shouldPreserveSession`과 navigation 정리 분기에서 screenshot + append 요청 + 기존 캡처가 있는 picking은 보존 대상으로 취급한다. 최초 picking은 기존 정리 정책을 유지한다. 패널의 onChanged/onTabUpdated 역시 append만 drafting으로 복귀시키고 reset하지 않는다. 피커를 시작하기 전에 append 스냅샷 저장 완료를 기다려 background가 이전 비보존 상태를 읽는 창을 없앤다. 패널이 닫혔으면 hydrate가 남은 append 상태를 drafting으로 복구한다.
6. 재현 환경은 현행 단일 DOM 행의 value를 `joinElementShotSelectors`로 파생한다. 배열 순서의 selector를 기존 쉼표 형식으로 결합하며 dedup하지 않는다. 사용자 편집 환경 행에 직접 삽입하지 않는다. 작성·미리보기·본문 복사·저장 상세·AI·로그 report에 같은 결과를 전달한다.
7. Viewport/Captured의 기존 단일 행은 현재 목록 첫 항목의 값을 사용한다. 첫 항목 삭제 후에는 다음 항목으로 바뀐다. 각 항목은 자기 메타를 별도로 보존한다.

## UI와 어노테이션

- 요소 추가는 미디어 Section action의 첫 버튼이며, DOM 네비게이션 repick과 같은 `Crosshair`·`size="icon"`·`variant="default"`·`h-8 w-8 shrink-0`을 사용한다. 텍스트는 접근명으로 유지한다.
- 일반 스크린샷에는 기존 액션 배치를 유지한다. 요소 캡처만 이미지별 우상단 액션 그룹으로 옮긴다.
- 삭제는 마지막 항목이면 렌더하지 않는다. store에서도 길이 1 이하의 삭제는 no-op이다.
- 어노테이션 대상은 배열 index가 아닌 ID다. 오버레이가 열린 동안 대상이 없어지거나 세션이 교체되면 저장 결과를 버린다. 다른 항목의 주석은 보존한다.
- 키보드 삭제 후 다음 항목의 액션, 없으면 이전 항목, 적절한 액션이 없으면 요소 추가 버튼으로 포커스를 옮긴다. 아이콘 버튼의 히트 영역은 기존 32px을 유지한다. 이미지 우상단의 기존 `ImageActions`를 재사용한다. 다운로드·삭제에 필요한 선택적 콜백만 확장하며 `ButtonGroup`·`TooltipIconButton`·표면 스타일을 공유한다. 별도의 액션 행이나 버튼 스타일을 만들지 않는다.
- 피커 진입 전 PageScroll의 scrollTop과 미디어 섹션 펼침 상태를 DraftingPanel 언마운트 밖의 IssueTab 소유 UI 상태에 보관한다. 성공 시 미디어 섹션을 펼치고 새 항목 프레임을 `scrollIntoView({ block: "nearest" })`로 노출한 뒤 그 항목의 첫 액션에 포커스를 준다. 취소·실패 시 이전 펼침 상태와 scrollTop을 복원하고 요소 추가 버튼에 `preventScroll` 포커스를 준다. 전체 패널 재열기에는 세션의 기존 스크롤 정책을 유지한다.
- 추가 실행 중에는 기존 `aria-disabled`와 핸들러 가드 규약으로 중복 실행을 막는다.

## 저장·하위 호환·용량

- `EDITOR_SNAPSHOT_KEYS`와 `snapshotFromState()`를 함께 변경한다. append picking 스냅샷은 hydrate 시 drafting으로 복귀하고 요청 토큰을 폐기한다. 최초 picking은 기존 idle 복구를 유지한다.
- 요소 캡처 배열이 있는 세션은 정상 저장 실패 뒤 `toLiteSnapshot`으로 같은 키를 덮지 않는다. debounce·언로드·명시 저장 모두 마지막 정상 스냅샷을 보존하고 저장 실패를 안내한다. 레거시 요소 캡처도 정규화 후 이 정책을 적용한다. 다른 모드의 기존 lite 정책은 유지한다. 이미 유실된 구 스냅샷의 null 이미지는 복구된 것으로 취급하지 않고 제출을 차단한다.
- 추가/주석 후보는 세션별 공통 직렬 저장 경로를 사용한다. pending debounce를 먼저 정리하고 현재 본문을 포함한 기준 스냅샷을 확정한 다음 후보 전체를 저장한다. 기준 저장 실패는 후보를 거부하고 메모리의 기존 작성 내용과 마지막 정상 저장본을 유지한다. 후보 저장 성공 후 requestId/세션 리비전을 다시 검증해 메모리에 반영한다. 실패하면 후보만 폐기하고 기존 이미지를 유지하며 한 번 안내한다. 저장 중 해당 세션 편집·추가를 잠그고, 취소·reset·탭 전환과 후속 스냅샷 저장도 같은 직렬화 경로에서 순서가 뒤집히지 않도록 한다. 오래된 후보가 저장된 뒤 취소됐다면 최신 유효 스냅샷으로 복구 저장을 완료한 후 잠금을 해제한다. 언로드 시 미확정 후보는 성공으로 알리지 않는다.
- 다중 이미지의 용량은 개수로만 보장할 수 없다. 신규 순수 헬퍼 `elementShotBudget.ts`가 후보 snapshot 직렬화 크기와 캡처 이미지의 첨부+logs.html 이중 임베드 예산을 계산한다. 추가/주석 적용 전에 세션 가용량(`QUOTA_BYTES`와 다른 키 사용량을 포함) 및 메시지 상한의 80% 안전 예산을 검사한다. 조회 실패/초과 시 새 변경을 거부하고 기존 자료를 유지한다. 이 검사는 다른 패널과 원자적이지 않으므로 실제 저장 실패 처리도 필요하다.
- 제출 직전에는 사용자 첨부·인라인·로그까지 포함한 실제 요청 크기를 `MESSAGE_BYTES_LIMIT`과 대조한다. 80% 캡처 예산만으로 전체 요청의 안전을 주장하지 않는다. 캡처가 복수인 새 경로에 한정해 생성 API 호출 전에 차단하며 일반 제출 경로의 전면 리팩터는 하지 않는다.
- `IssueRecord.elementShots`는 optional이다. 기존 레코드는 before 슬롯, 새 캡처는 `shot-${id}-v-${revision}` 슬롯을 쓴다. 논리 ID는 캡처 식별자이고 revision은 실제 바이트 버전이다. 바뀌지 않은 이미지 슬롯은 재사용하고 주석 등 바이트가 바뀐 항목만 새 슬롯에 쓴다. DB object store 변경 없이 `ImageSlot` union만 확장한다. 배열 index로 Blob 키를 만들지 않는다.
- 확정 저장은 issue별 기존 operation lock 안에서 변경 이미지를 새 버전 슬롯에 먼저 기록한다. 기존 슬롯을 덮어쓰지 않는다. 전 이미지 쓰기 성공 후 슬롯 목록과 새 `elementShotsRevision`을 durable 메타로 확정하고, 그 뒤에만 미리보기/제출과 성공 안내를 진행한다. 이미지 쓰기 또는 메타 저장 실패 시 이전 메타와 이전 슬롯을 유지하고 미확정 신규 슬롯만 보호된 정리 대상으로 남긴다. 인메모리 레코드도 durable 성공 전 새 메타를 노출하지 않는다. 저장 중 새 편집과의 경합은 저장 시작 스냅샷·세션 소유 검증과 편집 잠금으로 막는다. 중간 프로세스 종료로 남은 미참조 신규 슬롯은 기존 fail-closed GC 규약으로 정리한다.
- `useIssueImages`의 조회 키에 `elementShotsRevision`과 실제 슬롯 목록을 포함한다. 같은 issueId·shot ID·항목 수라도 주석 저장 후 리비전이 바뀌면 다시 읽는다. 기존 object URL은 교체·언마운트 시 해제하며 이전 비동기 로드의 완료가 최신 이미지를 덮지 않게 한다. 레거시 단일 조회 규칙은 유지한다.
- `snapshot.before`는 구 목록 요약과 호환되는 파생 존재값이다. 새 배열이 있으면 `before` Blob 존재를 요구하지 않는다. 레거시와 새 배열을 동시에 합쳐 읽지 않는다.
- 항목 삭제는 먼저 편집 목록에서 제거한다. 확정 저장 뒤 참조에서 빠진 슬롯만 정리하고, 활성 recovery 원본·다른 레코드 참조는 기존 보호 규칙을 따른다. 이슈 전체 삭제는 기존 issueId 접두사 정리와 journal 보호를 유지한다.
- 새 슬롯의 snapshot/record 참조 수집을 GC와 cleanup에 추가한다. 읽기 실패를 빈 참조 집합으로 해석하지 않는다. issues-store 변경 액션은 updatedAt을 올린다.

## 제출·로그 HTML·AI

- `BuildCaptureFilesInput`에 optional 복수 캡처 입력을 추가한다. 요소 캡처 배열이 있으면 그 배열만 쓰고, 없으면 기존 screenshotImage 경로를 유지한다.
- 새 파일의 논리 ID는 `capture:shot-${id}`, 파일명은 선택 순서대로 `screenshot-1.webp`, `screenshot-2.webp`다. ID와 원본 슬롯은 삭제로 재번호되지 않는다. 주석 재저장은 논리 ID를 유지하면서 원본 슬롯 버전만 바꾼다. journal은 제출 준비 시 확정한 버전 슬롯을 참조하고 이후 저장본을 따라가지 않는다. 파일명은 제출 준비 시 확정하며 진행 중 journal을 재번호하지 않는다. 기존 레코드/journal의 `capture:screenshot`·`screenshot.webp`는 그대로 지원한다.
- `expectedSubmissionSources`와 파일 생성에 공용 manifest 파생 함수를 사용해 ID·원본 키·파일명·순서가 갈라지지 않게 한다. 누락 원본은 생성 요청 전에 기존 MissingSubmissionFilesError 계열로 차단한다.
- prepared 파일과 progress/body slot은 파일 ID로 대응한다. Jira placeholder, Asana JPEG 변환, Notion ZIP, Slack 원본 보존/승격, Webhook media 배열에도 전 항목이 전달되는지 계약 테스트로 확인한다. 새 플랫폼 API는 없다.
- `LogViewerData`에 optional `screenshots: { dataUrl: string }[]`를 추가한다. 새 복수 출력은 legacy screenshot을 null로 두어 중복 임베드하지 않는다. 뷰어는 screenshots가 있으면 순서대로 세로 표시하고 없으면 기존 screenshot을 한 장으로 해석한다. 영상 시간축과 연결하지 않는다.
- `buildLogsHtml`, 라이브 로그 다운로드, 저장 상세 로그 다운로드, 제출용 logs.html이 같은 이미지 배열을 받는다. 이미지/본문을 숨기는 기존 설정과 로그 첨부 게이트는 유지한다.
- AI는 전체 유효 이미지를 선택 순서로 입력한 뒤 기존 PROMPT_CAPS 및 promptBudget 절삭을 사용한다. 본문 언어/AI 언어 정책을 바꾸지 않는다. 상한 초과를 이유로 저장된 캡처 자체를 삭제하지 않는다.

## 기존 패턴 준수

- 새 상태는 snapshot 키·실제 직렬화·hydrate·lite 폴백·종료 정리까지 한 세트로 변경한다.
- 캡처는 기존 `captureElementSnapshot`, 프레임 정리, 탭 모드 hold, activeTab 관문을 재사용한다. hold를 중복 추가하지 않는다.
- selector 생성과 개인정보 게이트는 기존 picker 결과를 그대로 사용한다.
- 첨부는 issue별 Web Lock·journal·durable 저장 후 정리 규약을 유지한다.
- 순수 함수 테스트를 먼저 작성한다. ko/en뿐 아니라 현재 등록된 전체 UI 로케일 대칭을 검사한다.
- 본문 언어 withLocale 구간에서 store write를 하지 않는다. API Hosts/로그 게이트를 컴포넌트에 복제하지 않는다.

## 대안 검토

- 단일 screenshotRaw에 새 캡처를 덮어쓰기: 요구한 누적과 저장/복원이 불가능하다.
- CSS 스타일 bufferedElements 재사용: before/after·styleEdits·selector dedup 의미가 달라 같은 요소 재캡처를 손실시킨다.
- 최초 캡처는 단일 필드, 추가분만 별도 배열: 모든 소비처가 두 저장소를 합쳐야 하고 첫 장 삭제/주석/순서 규칙이 복잡해진다.
- 모든 캡처 모드의 통합 미디어 모델: 이번 기능에 필요 없는 마이그레이션과 영상 회귀 범위를 만든다.

## 위험 요소

- 단일 소비처 하나라도 누락하면 작성 화면은 정상인데 제출·복원에서 첫 장만 남는다. `shotSelector`, `screenshotRaw`, `screenshotImage`, `capture:screenshot`, `:before` 소비처를 전수 분류한다.
- POSTMORTEM의 stale 캡처 알림·선택 소실 후 빈 화면·snapshot 누락 함정을 반영한다. 캡처 성공뿐 아니라 취소 후 재진입과 실패 응답 순서를 테스트한다.
- logs.html 이중 base64와 session quota 때문에 무제한 누적을 약속하지 않는다. 실제 요청 예산과 실패 시 기존 자료 보존이 필수다.
- 이미지 개별 삭제와 활성 recovery 정리가 충돌하지 않게 제출 중 편집을 잠근다.
- 이 설계는 기존 captureVisibleTab의 픽셀 정확성을 바꾸지 않는다. 자동화와 별도로 iframe·탭 모드 실측이 필요하다.
