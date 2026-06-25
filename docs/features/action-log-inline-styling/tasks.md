# 액션 로그 인라인 텍스트 디자인 강화 — 구현 태스크

## 선행 조건
- 권한·env·OAuth·외부 API 변경 없음.
- 새 의존성 없음(pnpm-workspace 정책 무관).
- `actionLog.role.*` i18n 키는 `src/log-viewer/markers.ts`에서 사용 중 → 삭제하지 않는다.

## 태스크

### Task 1: 순수 함수 + 단위 테스트 (`actionInline.ts`)
- **변경 대상**: `src/sidepanel/lib/actionInline.ts`(신규), `src/sidepanel/lib/__tests__/actionInline.test.ts`(신규)
- **작업 내용**:
  - `splitTemplate(template)` 구현: `/(\{[a-zA-Z]+\})/` split → 빈 문자열 제거 → `{name}`은 `{type:"slot",name}`, 나머지는 `{type:"text",value}`.
  - `resolveClickTarget(entry)` 구현: 우선순위 `target` → `tagName`(+`tagType`) → `selector`(name 모드) → `empty`.
  - 테스트 먼저 작성(TDD).
- **검증**:
  - [ ] `splitTemplate("Entered {value} in {field}")` → text/slot 4토큰
  - [ ] `splitTemplate("{target} 클릭")` → slot + text
  - [ ] `splitTemplate("Recording started")` → text 1토큰
  - [ ] `splitTemplate("{a}{b}")` → slot,slot (빈 문자열 없음)
  - [ ] `resolveClickTarget({target:"Save"})` → `{mode:"name",name:"Save"}`
  - [ ] `resolveClickTarget({tagName:"button",tagType:"submit"})` → `{mode:"tag",...}`
  - [ ] `resolveClickTarget({tagName:"div"})` → `{mode:"tag",tagName:"div"}`(tagType 없음)
  - [ ] `resolveClickTarget({selector:"div.foo"})` → `{mode:"name",name:"div.foo"}`(레거시)
  - [ ] `resolveClickTarget({})` → `{mode:"empty"}`
  - [ ] `pnpm test -- actionInline` green

### Task 2: 데이터 타입 확장
- **변경 대상**: `src/types/action.ts`
- **작업 내용**: `ActionEntry`에 `tagName?: string`, `tagType?: string` 추가(주석으로 click 전용 명시).
- **검증**:
  - [ ] `pnpm typecheck` 통과

### Task 3: recorder 태그 캡처
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**: 내부 `CapturedAction`에 `tagName?`/`tagType?` 추가. `recordClick`에서 `tagName: el.tagName.toLowerCase()`, `tagType: el.getAttribute("type") ?? undefined` 채움.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (수동/e2e) 버튼 클릭 시 엔트리에 tagName 채워짐 — Task 6 e2e에서 간접 확인

### Task 4: 렌더 컴포넌트 교체 (`ActionLogContent.tsx`)
- **변경 대상**: `src/sidepanel/components/ActionLogContent.tsx`
- **작업 내용**:
  - `splitTemplate`/`resolveClickTarget` import, `Fragment`·`ReactNode` import.
  - `ValueChip`, `ClickTarget`, `NavLink`, `renderVerb`, `renderActionContent` 추가.
  - `ActionRow`의 kind별 보간 블록 → `{renderActionContent(t, entry)}`로 교체, span에 `leading-relaxed`.
  - 고아가 된 `roleWord`/`clickTarget`/`NavigateText` 제거.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 전체 green (locales 대칭 포함)
  - [ ] grep으로 `roleWord`/`clickTarget`/`NavigateText` 잔존 참조 0

### Task 5: 시각 검증 빌드
- **변경 대상**: 없음(빌드만)
- **작업 내용**: 사용자가 `/build` 또는 `pnpm build` 실행 후 Chrome 재로드.
- **검증**:
  - [ ] 사이드패널 액션 탭에서 PRD 8개 시나리오 시각 확인
  - [ ] 로그 뷰어(영상 동기화 화면)에서 동일 렌더
  - [ ] 좁은 패널 폭에서 칩 줄바꿈 깨짐 없음

### Task 6: e2e 시나리오 (선택 — `/e2e-write`)
- **변경 대상**: `e2e/` spec, 필요 시 `data-testid` 추가만
- **작업 내용**: 테스트 페이지에서 입력·클릭·이동을 녹화 후 액션 탭 DOM 검증.
- **검증**: 아래 "테스트 계획" e2e 항목 참조.

## 테스트 계획
- **단위 테스트**: `src/sidepanel/lib/__tests__/actionInline.test.ts`
  - `splitTemplate`: 다중 슬롯/선행 슬롯/슬롯 없음/연속 슬롯.
  - `resolveClickTarget`: target 우선 / tagName+tagType / tagName만 / selector 레거시 / 전부 없음.
- **e2e 시나리오**(스크립트 판정 가능):
  - 텍스트 입력 후 녹화 종료하면 액션 탭에 값이 monospace 칩 요소(`font-mono` 클래스 박스)로 렌더된다.
  - 이름 없는 요소를 클릭하면 액션 행에 `<tag ...>` 형태 문법 하이라이트 마크업이 보인다.
  - 페이지 이동을 하면 액션 행에 해당 URL을 가리키는 `<a href>` 링크가 렌더된다.
- **수동 테스트**(자동화 불가 — 시각 정합):
  - 칩/태그/링크 색·정렬·줄높이, 좁은 패널 줄바꿈, 다크모드 색 대비.
  - 로그 뷰어 빌드 산출물 동일성.
  - 기존 저장 세션(태그 정보 없는 클릭 항목) 로드 시 깨짐 없음.

## 구현 순서 권장
- Task 1(순수 함수·테스트) → Task 2(타입) 은 독립, 병렬 가능.
- Task 3(recorder)·Task 4(렌더)는 Task 2 이후. Task 4는 Task 1 산출물에 의존.
- Task 5(빌드 검증)는 1~4 완료 후. Task 6(e2e)은 Task 5 이후 선택.
- 권장 순서: 1 → 2 → 3 → 4 → (사용자 빌드) 5 → (선택) 6.

## 가이드 영향
없음 — 액션 로그의 내부 표시(렌더) 변경이라 사용자 동작·플로우가 바뀌지 않는다. `guide/` 본문에 액션 로그 항목 포맷을 명시한 곳이 없으면 갱신 불필요. (구현 후 `/implement` 보고의 "가이드 영향" 플래그로 재확인.)
