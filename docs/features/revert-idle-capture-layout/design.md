# Idle 캡처 진입 레이아웃 원복 (1x2x2) — 기술 설계

## 개요
`IssueTab.tsx`의 `EmptyState`·`ReplayButton` 두 컴포넌트만 수정하고 `RecordingSettingsDialog.tsx`를 삭제한다. 녹화 모드 분기(`recordModeMeta`)와 설정 탭의 `RecordingSettingsCard`는 그대로 둔다. manifest·store 마이그레이션 변경 없음. i18n은 `issue.mode.element` 키 **값만** ko/en 수정(키 추가·삭제 없음). 순수 UI 재배치 + 비활성 리플레이 클릭 핸들러 원복 + Row1 레이블 텍스트 변경.

## 변경 범위

### `src/sidepanel/tabs/IssueTab.tsx` (수정)
현재 역할: 이슈 탭의 phase별 렌더. `EmptyState`가 idle 캡처 진입 화면.

변경 내용:
1. **import 정리**
   - 제거: `import { RecordingSettingsDialog } from "@/sidepanel/components/RecordingSettingsDialog";`
   - 추가: `useTabNav` (from `@/sidepanel/tab-nav`).
   - 유지: `recordModeMeta`, `MonitorPlay`, `AppWindow`, `useState`(RecordingState에서 사용), `cn`.
2. **`EmptyState` 재구성** (현 160~233줄)
   - `recSettingsOpen` `useState`(166줄) 및 `<RecordingSettingsDialog>` 사용(208~211줄) 제거. ⚙ 버튼은 IssueTab JSX가 아니라 `RecordingSettingsDialog` 내부 `DialogTrigger`이므로, 다이얼로그 파일 삭제 + 이 사용 제거로 **자동 소멸**(IssueTab에서 ⚙ JSX를 따로 찾지 말 것).
   - 버튼 컨테이너를 1x2x2 3행으로(컨테이너는 기존 `max-w-[336px]` 유지 — "전체폭"은 이 캡 안의 full-width):
     - Row1: 요소 스타일 편집 — primary 전체폭. `<Button className="w-full" onClick={onStartElement} data-testid="mode-element">`(variant 미지정 = default/primary). 레이블은 `t("issue.mode.element")` — 키 값을 "요소 스타일 편집"/"Edit element style"로 바꾼다(Task 0).
     - Row2: `<ButtonGroup className="w-full">` 안에 요소 캡처(`mode-element-shot`, `flex-1`) + 범위 캡처(`mode-screenshot`, `flex-1`), 둘 다 `variant="outline"`.
     - Row3: `<ButtonGroup className="w-full">` 안에 녹화(`mode-record`, `min-w-0 flex-1`) + `<ReplayButton className="min-w-0 flex-1" />`.
   - 녹화 버튼: 현 동작 유지 — onClick 분기(`recordingMode === "screen" ? onStartScreenRecord() : onStartVideo()`)·아이콘 `RecordIcon`(meta 기반)·레이블 `t(meta.labelKey)` 모두 현재 코드(196~203줄)에 이미 존재하므로 그대로 옮긴다(신규 작성 아님). `onStartVideo`/`onStartScreenRecord`는 기존 EmptyState props(6개)에 이미 있음.
   - `meta`/`RecordIcon`/`recordingMode` 셀렉터 유지.
   - **footer 변경 없음**: 가이드 버튼 + 이슈 초안 작성(`mode-freeform`) 버튼은 현 PageFooter 그대로 둔다(1x2x2는 본문 버튼 영역만 가리킨다).
3. **`ReplayButton` 시그니처·동작 원복** (현 235~293줄)
   - `onConfigure` prop 제거. `className?: string`만 유지.
   - `useTabNav()` 도입. 비활성(`!replayEnabled`) 버튼 `onClick`을 `() => navTo("settings", "issue")`로 원복(현재는 `onConfigure`).
   - 나머지(활성 capture, tooltip, encoding 표시) 그대로.

### `src/i18n/namespaces/issue.ts` (수정)
현재 역할: 이슈 탭 i18n 키. `issue.mode.element` = ko "요소 편집" / en "Edit element".
변경 내용: 값을 ko "요소 스타일 편집" / en "Edit element style"로 수정(키 이름·구조 불변). ko/en 동시 수정 — `src/i18n/__tests__/locales.test.ts` PostToolUse 훅이 자동 검사(키 대칭·placeholder 토큰 없음이라 통과). 다른 키 영향 없음.

### `src/sidepanel/components/RecordingSettingsDialog.tsx` (삭제)
현재 역할: ⚙ 버튼 + 인라인 녹화 설정 다이얼로그. `IssueTab`이 유일 사용처(grep 확인). 삭제.

### `src/sidepanel/components/RecordingSettingsCard.tsx` (선택적 소정리, 유지 기본)
현재 역할: 설정 탭 "녹화 설정" 섹션 + (삭제될) 다이얼로그가 공유하던 카드.
- `SettingsTab`이 계속 사용하므로 **파일 유지**.
- `replayInputId` prop은 다이얼로그와의 id 충돌 회피용이었다. 다이얼로그 삭제로 호출자가 `SettingsTab` 하나(기본값 `"replay-enabled"`)만 남는다. prop은 기본값으로 계속 동작하므로 **그대로 두는 것을 기본**으로 한다(외과적 범위 유지, e2e가 `replay-enabled` id 의존). 제거는 별도 정리 대상으로만 언급.

## 데이터 흐름
- `recordingMode`: `useSettingsUiStore` → `EmptyState`가 읽어 `recordModeMeta`로 아이콘·레이블·캡처 함수 분기(변경 없음).
- 비활성 리플레이 클릭: `ReplayButton` → `useTabNav()` 콜백 → App의 탭 전환 → 설정 탭 이슈 sub-tab.
- 다이얼로그를 통한 녹화 모드 변경 경로 제거 → 녹화 모드 변경은 설정 탭 `RecordingSettingsCard` 단일 경로.

## 인터페이스 설계
```ts
// EmptyState props: 변경 없음(기존 6개 콜백 그대로).

// ReplayButton: onConfigure 제거
function ReplayButton({ className }: { className?: string }): JSX.Element
```
새 타입 없음. `RecordModeMeta`/`recordModeMeta` 시그니처 변경 없음.

## 기존 패턴 준수
- shadcn `Button`/`ButtonGroup` 조합, `variant="outline"` 보조 액션 / 미지정 primary — 기능 전 원본과 동일 패턴.
- `data-testid` 명명 유지(`mode-element`/`mode-element-shot`/`mode-screenshot`/`mode-record`/`replay-button`/`mode-freeform`).
- `useTabNav("settings", "issue")` — 기능 전 `ReplayButton`이 쓰던 동일 호출. 설정 sub-tab 키 `"issue"`는 기존 상수.
- i18n: 모든 레이블 기존 키 재사용. `issue.replay.tooltip.disabled`("클릭하면 설정에서 30초 리플레이를 켤 수 있습니다")가 이미 설정 이동을 가리켜 navTo 원복과 정합.

## 대안 검토
- **단일 record를 video/screen 2버튼으로 완전 원복**: 기능 전 원본은 `[탭 녹화][화면 녹화]` 2버튼이었다. 그러나 사용자가 "녹화 모드 분기 단일 버튼 유지"를 명시 → 단일 버튼 + 분기 채택. 2버튼으로 가면 1x2x2가 깨지고 모드 설정이 무의미해진다.
- **비활성 리플레이를 무반응+툴팁만**: 진입점이 사라져 사용자가 리플레이 켜는 길을 잃는다. 원본대로 설정 탭 이동이 발견성↑. 채택 안 함.
- **`RecordingSettingsCard`의 `replayInputId` prop 제거**: 호출자가 하나 남지만 기본값으로 동작하고 제거 시 회귀 위험(id·e2e)만 추가. 외과적 범위 위반이라 보류.

## 위험 요소
- **e2e 회귀**: `e2e/capture-modes-layout.spec.ts`가 현 2-1-3 레이아웃·⚙·다이얼로그를 단언한다(특히 `mode-record-settings`, dialog 열림, Row 구성). 레이아웃 변경으로 다수 깨짐 → spec 재작성 필요(`/e2e-write`). 단언 방향: ⚙·dialog 부재, 1x2x2 행 구성, 비활성 리플레이 클릭 시 설정 탭 active.
- **아이콘 분기 회귀**: 녹화 버튼 아이콘 lucide 클래스(`lucide-app-window`/`lucide-monitor-play`) 기반 e2e 단언은 유지 가능 — 분기 로직 보존.
- **orphan import**: `RecordingSettingsDialog` 삭제 후 IssueTab에 잔존 import 있으면 빌드 실패 → import 제거 동반 필수.
- **`mode-record-settings` testid 잔존 검색**: 삭제 후 `src/`·`e2e/`(README.md 포함)에서 grep해 잔존 참조 0 확인. `onConfigure`/`recSettingsOpen`/`setRecSettingsOpen`도 함께 스윕.
- **e2e 리플레이 토글 셀렉터**: `RecordingSettingsCard`의 리플레이 스위치는 `data-testid`가 아니라 `id={replayInputId}`(기본 `replay-enabled`)다. 재작성 e2e가 토글에 접근하면 `#replay-enabled` id 셀렉터를 써야 한다(testid 아님).
- **i18n 라벨 변경 → 가이드/스크린샷 캡션 동기화**: `issue.mode.element` 값 변경으로 가이드 본문의 "요소 편집" 표기가 stale. `/guide`에서 갱신(가이드 영향 참조).
