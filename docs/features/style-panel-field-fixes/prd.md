# 스타일 패널 필드 정확성·일관성 수정 묶음

## 배경

스타일 편집 패널(`src/sidepanel/tabs/styleEditor/`, `StyleEditorPanel.tsx`)의 값 입력 필드 전반에서 색상 swatch·우측 미리보기·셀렉트·linked 4면·디자인 토큰 처리에 다수의 버그와 비대칭이 확인됐다. 3개 병렬 리뷰 에이전트 + 직접 코드 검증으로 재현 근거까지 확보했다.

사용자 영향이 큰 두 부류:

- **잘못된/누락된 시각 피드백** — hsl 등 최신 함수형 색상의 swatch가 안 뜨고, 같은 색이라도 토큰이면 보이고 직접 입력이면 안 보이는 비대칭. 선택된 필드 우측에 토큰 원시값 미리보기가 color 토큰에서만 빠짐.
- **무효/오염된 CSS가 상태·내보내기에 기록** — SelectProp 빈 옵션 선택 시 `display: __empty__` 같은 garbage가 inlineStyle에 저장되고, length 라이브 입력이 단위 없이 적용돼 타이핑 중 무효 CSS가 적용된다. 이 값들은 StyleChanges 내보내기(이슈 본문의 As-is/To-be 표)까지 새어 나간다.

## 목표

스타일 패널 값 필드의 입력→정규화→적용→표시 경로를 일관되게 만든다. 검증 가능한 단위로:

1. hsl/hsla/hwb/oklch/oklab/lab/lch/color() 색상 리터럴도 직접 입력 필드에서 swatch가 표시된다 (브라우저가 렌더 가능한 색은 모두). 색상 인식 기준을 `categorizeToken`(css-resolve.ts)과 일치시킨다.
2. 선택된 입력 필드의 우측 미리보기 텍스트가 color 토큰에서도 드롭다운(`TokenItem`)과 동일하게 **토큰 원시값**을 표시한다.
3. SelectProp 빈 옵션 선택은 해당 prop을 **리셋**한다(무효값 기록 금지).
4. length 라이브 입력이 커밋값과 동일하게 정규화(숫자→px)되어, 라이브 미리보기와 최종값이 일치한다.
5. linked(QuadProp/RadiusProp/GapPairProp) 상태가 요소 재선택에 따라 올바르게 갱신돼, 의도치 않은 4면 일괄 덮어쓰기가 없다.
6. BoxShadow 멀티레이어 value가 잘리지 않고 전부 표시된다.
7. `--_` private alias 토큰이 토큰 드롭다운/family에 노출되지 않는다.
8. AlignmentProp이 computed `start`/`end`/`match-parent` 등에서도 합리적으로 active 탭을 표시한다.
9. `var(--x, var(--y))` 형태에서 fallback 토큰이 별도 칩으로 과다 표시되지 않는다.
10. ⚪ 잔여 일관성 항목(단축 hex 라이브, `.5` 소수 px, transition 라벨, time computed 힌트, 좁은 패널 리플로우, isTokenValue 오탐) 정리.

## 비목표 (Non-goals)

- 색상 피커(컬러 휠/스포이드) 같은 **새 입력 UI 추가** — 이번은 기존 필드 동작 교정만.
- BoxShadow "레이어 추가(+)" 버튼 같은 **신규 편집 기능** — F는 기존 value 레이어 표시 누락만 고치고, 추가 UI는 비목표.
- shorthand(`margin`/`padding`/`border`)와 longhand 동시 편집 충돌 해소 — 별도 스코프(이번 묶음 제외).
- 토큰 family grouping(`tokenFamilyPrefix`)의 숫자 경계 오판 같은 **저빈도 grouping 정확도** — 관찰만, 이번 제외.
- 새 권한·env·OAuth·외부 API 일체 없음.

## 사용자 시나리오

1. **hsl 색상 직접 입력** — 사용자가 `color` 필드에 `hsl(210 100% 50%)`를 입력·커밋하면, 필드 좌측에 해당 색 swatch가 표시된다. (현재: swatch 없이 텍스트만)
2. **색 토큰 선택 후 확인** — raw 값이 `hsl(...)`인 디자인 토큰을 선택하면, 선택된 필드 우측에 그 원시값(`hsl(...)`)이 회색 미리보기로 보인다. 드롭다운에서 보이던 값과 일치. (현재: color 토큰은 우측 미리보기 없음)
3. **SelectProp 리셋** — `display` 셀렉트에서 맨 위 `(none)` 옵션을 고르면 inline `display`가 제거되어 원래 값으로 돌아간다. 내보내기 표에 `display: __empty__`가 안 남는다. (현재: garbage 기록)
4. **padding 타이핑** — padding-top에 `16`을 타이핑하는 동안에도 페이지에 `16px`가 라이브 적용되어 미리보기가 즉시 반영된다. 팝오버를 닫아도 값이 안 바뀐다. (현재: 닫기 전까지 무효 `16` 적용)
5. **요소 재선택 후 linked** — 4면이 동일해 linked가 켜졌던 요소에서, 4면이 제각각인 다른 요소로 다시 픽하면 linked가 그 요소 기준으로 재판정된다. 한 면만 고쳤는데 4면이 덮이지 않는다.

## 성공 기준

- 위 목표 1~10이 각 태스크 검증 항목으로 충족되고 `pnpm test`·`pnpm typecheck` 통과.
- 신규/변경 순수 함수(`isRenderableColorLiteral`, `finalizeValue`, `isInternalToken`, `extractTokenRefs`, SelectProp 값 역변환)에 단위 테스트가 붙고 통과.
- 회귀 위험 항목(D 라이브 적용, E linked)은 e2e 또는 수동 체크리스트로 실제 탭에서 확인.
- 사용자 노출 동작 변화(swatch·미리보기 표시)가 가이드와 어긋나지 않음(가이드 영향은 tasks.md 참조).
