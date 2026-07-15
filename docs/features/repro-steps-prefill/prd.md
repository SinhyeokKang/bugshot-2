# Repro Steps Prefill (재현 단계 자동 채움)

## 배경

버그 리포트 작성 시 `stepsToReproduce`(재현 과정) 섹션은 사용자가 손으로 채워야 한다. 하지만 BugShot은 이미 캡처 세션 동안 사용자 액션 로그(click/input/navigation/toggle/select/drag)를 전부 수집한다 — "무엇을 했는지"의 원자료가 이미 손에 있는데 사용자가 다시 타이핑하는 중복이 발생한다.

특히 **video(탭/화면 녹화·30s Replay)** 모드는 사용자가 재현 과정을 직접 시연하며 녹화하는 흐름이라, 그 구간의 액션 로그가 곧 재현 단계다. drafting phase로 넘어가는 순간 이 로그를 `stepsToReproduce`에 미리 채워주면 작성 부담이 크게 준다.

현재 AI drafting(배너 버튼)이 `stepsToReproduce`를 생성하긴 하지만, (1) 사용자가 버튼을 눌러야 하고, (2) 나노·BYOK가 아예 없는 사용자는 AI UI 자체가 안 보여 아무 도움도 못 받는다.

## 목표

- drafting phase 진입 시 `stepsToReproduce`가 비어 있으면 **자동으로** 액션 로그 기반 재현 단계를 채운다.
- **AI 없이도 동작**한다: 나노·BYOK가 없어도 룰 기반 변환으로 채운다(나노 없는 사용자 커버 — 이 기능의 핵심 가치).
- AI(나노 또는 BYOK)가 있으면 AI로 자연어 정리된 재현 단계를 생성한다(하이브리드 자동).
- 채워진 값은 사용자가 `OrderedListEditor`에서 자유롭게 편집·삭제할 수 있다.
- 이후 사용자가 기존 AI draft 버튼을 눌러 전체 초안을 생성하면, 채워둔 `stepsToReproduce`가 그 컨텍스트(`existingDraft`)로 자연히 전달된다(추가 연계 코드 없음).

## 비목표 (Non-goals)

- **제목·설명·기대결과·비고 섹션 생성** — 이번 스코프는 `stepsToReproduce` 한 섹션뿐. 나머지는 기존 AI draft 버튼이 담당한다.
- **screenshot / freeform 모드 지원** — 이번엔 `video`(탭/화면/30s Replay)만. 반응이 좋으면 후속으로 screenshot·freeform에 확장한다(`supportsActionLog`가 이미 셋을 커버하므로 게이트만 넓히면 됨).
- **element 모드** — 액션 로그를 수집하지 않으므로 대상 아님.
- **되돌리기(undo) 전용 UI** — 자동 채움은 "비어 있을 때만" 발화하므로 사용자가 지우면 그 상태가 유지된다. 별도 되돌리기 버튼은 만들지 않는다.
- **BYOK 자동 호출 opt-out 설정** — 사용자가 "나노+BYOK 둘 다 자동"을 선택. 설정 토글은 이번 스코프 밖(위험 요소에 프라이버시 함의 기록).

## 사용자 시나리오

### 주 플로우 (AI 있는 사용자)
1. 사용자가 video 모드로 탭/화면을 녹화하거나 30s Replay를 캡처한다.
2. 녹화가 끝나면 drafting phase로 진입, `DraftingPanel`이 마운트된다.
3. `stepsToReproduce`가 비어 있고 액션 로그가 있으면 자동 prefill이 발화한다.
4. AI(나노/BYOK)가 가용하므로 로딩 인디케이터가 잠깐 뜨고, AI가 액션 로그를 자연어 재현 단계로 정리해 `stepsToReproduce`에 채운다.
5. 사용자는 채워진 단계를 확인·수정하고 나머지 섹션을 작성한다.

### 대체 플로우 (AI 없는 사용자)
1~3 동일.
4. AI가 없으므로(나노·BYOK 모두 없음) 룰 기반 변환기가 즉시 액션 로그를 압축된 재현 단계 텍스트로 만들어 채운다.
5. 사용자는 기계적으로 정리된 초안을 다듬는다.

### 엣지 케이스
- **AI 호출 실패/타임아웃**: 룰 기반 baseline으로 폴백해 최소한 채운다.
- **30s Replay 트림**: 사용자가 트림 구간을 바꾸면 액션 로그가 재트림된다. trim 오버레이 동안 `DraftingPanel`은 언마운트되고, 트림 확정 후 재마운트되므로 prefill은 최종(재트림된) 로그로 실행된다.
- **액션 로그가 비어 있음**(`captured === 0`): prefill 미발화. 섹션은 빈 상태 유지.
- **사용자가 이미 손댐**: `stepsToReproduce`에 내용이 있으면 발화하지 않는다(사용자 입력 보존).

## 성공 기준

- video 모드로 캡처 후 drafting 진입 시, 액션 로그가 있으면 `stepsToReproduce`가 비어 있지 않게 된다.
- 나노·BYOK가 없는 프로필에서도(AI UI 미노출 상태) `stepsToReproduce`가 룰 기반으로 채워진다.
- AI 가용 프로필에서는 AI 결과로 채워지고, AI 실패 시 룰 baseline으로 폴백한다.
- 사용자가 `stepsToReproduce`를 편집/삭제한 뒤 재마운트되어도 덮어쓰지 않는다.
- 룰 기반 변환기 순수 함수에 단위 테스트가 있고 `pnpm test` 통과.
