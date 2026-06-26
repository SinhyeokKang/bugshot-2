# z-index 속성 편집 (element mode)

## 배경
element mode의 스타일 에디터는 layout·size·typography 등 69개 CSS 속성을 편집할 수 있지만 **`z-index`는 빠져 있다**. 겹침 순서(stacking) 버그는 QA·디자인 리뷰에서 흔히 잡히는 이슈인데, 현재는 z-index를 바꿔 비교/리포트할 방법이 없어 class 편집으로 우회해야 한다. position은 이미 편집 가능하므로 stacking을 조정하는 짝 속성인 z-index의 부재가 두드러진다.

## 목표
- element mode에서 선택한 요소의 `z-index`를 편집할 수 있다.
- 선택 시 요소의 현재 z-index 값(computed/specified)이 입력 컨트롤에 노출된다.
- 편집한 z-index가 타겟 요소에 **라이브로 적용**된다(`el.style` 반영). 실제 렌더 결과의 겹침 변화는 stacking context에 의존 — 부모에 `transform`/`opacity`/`filter` 등이 걸려 별도 stacking context가 형성된 경우 화면 변화가 없을 수 있다(비목표 참조).
- z-index 변경이 "변경 비교"(StyleChangesDialog/Table)에 `as-is → to-be` 행으로 나타나고 이슈에 포함된다.
- `auto`·정수·음수 정수 입력이 모두 그대로 적용된다(px 등 단위 자동부착 없음).

## 비목표 (Non-goals)
- stacking context 시각화·경고(부모 transform/opacity로 z-index가 무력화되는 케이스 안내 등) — 이번 스코프 아님.
- z-index 전용 슬라이더·증감 버튼 UI — 기존 TextProp(자유 입력 콤보박스) 재사용.
- position이 static일 때 z-index 입력 숨김/비활성 — **항상 표시**(아래 설계 참조).
- AI 스타일링 프롬프트에 z-index 전용 지침 추가 — 현재 DENIED 방식이라 z-index는 자동 허용, 별도 작업 없음.

## 사용자 시나리오
1. 사용자가 element mode로 겹침 문제가 있는 요소(예: 헤더에 가려지는 드롭다운)를 선택한다.
2. 사이드패널 **Layout 섹션**에 `z-index` 입력이 노출된다. 미지정 요소는 computed 기본값 `auto`가 placeholder(회색 힌트)로, 지정 요소는 specified 값(예: `10`)이 실제 입력값으로 채워진다.
3. 사용자가 `z-index`에 `9999`를 입력한다 → 타겟 요소에 즉시 적용되어 드롭다운이 헤더 위로 올라온다.
4. "변경 보기"에서 `z-index: auto → 9999` 행을 확인한다.
5. Next로 진행해 before/after와 함께 이슈로 등록한다.

엣지 케이스:
- 입력값을 비우면(`""`) 해당 inlineStyle 키가 제거되어 원본 z-index로 복원된다(기존 useStyleProp 동작).
- `auto` 입력 시 px 부착 없이 `auto` 그대로 적용된다.
- 음수(`-1`) 입력이 그대로 적용된다.
- z-index가 원본과 같으면(예: 원본 `auto`에 `auto` 입력) 비교 테이블에 phantom 행이 생기지 않는다(buildStyleDiff의 before==after 스킵).

## 성공 기준
- Layout 섹션에 z-index 입력이 보이고 선택 요소의 현재 값이 채워진다.
- z-index 편집이 라이브 적용 + 변경 비교 + 이슈 등록까지 기존 속성과 동일하게 흐른다.
- `auto`/정수/음수 입력에 단위가 자동부착되지 않는다.
- `pnpm test`(css-resolve·propMetadata 단위 테스트) 통과, `pnpm typecheck` 통과.
