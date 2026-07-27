# AI 취소 레인 단일화 — 구현 태스크

## 선행 조건

- 권한·env·의존성 추가 없음. 순수 내부 리팩터다.
- 착수 전 `docs/POSTMORTEM.md`에서 `취소래치` 항목 5건을 읽는다(2026-07-08/16/17/21/28). 특히 **2026-07-16·17**은 래치와 취소의 순서 문제라 Task 4의 순서 보존 요구가 거기서 나온다.
- 기준 상태: `pnpm test` green, `pnpm typecheck` 통과.

## 태스크

### Task 1: `useAiRun` 테스트 먼저 작성 (TDD red)

- **변경 대상**: `src/sidepanel/hooks/__tests__/useAiRun.test.tsx` (신규)
- **작업 내용**: `design.md`의 `AiRunController` 시그니처를 호출하는 테스트를 먼저 쓴다. 모듈이 없어 import 실패하는 것이 첫 red다. 케이스:
  - `begin()`이 `setLoading(true)`와 `setAiCancel(함수)`를 부른다.
  - `begin()` 직후 `isActive(run)`이 true, `end(run)` 후 `setLoading(false)`·`setAiCancel(null)`.
  - 두 번째 `begin()` 후 첫 run은 `isActive`가 false이고, 첫 run의 `end()`는 로딩을 끄지 않는다(stale run이 새 run의 로딩을 못 끈다).
  - canceller 호출 시 `run.cancelled`·`run.userCancelled`가 서고 `run.signal.aborted === true`, `onDispose`가 불린다.
  - `kind: "oneshot"`의 `detach(run)` → `run.signal.aborted === true`.
  - **`kind: "resumable"`의 `detach(run)` → `run.signal.aborted === false`** (2026-07-28 회귀 가드).
  - `resumable`에서 `detach` 후 `readopt()`가 같은 run을 반환하고 `cancelled`가 false로 돌아온다.
  - canceller로 중단한 뒤 `readopt()`는 `null`(`userCancelled`는 되살리지 않는다).
- **검증**:
  - [ ] `pnpm test --run src/sidepanel/hooks/__tests__/useAiRun.test.tsx` → import 실패로 red
  - [ ] 케이스 목록에 `signal.aborted` 직접 단언이 최소 3개(oneshot detach / resumable detach / canceller)

### Task 2: `useAiRun` 구현 (green 전환)

- **변경 대상**: `src/sidepanel/hooks/useAiRun.ts` (신규)
- **작업 내용**: `design.md`의 인터페이스대로 구현. run은 `useRef`로만 보유하고 store에 올리지 않는다(대안 D 기각 사유). `begin()`은 직전 run이 있으면 취소·`onDispose` 후 교체한다. `end()`·`detach()`는 현재 run일 때만 store를 건드린다. `readopt()`는 `userCancelled`면 `null`.
- **검증**:
  - [ ] Task 1 테스트 전부 green
  - [ ] `pnpm typecheck` 통과
  - [ ] `useAiRun.ts`가 `AISession`·`ai-provider`를 import하지 않는다(세션 지식 없음 — `grep -n "ai-provider\|AISession" src/sidepanel/hooks/useAiRun.ts` 0건)

### Task 3: `AiDraftDialog` 이관

- **변경 대상**: `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**: `activeRunRef` 선언·`new AbortController()`·canceller 본문·언마운트 cleanup의 run 처리·`finally` 정리 블록을 `useAiRun({ kind: "oneshot" })`로 교체. 세션 생성 후 가드와 prompt 후 가드를 `isActive(run)`으로 통일하고, `prompt`에 `run.signal`을 넘긴다. `sessionRef` destroy는 `onDispose`로 이동.
- **검증**:
  - [ ] `grep -n "run.cancelled = \|new AbortController\|activeRunRef" src/sidepanel/tabs/AiDraftDialog.tsx` → 0건
  - [ ] `pnpm test --run src/sidepanel/tabs/__tests__/` green
  - [ ] `pnpm typecheck` 통과

### Task 4: `useReproPrefill` 이관 (순서 보존 주의)

- **변경 대상**: `src/sidepanel/hooks/useReproPrefill.ts`
- **작업 내용**: re-adopt 분기를 `readopt()` 호출로, effect cleanup을 `detach(run)`으로 교체. `runRef`·직접 `AbortController`·`userCancelled` 수동 조작을 제거한다. **`setReproPrefillDone(true)` → `doneRef.current = true` → `begin()` 순서를 그대로 유지한다**(뒤바뀌면 2026-07-16/17 재발). `reproPrefillDone` 래치는 콜사이트에 남는다.
- **검증**:
  - [ ] 기존 `useReproPrefill.test.tsx` 29개 전부 green (특히 "게이트 왕복 cleanup은 in-flight 요청을 abort하지 않는다", "in-flight 중 게이트가 껐다 켜져도 …이어받는다", "사용자 중단 … 재발화 없음")
  - [ ] `grep -n "userCancelled = \|new AbortController\|runRef" src/sidepanel/hooks/useReproPrefill.ts` → 0건
  - [ ] 래치 3줄의 순서가 유지됐는지 diff로 직접 확인

### Task 5: `AiStylingDialog` 이관

- **변경 대상**: `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`
- **작업 내용**: Task 3과 동일. `onDispose`가 `sessionRef`와 **`sessionKeyRef`를 함께** 비운다(빠뜨리면 repick 후 stale system prompt로 요청이 나간다). `lastSentStylesRef`·`lastSentClassesRef`·`conversationCharsRef`는 취소 레인이 아니므로 건드리지 않는다.
- **검증**:
  - [ ] `grep -n "run.cancelled = \|new AbortController\|activeRunRef" src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx` → 0건
  - [ ] `onDispose`에서 `sessionKeyRef.current = null`이 있는지 눈으로 확인
  - [ ] `pnpm test --run` 전체 green

### Task 6: 콜사이트 계약 테스트 보강

- **변경 대상**: `src/sidepanel/hooks/__tests__/useReproPrefill.test.tsx`, 필요 시 Draft/Styling 테스트
- **작업 내용**: 세 콜사이트가 **넘겨받은 signal을 실제로 쓰는지** 단언한다. mock이 `input.signal`을 보관하도록 하고, 취소 시 `aborted === true` / 게이트 왕복 시 `aborted === false`를 확인한다. 결과값만 보는 단언은 이 함정을 못 잡는다(2026-07-28).
- **검증**:
  - [ ] Task 2~5 중 하나를 임시로 되돌리면 이 테스트가 red가 되는지 확인(그물이 실제로 잡는지 증명)
  - [ ] `pnpm test` 전체 green

## 테스트 계획

- **단위 테스트(jsdom, `renderHook`)**: Task 1 목록 그대로. 훅이라 node 트랙이 아니라 `*.test.tsx`다.
- **e2e 시나리오**: 이번 범위에서는 **추가하지 않는다.** 현재 `e2e/`에 AI 취소 spec이 없고, 취소는 실제 LLM 응답 지연에 걸려 있어 결정적 시나리오를 만들기 어렵다. 필요해지면 별도로 다룬다.
- **수동 테스트** (Chrome, `pnpm build` 후 확장 리로드):
  - [ ] 초안 생성 중 '중단' → 로딩 걷힘·본문 미변경·에러 토스트 없음
  - [ ] 스타일링 중 '중단' → 위와 동일 + 다음 실행이 새 세션으로 정상 동작
  - [ ] 스타일링 중 다른 요소로 repick → 옛 결과가 새 요소에 적용되지 않음
  - [ ] **초안을 연달아 두 번 실행(중단 없이)** → 나중 결과만 적용됨 (`isActive` 엄격화로 달라지는 지점)
  - [ ] 녹화 후 재현 단계 자동 채움 중 트림 오버레이 개폐 → 채움이 **이어져서 완료**됨
  - [ ] 재현 단계 자동 채움 중 '중단' → 영구 포기(게이트 왕복해도 되살아나지 않음)
  - [ ] 자동 채움 진행 중 패널 닫기 → 재오픈 시 스피너 고착 없음

## 구현 순서 권장

```
Task 1 (red) → Task 2 (green)          ← 헬퍼 확정. 여기까지 콜사이트 무변경
      ↓
Task 3 ──┐
Task 4 ──┼─ 병렬 가능 (서로 다른 파일, 헬퍼만 공유)
Task 5 ──┘
      ↓
Task 6 (그물 보강 + 되돌려 red 확인)
```

Task 4를 셋 중 **먼저** 하는 것을 권한다 — `resumable`이 유일하게 헬퍼 설계를 검증하는 경로라, 여기서 API가 안 맞으면 Task 2로 돌아가야 한다. Task 3·5는 골격이 같아 뒤에 붙이면 기계적이다.

## 가이드 영향

없음. 사용자 노출 UX·문구·플로우가 바뀌지 않는다(비목표에 명시).
