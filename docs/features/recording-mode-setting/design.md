# 녹화 모드 설정 — 기술 설계

## 개요

`settings-ui-store`에 영속 상태 `recordingMode: RecordingSource`("tab" | "screen")를 추가하고, 설정 캡처 섹션에 shadcn Tabs(2개 탭을 값 컨트롤로)를 둔다. 캡처 진입 화면 `EmptyState`의 Row 3을 [선택 모드 녹화 버튼 + ⚙][리플레이]로 재구성한다. **그리드 녹화 버튼만** `recordingMode`를 읽어 기존 `startVideoCapture`/`startScreenCapture` 중 하나로 분기한다(클릭 경로는 user gesture가 살아있음). 캡처 단축키와 캡처 로직 자체는 손대지 않는다.

## 변경 범위

### `src/store/editor-store.ts`
- 현재 역할: 에디터/녹화 세션 상태. `RecordingSource = "tab" | "screen"` 타입을 이미 export(`:17`).
- 변경: **없음.** `RecordingSource` 타입을 settings-ui-store에서 재사용한다 (editor-store는 settings-ui-store를 import하지 않으므로 순환 없음 — 확인 완료).

### `src/store/settings-ui-store.ts`
- 현재 역할: 앱 설정 영속 store(`bugshot-app-settings`, v5). `replayEnabled` 등 보유.
- 변경:
  - `import type { RecordingSource } from "@/store/editor-store"`
  - `SettingsUiState`에 `recordingMode: RecordingSource` + `setRecordingMode: (m: RecordingSource) => void` 추가
  - 초기값 `recordingMode: "tab"`
  - `setRecordingMode: (recordingMode) => set({ recordingMode })`
  - persist `version` 5 → **6**, `migrate`에 한 줄 추가: `state.recordingMode = state.recordingMode ?? "tab"` (신규 필드라 version 비교 없이 nullish 병합 — 기존 v3의 `llm` 처리와 동일 패턴. 어떤 손상 상태에서도 안전)

### `src/sidepanel/lib/recordModeMeta.ts` (신규)
- 역할: 녹화 모드 → UI 메타(아이콘 컴포넌트, i18n 라벨 키, 시작 액션 식별자) 매핑. IssueTab과 테스트에서 공용으로 쓰는 **순수 함수**.
- 아이콘은 컴포넌트 참조를 직접 반환하지 않고, IssueTab에서 분기 렌더하기 쉽도록 식별 문자열만 반환한다 (순수성 유지·테스트 용이).

### `src/sidepanel/tabs/IssueTab.tsx`
- 현재 역할: 캡처 진입 화면(`EmptyState`) + Row 3 [탭][화면] ButtonGroup(`:208-219`) + `ReplayButton`(`:243-293`).
- 변경:
  - `EmptyState`에서 `useSettingsUiStore((s) => s.recordingMode)` 구독
  - Row 3의 [탭 녹화][화면 녹화] 2버튼 ButtonGroup을 **제거**하고, 다음 단일 행으로 교체:
    - `<div className="flex w-full gap-2">`
      - `<div className="relative min-w-0 flex-1">` — 녹화 버튼 + ⚙ 오버레이 (ButtonGroup 미사용)
        - 녹화 버튼: `<Button className="w-full pr-9" data-testid="mode-record">` — `pr-9`로 ⚙ 자리 확보. `recordModeMeta(recordingMode)`로 아이콘/라벨 결정 → `recordingMode === "tab"` ? `<AppWindow/> + <span className="truncate">{t("issue.mode.video")}</span>` : `<MonitorPlay/> + <span className="truncate">{t("issue.mode.screenRecord")}</span>`. **onClick 분기는 IssueTab 인라인 if**(`recordingMode === "screen" ? onStartScreenRecord() : onStartVideo()`) — `recordModeMeta`는 아이콘/라벨만 반환(액션 식별자 미포함)
        - ⚙ 버튼: `<Button>` 위에 absolute 오버레이 — `variant="ghost" size="icon"`, `className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2"` (x=우측 8px, y=중앙), `data-testid="mode-record-settings"`, `aria-label={t(...)}`. `onClick={(e) => { e.stopPropagation(); navTo("settings","issue"); }}` — 녹화 버튼 클릭과 분리(⚙ 클릭이 녹화를 시작하지 않게 stopPropagation)
      - `<ReplayButton className="min-w-0 flex-1" />` — 같은 행에 배치. `ReplayButton`에 `className` prop을 받도록 시그니처 확장(현재 내부 `w-full` 하드코딩 → `cn("...", className)`)
  - `EmptyState` props: `onStartVideo`/`onStartScreenRecord`는 그대로 두고, 녹화 버튼이 `recordingMode`에 따라 둘 중 하나를 호출 (호출부 `:129-130` 유지)
  - 단축키 툴팁(`ShortcutTooltip` for `capture-video`)은 녹화 버튼에 유지(탭 녹화 단축키 표기 — 단축키 동작 자체는 불변)

### `src/sidepanel/hooks/useCaptureShortcuts.ts`
- **변경 없음.** 단축키 `video` 액션은 기존대로 `startVideoCapture`(탭 녹화 고정)를 호출한다. 단축키→화면 녹화는 `chrome.commands`→sidepanel 경로에서 transient user activation이 전파되지 않아 `getDisplayMedia` picker가 뜨지 않으므로 분기하지 않는다(PRD 비목표). 캡처 단축키 제거는 별도 feature.

### `src/sidepanel/tabs/SettingsTab.tsx`
- 현재 역할: 설정 탭. "캡처 설정" 섹션(`:111-134`)에 replay 토글(Switch).
- 변경: 캡처 설정 Card 안, replay 행 **위**에 녹화 모드 행 + `<Separator/>` 추가. 기존 replay 행과 동일한 좌측(아이콘+라벨+help) 레이아웃, 우측엔 shadcn **Tabs**를 값 컨트롤로:
  ```tsx
  <Tabs value={recordingMode}
    onValueChange={(v) => setRecordingMode(v as RecordingSource)}>
    <TabsList>
      <TabsTrigger value="tab">
        <AppWindow className="mr-1 h-4 w-4" />{t("settings.recordingMode.tab")}
      </TabsTrigger>
      <TabsTrigger value="screen">
        <MonitorPlay className="mr-1 h-4 w-4" />{t("settings.recordingMode.screen")}
      </TabsTrigger>
    </TabsList>
    {/* TabsContent 없음 — value 선택 컨트롤로만 사용 */}
  </Tabs>
  ```
  아이콘+텍스트 라벨 동반(명료성). 좌측 행 아이콘은 `Video`(lucide, 모드 중립). `useSettingsUiStore`에서 `recordingMode`/`setRecordingMode` 구독. 설정 화면은 폭 여유가 있어 Tabs 가로 배치가 들어간다.

### `src/i18n/namespaces/settings.ts`
- 변경: ko/en 양쪽에 **플랫 문자열 키**(점 포함 문자열, 중첩 객체 아님 — `locales.test.ts`가 `Object.keys` 평탄 비교라 중첩이면 검사 우회) 추가:
  - `"settings.recordingMode.label"` — "녹화 모드" / "Recording mode"
  - `"settings.recordingMode.help"` — 탭/화면 차이 한 줄 설명
  - `"settings.recordingMode.tab"` — "탭 녹화" / "Record tab"
  - `"settings.recordingMode.screen"` — "화면 녹화" / "Record screen"
- `issue.mode.video`/`issue.mode.screenRecord`는 **유지**(그리드 녹화 버튼이 재사용).

### `e2e/capture-modes-layout.spec.ts`
- 현재 역할: `1×2×2×1` + `mode-video`/`mode-screen-record` 동시 노출 검증. (grep 확인: `mode-video`/`mode-screen-record` testid는 이 1개 spec에만 의존 — 갱신 대상 확정.)
- 변경: `1×2×2` 검증으로 갱신 — Row 3에 `mode-record`(단일) + `mode-record-settings` + `replay-button`이 같은 행. `mode-video`/`mode-screen-record` 동시 노출 단언 제거.
- **회귀 주의**: `replay-button` testid는 `replay-action-log.spec.ts`·`action-log-coverage.spec.ts`도 의존(버튼 클릭만 함, Row4 단독 전제 아님). `ReplayButton`에 `className` prop을 추가하되 `data-testid="replay-button"`과 클릭 동작은 유지 → 두 spec 회귀 없음.

## 데이터 흐름

```
설정 Tabs → setRecordingMode("tab"|"screen")
   → settings-ui-store.recordingMode (persist: chrome.storage.local, bugshot-app-settings v6)
   → EmptyState 구독(라이브) → Row3 녹화 버튼 아이콘/라벨/onClick 분기
       → onStartVideo(tab) | onStartScreenRecord(screen)  (기존 로직 그대로)

단축키 video 액션 → startVideoCapture(tab)  ※ recordingMode 미참조, 기존 탭 녹화 고정 (이번 범위 밖)

[영속 설정] settings-ui-store.recordingMode = 다음 녹화의 모드 선택 입력
[세션 상태] editor-store.recordingSource = 진행 중 녹화가 어느 소스인지 (startRecording이 기록)
   → 둘은 직교: recordingMode는 "어느 함수를 부를지"의 입력일 뿐, 진행 중 녹화엔 무관.
```

## 인터페이스 설계

```ts
// editor-store.ts (기존, 재사용)
export type RecordingSource = "tab" | "screen";

// settings-ui-store.ts (추가)
interface SettingsUiState {
  // ...
  recordingMode: RecordingSource;
  setRecordingMode: (mode: RecordingSource) => void;
}

// sidepanel/lib/recordModeMeta.ts (신규, 순수)
export type RecordModeIcon = "appWindow" | "monitorPlay";
export interface RecordModeMeta {
  icon: RecordModeIcon;
  labelKey: "issue.mode.video" | "issue.mode.screenRecord";
}
export function recordModeMeta(mode: RecordingSource): RecordModeMeta;
//  "tab"    → { icon: "appWindow",   labelKey: "issue.mode.video" }
//  "screen" → { icon: "monitorPlay", labelKey: "issue.mode.screenRecord" }
```

## 기존 패턴 준수

- **i18n 동시 갱신**: `settings.ts` ko/en 양쪽 키 추가 (PostToolUse 훅 자동 검사).
- **store 마이그레이션**: `settings-ui-store` version bump + `migrate` 기본값 부여 (기존 v3/v4/v5 마이그레이션과 동일 패턴).
- **탭 네비게이션**: ⚙ 버튼은 IssueTab 내부에서 `useTabNav()` → `navTo("settings", "issue")` 호출 — 같은 파일의 `ReplayButton`(`IssueTab.tsx:260`)이 쓰는 패턴을 그대로 재사용. (SettingsTab은 `useTabNav`를 쓰지 않으므로 출처는 IssueTab의 ReplayButton임을 명확히.)
- **shadcn 우선**: Tabs(이미 설치)·Button(이미 설치) 사용. 직접 스타일링 금지.
- **⚠️ absolute 오버레이 ⚙는 신규 배치**: 버튼 위에 아이콘 버튼을 absolute로 겹치는 패턴은 이 코드베이스에 선례가 적다. `relative` 래퍼 + `pr-9`로 라벨이 ⚙ 밑으로 깔리지 않게 하고, ⚙는 `right-2 top-1/2 -translate-y-1/2`로 우측 중앙 정렬. `e.stopPropagation()`으로 ⚙ 클릭이 녹화 버튼 onClick을 트리거하지 않게 한다. 겹침·클릭 분리·시각 정합을 **수동 테스트 필수 항목**으로 둔다(tasks 참조).
- **IconButton 사이즈**: ⚙ 버튼은 녹화 버튼 안에 들어가는 보조라 `h-7 w-7`(28px, `size="icon"` 변형)로 본체보다 작게.
- **테스트 우선**: `recordModeMeta` 순수 함수 단위 테스트 먼저 작성. `settings-ui-store` v5→v6 migrate도 단위 테스트(아래 위험 요소).

## 대안 검토

1. **캡처 화면에 모드 토글 인라인 + 설정 없음**: 그리드를 1×2×2로 못 줄임(토글 자리 필요), "설정에 추가" 요구와 어긋남. 기각.
2. **두 녹화 버튼 유지 + 리플레이를 Row2로 흡수**: 행 수는 줄지만 캡처 버튼 의미 그룹이 깨지고 모드 선택 부담이 그대로. 기각.
3. **`recordingMode`를 editor-store에 추가**: 세션 상태(`recordingSource`)와 영속 설정이 섞임. 설정은 `settings-ui-store`가 단일 출처라 분리 유지. 기각.
4. **split 버튼에 ⚙ 대신 드롭다운(모드 즉시 전환)**: ButtonGroup split을 어차피 쓸 거면 ⚙ 대신 드롭다운을 붙여 설정 왕복 없이 캡처 화면에서 즉시 모드 전환 → "숨기지 않으면서 3행 + 즉시 전환" 둘 다 달성 가능. **그러나** 사용자 요구가 "설정에 녹화 모드 추가 + 녹화 버튼에 설정 이동 버튼"으로 명시적이고, 모드 전환을 드물게 보는 제품 가정(PRD 배경)상 설정이 단일 출처인 편이 단순하다. 좁은 폭에서 드롭다운 트리거까지 한 행에 넣으면 truncate 압박도 커진다. 요구·단순성 우선으로 기각하되, 모드 전환이 잦다는 데이터가 나오면 재고한다.

## 위험 요소

- **단축키 user activation (해결 — 분기 안 함)**: `getDisplayMedia`는 transient activation을 요구하고, `video-capture.ts`는 이를 위해 picker 호출을 첫 await로 둔다. 단축키(`chrome.commands`→`sendMessage`→sidepanel) 경로는 activation이 전파되지 않아 `screen` 모드가 picker를 못 띄운다(거의 확정). 그래서 **단축키는 분기하지 않고 기존 탭 녹화 고정**으로 둔다(PRD 비목표). 화면 녹화는 그리드 버튼 클릭(gesture 보존)으로만 시작. → 이번 설계에서 잔여 위험 없음.
- **좁은 폭 truncate**: Row 3을 [녹화(아이콘+라벨, flex-1)][⚙ ~36px][gap][리플레이 flex-1]로 한 행에 넣으면 실 가용 ~288px에서 각 텍스트 버튼이 ~120px로 줄어 "화면 녹화"·"30초 리플레이" 한국어 라벨이 잘릴 수 있다. `<span className="truncate">`로 처리하되 아이콘·클릭 영역은 유지. **좁은 폭 실측을 수동 검증 항목**으로 둔다.
- **absolute 오버레이 ⚙**: 녹화 버튼 위에 ⚙를 겹친다. `pr-9`로 라벨-⚙ 겹침 방지, `e.stopPropagation()`으로 클릭 분리. ⚙ 클릭 영역(`h-7 w-7`)이 녹화 버튼과 겹치므로 우측 가장자리 오클릭 가능성 — `right-2`(8px 안쪽)로 충분히 분리됐는지 시각/실측 확인. 시각 정합 **수동 테스트 필수**.
- **e2e 회귀**: `capture-modes-layout.spec.ts`가 반드시 깨진다 — 갱신 필수(grep으로 `mode-video`/`mode-screen-record`는 이 1개 spec에만 의존 확인). `replay-button` 의존 2개 spec은 testid·클릭 유지로 회귀 없음.
- **마이그레이션 누락 시**: `recordingMode` undefined면 그리드 분기·Tabs value가 깨진다 — migrate `?? "tab"` 필수 + **단위 테스트로 검증**(부재→"tab", 기존 값 보존).
- **세션 복원 상호작용**: `recordingMode`(설정 영속)와 세션 복원(`editor-store` 세션)은 직교 — 복원 시 충돌 없음.
