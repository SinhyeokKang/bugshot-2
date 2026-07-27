# AI 취소 레인 단일화 (ai-run-lane)

## 배경

`pnpm postmortem:report` 집계에서 **`AI × 취소래치`가 5건**으로 `어댑터 × 복제본`과 공동 2위다(1위는 `디자인 × 복제본` 6건). 1위를 제치고 이걸 먼저 하는 이유는 **그물의 유무**다 — 1위 계열은 `tokens.test.ts`라는 기계적 그물이 이미 있고, 이 계열은 그물이 없다.

| 날짜 | 함정 | 취소 레인? |
|---|---|---|
| 2026-07-08 | AI 스타일 적용이 CSS code view 포커스 중이면 다음 타이핑에 조용히 덮어써짐 | ✗ (loading 플래그의 다른 소비자) |
| 2026-07-16 | "결과 무관 1회" 래치와 effect cleanup 취소가 만나 취소된 요청을 아무도 이어받지 않아 재현 단계 영구 미충전 | ✓ |
| 2026-07-17 | zustand 전이와 React state 게이트가 다른 레인이라 한 렌더가 새고, 같은 함정이 **하루 만에 재발** | ✓ |
| 2026-07-21 | 소프트 취소를 3개 콜사이트에 얹을 때 **가드가 한 곳만** 있었고, 사용자 취소가 re-adopt로 되살아남 | ✓ |
| 2026-07-28 | 리뷰가 "abort 누락"이라 부른 것이 실은 re-adopt의 생명줄이었고, signal을 무시하는 mock이 그 회귀를 green으로 통과시킴 | ✓ |

5건 중 **4건이 같은 자리(취소 레인)**에서 났다. 나머지 1건(2026-07-08)은 취소가 아니라 `aiStylingLoading`의 **다른 소비자**가 원인이었는데, 이 리팩터가 그 플래그의 토글 시점을 건드리므로 재발 벡터로 관리 대상이다(아래 상태 목록 참조).

2026-07-21이 **이미 "3콜사이트 복제" 문제**였는데, 그때 한 일은 세 곳에 같은 가드를 손으로 맞춰 넣은 것이었다. 구조는 그대로 뒀으므로 2026-07-28에 같은 자리에서 또 터졌다.

현재 취소 한 번에 얽히는 상태는 아래 **아홉 범주**다(실제 식별자는 12개 — 범주로 묶어야 겨우 셀 수 있다는 것 자체가 문제다).

- `run.cancelled` — 비자발 취소(언마운트·게이트 왕복). **되살릴 수 있다.**
- `run.userCancelled` — 사용자 명시 중단. **되살리면 안 된다.** (`useReproPrefill`에만 존재)
- `AbortController` — 실제 fetch·retry 중단. cleanup에서 부르면 안 되는 자리가 있다.
- `activeRunRef` / `runRef` — "이게 아직 현재 run인가" 판정.
- `reproPrefillDone` 래치 — 결과 무관 1회 발화.
- `sessionRef` / `sessionKeyRef` — Chrome 세션 소유·destroy. Styling은 `sessionKeyRef`가 같으면 **세션을 재사용**한다(멀티턴 대화).
- `targetSelector` / `targetFrameId` — Styling의 repick 소유권 토큰. 취소 레인과 **별개**로 늦은 결과를 막는다.
- `aiDraftLoading` / `aiStylingLoading` / `reproPrefillLoading` — 오버레이 표시**만이 아니다**. `StyleCssView.tsx`가 `aiStylingLoading`의 **true→false 하강 에지**를 읽어 CodeMirror doc 강제 재동기화를 판정한다(2026-07-08 픽스의 본체). 더해 `editor-store`의 4곳(`onElementSelected` 2곳·`confirmStyles`·`backToStyling`)이 취소 없이 `aiStylingLoading: false`를 직접 set한다 — in-flight run이 살아 있는 채 플래그만 내려가는 전이가 이미 존재한다.
- `aiCancel` — 오버레이 '중단' 버튼이 부를 단일 슬롯 콜백.

이 아홉 범주가 세 콜사이트(`AiDraftDialog`·`AiStylingDialog`·`useReproPrefill`)에 각자 손으로 조합돼 있다. 조합이 사람의 작업기억을 넘어서서, **정답이 주석에 적혀 있어도 읽히지 않는다** — 2026-07-28이 그 사례다(re-adopt 분기는 `useReproPrefill.ts:93-98`, 그 정답에 의존하는 cleanup은 `:156-159`로 **58줄 떨어져 있어** 리뷰도 구현도 둘을 함께 보지 못했다).

## 목표

1. 세 콜사이트가 취소를 **같은 헬퍼 하나**로 처리한다. run 생성·canceller 등록/해제·재개 지점 가드·종료 정리가 헬퍼 안에서 한 번만 정의된다.
2. "await 재개 지점에서 이 run이 아직 유효한가"를 판정하는 술어가 **하나**다. 현재는 `if (run.cancelled)`와 `if (run.cancelled || activeRunRef.current !== run)`가 섞여 있고, 어느 지점에 어느 쪽이 필요한지는 콜사이트가 판단한다.
3. cleanup에서 abort해도 되는지가 **콜사이트 판단이 아니라 run 종류(`kind`)로 결정**된다. 2026-07-28 회귀가 구조적으로 불가능해진다.
4. 위 불변식이 **테스트로 고정**된다 — 특히 `signal.aborted`를 직접 단언해, signal을 무시하는 mock 때문에 방어가 inert해지는 2026-07-28 패턴을 막는다.
5. **`setAiCancel` crossover 버그를 함께 고친다.** 현재 슬롯 해제 가드가 슬롯 정체성이 아니라 자기 `runRef`라, 뒤늦게 settle한 run이 **다른 surface가 방금 등록한 canceller를 `null`로 덮는다**(Chrome 내장 AI는 abort를 무시하고 수 초 뒤 settle하므로 실제로 도달 가능하다). 그 결과 오버레이의 '중단'이 무음 no-op가 되고, ESC·바깥 클릭이 없어 **탈출구가 패널 재오픈뿐**이 된다. 헬퍼가 슬롯을 소유하게 되는 이번이 이걸 고칠 자리다 — `end()`는 **자기가 등록한 canceller일 때만** 해제한다.

### 이 리팩터가 해결하지 않는 것

2026-07-17 회고 (5)는 *"`useReproPrefill`의 취소↔래치 함정 자체는 여전히 살아있다 — 이번엔 트리거만 없앴다"*고 선언했다. 이 리팩터도 그 선언을 완전히 걷어내지는 못한다. `reproPrefillDone` 래치는 비목표로 남으므로 **래치와 취소의 순서 의존은 그대로**다. 달라지는 것은 그 순서를 지켜야 하는 **자리가 세 곳에서 한 곳으로 준다**는 점이다.

## 비목표 (Non-goals)

- **취소 UX 변경 없음.** 오버레이 '중단' 버튼, 문구, 표시 조건(`aiLoadingSurface`)은 그대로다. 단, 목표 5의 crossover 수정과 `isActive` 엄격화(시나리오 7)는 **의도적으로 수용한 예외 2건**이다.
- **`aiCancel` 단일 슬롯 구조 유지.** 동시 실행 op를 지원하지 않는다 — 오버레이가 `pointer-events`로 동시 시작을 구조적으로 막는다는 기존 전제(2026-07-21 회고)를 그대로 둔다. *단 이 전제는 포인터에만 성립한다 — 오버레이에 focus trap·`inert`가 없고, Radix 포털 다이얼로그는 오버레이 위에 뜨며, `StyleEditorPanel`의 스타일링 트리거에는 `DraftingPanel`과 달리 로딩 가드가 없다. 키보드·포털 경로는 이 전제의 예외이며 별도 항목으로 다룬다.*
- **Chrome 세션 생명주기 재설계 없음.** `sessionRef`/`sessionKeyRef`의 소유·destroy 책임은 콜사이트에 남긴다. 헬퍼는 "취소 시 불러야 할 정리"를 콜백으로 받을 뿐이다. **세션 재사용(멀티턴)·catch 경로의 세션 정리는 현행 그대로 유지**한다.
- **`reproPrefillDone` 래치 자체는 건드리지 않는다.** 헬퍼는 래치를 읽지도 쓰지도 않고, 재개 가능 여부만 판정한다.
- **`editor-store`의 스키마·액션 무변경.** `aiCancel` 슬롯과 3개 loading setter의 시그니처·영속 정책을 그대로 둔다. 위 배경의 "4곳 직접 set"도 이번 스코프 밖이다.
- **`IssueTab`의 스크롤 캡처 취소 레인 제외.** `IssueTab.tsx:122-155`에 `AbortController`를 소유권 토큰으로 쓰고 `isCurrent()` 술어로 늦은 결과를 버리는 **구조적으로 동일한 레인**이 이미 있다. 그러나 AI가 아니고 `aiCancel` 슬롯·loading 플래그와 무관하므로 이번에 흡수하지 않는다(성공 기준 grep도 이 파일을 대상에서 제외한다).
- **e2e spec 추가 없음.** 취소는 실제 LLM 응답 지연에 걸려 있어 결정적 시나리오를 만들기 어렵다 — 근거와 대안은 `tasks.md` 테스트 계획 참조.
- **AI 프롬프트·프로바이더·예산 가드 무관.**

## 사용자 시나리오

이 기능은 리팩터라 새 사용자 플로우가 없다. 기존 플로우가 **그대로 유지되는지**가 시나리오다.

1. **초안 생성 중 중단** — AI 초안 실행 → 오버레이 '중단' → 로딩이 즉시 걷히고, 늦게 온 응답이 본문을 덮어쓰지 않으며, 에러 토스트가 뜨지 않는다. BYOK면 진행 중 fetch·retry 대기가 실제로 끊긴다. **Chrome 내장 AI는 `prompt()`에 signal을 넘기지 않으므로 진행 중 추론이 끊기지 않고 결과 폐기로만 동작한다** — 사용자 눈에는 같지만 자원 소모는 계속된다.
2. **스타일링 중 중단** — 위와 동일. 추가로 세션이 destroy되고 다음 실행이 새 세션을 만든다.
3. **스타일링 중 다른 요소로 repick** — 옛 요소용 결과가 새 요소에 적용되지 않는다. *이 보장의 실제 주체는 취소 레인이 아니라 `AiStylingDialog.tsx:209-216`의 selection identity 체크(`selector`·`frameId` 대조)다. 리팩터가 이 가드를 건드리지 않아야 시나리오가 유지된다.*
4. **재현 단계 자동 채움 중 게이트 왕복** — effect가 재실행돼도 **진행 중 요청이 살아남아 결과를 이어받는다**. `reproPrefillDone`이 래치된 뒤라 재발화는 없다. *실제 왕복 트리거는 설정 탭의 "재현 과정" 섹션 토글 / BYOK·LLM 설정 저장(`createSession` 정체성 변경) / `aiStatus` checking→available 전이 / `stepsEmpty` 왕복이다. **트림 오버레이 개폐는 트리거가 아니다** — `IssueTab.tsx:219`가 트림 중 `DraftingPanel`을 통째로 언마운트해 훅 인스턴스 자체가 없어지기 때문. 또 in-flight 중에는 오버레이가 클릭을 흡수해 **마우스만으로는 이 경로를 재현할 수 없다**(단위 테스트가 유일한 그물).*
5. **재현 단계 자동 채움 중 사용자 중단** — 영구 포기. 게이트가 다시 열려도 되살아나지 않고 재발화도 없다.
6. **패널 언마운트 / provider 교체** — 진행 중 요청의 결과가 버려지고 로딩·canceller가 해제되며 세션이 destroy된다. *두 다이얼로그의 cleanup deps는 `[createSession]`이라 **AI provider 설정 변경**에서도 같은 경로가 돈다 — 언마운트 전용이 아니다. `useReproPrefill`은 cleanup이 `run.cancelled = true` 한 줄뿐이라 로딩·canceller 해제가 즉시가 아니라 **요청이 실제로 settle된 뒤**로 지연된다.*
7. **초안을 중단 없이 연달아 두 번 실행** — 나중 결과만 적용되고, 먼저 시작한 run의 결과와 **에러 토스트가 모두 억제**된다. *이건 유일하게 의도적으로 바꾸는 동작이다(현재는 옛 run의 결과·에러가 통과할 수 있다). 재현 조건이 좁다 — 다이얼로그 exit 애니메이션 300ms 동안 제출 버튼이 살아 있고, `AiDraftDialog`는 element 모드에서만 빈 입력 제출이 유효하다.*

엣지: 5번(사용자 중단)과 4번(게이트 왕복)이 **연달아** 일어나도 5번이 이긴다 — 이것이 `userCancelled` 레인이 존재하는 이유다.

## 성공 기준

- 세 콜사이트에서 취소 상태를 **직접 조작·판독하는 코드가 사라진다**. 대상 3파일을 고정해 판정한다(무관 레인인 `IssueTab.tsx`는 비목표에 따라 제외):

  ```bash
  grep -nE "run\.cancelled|userCancelled|new AbortController|activeRunRef|runRef" \
    src/sidepanel/tabs/AiDraftDialog.tsx \
    src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx \
    src/sidepanel/hooks/useReproPrefill.ts
  ```
  → 0건. (대입뿐 아니라 **읽기 가드**(`if (run.cancelled)`)까지 잡아야 한다 — 현재 세 파일에 읽기 가드만 9곳이고, 대입 패턴만 검사하면 전부 통과한다.)
- 위 7개 시나리오가 전부 기존과 동일하게 동작한다(7번은 명시된 대로 달라진다).
- `pnpm test` 전체 green, `pnpm typecheck` 통과.
- 헬퍼 단위 테스트가 다음을 고정한다: `oneshot` cleanup은 abort하고 `resumable` cleanup은 abort하지 않는다 / `userCancelled`된 run은 재개되지 않는다 / stale run은 `isActive`가 false다 / `detach` 후에도 현재 run의 `end()`는 로딩을 끈다 / `end()`는 자기가 등록한 canceller일 때만 슬롯을 비운다.
- 회귀 테스트가 **`signal.aborted`를 직접 단언**한다(결과값만 보는 단언은 이 함정을 못 잡는다 — 2026-07-28). 저장소 전체에서 현재 `signal.aborted`를 단언하는 테스트는 1건뿐이고 그마저 `false` 방향만 본다.
- 두 다이얼로그에 **취소 경로 렌더 테스트가 신설**된다(현재 0건 — `tasks.md` Task 6).
