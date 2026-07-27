# AI 취소 레인 단일화 (ai-run-lane)

## 배경

`docs/POSTMORTEM.md` 집계에서 **`AI × 취소래치`가 5건**으로 반복 함정 2위다. 시간순으로 보면 같은 자리에서 계속 터진다.

| 날짜 | 함정 |
|---|---|
| 2026-07-08 | AI 스타일 적용이 CSS code view 포커스 중이면 다음 타이핑에 조용히 덮어써짐 |
| 2026-07-16 | "결과 무관 1회" 래치와 effect cleanup 취소가 만나 취소된 요청을 아무도 이어받지 않아 재현 단계 영구 미충전 |
| 2026-07-17 | zustand 전이와 React state 게이트가 다른 레인이라 한 렌더가 새고, 같은 함정이 **하루 만에 재발** |
| 2026-07-21 | 소프트 취소를 3개 콜사이트에 얹을 때 **가드가 한 곳만** 있었고, 사용자 취소가 re-adopt로 되살아남 |
| 2026-07-28 | 리뷰가 "abort 누락"이라 부른 것이 실은 re-adopt의 생명줄이었고, signal을 무시하는 mock이 그 회귀를 green으로 통과시킴 |

2026-07-21이 **이미 "3콜사이트 복제" 문제**였는데, 그때 한 일은 세 곳에 같은 가드를 손으로 맞춰 넣은 것이었다. 구조는 그대로 뒀으므로 2026-07-28에 같은 자리에서 또 터졌다.

현재 취소 한 번에 얽히는 상태는 다음과 같다.

- `run.cancelled` — 비자발 취소(언마운트·게이트 왕복). **되살릴 수 있다.**
- `run.userCancelled` — 사용자 명시 중단. **되살리면 안 된다.** (`useReproPrefill`에만 존재)
- `AbortController` — 실제 fetch·retry 중단. cleanup에서 부르면 안 되는 자리가 있다.
- `activeRunRef` / `runRef` — "이게 아직 현재 run인가" 판정.
- `reproPrefillDone` 래치 — 결과 무관 1회 발화.
- `sessionRef` / `sessionKeyRef` — Chrome 세션 소유·destroy.
- `aiDraftLoading` / `aiStylingLoading` / `reproPrefillLoading` — 오버레이 표시.
- `aiCancel` — 오버레이 '중단' 버튼이 부를 단일 슬롯 콜백.

여덟 개가 세 콜사이트(`AiDraftDialog`·`AiStylingDialog`·`useReproPrefill`)에 각자 손으로 조합돼 있다. 조합이 사람의 작업기억을 넘어서서, **정답이 주석에 적혀 있어도 읽히지 않는다** — 2026-07-28이 그 사례다(cleanup 바로 위 분기가 re-adopt인데 리뷰도 구현도 못 봤다).

## 목표

1. 세 콜사이트가 취소를 **같은 헬퍼 하나**로 처리한다. run 생성·canceller 등록/해제·재개 지점 가드·종료 정리가 헬퍼 안에서 한 번만 정의된다.
2. "await 재개 지점에서 이 run이 아직 유효한가"를 판정하는 술어가 **하나**다. 현재는 `if (run.cancelled)`와 `if (run.cancelled || activeRunRef.current !== run)`가 섞여 있고, 어느 지점에 어느 쪽이 필요한지는 콜사이트가 판단한다.
3. cleanup에서 abort해도 되는지가 **콜사이트 판단이 아니라 run 종류(`kind`)로 결정**된다. 2026-07-28 회귀가 구조적으로 불가능해진다.
4. 위 불변식이 **테스트로 고정**된다 — 특히 `signal.aborted`를 직접 단언해, signal을 무시하는 mock 때문에 방어가 inert해지는 2026-07-28 패턴을 막는다.

## 비목표 (Non-goals)

- **취소 UX 변경 없음.** 오버레이 '중단' 버튼, 문구, 표시 조건(`aiLoadingSurface`)은 그대로다.
- **`aiCancel` 단일 슬롯 구조 유지.** 동시 실행 op를 지원하지 않는다 — 오버레이가 `pointer-events`로 동시 시작을 구조적으로 막는다는 기존 전제(2026-07-21 회고)를 그대로 둔다.
- **Chrome 세션 생명주기 재설계 없음.** `sessionRef`/`sessionKeyRef`의 소유·destroy 책임은 콜사이트에 남긴다. 헬퍼는 "취소 시 불러야 할 정리"를 콜백으로 받을 뿐이다.
- **`reproPrefillDone` 래치 자체는 건드리지 않는다.** 헬퍼는 래치를 읽지도 쓰지도 않고, 재개 가능 여부만 판정한다.
- **AI 프롬프트·프로바이더·예산 가드 무관.**

## 사용자 시나리오

이 기능은 리팩터라 새 사용자 플로우가 없다. 기존 플로우가 **그대로 유지되는지**가 시나리오다.

1. **초안 생성 중 중단** — AI 초안 실행 → 오버레이 '중단' → 로딩이 즉시 걷히고, 늦게 온 응답이 본문을 덮어쓰지 않으며, 에러 토스트가 뜨지 않는다. BYOK면 진행 중 fetch·retry 대기가 실제로 끊긴다.
2. **스타일링 중 중단** — 위와 동일. 추가로 세션이 destroy되고 다음 실행이 새 세션을 만든다.
3. **스타일링 중 다른 요소로 repick** — 옛 요소용 결과가 새 요소에 적용되지 않는다.
4. **재현 단계 자동 채움 중 게이트 왕복** — 트림 오버레이 개폐·섹션 토글로 effect가 재실행돼도 **진행 중 요청이 살아남아 결과를 이어받는다**. `reproPrefillDone`이 래치된 뒤라 재발화는 없다.
5. **재현 단계 자동 채움 중 사용자 중단** — 영구 포기. 게이트가 다시 열려도 되살아나지 않고 재발화도 없다.
6. **패널 언마운트** — 진행 중 요청의 결과가 버려지고 로딩·canceller가 해제된다.

엣지: 5번(사용자 중단)과 4번(게이트 왕복)이 **연달아** 일어나도 5번이 이긴다 — 이것이 `userCancelled` 레인이 존재하는 이유다.

## 성공 기준

- 세 콜사이트에서 `cancelled`·`userCancelled`·`AbortController`·현재-run 판정을 **직접 조작하는 코드가 사라진다**(`grep -rn "run.cancelled = \|new AbortController" src/sidepanel/tabs src/sidepanel/hooks` 결과가 헬퍼 파일 외 0건).
- 위 6개 시나리오가 전부 기존과 동일하게 동작한다.
- `pnpm test` 전체 green, `pnpm typecheck` 통과.
- 헬퍼 단위 테스트가 다음을 고정한다: `oneshot` cleanup은 abort하고 `resumable` cleanup은 abort하지 않는다 / `userCancelled`된 run은 재개되지 않는다 / stale run은 `isActive`가 false다.
- 회귀 테스트가 **`signal.aborted`를 직접 단언**한다(결과값만 보는 단언은 이 함정을 못 잡는다 — 2026-07-28).
