# Element 모드: 스타일 수정 없이 이슈 작성

## 배경

현재 element 모드는 DOM 요소를 선택한 뒤 반드시 스타일(CSS/클래스/텍스트)을 수정해야 drafting 단계로 진입할 수 있다. "Next" 버튼이 `hasChange === false`일 때 비활성화되기 때문이다.

그러나 element 모드의 핵심은 "특정 DOM 요소를 지목해서 이슈를 작성하는 것"이며, 스타일 수정 없이도 "이 요소에 문제가 있다"는 이슈를 작성할 필요가 있다. 예를 들어, 특정 요소의 레이아웃이 깨져 있거나, 접근성 문제가 있거나, 콘텐츠가 잘못된 경우 등.

또한 현재는 Next 버튼이 비활성이라 이 경로에 도달할 수 없지만, body 빌더 코드에는 `diffs.length === 0`인 element 모드에 대한 처리가 없어 만약 도달하면 빈 "Style Changes" 헤딩만 남거나 빈 테이블이 생성되는 문제도 존재한다. 이번 변경으로 이 잠재적 문제도 함께 해결한다.

## 목표

1. Element 모드에서 스타일 수정 없이도 drafting 단계로 진입할 수 있다.
2. 스타일 변경이 없을 때 diff table은 표시하지 않고, 미디어 섹션에 element 스냅샷 이미지 1장만 표시한다.
3. 이슈 제출 시 4개 플랫폼(Jira/GitHub/Linear/Notion) body에는 screenshot 모드와 동일한 방식으로 미디어 섹션에 이미지 1장을 삽입한다.
4. 스타일 변경이 있는 기존 element 모드 흐름은 전혀 변경하지 않는다.

## 비목표 (Non-goals)

- Styling 단계 자체를 건너뛰는 UX(별도 "스킵" 버튼 등)는 이번 스코프가 아니다. styling 화면은 유지하되 Next 버튼의 활성화 조건만 완화한다.
- Element 선택 후 곧바로 drafting으로 자동 전환하는 흐름은 제외.
- Screenshot 모드 등 다른 캡처 모드에는 영향 없음.

## 사용자 시나리오

### 시나리오 1: 스타일 수정 없이 이슈 작성

1. 사용자가 element 모드로 DOM 요소를 선택 → styling 화면 진입
2. 스타일 수정 없이 "Next" 버튼 클릭 (현재는 비활성 → **변경 후 활성**)
3. Drafting 화면 진입 — 미디어 섹션에 element 스냅샷 이미지 1장 표시 (diff table 없음)
4. 이슈 제목·설명 작성 후 제출
5. 플랫폼 body에 "미디어" 섹션으로 element 스냅샷 이미지 삽입 (기존 element 환경 정보 — selector, tagName, viewport 등 — 은 그대로 포함)

### 시나리오 2: 스타일 수정 후 이슈 작성 (기존 흐름, 변경 없음)

1. 사용자가 element 모드로 DOM 요소를 선택 → styling 화면 진입
2. CSS 속성·클래스·텍스트 수정
3. "Next" 버튼 클릭 → drafting 화면 진입
4. "스타일 변경사항" 섹션에 before/after 스냅샷 + diff table 표시 (기존과 동일)
5. 이슈 제출 시 기존 style changes table 형식 유지

### 엣지 케이스

- beforeImage 캡처 실패 시: 미디어 섹션 자체가 빈 상태로 노출 (기존 screenshot 모드에서 이미지 없을 때와 동일하게 graceful)
- 스타일 수정 후 되돌려 원래 상태와 같아진 경우: `buildStyleDiff` 결과가 빈 배열 → "스타일 변경 없음"으로 취급, 스냅샷 이미지만 노출
- 저장된 draft를 DraftDetailDialog에서 다시 열 때도 동일한 분기 적용

## 성공 기준

- [ ] Element 모드에서 스타일 수정 없이 "Next" 버튼을 눌러 drafting에 진입할 수 있다
- [ ] 스타일 변경 없는 drafting 화면에 element 스냅샷 이미지 1장이 "미디어" 섹션에 표시된다
- [ ] 스타일 변경 없는 이슈 제출 시 Jira/GitHub/Linear/Notion body에 screenshot 모드와 동일한 미디어 섹션이 포함된다
- [ ] 스타일 변경이 있는 기존 흐름은 변경 없이 작동한다
- [ ] 스타일 수정 후 되돌린 경우에도 "미디어" 섹션 1장 이미지로 정상 처리된다
- [ ] `pnpm typecheck` 통과
- [ ] `pnpm test` 통과
