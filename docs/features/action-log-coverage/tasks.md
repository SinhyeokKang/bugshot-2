# 액션 로그 커버리지 확장 — 구현 태스크

## 선행 조건

- `formatKeyCombo` 테스트를 `/tdd interface`로 먼저 작성(신규 인터페이스).
- `docs/privacy.md` 갱신 필요 인지(새 캡처 동작 — keypress·toggle·select). `/push` 전 privacy 게이트 대상.
- 권한·env·OAuth·manifest 변경 **없음**(기존 content_scripts·동작 범위 내).

## 태스크

### Task 1: `formatKeyCombo` 헬퍼 + 테스트
- **변경 대상**: `src/content/action-recorder-helpers.ts`, `src/content/__tests__/action-recorder-helpers.test.ts`
- **작업 내용**: `KeyComboInput` 인터페이스(`isComposing` 포함)와 `formatKeyCombo` 추가. IME 가드(`isComposing` 또는 `key==="Process"` → null), 모디파이어 조합/특수키 → 표시 문자열, 인쇄 문자·단독 Shift → null. 표기 순서 `⌘·Ctrl·Alt·Shift`.
- **검증**:
  - [ ] `{key:"k", metaKey:true}` → `"⌘+K"`
  - [ ] `{key:"Enter"}` → `"Enter"`, `{key:"Escape"}` → `"Escape"`, `{key:"Tab"}` → `"Tab"`
  - [ ] `{key:"ArrowDown"}` → `"ArrowDown"`
  - [ ] `{key:"a"}` (모디파이어 없음) → `null`
  - [ ] `{key:"Shift"}` 단독 → `null`
  - [ ] `{key:"p", ctrlKey:true, shiftKey:true}` → `"Ctrl+Shift+P"`
  - [ ] `{key:"Enter", isComposing:true}` → `null`, `{key:"Process"}` → `null` (IME 가드)
  - [ ] `pnpm test` 통과

### Task 2: `ActionEntryKind` union 확장
- **변경 대상**: `src/types/action.ts`
- **작업 내용**: union에 `"keypress" | "toggle" | "select"` 추가 + 종류별 필드 사용 규약 주석. 새 필드 추가 없음.
- **검증**:
  - [ ] `pnpm typecheck` 시 `markers.ts` exhaustive switch가 빨갛게 누락 검출(Task 5 전까지 의도된 에러)

### Task 3: 레코더 — keypress 수집
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**: 내부 `Kind` 리터럴에 3종 추가. keydown capture 리스너 추가 — `isOwnUi` 가드, **IME 가드**(`e.isComposing || e.key==="Process"` early-return), inline 키 조합 포맷(helpers와 동일 규칙), null이면 무시, 아니면 `kind:"keypress"` push(value=조합, target=포커스 요소 accessibleName, selector). keypress는 dedup 미적용(연타 각각 기록 — input dedup 복제 금지).
- **검증** (e2e — `e2e/fixtures/pages/actions.html` 확장):
  - [ ] (e2e) `Escape` → `keypress` "Escape" entry 1건
  - [ ] (e2e) `⌘+K`(또는 Ctrl+K) → `keypress` 조합 entry 1건
  - [ ] (e2e) 일반 문자 타이핑 → keypress 미출현(input만)
  - [ ] (e2e) Enter 2회 → keypress 2건(dedup 병합 안 됨)
  - [ ] (수동) picker host 내부 키 입력 무시 (자체 UI — e2e 곤란)
  - [ ] (수동) IME(한글) 조합 확정 Enter → keypress 미기록

### Task 4: 레코더 — toggle/select 수집 + click 중복 제거
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**: `recordClick` 직전 가드 — 클릭 타깃 또는 `<label for>`/래핑 label의 연결 컨트롤(`htmlFor`/`label.control`)이 `input[type=checkbox|radio]`면 click 기록 제외. `onInput`(change/input) 핸들러에 분기 추가 — `<select>`→`kind:"select"`(단일: `options[selectedIndex].text`, `multiple`: `selectedOptions` text를 ", " join+cap, 빈 선택은 ""/"(none)"), checkbox/radio→`kind:"toggle"`(value="checked"/"unchecked"). 기존 텍스트 dedup은 유지.
- **검증** (e2e — `e2e/fixtures/pages/actions.html` 확장):
  - [ ] (e2e) 체크박스 직접 클릭 → toggle 1건만(click 0건)
  - [ ] (e2e) `<label for>` 클릭으로 체크박스 토글 → toggle 1건만(click 중복 없음)
  - [ ] (e2e) `<select>` 변경 → "X에서 Y 선택" 1건
  - [ ] (e2e) radio 선택 → toggle 기록
  - [ ] (e2e) 텍스트 input 기존 동작·dedup 무회귀
  - [ ] (수동) `<select multiple>` 다중 선택 → join 표기 / 전체 해제 → 빈 선택 표기

### Task 5: 표현 — 라이브 서브탭 + 영상 마커
- **변경 대상**: `src/sidepanel/components/ActionLogContent.tsx`, `src/log-viewer/markers.ts`
- **작업 내용**: `ACTION_FILTERS`에 3종 추가 + **필터 탭 오버플로 처리**(TabsList 래퍼에 `overflow-x-auto` — `OriginFilterBar` 패턴). `KindIcon`에 3 case(`CornerDownLeft`·`SquareCheck`·`ListChecks`) + **`default: kind satisfies never` 가드 추가**. `ActionRow` 렌더 분기 + verb i18n. `markers.ts` action switch에 3 case(labelParts, 중립 default variant) 추가 — `satisfies never` 통과.
- **검증**:
  - [ ] `pnpm typecheck` 통과(markers.ts + KindIcon exhaustive switch 충족)
  - [ ] (e2e) 376px viewport에서 필터 6종 동시 present 시 가로 오버플로 없음(스크롤)
  - [ ] (수동) 라이브 서브탭에서 3종 아이콘·문구 정상 렌더
  - [ ] (수동) 영상 타임라인 마커에 3종 표시·seek 동작

### Task 6: 표현 — AI 요약 + JSON 확인
- **변경 대상**: `src/sidepanel/lib/buildLogSummary.ts`, `src/sidepanel/lib/__tests__/buildActionLogJson.test.ts`, `buildLogSummary` 테스트
- **작업 내용**: `buildActionLogSummary`에 3종 영문 줄 분기. `buildLogSummary`는 if/else "Clicked" 폴백 구조라(exhaustive switch 아님) 분기 누락 시 조용히 오표시 → **폴백 회귀 테스트** 추가. `buildActionLogJson`은 코드 변경 없음 — 새 종류 직렬화 확인 테스트만 추가.
- **검증**:
  - [ ] `buildActionLogSummary` 단위 테스트(3종 줄 포맷) 통과
  - [ ] **폴백 회귀 테스트**: keypress/toggle/select가 "Clicked"로 새지 않음을 단언
  - [ ] `buildActionLogJson` 테스트에 keypress/toggle/select 케이스 추가·통과(멀티/빈 select 포함)
  - [ ] `pnpm test` 전체 통과

### Task 7: i18n 키 추가
- **변경 대상**: `src/i18n/namespaces/logs.ts`
- **작업 내용**: filter.keypress/toggle/select(ko: `키`·`토글`·`선택` — 기존 2자급 통일 / en: `Keys`·`Toggle`·`Select`), verb.keypress, verb.toggle.check/uncheck, verb.select를 ko/en 동시 추가.
- **검증**:
  - [ ] PostToolUse 훅 `locales.test` 자동 통과(ko/en 대칭)

## 테스트 계획

- **단위 테스트**:
  - `formatKeyCombo` — 조합/특수키/인쇄문자/단독모디파이어/IME 케이스(Task 1).
  - `buildActionLogSummary` — keypress/toggle/select 줄 포맷 + "Clicked" 폴백 회귀(Task 6).
  - `buildActionLogJson` — 3종 직렬화, 멀티/빈 select 포함(Task 6).
  - `locales.test` — ko/en 대칭(자동, Task 7).
- **e2e 시나리오** (`/e2e-write` 입력 후보 — `e2e/fixtures/pages/actions.html` 확장):
  - "체크박스를 직접 클릭하면 toggle 항목이 1건만 생긴다(click 0건)."
  - "`<label for>` 클릭으로 체크박스를 토글해도 toggle 1건만 생긴다(click 중복 없음)."
  - "`<select>`에서 옵션을 바꾸면 '…에서 … 선택' 항목이 생긴다."
  - "radio를 선택하면 toggle 항목이 생긴다."
  - "Escape 키를 누르면 keypress 'Escape' 항목이 생긴다."
  - "⌘+K(Ctrl+K)를 누르면 keypress 조합 항목이 생긴다."
  - "Enter를 2회 누르면 keypress 항목이 2건 생긴다(병합 안 됨)."
  - "일반 문자를 타이핑하면 keypress 항목이 생기지 않는다."
  - "376px viewport에서 필터 6종이 모두 present여도 가로 오버플로 없이 스크롤된다."
- **수동 테스트** (Chrome, captureVisibleTab·시각 정합 의존):
  - 영상 타임라인 마커 색·seek 정합.
  - 단축키 조합(⌘+K) 표기 정합(⌘ 글리프 렌더).
  - `<select multiple>` 다중·전체 해제 표기.
  - IME(한글) 조합 확정 Enter가 keypress로 미기록.
  - picker host 내부 키 입력 무시(자체 UI).

## 구현 순서 권장

1. **Task 1**(헬퍼+테스트, `/tdd` 선행) → **Task 2**(타입) — 기반.
2. **Task 3·4**(레코더) 병렬 가능하나 같은 파일이라 순차 권장.
3. **Task 5·6·7**(표현·i18n) — Task 2 후 병렬 가능. Task 5는 Task 2의 타입 확장에 의존(exhaustive switch).
4. 전체 후 `pnpm test`·`pnpm typecheck`.

privacy.md 갱신은 구현과 독립 — `/push` 전 처리(아래 별도).

## 가이드 영향

사용자 노출 기능(액션 로그 표시 항목 확장). `/guide`로 ko·en 갱신:
- `guide/ko/logs/live.md` · `guide/en/logs/live.md` — 라이브 액션 로그가 표시하는 동작 종류에 keypress·toggle·select 추가 설명.
- `guide/ko/logs/viewer.md` · `guide/en/logs/viewer.md` — 영상 타임라인 마커 종류 설명에 반영.
- 작성 기준은 `guide/AUTHORING.md` 선독.

## privacy.md 영향 (별도 — /push 게이트)

- `docs/privacy.md`에 새 캡처 동작 명시·시행일 bump: 액션 로그가 키 조합(특수키·단축키)·폼 상태 변경(체크/선택 옵션)을 추가 수집. manifest diff는 0이지만 privacy 게이트 대상.
- **검증**:
  - [ ] privacy.md 시행일 bump
  - [ ] keypress는 키 조합만 저장, 인쇄 문자·필드 입력값 미포함 명시
  - [ ] keypress `target`(포커스 요소 접근성 이름) 수집 표면 명시
  - [ ] toggle/select는 체크 상태·선택 옵션 텍스트 저장 명시
