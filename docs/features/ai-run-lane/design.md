# AI 취소 레인 단일화 — 기술 설계

## 개요

세 콜사이트가 각자 조립하던 취소 상태를 `useAiRun` 훅 하나로 옮긴다. 훅은 run 객체를 소유하고(`cancelled`·`userCancelled`·`AbortController`), canceller를 `editor-store`의 `aiCancel` 슬롯에 등록·해제하며, "이 run이 아직 유효한가"를 단일 술어 `isActive(run)`로 답한다. 콜사이트 간 유일한 실질 차이인 **effect cleanup에서 abort해도 되는가**를 `kind`(`"oneshot"` | `"resumable"`)로 승격시켜, 판단이 콜사이트가 아니라 타입에 붙게 한다.

## 변경 범위

### 새 파일

**`src/sidepanel/hooks/useAiRun.ts`** — 취소 레인 단일 출처. run 생성·재개·가드·종료 정리와 `aiCancel` 등록/해제를 담당한다. 세션 destroy 같은 콜사이트 고유 정리는 `onDispose` 콜백으로 위임한다(헬퍼가 `AISession`을 알 필요가 없다).

**`src/sidepanel/hooks/__tests__/useAiRun.test.tsx`** — 훅 단위 테스트(jsdom·`renderHook`).

### 변경 파일

**`src/sidepanel/tabs/AiDraftDialog.tsx`** (현재: 초안 생성 다이얼로그. `activeRunRef`·canceller·언마운트 cleanup·3개 가드를 직접 보유)
→ `useAiRun({ kind: "oneshot", ... })`로 교체. `activeRunRef` 선언, `new AbortController()`, canceller 본문, 언마운트 cleanup의 run 처리, `finally`의 정리 블록이 사라진다. `sessionRef` 관리는 남되 destroy 호출이 `onDispose`로 이동.

**`src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`** (현재: 스타일링 다이얼로그. 위와 동일 골격 + `sessionKeyRef`)
→ 동일하게 교체. `onDispose`가 `sessionRef`와 `sessionKeyRef`를 함께 비운다.

**`src/sidepanel/hooks/useReproPrefill.ts`** (현재: 재현 단계 자동 채움. `runRef`·re-adopt 분기·cleanup abort 금지 주석 보유)
→ `useAiRun({ kind: "resumable", ... })`로 교체. re-adopt 분기가 `readopt()` 호출로, cleanup이 `detach(run)`으로 축약된다. `reproPrefillDone` 래치는 그대로 콜사이트에 남는다(헬퍼는 래치를 모른다).

### 변경 없음

`src/store/editor-store.ts`(`aiCancel` 슬롯·3개 loading 플래그), `src/sidepanel/App.tsx`(오버레이·'중단' 버튼), `src/sidepanel/lib/aiLoadingPhrases.ts`, `src/sidepanel/lib/ai-provider.ts`.

## 데이터 흐름

```
콜사이트                        useAiRun                      editor-store
   │                              │                                │
   │  begin()                     │                                │
   ├─────────────────────────────►│  이전 run 있으면 취소·교체       │
   │                              ├───── setAiCancel(canceller) ──►│
   │                              ├───── setLoading(true) ────────►│
   │◄──────── run ────────────────┤                                │
   │                              │                                │
   │  await createSession/prompt(run.signal)                       │
   │                              │                                │
   │  isActive(run)?              │   !cancelled && current === run │
   ├─────────────────────────────►│                                │
   │◄──────── boolean ────────────┤                                │
   │                              │                                │
   │  end(run)                    │  current === run 일 때만 정리    │
   ├─────────────────────────────►├───── setAiCancel(null) ───────►│
   │                              ├───── setLoading(false) ───────►│
```

오버레이 '중단' 클릭 시:

```
App.tsx ──► aiCancel?.() ──► 헬퍼 canceller
                                 │  run.cancelled = true
                                 │  run.userCancelled = true   ← 재개 금지 표시
                                 │  run.controller.abort()      ← fetch·retry 중단
                                 │  onDispose(run)              ← 세션 destroy
                                 └─ setLoading(false)
```

`resumable`의 게이트 왕복:

```
effect 재실행 → detach(run)     : cancelled = true      (abort 안 함 — 요청은 살아 있다)
효과 재진입   → readopt()       : userCancelled면 null
                                  아니면 cancelled = false 로 되살려 같은 run 반환
```

## 인터페이스 설계

```ts
// src/sidepanel/hooks/useAiRun.ts

// oneshot: 사용자 액션이 시작한다. effect cleanup = 이 run은 끝났다 → abort해도 안전.
// resumable: effect가 자동 발화한다. cleanup은 언마운트와 deps 변경을 구분하지 못하므로
//            abort하면 재개될 요청을 죽인다 → cleanup에서 abort하지 않는다.
export type AiRunKind = "oneshot" | "resumable";

export interface AiRun {
  /** 비자발 취소(언마운트·게이트 왕복). resumable은 되살릴 수 있다. */
  cancelled: boolean;
  /** 사용자 명시 중단. 영구 포기 — readopt가 되살리지 않는다. */
  userCancelled: boolean;
  /** BYOK fetch·retry 대기에 넘긴다. */
  readonly signal: AbortSignal;
}

export interface AiRunController {
  /** 새 run 시작. 직전 run이 있으면 취소하고 교체한다. canceller 등록 + 로딩 on. */
  begin(): AiRun;
  /** await 재개 지점의 단일 술어. !run.cancelled && 현재 run === run. */
  isActive(run: AiRun): boolean;
  /** 정상·에러 종료 정리. 현재 run일 때만 canceller 해제 + 로딩 off. */
  end(run: AiRun): void;
  /** resumable 전용. 직전 run을 되살려 반환, 되살릴 수 없으면 null. */
  readopt(): AiRun | null;
  /** effect cleanup. kind가 abort 여부를 결정한다. */
  detach(run: AiRun): void;
}

export function useAiRun(config: {
  kind: AiRunKind;
  /** setAiDraftLoading / setAiStylingLoading / setReproPrefillLoading */
  setLoading: (loading: boolean) => void;
  /** 취소·교체 시 콜사이트 고유 정리(세션 destroy 등). */
  onDispose?: (run: AiRun) => void;
}): AiRunController;
```

콜사이트 사용 형태:

```ts
// AiDraftDialog — oneshot
const aiRun = useAiRun({
  kind: "oneshot",
  setLoading: useEditorStore.getState().setAiDraftLoading,
  onDispose: () => { sessionRef.current?.destroy?.(); sessionRef.current = null; },
});

const handleSubmit = useCallback(async () => {
  const run = aiRun.begin();
  try {
    const session = await createSessionRef.current(systemPrompt, fewShot);
    if (!aiRun.isActive(run)) { session.destroy?.(); return; }
    sessionRef.current = session;
    const raw = await session.prompt(msg, { responseSchema, images, signal: run.signal });
    if (!aiRun.isActive(run)) return;
    // …결과 적용
  } catch (err) {
    if (!aiRun.isActive(run)) return;
    toastLlmError(err, t, "draft.aiError");
  } finally {
    aiRun.end(run);
  }
}, [...]);
```

```ts
// useReproPrefill — resumable
useEffect(() => {
  // …게이트들
  if (doneRef.current) {
    const prev = aiRun.readopt();
    return prev ? () => aiRun.detach(prev) : undefined;
  }
  setReproPrefillDone(true);
  doneRef.current = true;
  const run = aiRun.begin();
  void (async () => {
    try {
      const steps = await generateReproStepsWithAI({ …, signal: run.signal });
      if (!aiRun.isActive(run)) return;
      apply(steps);
    } catch (err) {
      if (aiRun.isActive(run)) toastLlmError(err, t, "draft.reproPrefillError");
    } finally {
      aiRun.end(run);
    }
  })();
  return () => aiRun.detach(run);
}, [...]);
```

## 통일되는 미세 차이

세 콜사이트를 대조해 나온 차이. **통일** 방침이므로 아래로 수렴한다(각각 동작 변경이 있는지 표기).

| 항목 | 현재 | 통일 후 | 동작 변경 |
|---|---|---|---|
| `AbortController` 위치 | Draft/Styling은 run 객체 안, repro는 밖 | run 객체 안(`run.signal`) | 없음 |
| `setAiCancel(null)` 시점 | repro는 canceller 안 + finally, 둘은 finally만 | `end()` 한 곳 | 없음(취소 시 곧 finally가 돈다) |
| `setLoading(false)` 조건 | Draft/Styling은 현재 run일 때만, repro는 무조건 | 현재 run일 때만 | repro만 해당. 래치로 run이 하나뿐이라 실질 동일하고, stale run이 새 run의 로딩을 끄는 잠재 버그가 닫힌다 |
| 재개 지점 가드 | `run.cancelled` / `run.cancelled \|\| activeRef !== run` 혼재 | `isActive(run)` 단일 | Draft/Styling의 prompt 후 가드가 현재-run 판정까지 하게 되어 **더 엄격**해진다 |
| catch 가드 방향 | `if (cancelled) return` / `if (!cancelled) toast` | `if (!isActive(run)) return` | 없음(동등) |
| cleanup abort | Draft/Styling은 abort, repro는 안 함 | `kind`가 결정 | 없음 |
| `userCancelled` | repro만 보유 | 셋 다 보유(oneshot은 readopt를 안 쓰므로 무해) | 없음 |

## 기존 패턴 준수

- **`aiCancel` 단일 슬롯**(`editor-store.ts:189`·`:505`) — 비영속, `EditorSnapshot` Pick 제외. 헬퍼가 등록·해제만 하고 슬롯 구조는 그대로.
- **소프트 취소 3짝**(2026-07-21 회고) — canceller 등록 / 결과 폐기 가드 / **catch 최상단 가드**. 세 짝이 전부 헬퍼 API로 표현되어 콜사이트가 하나를 빠뜨릴 수 없게 된다.
- **`store`는 `sidepanel/tabs`를 import하지 않는다** — 헬퍼는 `hooks/`에 두고 store를 import하는 방향만 유지(역방향 없음).
- **테스트 2트랙** — 훅이므로 `*.test.tsx`(jsdom + `renderHook`). `src/test/setup-dom.ts`가 cleanup·폴리필을 제공한다.

## 대안 검토

**(A) Draft·Styling만 통합하고 `useReproPrefill`은 제외.** 헬퍼가 모드 분기 없이 단순해진다. 그러나 회고 5건 중 3건(2026-07-16·17·28)이 `useReproPrefill`에서 났다 — 가장 많이 터진 곳을 밖에 두면 목표를 달성하지 못한다. 기각.

**(B) 코드 통합 없이 계약 테스트만 추가.** 회귀 위험이 0에 가깝다. 그러나 2026-07-21에 이미 "세 곳에 같은 가드를 손으로 맞추는" 처방을 했고 2026-07-28에 재발했다. 복제가 남는 한 네 번째 콜사이트가 생기면 같은 일이 반복된다. 기각.

**(C) `kind` 대신 `onCleanup` 콜백을 콜사이트가 주입.** 유연하지만 "cleanup에서 abort할지"를 다시 콜사이트 판단으로 되돌린다 — 이번 회귀의 원인을 그대로 남기는 설계다. 기각.

**(D) run 상태를 zustand store로 승격.** 2026-07-17이 "zustand 전이와 React state가 다른 레인이라 한 렌더가 샌다"였다. 레인을 늘리는 방향이라 기각. run은 ref로만 산다.

## 위험 요소

- **`isActive`가 Draft/Styling의 prompt 후 가드를 더 엄격하게 만든다.** 현재는 `run.cancelled`만 보므로, 사용자가 취소 없이 **새 요청을 연달아 시작**한 경우 옛 run의 결과가 적용될 수 있다(현재 run이 아닌데도 통과). 통일 후에는 차단된다. 의도한 개선이지만 동작 변경이므로 시나리오 1·2 수동 확인 대상.
- **`readopt()`가 `reproPrefillDone` 래치와 순서를 맞춰야 한다.** 콜사이트가 래치를 먼저 세우고 `begin()`을 부르는 현재 순서(`setReproPrefillDone(true)` → `doneRef.current = true` → run 생성)를 그대로 유지해야 한다. 순서가 바뀌면 2026-07-16/17이 재발한다.
- **테스트 mock이 signal을 무시하면 방어가 inert해진다**(2026-07-28). 헬퍼 테스트는 `run.signal.aborted`를 직접 단언하고, 콜사이트 테스트의 `generateReproStepsWithAI`·`createSession` mock은 넘겨받은 signal을 보관해 단언 가능하게 만든다.
- **`onDispose` 호출 시점**이 현재 canceller 본문의 세션 destroy와 같아야 한다. Styling은 `sessionKeyRef`까지 비워야 다음 실행이 새 system prompt를 만든다 — 빠뜨리면 repick 후 stale 프롬프트로 요청이 나간다.
- **e2e 커버리지 없음.** `e2e/`에 AI 취소 spec이 없다(`ai-draft`·`ai-styling`·`ai-local-provider` 등 5개 모두 취소 경로 미포함). 이번 변경의 안전망은 jsdom 테스트와 수동 확인이다.
