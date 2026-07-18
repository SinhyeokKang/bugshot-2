# 로그 표면 mono 일관화 — 구현 태스크

## 선행 조건

- 신규 의존성·권한·env·OAuth 없음. Geist Mono는 이미 설치·설정됨(`globals.css @import`, `tailwind.config.js fontFamily.mono`).
- CSS 파일(`globals.css`·`log-viewer/styles.css`) 변경 없음 — 리거처 규칙은 `.font-mono` 셀렉터가 자동 커버.

## 태스크

### Task 1: JsonTreeViewer mono + 12px
- **변경 대상**: `src/sidepanel/components/JsonTreeViewer.tsx`
- **작업 내용**:
  - `JsonTreeViewer` 반환부에서 `<JsonNode>`를 `<div className="font-mono">`로 감싼다.
  - 행 컨테이너의 `text-[13px]`(L128, L139, L210, L239, L272) → `text-xs`로 교체.
- **검증**:
  - [ ] 네트워크 로그에서 JSON 응답 펼침 시 키/값/괄호가 Geist Mono로 렌더.
  - [ ] WebSocket JSON 프레임도 동일하게 mono.
  - [ ] 행 크기 12px(`text-xs`), 색상 토큰·들여쓰기 불변.
  - [ ] `--` 포함 값이 리거처로 붕괴되지 않음(2셀 유지).

### Task 2: 콘솔 접힌 인라인 메시지 mono
- **변경 대상**: `src/sidepanel/components/ConsoleLogContent.tsx`
- **작업 내용**: `EntryAccordion` 접힌 행 메시지 `<span>`(L243)에 `font-mono text-xs` 추가(부모 L233에서 상속하던 13px sans를 12px mono로 오버라이드 — 메시지만 mono, 형제 아이콘은 sans 유지).
- **검증**:
  - [ ] 접힌 요약과 펼친 `<pre>` 상세가 같은 mono 서체.
  - [ ] `LinkifiedText`의 URL 링크가 mono로 렌더되며 클릭 동작 유지.
  - [ ] 아이콘·타임스탬프 칩·레벨 배경 틴트 불변.

### Task 3: 액션 로그 행 전체 mono
- **변경 대상**: `src/sidepanel/components/ActionLogContent.tsx`
- **작업 내용**: `ActionRow` 콘텐츠 `<span>`(L322)에 `font-mono text-xs` 추가 + `leading-relaxed` **제거**(text-xs가 16px line-height 공급 → 콘솔 인라인과 행간 통일, DESIGN 리스트·칩 불변식 16px에 합류).
- **검증**:
  - [ ] verb 문장 + chip(태그/셀렉터/입력값)이 전부 mono(콘솔과 통일).
  - [ ] `InlineChip`·`ResolvedTargetChip` 색상·테두리 불변, 서체만 mono 상속.
  - [ ] 네비게이션 URL(`InlineLink`) 링크 동작 유지.
  - [ ] 행간이 콘솔 인라인과 동일(16px — relaxed 제거됨). 다중 행 액션 문장 가독성 시각 확인.

### Task 4: 타임라인 마커 툴팁 mono
- **변경 대상**: `src/log-viewer/components/TimelineMarkers.tsx`
- **작업 내용**: 호버 툴팁 컨테이너 `<div>`(L87)에 `font-mono` 추가(이미 `text-xs`).
- **검증**:
  - [ ] 로그뷰어(`logs.html`) 영상 타임라인 마커 호버 시 툴팁 내용 mono.
  - [ ] 트리밍 다이얼로그(`ReplayTrimDialog` → `TrimTimeline`) 타임라인 마커 툴팁도 mono.
  - [ ] `labelParts` 색상(레벨/메서드/URL 톤) 불변.

### Task 5: WebSocket non-JSON 프레임 본문 mono
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx` — `FrameBody`
- **작업 내용**: L745 `<pre>`의 `font-sans text-[11px]` → `font-mono text-xs`로 교체. L744 주석 갱신/삭제(이제 mono가 의도, 리거처는 `.font-mono` 전역 규칙이 커버).
- **검증**:
  - [ ] Messages 탭에서 non-JSON WS 프레임 펼침 시 본문이 mono(12px).
  - [ ] 같은 탭의 JSON 프레임(JsonTreeViewer)과 서체 통일.
  - [ ] 형제 raw body `<pre>`(`BodyBlock` L588 `font-mono text-xs`)와 동일 스타일.
  - [ ] `------WebKitFormBoundary` 등 `--` 연속이 리거처로 붕괴되지 않음.

### Task 6: DESIGN.md mono 불변식/예외 서술 갱신 (문서)
- **변경 대상**: `docs/DESIGN.md` §4 "mono 표면 불변식" + "sans여야 하는 pre는 font-sans 명시"의 `FrameBody` 대표 사례 인용부
- **작업 내용**:
  - "리스트·칩" 그룹 표에 신규 mono 표면 추가 — JSON 트리 · 콘솔 인라인 요약 · 액션 로그 행 · 마커 툴팁. **각주 없음**: 액션 행은 `leading-relaxed` 제거로 16px 불변식에 그대로 합류하므로 별도 예외 서술 불필요.
  - **"로그 N곳" 재집계**: Task 1~5로 표면이 늘었으니 정확한 수치로 갱신하고 경로를 귀속한다 — `.font-mono` 유틸 경로(JSON 트리·콘솔 인라인·액션 행·마커 툴팁)와 preflight `<pre>` 경로(WS `FrameBody`)를 구분(막연한 "N" 금지). `src/styles/__tests__/tokens.test.ts`의 동일 카운트 주석(L146 "로그 N곳")도 함께 재집계(주석이라 테스트는 안 깨지나 stale 방지 — 선택).
  - **FrameBody 사실오류 정정**: Task 5가 `FrameBody`의 `<pre>`를 `font-sans`→`font-mono`로 역전하므로, DESIGN이 이를 "sans여야 하는 pre는 font-sans 명시"의 대표 사례로 인용한 문장을 삭제/갱신한다(안 고치면 사실오류로 남음).
- **검증**:
  - [ ] 표/문구·카운트가 실제 코드 표면과 일치.
  - [ ] `FrameBody`가 더는 font-sans 대표 사례로 남지 않음.
  - [ ] `/push` 또는 `/doc-check` 신선도 검사 통과.

> Task 6은 `docs(DESIGN): ...` 별도 커밋(문서 전용). Task 1~5 구현·확정 후 `/guide` 흐름과 별개로 문서만.

## 테스트 계획

- **단위 테스트(순수 함수)**: 신규 순수 함수 없음. `markers.ts`·`JsonTreeViewer`의 순수 로직(펼침 경로 계산 등)은 서체와 무관하므로 기존 테스트 그대로 통과해야 함.
- **컴포넌트 테스트(jsdom, `*.test.tsx`)** — 경량 스타일 assertion(선택적, 회귀 고정용):
  - `JsonTreeViewer.test.tsx`(신규): 렌더 후 트리 래퍼가 `font-mono` 클래스, 행이 `text-xs`(13px 부재) 보유.
  - `ConsoleLogContent.test.tsx`(기존 확장): 접힌 행 메시지 span에 `font-mono` 존재.
  - `ActionLogContent.test.tsx`(신규): 콘텐츠 span에 `font-mono` 존재.
  - `TimelineMarkers.test.tsx`(신규): 마커 호버 시 portal 툴팁에 `font-mono` 존재.
  - 판정 문장: "JsonTreeViewer를 렌더하면 트리 컨테이너가 font-mono·text-xs다", "액션 행을 렌더하면 콘텐츠 span이 font-mono다".
- **e2e 시나리오**(자동화 가능, `/e2e-write` 입력):
  - 네트워크 로그에서 JSON 응답을 펼치면 트리 컨테이너에 `font-mono` 클래스가 붙는다.
  - 콘솔 로그 접힌 행 메시지 span에 `font-mono` 클래스가 붙는다.
  - 액션 로그 행 콘텐츠 span에 `font-mono` 클래스가 붙는다.
  - **셀렉터 준비**: JSON 트리 래퍼·콘솔/액션 대상 span엔 현재 `data-testid`가 없다. `/e2e-write`가 대상에 `data-testid`를 부착해야 잡을 수 있다(src 수정은 testid 추가만 허용). 부착 계획 없이는 작성 불가.
  - (마커 툴팁은 영상 재생·호버 의존이라 e2e보다 수동 권장 — 아래로.)
- **수동 테스트**(자동화 불가 — 시각 정합·export 산출물·시스템 mono 폴백):
  - `pnpm build` 후 내보낸 `logs.html`을 열어 콘솔/네트워크/액션 로그가 시스템 mono로 폴백 렌더되는지(개발자 기기 Geist 설치 영향 배제).
  - 라이트/다크 모두에서 5개 표면 시각 확인.
  - Messages 탭에서 non-JSON WS 프레임 본문 mono·리거처 미붕괴 확인.
  - 타임라인 마커 호버 툴팁(로그뷰어 + 트리밍) mono 확인.
  - 13→12px 변경 후 좁은 패널에서 행 높이·truncation 자연스러운지.

## 구현 순서 권장

Task 1~5는 서로 독립이라 **병렬 가능**(Task 1은 `JsonTreeViewer.tsx`, Task 5는 `NetworkLogContent.tsx`의 `FrameBody`로 파일이 달라 충돌 없음). Task 6(문서)는 1~5 확정 후. 권장: 1 → 2 → 3 → 4 → 5 → (컴포넌트 테스트) → 6.

## 가이드 영향

없음. 서체 변경은 기능·조작 플로우·UI 라벨을 바꾸지 않아 `guide/ko`·`guide/en` 갱신 대상이 아니다. (문서 영향은 `docs/DESIGN.md`뿐 — Task 6.)
