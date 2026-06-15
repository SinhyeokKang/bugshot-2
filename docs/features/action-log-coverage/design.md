# 액션 로그 커버리지 확장 — 기술 설계

## 개요

`ActionEntryKind`에 3종(`keypress`·`toggle`·`select`)을 추가하고, MAIN world 레코더(`action-recorder.ts`)에 keydown 리스너와 change 핸들러 확장을 더한다. 데이터 경로(MAIN world `CustomEvent` dispatch → `recorder-bridge` 중계 → `picker-control` 수집)는 무변경 — entry 스키마만 확장되므로 기존 버퍼·flush·sentinel 메커니즘을 그대로 탄다. 표현은 4개 레이어(라이브 서브탭·영상 마커·AI 요약·JSON)에 새 종류 분기를 추가한다. 새 저장 필드는 만들지 않고 기존 `value`·`fieldLabel`·`target`·`selector`를 재사용한다.

## 변경 범위

### 타입

- **`src/types/action.ts`** — `ActionEntryKind` union에 `"keypress" | "toggle" | "select"` 추가. 새 필드는 추가하지 않음(기존 optional 필드 재사용). 주석으로 종류별 필드 사용 규약 명시.

### 레코더 (content, MAIN world)

- **`src/content/action-recorder.ts`**
  - 내부 `type Kind` 리터럴(line 20)에 3종 추가 — `types/action.ts`와 리터럴 동기화(MAIN world라 import 불가, 기존 HOST_ID 주석과 동일 사유).
  - **keydown capture 리스너 추가**: `document.addEventListener("keydown", …, true)`. `isOwnUi` 가드 → **IME 가드**(`e.isComposing || e.key === "Process"`면 early-return) → `formatKeyCombo()`로 조합 문자열 산출 → null이면 무시(인쇄 문자), 아니면 `pushAction({kind:"keypress", value: combo, target: accessibleName(focused), selector})`. keypress는 이산 이벤트라 dedup 불필요(연타는 각각 기록 — input dedup 로직을 복제하지 말 것).
  - **click 핸들러 checkbox/radio 가드**(line 185~): click 핸들러는 `closest("button, a, [role=button], input[type=submit]")`로 정규화하므로 checkbox/radio는 interactive 매칭에서 빠지고 원본 요소로 `recordClick`된다. 따라서 셀렉터 수정이 아니라 **`recordClick` 직전 가드**를 추가한다 — 클릭 타깃(또는 `<label for>`/래핑 label의 연결 컨트롤)이 `input[type=checkbox|radio]`면 click 기록을 **건너뛴다**(change가 toggle로 기록). label은 `htmlFor`로 연결 컨트롤을 해석하거나 `label.control`을 사용. `<select>`는 click이 옵션 선택을 의미하지 않으므로 영향 없음.
  - **change/input 핸들러 확장**(`onInput`, line 201~): 현재 input/textarea/contentEditable만 통과. 분기 추가:
    - `<select>` → `pushAction({kind:"select", fieldLabel, value: selectedText, selector})`. `selectedText`는 단일 select면 `options[selectedIndex].text`, `multiple`이면 `selectedOptions`의 text를 ", "로 join + 길이 cap(빈 선택이면 빈 문자열 또는 "(none)"). 단일 select가 대다수.
    - `input[type=checkbox|radio]` → `pushAction({kind:"toggle", fieldLabel, value: checked ? "checked" : "unchecked", selector})`
    - 기존 텍스트 input dedup 로직은 input/textarea/contentEditable에만 적용(현행 유지).

- **`src/content/action-recorder-helpers.ts`** (순수 함수 — 테스트 우선)
  - `formatKeyCombo(input: KeyComboInput): string | null` 추가. 모디파이어 조합 또는 특수키만 사람이 읽는 문자열로, 그 외 null.
  - `shouldMaskField`·`maskValue`는 **변경 없음**(② 비목표).

### 표현 레이어

- **`src/sidepanel/components/ActionLogContent.tsx`**
  - `ACTION_FILTERS` 배열에 `keypress`·`toggle`·`select` 추가(availableFilters가 present 종류만 노출하므로 동적).
  - **필터 탭 오버플로 처리**: 좁은 사이드패널(~376px)에서 6종 동시 present 시 `TabsList`(`whitespace-nowrap`, overflow 미처리)가 같은 줄의 Search Input을 밀어낸다. `OriginFilterBar`가 쓰는 `overflow-x-auto` 패턴을 적용 — `TabsList` 래퍼에 가로 스크롤 허용(코드 선제 처리, 수동 테스트로 미루지 않음).
  - `KindIcon` switch에 3 case 추가(lucide 아이콘: `keypress`→`CornerDownLeft`, `toggle`→`SquareCheck`, `select`→`ListChecks`). **누락 방지 가드 추가**: `default: kind satisfies never`로 새 kind 누락을 컴파일 타임에 검출(현재는 가드 없어 누락 시 조용히 아이콘 미렌더).
  - `ActionRow` 렌더 분기에 3종 추가 — verb i18n 적용.
  - `kindColor`/`kindBgColor`는 navigation만 틴트하는 현행 유지(새 3종 중립).
  - `searchText`에 keypress `value` 포함 검토(선택).

- **`src/log-viewer/markers.ts`** — action switch(line 105~)에 `keypress`·`toggle`·`select` case 추가. 각 `labelParts` 구성. variant는 **중립 default**(기존 click/input과 동일 — keypress/toggle/select에 별도 색 틴트 없음). `default: e.kind satisfies never` 그대로 두면 컴파일러가 누락 검출.

- **`src/sidepanel/lib/buildLogSummary.ts`** — `buildActionLogSummary`에 3종 분기 추가(영문 자연어 줄). 예: `Pressed: ⌘+K` / `Toggled "약관 동의": checked` / `Selected "Korea" in "국가"`. **주의**: 현재 구조가 `if(navigation)/if(input)/else "Clicked"` 폴백이라(exhaustive switch 아님) 3종 분기를 빠뜨리면 컴파일 에러 없이 "Clicked"로 오표시된다. 회귀 테스트로 "3종이 Clicked로 새지 않음"을 단언(Task 6).

- **`src/sidepanel/lib/buildActionLogJson.ts`** — **변경 불필요**. 현재 `kind`·`value`·`fieldLabel`·`target`·`selector`를 모두 조건부 스프레드하므로 새 종류가 자동 직렬화된다. (확인용 테스트만 추가)

### i18n

- **`src/i18n/namespaces/logs.ts`** — ko/en 동시 추가:
  - `actionLog.filter.keypress` / `.toggle` / `.select` — ko 라벨은 기존 2자급(클릭/이동/입력)과 통일: `키`·`토글`·`선택`. en: `Keys`·`Toggle`·`Select`.
  - `actionLog.verb.keypress` (`"{keys} 키"` / `"Pressed {keys}"`)
  - `actionLog.verb.toggle.check` / `.uncheck` (`"{field} 체크"`·`"{field} 해제"` / `"Checked {field}"`·`"Unchecked {field}"`)
  - `actionLog.verb.select` (`"{field}에서 {value} 선택"` / `"Selected {value} in {field}"`)

## 데이터 흐름

```
[페이지 DOM 이벤트] keydown / change(select·checkbox·radio)
   → action-recorder.ts (MAIN world) recordKeypress/recordToggle/recordSelect
   → buffer.push(CapturedAction{kind, value, fieldLabel, target, selector})
   → throttle.schedule() → CustomEvent("__bugshot_action_data__"+sentinel) dispatch
   → recorder-bridge.ts (ISOLATED) 수신·중계        [무변경]
   → picker-control / useBackgroundRecorder 수집 → ActionLog.entries  [무변경]
   → 4개 표현 레이어 렌더
```

엔트리 스키마만 확장되고 버퍼링·flush·sentinel·FIFO cap(MAX_ENTRIES=1000)은 그대로다.

## 인터페이스 설계

```typescript
// types/action.ts
export type ActionEntryKind =
  | "click" | "navigation" | "input"
  | "keypress"   // value: 키 조합 문자열, target?: 포커스 요소 이름, selector
  | "toggle"     // checkbox/radio. fieldLabel, value: "checked"|"unchecked", selector
  | "select";    // <select>. fieldLabel, value: 선택 옵션 텍스트, selector
// ActionEntry 필드 추가 없음 — 위 종류는 기존 optional 필드 재사용.

// action-recorder-helpers.ts
export interface KeyComboInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}
// 모디파이어 조합 또는 특수키(Enter·Escape·Tab·Arrow*)면 표시 문자열, 아니면 null.
// 예: {key:"k", metaKey:true} → "⌘+K" / {key:"Enter"} → "Enter" / {key:"a"} → null
export function formatKeyCombo(input: KeyComboInput): string | null;
```

`formatKeyCombo` 규칙:
- **IME 가드**: `isComposing === true` 또는 `key === "Process"` → `null`(한글·일본어·중국어 조합 중 keydown 제외).
- 모디파이어(ctrl/meta/alt) 하나라도 true → 조합 문자열 반환(shift 포함). 표기 순서 `⌘`(meta)·`Ctrl`·`Alt`·`Shift` + `+키`. 단일 문자 키는 대문자.
- 모디파이어 없음 + 특수키(`Enter`·`Escape`·`Tab`·`ArrowUp/Down/Left/Right`) → 키 이름 반환.
- 그 외(모디파이어 없는 인쇄 문자, 단독 Shift 등) → `null`.

## 기존 패턴 준수

- **MAIN world self-contained**: action-recorder.ts는 직렬화 주입이라 import 불가. 새 헬퍼 로직은 recorder 내부 inline 구현, 순수 부분만 helpers로 분리해 테스트(기존 `buildLightSelector`·`shouldMaskField`와 동일 분리 패턴). `formatKeyCombo`는 helpers에 두되 recorder에는 동등 로직을 inline(현재도 helpers는 테스트 전용 복제 — line 1 주석).
- **i18n 동시 갱신**: ko/en 양쪽 추가, PostToolUse 훅이 `locales.test`로 대칭 강제.
- **exhaustive switch**: `markers.ts`의 `satisfies never`로 종류 누락을 컴파일 타임 검출 — 새 종류는 반드시 case 추가해야 통과.
- **테스트 우선**: `formatKeyCombo`는 인터페이스 신규이므로 `/tdd interface`로 테스트 선작성.
- **세션 보존 무영향**: phase별 보존 룰·cross-page 누적은 entry 종류와 무관.

## 대안 검토

- **③ 새 kind 대신 기존 `input` kind 재사용** — value에 "checked"/옵션텍스트를 담아 배선 0으로 처리 가능. **미채택**: 사용자 결정(새 kind 신설). 토글·드롭다운을 텍스트 입력과 구분해 필터·아이콘·표현을 분리하는 편이 재현 동선 가독성이 높다는 판단.
- **① keypress 전수 기록** — 모든 키. **미채택**: 인쇄 문자가 input과 중복되고 평문 키스트로크가 프라이버시 위험(비밀번호 필드 키 누출). 특수키+조합만으로 단축키·내비게이션 신호는 충분.
- **② email/tel 마스킹 확장** — **미채택**(비목표). 재현 가치 우선, 사용자 결정.
- **toggle/radio를 별도 kind로 더 쪼개기** — checkbox·radio를 각각의 kind로. **미채택**: 둘 다 "boolean/선택 상태 변경"이라 `toggle` 하나로 충분, 배선 최소화.

## 위험 요소

- **click ↔ change 중복**: checkbox/radio는 click·change 둘 다 발화. click 핸들러에서 checkbox/radio 제외를 정확히 해야 단일 기록(change 기준이 안전). **표준 `<label for>`·래핑 label 클릭도 change가 발화**하므로, click 가드가 label의 연결 컨트롤(`htmlFor`/`label.control`)까지 해석해 checkbox/radio면 click을 제외해야 click+toggle 이중 기록을 막는다(엣지). change가 발화하지 않는 커스텀 위젯(div role=checkbox)은 click으로만 남음 — 수용(현행과 동일 수준).
- **keypress 고빈도 → FIFO cap 폭증**: action 로그는 **순수 FIFO**(`MAX_ENTRIES=1000`, `mergeLogItems`에 topOrigin 미전달 — CLAUDE.md "action은 광고가 폭증시키지 않아 순수 FIFO" 명시)다. keypress는 click/navigation보다 고빈도라, 특수키·조합만 필터링해도 Tab/Enter/화살표 연타나 에디터·게임형 페이지에서 cap을 빠르게 채워 기존 click/navigation 기록을 밀어낼 수 있다. **순수 FIFO 유지로 수용**(기존 설계 일관성 우선, sub-cap 미도입). 한계로 인지.
- **필터 탭 오버플로**: 사이드패널이 좁아 종류 6개가 동시에 present면 TabsList가 넘칠 수 있음. availableFilters가 동적이라 통상은 일부만 노출되나, 다종 페이지에서 확인 필요(수동 테스트 항목).
- **`<select>` 멀티 셀렉트**: `selectedOptions` 다중일 때 첫 옵션만? 전체 join? → 첫 옵션 + `…` 또는 join. 단순화 위해 `selectedOptions`를 ", "로 join(cap). 설계상 단일 select가 대다수.
- **privacy.md 게이트**: keypress(조합·특수키)·toggle/select(옵션 라벨·체크 상태)는 **새 캡처·수집 동작**이다. manifest diff가 0이어도 `docs/privacy.md`를 대조·갱신해야 한다(시행일 포함) — `/audit`/CLAUDE.md의 privacy 게이트 전례. 명시할 항목: (1) keypress는 키 조합만 저장하고 인쇄 문자·필드 값은 미포함, (2) **keypress의 `target`은 포커스 요소의 접근성 이름**(`accessibleName()` — aria-label/textContent/title/alt를 긁으므로 임의 포커스 요소의 표시 텍스트가 들어갈 수 있음 = 새 수집 표면), (3) toggle/select는 체크 상태·선택 옵션 텍스트를 저장.
- **MAIN world inline 복제 드리프트**: `formatKeyCombo` 로직이 helpers(테스트용)와 recorder(inline) 두 곳에 존재 — 변경 시 동기화 필요(기존 helpers 패턴의 알려진 트레이드오프).
