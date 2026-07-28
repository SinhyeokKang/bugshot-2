# AI 취소 레인 단일화 — 구현 태스크

## 선행 조건

- 권한·env·의존성 추가 없음. 순수 내부 리팩터다.
- 착수 전 `docs/POSTMORTEM.md`에서 `취소래치` 항목 5건을 읽는다(2026-07-08/16/17/21/28). 특히 **2026-07-16·17**은 래치와 취소의 순서 문제라 Task 4의 순서 보존 요구가 거기서 나온다.
- 착수 전 `design.md`의 **"규약"** 7개를 읽는다. 이번 구현의 실질이 거기 있고, 각 항에 어기면 나는 회귀가 붙어 있다.
- 기준 상태: `pnpm test` green, `pnpm typecheck` 통과.

## 태스크

### Task 1: `useAiRun` 테스트 먼저 작성 (TDD red)

- **변경 대상**: `src/sidepanel/hooks/__tests__/useAiRun.test.tsx` (신규)
- **작업 내용**: `design.md`의 `AiRunController` 시그니처를 호출하는 테스트를 먼저 쓴다. 모듈이 없어 import 실패하는 것이 첫 red다. 케이스:
  - `begin()`이 `setLoading(true)`와 `setAiCancel(함수)`를 부른다.
  - `begin()` 직후 `isActive(run)`이 true, `end(run)` 후 `setLoading(false)`·`setAiCancel(null)`.
  - 두 번째 `begin()` 후 첫 run은 `isActive`가 false이고, 첫 run의 `end()`는 로딩을 끄지 않는다(stale run이 새 run의 로딩을 못 끈다).
  - canceller 호출 시 `run.signal.aborted === true`, `onDispose`가 불리고 로딩이 꺼진다.
  - `kind: "oneshot"`의 `detach(run)` → `run.signal.aborted === true`.
  - **`kind: "resumable"`의 `detach(run)` → `run.signal.aborted === false`** (2026-07-28 회귀 가드).
  - **`detach(run)`이 `setLoading`·`setAiCancel`을 부르지 않는다**(규약 4 — store 무접촉).
  - **`detach(run)` 후에도 `end(run)`이 `setLoading(false)`를 부른다**(규약 4 — current 유지. 게이트 OFF 후 `begin()`이 안 불리는 경로에서 `end()`가 유일한 로딩 해제자다. `current === run`과 `isActive(run)`를 가르는 유일한 경계이기도 하다).
  - `resumable`에서 `detach` 후 `readopt()`가 같은 run을 반환하고 재개 가능하다.
  - canceller로 중단한 뒤 `readopt()`는 `null`(`userCancelled`는 되살리지 않는다).
  - **`end(run)` 후의 두 번째 `begin()`은 `onDispose`를 부르지 않는다**(규약 1·2 — 세션 재사용이 여기 의존한다).
  - **미종료 run이 있는 상태의 두 번째 `begin()`은** 첫 run에 대해 `onDispose`를 정확히 1회 부르고, 첫 run의 `signal.aborted`가 **kind와 무관하게 `true`**이며(`kind` 축은 cleanup 전용이고, 교체된 run은 `readopt()` 대상도 아니라 아무도 이어받지 않는다), 새 canceller가 `setAiCancel`에 등록된다.
  - **교체 경로에서 첫 run이 `readopt()` 대상이 되지 않는다**(규약 3 — 사용자가 누르지 않은 run에 `userCancelled`가 서지 않아야 하되, 외부에 노출되지 않으므로 `readopt()` 동작으로 관찰한다).
  - **`begin()`이 이미 `true`인 로딩을 `false→true`로 토글하지 않는다**(design.md 위험 요소 — `StyleCssView`가 하강 에지를 읽어 2026-07-08이 재발한다).
  - **`end()`는 슬롯이 자기 canceller일 때만 `setAiCancel(null)`을 부른다**(규약 5 — 슬롯을 제3자 값으로 바꾼 뒤 `end()`를 불러 `null`이 안 나가는 것을 확인).
  - **rerender 후 컨트롤러와 6개 메서드의 참조가 동일**하다(규약 7).
  - **`disposeCurrent()`**: oneshot은 abort + `onDispose` + 슬롯 해제 + 로딩 off까지 / resumable은 no-op(store 무접촉) / 진행 중 run이 없으면 no-op.
  - **사용자 중단 후 재제출해도 `onDispose`는 run당 한 번만** 불린다(규약 6).
  - **`oneshot` 언마운트** → `signal.aborted === true` + `setLoading(false)` + 슬롯 해제 + `onDispose`. **`resumable` 언마운트** → abort하지 않는다.
- **검증**:
  - [x] `pnpm test --run src/sidepanel/hooks/__tests__/useAiRun.test.tsx` → import 실패로 red
  - [x] 케이스 목록에 `signal.aborted` 직접 단언이 최소 5개(oneshot detach / resumable detach / canceller / begin 교체 / 언마운트)

### Task 2: `useAiRun` 구현 (green 전환)

- **변경 대상**: `src/sidepanel/hooks/useAiRun.ts` (신규), `src/sidepanel/lib/aiCancelSlot.ts` (신규 — `getAiCancel` 라이브 리더 단일 출처)
- **작업 내용**: `design.md`의 인터페이스와 **규약 7개**대로 구현. run은 `useRef`로만 보유하고 store에 올리지 않는다(대안 D 기각 사유). `begin()`은 **미종료** 직전 run이 있을 때만 취소·`onDispose` 후 교체한다. `end()`는 현재 run일 때만 로딩을 끄고 **자기 canceller일 때만** 슬롯을 비우며 current를 `null`로 만든다. `detach()`는 `cancelled`만 세우고 store·current를 건드리지 않으며 `kind`가 abort를 결정한다. `readopt()`는 `userCancelled`면 `null`. `disposeCurrent()`는 oneshot만 정리하고(abort + `onDispose` + 슬롯 해제 + 로딩 off), 헬퍼의 언마운트 effect와 콜사이트의 provider 교체 cleanup이 이걸 공유한다. `onDispose`는 `disposed` 플래그로 run당 1회를 보장한다. 컨트롤러는 `useMemo`/`useRef`로 안정화한다.
- **검증**:
  - [x] Task 1 테스트 전부 green
  - [x] `pnpm typecheck` 통과
  - [x] `useAiRun.ts`가 `AISession`·`ai-provider`를 import하지 않는다 — `test -f src/sidepanel/hooks/useAiRun.ts && grep -c "ai-provider\|AISession" src/sidepanel/hooks/useAiRun.ts` → **파일 존재 + 0건**(파일 부재의 exit 2와 구분할 것)
  - [x] `useAiRun.ts`가 `editor-store`를 import하지 않는다(setter는 전부 주입 — `grep -c "editor-store" src/sidepanel/hooks/useAiRun.ts` → 0건)

### Task 3: `useReproPrefill` 이관 (순서 보존 주의 — 셋 중 **먼저**)

- **변경 대상**: `src/sidepanel/hooks/useReproPrefill.ts`, `src/sidepanel/tabs/DraftingPanel.tsx`(`getAiCancel` 주입)
- **작업 내용**: re-adopt 분기를 `readopt()` 호출로, effect cleanup을 `detach(run)`으로 교체. `runRef`·직접 `AbortController`·`userCancelled` 수동 조작·`apply()` 내부 2차 가드를 제거하고 `isActive(run)`으로 통일한다. **`setReproPrefillDone(true)` → `doneRef.current = true` → `begin()` 순서를 그대로 유지한다**(뒤바뀌면 2026-07-16/17 재발). `reproPrefillDone` 래치는 콜사이트에 남는다. `UseReproPrefillArgs`의 `setLoading`·`setAiCancel` DI 시그니처를 유지하고 그대로 `useAiRun` config에 넘긴다. 컨트롤러를 effect deps에 넣는다면 규약 6(참조 안정)에 의존함을 주석 한 줄로 남긴다.
- **검증**:
  - [x] 기존 `useReproPrefill.test.tsx` **29개 전부 green**, 특히 "게이트 왕복 cleanup은 in-flight 요청을 abort하지 않는다"·"in-flight 중 게이트가 껐다 켜져도 …이어받는다"·"사용자 중단 … 재발화 없음"·`:582` "AI in-flight 중 sectionEnabled가 꺼지면 취소되더라도 로딩은 풀린다"
  - [x] 아래 **공통 grep** → 0건
  - [x] 래치 3줄의 순서가 유지됐는지 diff로 직접 확인

### Task 4: `AiDraftDialog` 이관

- **변경 대상**: `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**: `activeRunRef` 선언·`new AbortController()`·canceller 본문·언마운트 cleanup의 **run 처리**·`finally` 정리 블록을 `useAiRun({ kind: "oneshot" })`로 교체. 세션 생성 후 가드와 prompt 후 가드를 `isActive(run)`으로 통일하고, `prompt`에 `run.signal`을 넘긴다. `sessionRef` destroy는 `onDispose`로 이동. **catch의 세션 정리는 잔류**시키고, **`deps: [createSession]`인 provider 교체 cleanup effect는 `aiRun.disposeCurrent()` + 세션 destroy 둘 다** 하도록 유지한다(그 deps의 의미는 언마운트가 아니라 provider 교체이고, 헬퍼의 언마운트 effect는 안정 참조 deps라 이 경로에서 발화하지 않는다).
- **검증**:
  - [x] 아래 **공통 grep** → 0건
  - [x] `grep -n "createSession\]" src/sidepanel/tabs/AiDraftDialog.tsx` → provider 교체 cleanup effect가 남아 있다
  - [x] catch 블록에 `sessionRef.current = null`이 남아 있다
  - [x] `pnpm typecheck` 통과

### Task 5: `AiStylingDialog` 이관

- **변경 대상**: `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`
- **작업 내용**: Task 4와 동일. `onDispose`가 `sessionRef`와 **`sessionKeyRef`를 함께** 비운다(빠뜨리면 repick 후 stale system prompt로 요청이 나간다). **세션 재사용 분기(`sessionKeyRef.current !== targetKey` 비교)와 repick 소유권 가드(`:209-216`)·`lastSentStylesRef`·`lastSentClassesRef`·`conversationCharsRef`는 취소 레인이 아니므로 건드리지 않는다.**
- **검증**:
  - [x] 아래 **공통 grep** → 0건
  - [x] `grep -c "sessionKeyRef.current = null" src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx` → **3건 이상**(onDispose / 세션 교체 / catch)
  - [x] `grep -n "targetSelector\|targetFrameId" src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx` → repick 가드 존치
  - [x] `pnpm test --run` 전체 green

**공통 grep (Task 3·4·5 동일 — PRD 성공 기준과 같은 명령)**

```bash
grep -nE "run\.cancelled|userCancelled|new AbortController|activeRunRef|runRef" \
  src/sidepanel/tabs/AiDraftDialog.tsx \
  src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx \
  src/sidepanel/hooks/useReproPrefill.ts
```

대입뿐 아니라 **읽기 가드**(`if (run.cancelled)` — 현재 세 파일에 9곳)까지 잡는 패턴이다. 무관 레인인 `src/sidepanel/tabs/IssueTab.tsx:122`(스크롤 캡처용 `AbortController`)는 대상에서 제외했다(PRD 비목표).

### Task 6: 콜사이트 계약 테스트 신설·보강

- **변경 대상**: `src/sidepanel/tabs/__tests__/AiDraftDialog.test.tsx`(신규), `src/sidepanel/tabs/styleEditor/__tests__/AiStylingDialog.test.tsx`(신규), `src/sidepanel/hooks/__tests__/useReproPrefill.test.tsx`(보강)
- **작업 내용**: **두 다이얼로그는 현재 단위 테스트가 0건**이다(`tabs/__tests__/`의 6개 파일 중 `AiDraftDialog`를 렌더하는 것이 없고, `styleEditor/__tests__/`의 13개는 전부 순수 함수 `.ts`다). 이번 리팩터가 건드리는 코드의 60%가 그물 밖이므로 취소 경로 렌더 테스트를 신설한다. 세 콜사이트 공통으로 **넘겨받은 signal을 실제로 쓰는지** 단언한다 — mock이 `options.signal`(다이얼로그는 `AISession.prompt`, repro는 `generateReproStepsWithAI({signal})`)을 보관하고, 취소 시 `aborted === true` / 게이트 왕복 시 `aborted === false`를 확인한다. 결과값만 보는 단언은 이 함정을 못 잡는다(2026-07-28).
  - 최소 케이스: **중단 시 `signal.aborted === true` + 결과 미적용 + 에러 토스트 없음**, **중단 후 재실행이 새 세션을 만든다**(Styling은 `sessionKeyRef` 리셋 확인), **정상 종료 후 재제출이 세션을 재사용한다**(규약 1·2 — 멀티턴 회귀 가드).
- **검증**:
  - [x] `pnpm test` 전체 green
  - [x] **뮤테이션 확인**: `useAiRun.ts`의 `detach`에서 `kind` 분기를 지워 항상 `controller.abort()`하도록 1줄 바꾼 뒤 `pnpm test --run src/sidepanel/hooks/__tests__/useReproPrefill.test.tsx`가 "게이트 왕복 cleanup은 in-flight 요청을 abort하지 않는다"에서 red가 되는지 확인 → `git checkout -- src/sidepanel/hooks/useAiRun.ts`로 복구. **되돌린 상태를 커밋하지 않는다.**
  - [x] **뮤테이션 확인 2**: `end()`에서 current를 `null`로 비우는 줄을 지우면 Task 6의 "정상 종료 후 세션 재사용" 테스트가 red가 되는지 확인 후 복구(규약 1의 그물 증명)

## 테스트 계획

- **단위 테스트(jsdom, `renderHook`·`@testing-library/react`)**: Task 1·6 목록 그대로. 훅·컴포넌트라 node 트랙이 아니라 `*.test.tsx`다.
- **e2e 시나리오**: 이번 범위에서는 **추가하지 않는다.** 현재 `e2e/`에 AI 취소 spec이 없고, 취소는 실제 LLM 응답 지연에 걸려 있어 결정적 시나리오를 만들기 어렵다. 필요해지면 별도로 다룬다.
- **수동으로 재현 불가능한 경로가 있다**: 시나리오 4(게이트 왕복)의 실제 트리거는 설정 탭 섹션 토글·BYOK 설정 저장·`aiStatus` 전이인데, in-flight 중에는 AI 오버레이가 클릭을 흡수해 **마우스만으로 도달할 수 없다**. 회고 5건 중 3건이 난 경로가 수동 그물 밖이라는 뜻이며, 이 경로의 유일한 안전망은 `useAiRun`·`useReproPrefill` 단위 테스트다.
- **커버리지**: `useAiRun.ts`는 `isBrowserBound()`에 등록할 필요 없이 **로직 스코프에 자동 편입**된다(`.tsx`가 아니고 `BROWSER_BOUND_EXACT`에 `sidepanel/hooks/`가 없다). 다만 `useReproPrefill.ts`(baseline 100%)의 로직이 새 파일로 이동하므로 파일별 수치가 재배치된다 — `/merge` 커버리지 래칫에서 잡음이 나면 `pnpm coverage:update`로 갱신.
- **수동 테스트** (Chrome, `pnpm build` 후 확장 리로드). 취소 동작이 provider마다 다르므로 **BYOK와 Chrome 내장 AI 양쪽**에서 1·2를 확인한다(내장은 abort를 무시해 결과 폐기로만 동작 — 로딩은 걷히지만 추론은 계속된다):
  - [ ] 초안 생성 중 '중단' → 로딩 걷힘·본문 미변경·에러 토스트 없음 *(BYOK / Chrome 내장 각각)*
  - [ ] 스타일링 중 '중단' → 위와 동일 + 다음 실행이 새 세션으로 정상 동작 *(BYOK / Chrome 내장 각각)*
  - [ ] **스타일링 후속 지시 2회 연속(중단 없이)** → 두 번째가 첫 지시의 맥락을 유지한다 *(규약 1·2 — 멀티턴 세션 파괴 회귀 가드. 에러 없이 품질만 떨어지므로 결과를 실제로 읽어 판정할 것)*
  - [ ] 스타일링 중 다른 요소로 repick → 옛 결과가 새 요소에 적용되지 않음
  - [ ] **초안을 연달아 두 번 실행(중단 없이)** → 나중 결과만 적용됨. *재현 조건: `element` 모드 + 첫 제출 직후 다이얼로그 exit 애니메이션 **300ms 안에** 다시 제출(포털 다이얼로그가 오버레이 위에 있어 이 창에서만 클릭이 통한다). 조건을 안 맞추면 재현되지 않으므로 "안 됨 = 통과"로 체크하지 말 것* (`isActive` 엄격화로 달라지는 지점)
  - [ ] 네트워크 에러 도착 직전에 '중단' → 에러 토스트가 뜨지 않음(catch 최상단 가드 — 2026-07-21 소프트 취소 3짝)
  - [ ] 재현 단계 자동 채움 중 '중단' → 영구 포기(게이트 왕복해도 되살아나지 않음)
  - [ ] 자동 채움 진행 중 패널 닫기 → 재오픈 시 스피너 고착 없음
  - [ ] **초안/스타일링 진행 중 패널 닫기** → 재오픈 시 스피너 고착 없음 *(oneshot 언마운트 경로 — `finally`가 대신 못 하는 자리)*
  - [ ] **초안 진행 중 설정에서 AI provider 변경** → 세션이 정리되고 이후 실행이 정상 동작 *(cleanup deps `[createSession]` 경로)*
  - [ ] **한 surface 취소 직후 다른 surface 실행** → 새 오버레이의 '중단'이 실제로 동작한다 *(crossover 수정 확인. Chrome 내장 AI에서 재현 확률이 높다 — 취소가 추론을 안 끊어 수 초 뒤 settle하기 때문)*

## 구현 순서 권장

```
Task 1 (red) → Task 2 (green)          ← 헬퍼 확정. 여기까지 콜사이트 무변경
      ↓
Task 3 (useReproPrefill)               ← resumable이 유일하게 헬퍼 설계를 검증한다
      ↓
Task 4 ──┐
Task 5 ──┴─ 병렬 가능 (서로 다른 파일, 골격 동일)
      ↓
Task 6 (그물 신설 + 뮤테이션으로 red 확인)
```

Task 3을 먼저 하는 이유: `readopt()`와 비-abort `detach`를 실사용하는 유일한 경로라, 여기서 API가 안 맞으면 Task 2로 돌아가야 한다. Task 4·5는 골격이 같아 뒤에 붙이면 기계적이다 — **셋을 병렬로 두면 Task 3발 API 변경이 나머지 둘을 깨뜨린다.**

## 가이드 영향

없음. 사용자 노출 UX·문구·플로우가 바뀌지 않는다(비목표에 명시). 단 `isActive` 엄격화(시나리오 7)와 crossover 수정(PRD 목표 5)은 수용된 동작 변경이며, 둘 다 가이드에 기술된 적 없는 엣지라 문서 갱신 대상은 아니다.
