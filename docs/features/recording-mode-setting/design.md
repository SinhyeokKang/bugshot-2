# 녹화 모드 설정 — 기술 설계

## 개요

`settings-ui-store`에 영속 상태 `recordingMode: RecordingSource`("tab" | "screen")를 추가하고, 설정 캡처 섹션에 ToggleGroup 세그먼트 컨트롤을 둔다. 캡처 진입 화면 `EmptyState`의 Row 3을 [선택 모드 녹화 버튼 + ⚙][리플레이]로 재구성한다. 단축키 `video` 액션과 그리드 녹화 버튼 모두 `recordingMode`를 읽어 기존 `startVideoCapture`/`startScreenCapture` 중 하나로 분기한다. 캡처 로직 자체는 손대지 않는다.

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
  - persist `version` 5 → **6**, `migrate`에 `if (version < 6 || !state.recordingMode) state.recordingMode = "tab"` 추가

### `src/sidepanel/lib/recordModeMeta.ts` (신규)
- 역할: 녹화 모드 → UI 메타(아이콘 컴포넌트, i18n 라벨 키, 시작 액션 식별자) 매핑. IssueTab과 테스트에서 공용으로 쓰는 **순수 함수**.
- 아이콘은 컴포넌트 참조를 직접 반환하지 않고, IssueTab에서 분기 렌더하기 쉽도록 식별 문자열만 반환한다 (순수성 유지·테스트 용이).

### `src/sidepanel/tabs/IssueTab.tsx`
- 현재 역할: 캡처 진입 화면(`EmptyState`) + Row 3 [탭][화면] ButtonGroup(`:208-219`) + `ReplayButton`(`:243-293`).
- 변경:
  - `EmptyState`에서 `useSettingsUiStore((s) => s.recordingMode)` 구독
  - Row 3의 [탭 녹화][화면 녹화] 2버튼 ButtonGroup을 **제거**하고, 다음 단일 행으로 교체:
    - `<div className="flex w-full gap-2">`
      - `<ButtonGroup className="min-w-0 flex-1">` — split: [녹화 버튼(`flex-1`, `data-testid="mode-record"`)][⚙ 버튼(`shrink-0`, `data-testid="mode-record-settings"`)]
        - 녹화 버튼: `recordingMode === "tab"` ? `<AppWindow/> + t("issue.mode.video")` : `<MonitorPlay/> + t("issue.mode.screenRecord")`. onClick → 모드에 맞는 `startVideoCapture`/`startScreenCapture`
        - ⚙ 버튼: `<Settings/>` 아이콘만, `aria-label`, onClick → `navTo("settings", "issue")`
      - `<ReplayButton />` — `flex-1`로 같은 행에 배치 (현재 `w-full`을 래퍼/props로 `flex-1` 적용)
  - `capture-video` 단축키 툴팁(`ShortcutTooltip`)은 녹화 버튼에 유지
  - `EmptyState` props: `onStartVideo`/`onStartScreenRecord`는 그대로 두고, 녹화 버튼이 모드에 따라 둘 중 하나를 호출 (호출부 `:129-130` 유지)

### `src/sidepanel/hooks/useCaptureShortcuts.ts`
- 현재 역할: 캡처 단축키 액션 디스패치. `action === "video"` → `startVideoCapture(tabId)`(`:27`).
- 변경: `video` 분기에서 `recordingMode`를 읽어 분기.
  ```ts
  else if (action === "video") {
    const mode = useSettingsUiStore.getState().recordingMode;
    if (mode === "screen") void startScreenCapture(tabId);
    else void startVideoCapture(tabId);
  }
  ```
  `startScreenCapture` import 추가.

### `src/sidepanel/tabs/SettingsTab.tsx`
- 현재 역할: 설정 탭. "캡처 설정" 섹션(`:111-134`)에 replay 토글.
- 변경: 캡처 설정 Card 안, replay 행 **위**에 녹화 모드 행 + `<Separator/>` 추가. 기존 replay 행과 동일한 좌측(아이콘+라벨+help) 레이아웃, 우측엔 Switch 대신 `ToggleGroup`:
  ```tsx
  <ToggleGroup type="single" value={recordingMode}
    onValueChange={(v) => v && setRecordingMode(v as RecordingSource)}>
    <ToggleGroupItem value="tab" aria-label={t("settings.recordingMode.tab")}>
      <AppWindow className="h-4 w-4" />
    </ToggleGroupItem>
    <ToggleGroupItem value="screen" aria-label={t("settings.recordingMode.screen")}>
      <MonitorPlay className="h-4 w-4" />
    </ToggleGroupItem>
  </ToggleGroup>
  ```
  좌측 아이콘은 `Video`(lucide) 또는 모드 중립 아이콘. `useSettingsUiStore`에서 `recordingMode`/`setRecordingMode` 구독.

### `src/i18n/namespaces/settings.ts`
- 변경: ko/en 양쪽에 키 추가 (PostToolUse 훅이 대칭 검사):
  - `settings.recordingMode.label` — "녹화 모드" / "Recording mode"
  - `settings.recordingMode.help` — 탭/화면 차이 한 줄 설명
  - `settings.recordingMode.tab` — "탭 녹화" / "Record tab"
  - `settings.recordingMode.screen` — "화면 녹화" / "Record screen"
- `issue.mode.video`/`issue.mode.screenRecord`는 **유지**(그리드 녹화 버튼이 재사용).

### `e2e/capture-modes-layout.spec.ts`
- 현재 역할: `1×2×2×1` + `mode-video`/`mode-screen-record` 동시 노출 검증.
- 변경: `1×2×2` 검증으로 갱신 — Row 3에 `mode-record`(단일) + `mode-record-settings` + `replay-button`이 같은 행. `mode-video`/`mode-screen-record` 동시 노출 단언 제거.

## 데이터 흐름

```
설정 ToggleGroup → setRecordingMode("tab"|"screen")
   → settings-ui-store.recordingMode (persist: chrome.storage.local, bugshot-app-settings v6)
   → EmptyState 구독 → Row3 녹화 버튼 아이콘/라벨/onClick 분기
   → 단축키 video 액션 → useSettingsUiStore.getState().recordingMode 분기
       → startVideoCapture(tab) | startScreenCapture(screen)  (기존 로직 그대로)
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
- **탭 네비게이션**: ⚙ 버튼은 기존 `useTabNav()` → `navTo("settings", "issue")` 패턴 재사용 (ReplayButton `:260`과 동일).
- **shadcn 우선**: ToggleGroup(이미 설치)·ButtonGroup(이미 설치) 사용. 직접 스타일링 금지.
- **IconButton 사이즈**: ⚙ 버튼은 패널/섹션 액션이 아닌 split 보조라 녹화 버튼 높이(`h-9`, default)에 맞춘다. ToggleGroupItem은 컴포넌트 기본.
- **테스트 우선**: `recordModeMeta` 순수 함수 단위 테스트 먼저 작성.

## 대안 검토

1. **캡처 화면에 모드 토글 인라인 + 설정 없음**: 그리드를 1×2×2로 못 줄임(토글 자리 필요), "설정에 추가" 요구와 어긋남. 기각.
2. **두 녹화 버튼 유지 + 리플레이를 Row2로 흡수**: 행 수는 줄지만 캡처 버튼 의미 그룹이 깨지고 모드 선택 부담이 그대로. 기각.
3. **`recordingMode`를 editor-store에 추가**: 세션 상태(`recordingSource`)와 영속 설정이 섞임. 설정은 `settings-ui-store`가 단일 출처라 분리 유지. 기각.

## 위험 요소

- **화면 녹화 + 단축키 user activation**: `getDisplayMedia`는 transient activation을 요구한다. 그리드 버튼 클릭 경로는 gesture가 살아있지만, 단축키(`chrome.commands` → sidepanel) 경로에서 `screen` 모드 시작 시 activation이 끊겨 실패할 수 있다. 구현 후 실제 탭에서 단축키→화면 녹화를 실측한다. 실패하면 단축키는 탭 녹화만 지원하도록 폴백(문서 명시) 검토.
- **e2e 회귀**: `capture-modes-layout.spec.ts`가 반드시 깨진다 — 갱신 필수. 다른 spec이 `mode-video`/`mode-screen-record` testid에 의존하는지 grep 확인.
- **ButtonGroup split 스타일**: [녹화|⚙] 인접 버튼의 border-radius 묶음이 ButtonGroup 기본 스타일로 자연스러운지 시각 확인.
- **마이그레이션 누락 시**: `recordingMode` undefined면 그리드 분기·ToggleGroup value가 깨진다 — migrate 기본값 `"tab"` 필수.
