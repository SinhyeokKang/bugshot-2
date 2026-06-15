# 액션 로그 커버리지 확장 (keypress · 상태 변경)

## 배경

action-log는 버그 재현 동선을 click·input·navigation 3종으로 기록한다. 경쟁 도구 Jam과 대조한 감사(`/audit action-log`)에서 세 격차가 확인됐다:

1. **keypress 미수집** — Enter·Escape·Tab·단축키(⌘+K 등)가 로그에 남지 않는다. 폼 제출·모달 닫기·키보드 단축키로 유발되는 버그의 재현 동선이 끊긴다.
2. **PII 마스킹 범위가 Jam보다 좁음** — email·tel 입력값이 평문 저장.
3. **checkbox/radio/select 상태 미캡처** — 토글·드롭다운이 "click"으로만 남고 "무엇을 선택/체크했는지"가 사라진다. `change` 핸들러가 `<select>`·checkbox·radio를 버린다(action-recorder.ts).

이 중 **①·③을 보완**한다. ②는 아래 비목표에서 의도적으로 현행 유지한다.

## 목표

- **keypress 이벤트 수집**: 특수키(Enter·Escape·Tab·화살표)와 모든 모디파이어 조합(Ctrl/Cmd/Alt+key)을 새 액션 종류 `keypress`로 기록한다. 일반 인쇄 문자(모디파이어 없는 단일 문자)는 input이 이미 커버하므로 제외한다.
- **상태 변경 수집**: checkbox/radio 토글을 `toggle`, `<select>` 선택을 `select` 새 종류로 기록한다. 동일 동작이 click과 중복 기록되지 않는다(표준 `<label for>`·래핑 label 클릭 포함 — change 기준으로 단일화).
- **표현 일관성**: 새 3종이 라이브 서브탭(`ActionLogContent`)·영상 타임라인(`markers.ts`)·AI 요약(`buildLogSummary`)·JSON export(`buildActionLogJson`) 4개 표현 레이어 모두에서 click/input/navigation과 동일한 품질로 렌더된다.
- **i18n 대칭**: 새 verb·filter·icon 라벨을 ko/en 동시 추가.

## 비목표 (Non-goals)

- **② email/tel PII 마스킹 확장** — 검토 후 **현행 유지**(평문 보존)로 결정. 사유: email·tel은 버그 재현에서 "어떤 계정/번호로 재현했나"가 핵심 신호이고, 자동 마스킹하면 재현 가치가 크게 떨어진다. 기존 마스킹(password·card·cvv·ssn·token 계열)은 그대로 둔다. `shouldMaskField`는 변경하지 않는다.
- 일반 인쇄 문자(모디파이어 없는 a~z·0~9 등) keypress 기록 — input이 커버, **노이즈·중복 회피**가 1차 사유다(같은 텍스트가 input value에 이미 평문으로 남으므로 키스트로크 미수집은 마스킹 목적이 아니다). 부수적으로 비밀번호 필드 keystroke 노출 표면도 줄인다.
- scroll·resize·hover·copy/paste·form submit 등 추가 이벤트 — 이번 스코프 외.
- 새 ActionEntry 저장 필드 추가 — 기존 `value`·`fieldLabel`·`target`·`selector` 재사용으로 충족.
- keypress 조합 커스터마이즈 설정 UI.

## 사용자 시나리오

전제: 아래 시나리오는 모두 **녹화 중**(영상 녹화 시작 시 sentinel 발급으로 레코더 활성화)을 가정한다. 녹화 비활성 상태에서는 액션이 수집되지 않는다.

1. **단축키 버그** — 사용자가 모달에서 `Esc`를 눌렀는데 닫히지 않는 버그를 재현한다. 녹화 중 `Esc` 키가 액션 로그에 "Escape 키"로 남고, 영상 타임라인의 같은 시점 마커로 점프된다.
2. **드롭다운 버그** — 결제 폼에서 국가를 "Korea"로 바꾸면 우편번호 검증이 깨진다. `<select>`에서 "Korea" 선택이 "국가에서 Korea 선택"으로 기록된다. (기존: 무엇을 선택했는지 input value로만 남고 select 동작으로 구분되지 않음)
3. **체크박스 버그** — "약관 동의" 체크 후에도 제출 버튼이 비활성. 체크박스 토글이 "약관 동의 체크"로 남는다. click과 중복되지 않는다(label 클릭으로 토글한 경우 포함).
4. **단축키 조합** — `⌘+K` 커맨드 팔레트가 안 뜨는 버그. "⌘+K" keypress로 기록된다.

**엣지 케이스**:
- 모디파이어 없는 단일 인쇄 문자 keydown → 기록 안 함(input이 커버).
- 자체 UI(picker host) 내부 키 입력 → `isOwnUi` 가드로 제외.
- checkbox/radio 클릭 시 click과 change 동시 발화 → click 쪽에서 제외, change(toggle)만 기록. **표준 `<label for>`·래핑 label 클릭은 change가 발화하므로 동일하게 click 제외 가드를 적용**(label→연결 컨트롤이 checkbox/radio면 click 미기록). div role=checkbox 등 change 미발화 커스텀 위젯은 click으로만 남을 수 있음(현행 수준 수용).
- 비밀번호 필드에서 `Enter` → keypress는 키만 기록(값 미포함)이므로 PII 누출 없음.
- **IME 조합 중 keydown**(한글·일본어·중국어): `isComposing` true 또는 `key === "Process"`인 keydown은 조합 확정 키(Enter 등)를 오기록하지 않도록 keypress 수집에서 제외.

## 성공 기준

- keydown 시 특수키·조합키가 `keypress` entry로, 인쇄 문자는 미기록. IME 조합 중 keydown은 미기록.
- checkbox/radio 토글이 `toggle`(label 클릭 경유 포함), `<select>` 변경이 `select` entry로 단일 기록(click 중복 없음). `<select multiple>`은 선택 옵션을 join(cap)해 단일 기록.
- 새 3종이 4개 표현 레이어에서 모두 렌더된다:
  - `markers.ts`의 exhaustive switch(`satisfies never`)가 타입 에러 없이 통과(중립 default variant).
  - `ActionLogContent`의 `KindIcon`에 누락 방지 가드(`satisfies never`) 추가.
  - `buildLogSummary`에서 3종이 "Clicked" 폴백으로 새지 않음(회귀 테스트로 단언).
  - 좁은 사이드패널(~376px)에서 필터 탭 6종 동시 present 시 가로 오버플로 없이 스크롤 처리(`OriginFilterBar` 패턴).
- ko/en i18n 키 대칭(locales.test 통과). 새 필터 ko 라벨은 기존 2자급(키·토글·선택).
- 신규 순수 함수(키 조합 포맷터)에 단위 테스트 존재, `pnpm test` 통과.
- 기존 click/input/navigation 동작·표현 무회귀.
