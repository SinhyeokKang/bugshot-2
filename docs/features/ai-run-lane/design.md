# AI 취소 레인 단일화 — 기술 설계

## 개요

세 콜사이트가 각자 조립하던 취소 상태를 `useAiRun` 훅 하나로 옮긴다. 훅은 run 객체를 소유하고(`cancelled`·`userCancelled`·`AbortController`), canceller를 `editor-store`의 `aiCancel` 슬롯에 등록·해제하며, "이 run이 아직 유효한가"를 단일 술어 `isActive(run)`로 답한다. 콜사이트 간 유일한 실질 차이인 **effect cleanup에서 abort해도 되는가**를 `kind`(`"oneshot"` | `"resumable"`)로 승격시켜, 판단이 콜사이트가 아니라 타입에 붙게 한다.

## 변경 범위

### 새 파일

**`src/sidepanel/hooks/useAiRun.ts`** — 취소 레인 단일 출처. run 생성·재개·가드·종료 정리와 `aiCancel` 등록/해제, **oneshot의 언마운트 정리**를 담당한다. 세션 destroy 같은 콜사이트 고유 정리는 `onDispose` 콜백으로 위임한다(헬퍼가 `AISession`을 알 필요가 없다).

**`src/sidepanel/lib/aiCancelSlot.ts`** — `getAiCancel` 라이브 리더 한 줄. 규약 5의 슬롯 소유권 판정에는 슬롯을 **읽어야** 하는데, 헬퍼가 store를 알면 안 되므로 콜사이트가 주입한다. 세 콜사이트가 같은 한 줄을 복제하지 않도록 여기 단일화한다.

**`src/sidepanel/hooks/__tests__/useAiRun.test.tsx`** — 훅 단위 테스트(jsdom·`renderHook`).

### 변경 파일

**`src/sidepanel/tabs/AiDraftDialog.tsx`** (현재: 초안 생성 다이얼로그. `activeRunRef`·canceller·언마운트 cleanup·3개 가드를 직접 보유)
→ `useAiRun({ kind: "oneshot", ... })`로 교체. `activeRunRef` 선언, `new AbortController()`, canceller 본문, 언마운트 cleanup의 **run 처리**, `finally`의 정리 블록이 사라진다. `sessionRef` 관리는 남되 destroy 호출이 `onDispose`로 이동. **catch의 세션 정리와 provider 교체용 cleanup은 콜사이트에 잔류**(아래 참조).

**`src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`** (현재: 스타일링 다이얼로그. 위와 동일 골격 + `sessionKeyRef`)
→ 동일하게 교체. `onDispose`가 `sessionRef`와 `sessionKeyRef`를 함께 비운다. **세션 재사용(`sessionKeyRef` 일치 시 멀티턴)과 repick 가드(`:209-216`)는 취소 레인이 아니므로 그대로 잔류.**

**`src/sidepanel/hooks/useReproPrefill.ts`** (현재: 재현 단계 자동 채움. `runRef`·re-adopt 분기·cleanup abort 금지 주석 보유)
→ `useAiRun({ kind: "resumable", ... })`로 교체. re-adopt 분기가 `readopt()` 호출로, cleanup이 `detach(run)`으로 축약된다. `reproPrefillDone` 래치는 그대로 콜사이트에 남는다(헬퍼는 래치를 모른다). `setLoading`·`setAiCancel`을 인자로 받는 **기존 DI 시그니처(`UseReproPrefillArgs`)는 유지**하고, 규약 5용 `getAiCancel`을 **필수 필드로 하나 추가**해(주입처 `DraftingPanel`) 셋 다 `useAiRun` config에 흘려보낸다.

### 콜사이트에 잔류하는 것 (헬퍼가 가져가지 않는다)

세 가지를 명시적으로 남긴다 — 옮기면 회귀한다.

1. **catch 경로의 세션 정리.** 현재 두 다이얼로그의 catch는 토스트 뒤에 세션을 destroy하고 Styling은 `sessionKeyRef`까지 비운다(`AiDraftDialog.tsx:316-321`, `AiStylingDialog.tsx:265-271`). 이건 취소가 아니라 **에러** 경로라 `onDispose`도 `end()`도 커버하지 않는다. 빠뜨리면 `AiContextOverflowError`·auth 에러 후 **망가진 세션과 stale `sessionKeyRef`가 영구 재사용**된다(`sessionKeyRef`가 살아 있어 재생성 분기도 통과 못 한다).
2. **provider 교체용 cleanup.** 두 다이얼로그의 cleanup effect deps는 `[]`가 아니라 `[createSession]`이라 provider 설정 변경 시에도 발화한다. 이 effect는 **두 가지**를 한다 — `aiRun.disposeCurrent()`(run 정리)와, **run 유무와 무관한 세션 destroy**(`sessionRef`가 run보다 오래 살아 `onDispose`로 접을 수 없다). 헬퍼의 언마운트 effect는 deps가 안정 참조라 provider 교체에서 발화하지 않으므로, 이 한 줄이 없으면 **세션은 죽고 run은 살아남아** 로딩·슬롯이 요청 settle까지 방치된다.
3. **repick 소유권 가드.** `AiStylingDialog.tsx:209-216`의 selection identity 체크는 취소 레인과 별개 메커니즘이다. `lastSentStylesRef`·`lastSentClassesRef`·`conversationCharsRef`도 마찬가지.

### 변경 없음

`src/store/editor-store.ts`(`aiCancel` 슬롯·3개 loading 플래그), `src/sidepanel/App.tsx`(오버레이·'중단' 버튼), `src/sidepanel/lib/aiLoadingPhrases.ts`, `src/sidepanel/lib/ai-provider.ts`.

## 데이터 흐름

```
콜사이트                        useAiRun                      editor-store
   │                              │                                │
   │  begin()                     │                                │
   ├─────────────────────────────►│  미종료 직전 run만 취소·교체      │
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
   ├─────────────────────────────►├─ setAiCancel(null) ※자기 것일 때만
   │                              ├───── setLoading(false) ───────►│
   │                              └─ current = null                │
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

`resumable`의 게이트 왕복 (**store 무접촉**이 핵심):

```
effect 재실행 → detach(run)     : cancelled = true      (abort 안 함 — 요청은 살아 있다)
                                  store 안 건드림       (중단 버튼·스피너 유지)
                                  current 포인터 유지   (뒤늦은 end()가 로딩을 끌 수 있어야)
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

/** 콜사이트에는 signal만 노출한다 — cancelled·userCancelled는 헬퍼 내부 전용. */
export interface AiRun {
  /** BYOK fetch·retry 대기에 넘긴다. */
  readonly signal: AbortSignal;
}

export interface AiRunController {
  /** 새 run 시작. **아직 종료되지 않은** 직전 run이 있으면 취소·onDispose 후 교체한다. canceller 등록 + 로딩 on. */
  begin(): AiRun;
  /** await 재개 지점의 단일 술어. !cancelled && 현재 run === run. */
  isActive(run: AiRun): boolean;
  /** 정상·에러 종료 정리. 현재 run일 때만 로딩 off + 슬롯 해제 + current를 비운다. */
  end(run: AiRun): void;
  /** resumable 전용. 직전 run을 되살려 반환, 되살릴 수 없으면 null. */
  readopt(): AiRun | null;
  /** effect cleanup. cancelled만 세우고 store는 건드리지 않는다. kind가 abort 여부를 결정한다. */
  detach(run: AiRun): void;
  /**
   * run 핸들 없이 정리해야 하는 자리용. oneshot은 abort + onDispose + 슬롯 해제 +
   * 로딩 off까지 하고, resumable은 no-op다(콜사이트 detach가 담당).
   * 헬퍼의 언마운트 effect와 콜사이트의 provider 교체 cleanup이 **같은 함수를 공유**한다.
   */
  disposeCurrent(): void;
}

export function useAiRun(config: {
  kind: AiRunKind;
  /** setAiDraftLoading / setAiStylingLoading / setReproPrefillLoading */
  setLoading: (loading: boolean) => void;
  /** editor-store의 aiCancel 슬롯 setter. 주입받는다(store 직접 접근 아님). */
  setAiCancel: (fn: (() => void) | null) => void;
  /** 슬롯 라이브 리더. 규약 5의 소유권 비교에 필수 — setter만으로는 판정할 수 없다. */
  getAiCancel: () => (() => void) | null;
  /** 취소·교체 시 콜사이트 고유 정리(세션 destroy 등). **run당 최대 1회** 보장. */
  onDispose?: (run: AiRun) => void;
}): AiRunController;
```

### 규약 (구현이 지켜야 하는 것)

이 7개가 이번 설계의 실질이다. 어긋나면 아래 각 항에 적힌 회귀가 난다.

1. **`end(run)`은 current 포인터를 `null`로 비운다.** 안 비우면 다음 `begin()`이 정상 종료한 run을 "직전 run"으로 보고 `onDispose`를 불러, **`AiStylingDialog`의 멀티턴 세션이 두 번째 제출부터 매번 파괴**된다(에러 없이 "AI가 직전 지시를 잊는" 품질 저하로만 나타난다).
2. **`begin()`의 `onDispose`는 미종료 run에만.** 위 1의 뒷면이다. 정상 종료 뒤의 `begin()`은 `onDispose`를 부르지 않는다 — **세션 재사용이 이에 의존한다.**
3. **`begin()`의 교체 경로는 `userCancelled`를 세우지 않는다.** 사용자가 누른 적 없는 run에 그 플래그가 서면 이름과 의미가 어긋나 이후 디버깅에서 오독을 낳는다(회고 5건이 전부 "이름과 실제가 어긋난 자리"에서 났다).
4. **`detach(run)`은 store를 절대 건드리지 않고 current 포인터도 유지한다.** store를 건드리면 게이트 왕복 한 번에 `setAiCancel(null)`+`setLoading(false)`가 나가 **in-flight 요청은 살아 있는데 중단 수단이 사라지고 오버레이가 걷힌다**(시나리오 4·5 동시 파괴). 반대로 current를 비우면 그 run의 `end()`가 no-op이 되어 **스피너가 영구 고착**된다 — 게이트 OFF 후 `begin()`이 다시 안 불리는 경로에서 `end()`가 유일한 로딩 해제자이기 때문이다(기존 테스트 `useReproPrefill.test.tsx:582`가 이를 고정 중).
5. **`end()`의 슬롯 해제는 "자기가 등록한 canceller일 때만".** 등록한 함수 참조와 현재 슬롯 값을 비교한다. `current === run` 가드만으로는 부족하다 — 뒤늦게 settle한 run이 다른 surface가 방금 등록한 canceller를 덮는 crossover가 실재한다(PRD 목표 5).
6. **`onDispose`는 run당 최대 1회 불린다.** canceller가 current를 비우지 않으므로, 중단된 run이 settle하기 전에 재제출하면 `begin()`의 교체 경로가 같은 run을 또 dispose하려 든다. 현재 두 콜사이트의 `onDispose`는 멱등이라 오늘은 무해하지만, 세션 카운터·analytics 같은 **비멱등 정리를 붙이는 네 번째 콜사이트에서 터질 계약 구멍**이라 `disposed` 플래그로 닫는다.
7. **컨트롤러 객체와 6개 메서드는 마운트 동안 참조가 안정적이다**(`useMemo`/`useRef`). `useReproPrefill`의 effect deps 배열에 들어가므로, 매 렌더 새 객체면 **재실행→cleanup→readopt 루프**가 된다 — 정확히 2026-07-16/17 지형이다. 저장소의 다른 훅들은 반환 객체를 안정화하지 않으므로 이건 관례가 아니라 **이 훅의 명시 규약**이다.

### `readopt()`의 유효 범위

`readopt()`는 **같은 훅 인스턴스 안에서만** 유효하다. run을 훅 내부 `useRef`로 보유하므로 진짜 언마운트-재마운트 시 ref가 비고 `readopt()`는 `null`을 반환한다 — 이때 `reproPrefillDone`은 store 영속이라 `true`로 남아 그 세션 동안 prefill은 재발화하지 않는다. **이건 현행 `useReproPrefill`과 동일한 동작이며 의도된 것이다.** re-adopt가 실제로 작동하는 범위는 동일 인스턴스의 게이트 왕복과 StrictMode 이중 effect뿐이다. 이 문장이 없으면 구현자가 "개선"이라며 run을 module scope나 store로 올릴 유인이 생긴다 — 대안 (D) 기각 사유 위반이다.

### 언마운트 · provider 교체 처리

둘은 **같은 함수(`disposeCurrent`)를 공유**한다 — 둘 다 "이 run은 끝났고 뒤늦은 `end()`가 정리하러 오지 않을 수도 있다"는 자리다.

- `oneshot`: 진행 중 run이 있으면 abort + `onDispose` + 슬롯 해제 + `setLoading(false)`.
- `resumable`: 무동작. 콜사이트 effect의 `detach`가 이미 처리하고, 여기서 abort하면 2026-07-28이 재발한다.

호출자는 둘이다 — 헬퍼 **내부**의 언마운트 effect, 그리고 **콜사이트**의 `[createSession]` cleanup(provider 교체). 후자를 콜사이트가 불러야 하는 이유는 헬퍼의 언마운트 effect가 안정 참조 deps라 provider 교체에서 발화하지 않기 때문이다.

`oneshot`의 로딩 해제를 `finally`가 대신할 수 없다는 점이 중요하다 — cleanup이 current를 비운 뒤라 `finally`의 `end(run)`이 가드에 걸려 스킵된다. 이 경로가 빠지면 "초안 실행 중 패널 닫기 → 재오픈 시 스피너 고착"이 재발한다.

## 콜사이트 사용 형태

```ts
// AiDraftDialog — oneshot
const aiRun = useAiRun({
  kind: "oneshot",
  setLoading: useEditorStore.getState().setAiDraftLoading,
  setAiCancel: useEditorStore.getState().setAiCancel,
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
    sessionRef.current?.destroy?.();   // ← 에러 경로의 세션 정리는 잔류(Styling은 sessionKeyRef까지)
    sessionRef.current = null;
  } finally {
    aiRun.end(run);
  }
}, [...]);

// provider 교체·언마운트 — run 정리는 disposeCurrent가, run과 무관한 세션 정리는 여기가.
useEffect(() => () => {
  aiRun.disposeCurrent();
  sessionRef.current?.destroy?.();
  sessionRef.current = null;
}, [createSession, aiRun]);
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
| `setAiCancel(null)` 시점 | repro는 canceller 안 + finally, 둘은 finally만 | `end()` 한 곳 | 없음 |
| `setAiCancel(null)` **가드** | 자기 `runRef` 비교 (슬롯 정체성 아님) | **등록한 canceller 참조 비교** | **있음 — crossover 버그 수정**. 뒤늦게 settle한 run이 다른 surface의 중단 버튼을 무음으로 죽이던 경로가 닫힌다(PRD 목표 5) |
| cleanup의 store 정리 | **Draft/Styling은 `setLoading(false)`+`setAiCancel(null)` 수행, repro는 미수행** | `detach`는 store 무접촉. oneshot의 store 정리는 `disposeCurrent`가 담당(언마운트 + provider 교체 양쪽) | 없음(경로만 이동) |
| cleanup effect deps | Draft/Styling `[createSession]`(provider 교체 시에도 발화), repro는 별도 cleanup effect 없음 | 콜사이트 effect가 `disposeCurrent()` + 세션 destroy를 하고 deps는 그대로 | 없음 |
| run 없는 세션 destroy | Draft/Styling cleanup은 `if (run)` **밖**에서 세션 destroy | 콜사이트 effect에 잔류 | 없음 |
| `setLoading(false)` 조건 | Draft/Styling은 현재 run일 때만, repro는 무조건 | 현재 run일 때만 | repro만 해당. 래치로 run이 하나뿐이라 실질 동일하고, stale run이 새 run의 로딩을 끄는 잠재 버그가 닫힌다. **단 규약 4(detach가 current 유지)를 지켜야 등가다** |
| 재개 지점 가드 | `run.cancelled` / `run.cancelled \|\| activeRef !== run` 혼재 | `isActive(run)` 단일 | **있음** — Draft/Styling의 prompt 후 가드가 현재-run 판정까지 하게 되어 더 엄격해진다(시나리오 7) |
| 2차 재개 가드 | repro의 `apply()` 내부에 `run.cancelled \|\| !current` 별도 존재 | `isActive(run)` 단일 | 없음(동등) |
| catch 가드 방향 | `if (cancelled) return` / `if (!cancelled) toast` | `if (!isActive(run)) return` | **있음** — 취소 없이 superseded된 stale run이 실패하면 지금은 에러 토스트가 뜨고, 통일 후엔 억제된다. 위 재개 지점 엄격화와 같은 사유의 사용자 가시 변화다 |
| cleanup abort | Draft/Styling은 abort, repro는 안 함 | `kind`가 결정 | 없음 |
| `userCancelled` | repro만 보유 | 헬퍼 내부에 셋 다 보유(oneshot은 readopt를 안 쓰므로 무해) | 없음 |
| repick 소유권 가드 | Styling만 보유(`:209-216`) | **잔류**(취소 레인 아님) | 없음. 단 `:205-207`의 delta 기준선 갱신이 취소 가드와 repick 가드 사이에 있어, `isActive` 엄격화로 통과 조건이 바뀌면 기준선 이동 타이밍이 달라진다(개선 방향) |

## 기존 패턴 준수

- **`aiCancel` 단일 슬롯**(`editor-store.ts:189`·`:505`) — 비영속, `EditorSnapshot` Pick 제외. 헬퍼가 등록·해제만 하고 슬롯 구조는 그대로.
- **setter 주입(DI)** — `useReproPrefill`은 store를 import하지 않고 `setLoading`·`setAiCancel`을 인자로 받는다(`useReproPrefill.ts:30-32`, 주입처 `DraftingPanel.tsx:151`). 기존 테스트가 바로 그 주입으로 canceller를 낚아채므로(`useReproPrefill.test.tsx:320`·`:353`), `useAiRun`도 **셋 다 config로 받는다**(`setLoading`·`setAiCancel`·`getAiCancel`). store 직접 접근으로 가면 무관한 테스트 재작성이 딸려온다.
- **소프트 취소 3짝**(2026-07-21 회고) — canceller 등록 / 결과 폐기 가드 / **catch 최상단 가드**. 세 짝이 전부 헬퍼 API로 표현되어 콜사이트가 하나를 빠뜨릴 수 없게 된다.
- **`store`는 `sidepanel/tabs`를 import하지 않는다** — 헬퍼는 `hooks/`에 두고 store를 import하는 방향만 유지(역방향 없음).
- **테스트 2트랙** — 훅이므로 `*.test.tsx`(jsdom + `renderHook`). `src/test/setup-dom.ts`가 cleanup·폴리필을 제공한다.

## 대안 검토

**(A) Draft·Styling만 통합하고 `useReproPrefill`은 제외.** 헬퍼가 모드 분기 없이 단순해진다. 그러나 회고 5건 중 3건(2026-07-16·17·28)이 `useReproPrefill`에서 났다 — 가장 많이 터진 곳을 밖에 두면 목표를 달성하지 못한다. 기각.

**(B) 코드 통합 없이 계약 테스트만 추가.** 회귀 위험이 0에 가깝다. 그러나 2026-07-21에 이미 "세 곳에 같은 가드를 손으로 맞추는" 처방을 했고 2026-07-28에 재발했다. 복제가 남는 한 네 번째 콜사이트가 생기면 같은 일이 반복된다. 기각. (참고: `IssueTab.tsx:122-155`에 구조적으로 동일한 레인이 **이미** 있다 — AI가 아니라 이번 스코프 밖으로 뒀지만, 복제가 자생한다는 증거다.)

**(C) `kind` 대신 `onCleanup` 콜백을 콜사이트가 주입.** 유연하지만 "cleanup에서 abort할지"를 다시 콜사이트 판단으로 되돌린다 — 이번 회귀의 원인을 그대로 남기는 설계다. 기각.

**(D) run 상태를 zustand store로 승격.** 2026-07-17이 "zustand 전이와 React state가 다른 레인이라 한 렌더가 샌다"였다. 레인을 늘리는 방향이라 기각. run은 ref로만 산다.

**(E) 훅이 아닌 순수 팩토리(`createAiRunLane`).** 헬퍼의 상태는 ref 하나뿐이고 React API가 필요한 곳이 없다 — 팩토리면 컨트롤러 identity 안정성 문제(규약 7)가 소멸하고, `renderHook` 없이 node 트랙 `*.test.ts`로 테스트되며, 기존 setter 주입 패턴과 결이 같다. 그러나 **언마운트 정리를 콜사이트가 1줄씩 붙여야 한다** — "cleanup에서 뭘 할지"가 다시 콜사이트 판단이 되므로 대안 (C)와 같은 실수다. `oneshot` 언마운트 로직을 헬퍼 안에 가두는 것이 이번 목표 3의 실질이라 기각. identity는 규약 7(참조 안정)로 명시해 해결한다. *(단서: 구현 결과 provider 교체 때문에 콜사이트가 `disposeCurrent()` 1줄을 붙이게 됐다 — 이 기각 근거의 전제가 부분적으로 약해졌다. 다만 **무엇을 할지는 여전히 `kind`가 결정**하고 헬퍼의 언마운트 effect가 안전망으로 남아, "cleanup 판단이 콜사이트로 되돌아간다"는 핵심 우려는 성립하지 않는다.)*

## 위험 요소

- **`isActive`가 Draft/Styling의 재개 지점·catch 가드를 더 엄격하게 만든다.** 현재는 `run.cancelled`만 보므로, 사용자가 취소 없이 **새 요청을 연달아 시작**한 경우 옛 run의 결과와 에러 토스트가 통과할 수 있다. 통일 후에는 둘 다 차단된다. 의도한 개선이지만 동작 변경이므로 시나리오 7 수동 확인 대상 — 재현 조건이 좁으니 `tasks.md`의 조건을 그대로 따를 것.
- **`begin()`의 세션 파괴 위험.** 규약 1·2를 어기면 `AiStylingDialog`의 멀티턴 대화가 매 요청 소실된다. 에러도 토스트도 없이 품질만 떨어져 **수동 테스트로도 놓치기 쉽다** — Task 1의 헬퍼 테스트가 유일한 기계적 그물이다.
- **`aiStylingLoading`의 다른 소비자.** `StyleCssView.tsx`가 이 플래그의 **true→false 하강 에지**를 읽어 "AI 턴 종료"로 해석하고, 포커스 중이어도 CodeMirror doc을 강행 재동기화한다(2026-07-08 픽스의 본체). 따라서 **`begin()`의 교체 경로가 `setLoading(false)→(true)` 토글을 만들면 안 된다** — 이미 `true`면 그대로 둔다. 토글이 새면 포커스 중 CSS 에디터 doc이 덮어써져 2026-07-08이 재발한다. 더해 `editor-store`의 4곳(`onElementSelected` 2곳·`confirmStyles`·`backToStyling`)이 취소 없이 이 플래그를 내리므로, 헬퍼가 "로딩을 소유한다"는 모델은 **헬퍼가 켠 것만** 소유한다는 뜻으로 읽어야 한다.
- **`readopt()`가 `reproPrefillDone` 래치와 순서를 맞춰야 한다.** 콜사이트가 래치를 먼저 세우고 `begin()`을 부르는 현재 순서(`setReproPrefillDone(true)` → `doneRef.current = true` → run 생성)를 그대로 유지해야 한다. 순서가 바뀌면 2026-07-16/17이 재발한다.
- **테스트 mock이 signal을 무시하면 방어가 inert해진다**(2026-07-28). 헬퍼 테스트는 `run.signal.aborted`를 직접 단언하고, 콜사이트 테스트의 mock은 넘겨받은 signal을 보관해 단언 가능하게 만든다. 주의: `createSession(systemPrompt, fewShot?)`에는 **signal 인자가 없다** — signal은 `AISession.prompt`의 `options.signal`로만 흐르므로 `prompt` mock이 그것을 보관해야 한다. `useReproPrefill`은 `generateReproStepsWithAI({ signal })`.
- **`onDispose` 호출 시점**이 현재 canceller 본문의 세션 destroy와 같아야 한다. Styling은 `sessionKeyRef`까지 비워야 다음 실행이 새 system prompt를 만든다 — 빠뜨리면 repick 후 stale 프롬프트로 요청이 나간다.
- **Chrome 내장 AI는 abort를 무시한다.** `wrapChromeSession.prompt`는 호출 직전 `signal?.throwIfAborted()` 1회만 하고 native `prompt()`에 signal을 넘기지 않는다 — 진행 중 추론은 안 끊기고 결과 폐기로만 동작한다. 취소 후 수 초 뒤 settle하는 이 지연이 crossover 버그(PRD 목표 5)의 실제 도달 경로다.
- **e2e 커버리지 없음.** `e2e/`에 AI 취소 spec이 없다(`ai-draft`·`ai-styling`·`ai-local-provider` 등 5개 모두 취소 경로 미포함). 두 다이얼로그는 단위 테스트도 0건이라, 이번 변경의 안전망은 신설할 jsdom 테스트(Task 1·6)와 수동 확인이다.
