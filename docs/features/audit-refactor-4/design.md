# audit-refactor-4 — 기술 설계

## 개요

세 종류의 수정이 섞여 있다. ① **판정 재료를 영속화해 두 경로를 한 함수로 합치는 것**(항목 12) — `IssueRecord`에 비파괴 optional 필드 하나를 더하고, 제출 직전 `environment` 게이트를 `apiHostRow.ts`의 순수 함수로 승격해 라이브(`buildEditorCapture`)와 draft 재제출(`DraftDetailDialog`)이 같은 초크포인트를 통과하게 한다. ② **실패 정책 전환**(항목 13) — 마이그레이션의 이미지 이관을 "일시 실패는 전파해 전체 abort / 영구 실패(못 읽는 dataURL)는 그 슬롯만 포기"로 나눈다. ③ **누락 훅·상수화·문서/주석 정합**(14·17·18·71·73~76) — 서로 독립이고 병렬 가능하다.

전 항목이 **기존 파일 안에서 끝난다. 새 파일 0개**이며, 기존 순수 함수 모듈(`apiHostRow.ts`·`inline-ref.ts`·`session-keys.ts`)에 export를 더하는 형태다.

## 변경 범위

### 항목 12 — draft 재제출의 API Hosts strip (배치의 무게중심)

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/store/issues-store.ts` | `IssueRecord` 정의(`:180-253`) | `apiHostsDerived?: string \| null` optional 필드 추가. **버전 bump 없음**(아래 마이그레이션 계획) |
| `src/store/editor-store.ts` | `confirmDraft`가 4개 캡처 모드 분기로 `saveDraft` 호출(`:867-1050`) | 4개 분기 전부에 `apiHostsDerived: state.apiHostsDerived`를 **명시 기입** |
| `src/sidepanel/lib/apiHostRow.ts` | 파생·게이트·strip·sync 순수 함수 모음 | `environmentForSubmit()` 신설 — "로그 게이트 통과면 원본, 아니면 strip"을 한 곳에 담는다 |
| `src/sidepanel/lib/buildEditorCapture.ts` | 라이브 제출 ctx 조립. `:55-59`에 게이트가 인라인 | 인라인 삼항을 `environmentForSubmit()` 호출로 교체(**동작 불변**) |
| `src/sidepanel/tabs/DraftDetailDialog.tsx` | 저장 draft 재제출 ctx 조립(`buildCtxForSubmit`, `:307-401`) | `:352`의 `environment: issue.draft.environment ?? []`를 `environmentForSubmit()` 호출로 교체 |

**왜 게이트를 컴포넌트가 아니라 lib에 두는가**: `apiHostRow.ts:61-62`가 이미 같은 이유를 적어뒀다 — `DraftingPanel`에 테스트 파일이 없어 모드 누출이 green으로 통과한다. `DraftDetailDialog`도 마찬가지로 테스트 파일이 없다(`src/sidepanel/tabs/__tests__/`에 없음). 판정이 JSX 옆에 인라인으로 남으면 이 배치가 고치는 결함이 **다른 형태로 재발해도 아무 그물도 안 울린다**.

**모드 인자로 무엇을 넘기는가**: `issue.captureMode`(원본)를 넘긴다. `buildCtxForSubmit`은 legacy no-diff draft를 `ctx.captureMode: "screenshot"`으로 **강제 변환**하는데(`:337`), 그 값을 게이트에 넣으면 element 초안이 "로그 지원 모드"로 뒤집힌다. 같은 함수의 로그 blob 로드 게이트 3개(`:313`·`:317`·`:321`)도 전부 `issue.captureMode`를 쓰므로 그 규율을 따른다.

### 항목 13 — v<2 이미지 마이그레이션 fail-closed

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/store/issues-store.ts` | `migrateIssuesState`의 v<2 블록(`:286-308`)이 `saveImageBlobRaw` 실패를 `catch {}`로 삼킴 | 슬롯 이관을 `migrateSnapshotImage()` 헬퍼로 추출·export하고, **IDB 실패는 전파 / dataURL 파싱 실패는 그 슬롯만 포기**로 분리 |

기존 `try { await saveImageBlobRaw(...) } catch {}`는 두 종류의 실패를 한 덩어리로 삼킨다. `dataUrlToBlob`(`src/store/blob-db.ts:728-736`)은 정규식 불일치 시 `Invalid data URL`을, base64가 깨졌으면 `atob`이 `InvalidCharacterError`를 던진다 — **재시도해도 영원히 같은 결과**다. 반면 `saveImageBlobRaw`(`:151-160`)의 reject는 IDB quota·IO·차단 같은 **일시 상태**다. 둘을 같이 전파하면 못 읽는 dataURL 하나가 사용자의 이슈 목록을 영구히 빈 화면으로 만든다(그 기동에서 재시도 → 같은 지점에서 또 실패 → 무한). 그래서 경계를 `dataUrlToBlob` 호출에 긋는다.

### 항목 14 — 복원 세션의 시트 교체 훅 재등록

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/content/picker.ts` | `handleSelectByPath`(`:1214-1238`)가 overlay 부재 시 재생성 + `startCssCacheObserver()` + `ensureCssCacheLoaded()` | 같은 `if (!overlay)` 블록에 `setOnCacheReloaded(scheduleInspectorRefresh)` 추가 |

블록 **안**에 두는 이유: overlay가 살아 있으면 `handleStart`(`:608`)의 등록이 아직 유효하다. 밖에 두면 무해하지만(멱등 대입) 조건이 뜻하는 바 — "`handleClear`가 훑고 지나간 뒤인가"(`:656`이 null화) — 를 흐린다.

### 항목 17 — 문서 stale (코드 변경 0)

| 파일 | 변경 |
|---|---|
| `docs/ARCHITECTURE.md:576` | `settings-ui-store` v9 → **v10**, `v10은 aiLanguage 추가` 서술 편입 |
| `docs/DIRECTORY.md:96` | `settings-ui v9:` → **v10**, 필드 목록에 `aiLanguage` 추가 |

코드(`src/store/settings-ui-store.ts:250` `version: 10`, `:249` 주석)는 이미 정확하다. `migrateSettingsUi`(`:135-157`)는 버전 비교 없는 nullish 정규화 + `merge`(`:254-262`) 재정규화라 멱등이므로 **코드는 손대지 않는다**.

### 항목 18 — persist 키 상수화

| 파일 | 현재 | 변경 |
|---|---|---|
| `src/lib/session-keys.ts` | `ISSUES_PERSIST_KEY`(`:21`) 보유, import 0개 leaf | `APP_SETTINGS_PERSIST_KEY = "bugshot-app-settings"` 추가 |
| `src/store/settings-ui-store.ts:248` | `name: "bugshot-app-settings"` | `name: APP_SETTINGS_PERSIST_KEY` |
| `src/i18n/bg-init.ts:14,15,20,21` | 리터럴 4벌 | 상수 참조 4곳 |

**위치 근거**: `src/lib/session-keys.ts`는 **import가 하나도 없는 leaf**이고, background(`src/background/index.ts:3`·`src/background/tab-bindings.ts:1`)·store·content·sidepanel이 이미 전부 쓰는 검증된 위치다. `ISSUES_PERSIST_KEY`가 **정확히 같은 이유**(blob-db GC가 봉투를 직독)로 거기 있으므로 형제 상수를 나란히 두면 규율이 한 줄로 읽힌다. `src/lib/settings-storage.ts`는 후보에서 뺐다 — 그 파일은 **다른 store의 다른 키**(`bugshot-settings`, 인증 봉투)를 다루고 8개 플랫폼 auth 타입을 import한다. 이름이 하나 글자 차이(`SETTINGS_STORAGE_KEY` ↔ 새 상수)로 한 파일에 공존하면 그 자체가 사고 지점이다. `src/i18n/bg-init.ts`가 sidepanel 그래프를 끌어오면 안 된다는 제약(CLAUDE.md의 store→tabs 금지와 같은 계열)도 leaf 선택으로 자동 충족된다.

### 항목 71·73~76

| 항목 | 파일 | 변경 |
|---|---|---|
| 71 | `src/store/settings-store.ts:315-324` | `PLATFORM_FALLBACK_ORDER`를 `satisfies Record<PlatformId, number>` 랭크 맵에서 파생 — 플랫폼 누락 시 컴파일 에러 |
| 73 | `docs/ARCHITECTURE.md:64` | "삭제가 성공한 뒤에만 기록한다" → 실제 계약(참조 수집 실패 시 prune 전체 skip + 플래그 미기록 / 개별 delete 실패는 삼킨다)으로 정정. **코드 변경 0** |
| 74 | `src/lib/inline-ref.ts` (+3 호출부) | `inlineRefUrl`·`inlineRefMarkdown` 생성기 추가, `editor-store.ts:557`·`TiptapEditor.tsx:526`·`submitToAsana.ts:223`이 사용 |
| 75 | `src/content/css-resolve.ts:1905` | 주석의 `memo 조회 1회로 끝난다` 삭제 — memo는 코드에도 문서에도 없다 |
| 76 | `src/content/dom-describe.ts:105` | `isRenderable`이 `ANNOTATION_HOST_ID`도 제외 |

항목 76의 import 안전성: `dom-describe.ts`는 `src/content/picker.ts:36`에서만 import되고, 그 picker 엔트리는 이미 `./annotation`을 import한다(`picker.ts:76`). 같은 청크 안이라 새 그래프 유입이 없다 — `src/content/scroll-capture.ts:1,141`이 같은 형태의 선례다. (MAIN world라 import가 불가능한 `action-recorder.ts:26-29`만 리터럴 복제를 유지한다.)

## 데이터 흐름

### 항목 12 — `apiHostsDerived`의 생애

```
[라이브 세션]
  DraftingPanel effect (:615-643)
    syncApiHostsRow → draft.environment에 {source:"api-hosts"} 행 주입
                    → editor-store.apiHostsDerived = 그때의 파생 문자열
    (세션 영속: useEditorSessionSync :88-89 + EditorSnapshot Pick :335-336)

  ┌── 즉시 제출 ────────────────────────────────────────────────┐
  │ buildEditorMarkdownContext()                                │
  │   environmentForSubmit({captureMode, logsAttach,            │
  │                         rows: draft.environment,            │
  │                         lastDerived: s.apiHostsDerived})    │
  └─────────────────────────────────────────────────────────────┘

  └── 초안 저장 ────────────────────────────────────────────────┐
      confirmDraft() → saveDraft({... draft, apiHostsDerived})  │  ← 신설 경로
        IssueRecord (chrome.storage.local, failClosedLocalStorage)
                                                                │
[나중에 재오픈]                                                  │
      DraftDetailDialog.buildCtxForSubmit()                     │
        environmentForSubmit({captureMode: issue.captureMode,   │
                              logsAttach: issue.logsAttached !== false,
                              rows: issue.draft.environment,
                              lastDerived: issue.apiHostsDerived ?? null})
      → 8개 빌더 · logs.html Report 탭
```

`logsAttached` 토글(`DraftDetailDialog.tsx:924`·`:1001`)은 `patchIssue`로 레코드만 바꾸고 `draft.environment`는 건드리지 않는다 — **행은 계속 저장돼 있고 제출 시점에만 걸러진다**. 이 가역성이 설계의 전제다(off→on으로 되돌리면 행이 다시 실린다). 라이브 규율과 같다: `logsAttach` off로 행이 사라질 땐 `apiHostsDismissed` 래치를 세우지 않는다(`apiHostRow.ts:105`, ARCHITECTURE.md:554).

### 항목 13 — 실패 시 저장소 상태

zustand persist(`node_modules/zustand/esm/middleware.mjs:376-436`)의 실측 동작:

- **migrate 성공** → `set(merged, true)` → `setItem()`으로 `{state, version: 5}` 기록. 구 dataURL 폐기.
- **migrate reject** → `set()`·`setItem()` **둘 다 미실행** → **저장소의 구버전 봉투가 그대로 남는다**. `.catch`가 `postRehydrationCallback(undefined, e)`를 호출 → `shouldPruneAfterRehydrate(error)`가 false → orphan prune 스킵. `hasHydrated`는 false로 남는다.

즉 throw는 이미 `failClosedLocalStorage`(읽기 실패 전파)와 **같은 레인**으로 떨어진다. 새 실패 경로를 만드는 게 아니라 기존 fail-closed 레인에 합류시키는 것이다.

## 인터페이스 설계

### 항목 12

```ts
// src/store/issues-store.ts — IssueRecord에 추가
export interface IssueRecord {
  // ...
  /**
   * 저장 시점의 API Hosts 자동 파생값(editor-store.apiHostsDerived 스냅샷).
   * stripApiHostsRows가 "사용자가 손 안 댄 자동 행"을 판정하는 유일한 재료다.
   * 구 draft는 undefined → null로 읽혀 어떤 행과도 일치하지 않으므로 strip이 no-op가 된다
   * (판정 재료 없이 지우면 사용자가 고친 값을 지울 수 있다).
   */
  apiHostsDerived?: string | null;
}
```

```ts
// src/sidepanel/lib/apiHostRow.ts — 신설. 라이브·draft 제출 경로의 단일 초크포인트.
export function environmentForSubmit(input: {
  captureMode: CaptureMode | undefined;
  logsAttach: boolean;
  rows: readonly EnvironmentRow[] | undefined;
  lastDerived: string | null | undefined;
}): EnvironmentRow[];
```

동작(기존 `buildEditorCapture.ts:55-59`의 삼항과 등가):

```ts
export function environmentForSubmit(input) {
  const rows = input.rows ?? [];
  if (supportsConsoleNetworkLog(input.captureMode) && input.logsAttach) return [...rows];
  return [...stripApiHostsRows(rows, input.lastDerived ?? null)];
}
```

`stripApiHostsRows`는 **시그니처·동작 모두 불변**이다(`lastDerived: string | null`). `?? null` 흡수는 새 함수가 맡아, 구 draft의 `undefined`가 "판정 불가"로 정확히 읽히게 한다.

호출부 2곳:

```ts
// buildEditorCapture.ts (라이브)
environment: environmentForSubmit({
  captureMode, logsAttach, rows: draft.environment, lastDerived: s.apiHostsDerived,
}),

// DraftDetailDialog.tsx:352 (재제출)
environment: environmentForSubmit({
  captureMode: issue.captureMode,               // legacyNoDiff 강제변환 이전의 원본 모드
  logsAttach: logsOn,                           // = issue.logsAttached !== false (:311)
  rows: issue.draft.environment,
  lastDerived: issue.apiHostsDerived,
}),
```

```ts
// src/store/editor-store.ts — confirmDraft 4개 분기 전부에 동일 라인
useIssuesStore.getState().saveDraft({
  // ...
  apiHostsDerived: state.apiHostsDerived,   // 조건부 스프레드 금지 — saveDraft가 병합이라
});                                          // 키를 빼면 이전 값이 살아난다(:947·:1019 규율)
```

element 분기도 포함한다. 그 모드는 자동 행을 주입하지 않아 값이 항상 `null`이지만, **키를 조건부로 빼면 `saveDraft`의 병합(`issues-store.ts:356-361`)이 직전 세션 값을 되살린다** — 같은 파일이 `selector`(`:947`)·`bufferedElements`(`:1019`)에서 이미 못박은 규율이다.

### 항목 13

```ts
// src/store/issues-store.ts — export해서 단위 테스트로 고정
/**
 * v<2 스냅샷의 dataURL 한 슬롯을 blob-db로 이관한다.
 * - 반환 true/false = 이관 성공 여부(→ snapshot.hasBefore/hasAfter)
 * - dataURL이 못 읽는 값이면 false (재시도해도 같은 결과라 그 슬롯만 포기)
 * - IDB write 실패는 **전파**한다 — 마이그레이션 전체를 abort시켜 구버전 봉투를
 *   저장소에 남기고 다음 기동에서 재시도하게 한다(fail-closed).
 */
export async function migrateSnapshotImage(
  issueId: string,
  slot: "before" | "after",
  raw: unknown,
): Promise<boolean> {
  if (typeof raw !== "string" || !raw.startsWith("data:")) return false;
  let blob: Blob;
  try {
    blob = dataUrlToBlob(raw);
  } catch {
    return false;            // 영구 실패 — abort하면 이 사용자는 영영 hydrate 못 한다
  }
  await saveImageBlobRaw(issueId, slot, blob);  // 일시 실패 — 전파
  return true;
}
```

`migrateIssuesState`의 v<2 블록은 이 헬퍼 호출로 축소된다:

```ts
if (version < 2) {
  for (const issue of state.issues) {
    const snap = issue.snapshot as unknown as { before: unknown; after: unknown };
    const hasBefore = await migrateSnapshotImage(issue.id, "before", snap.before);
    const hasAfter = await migrateSnapshotImage(issue.id, "after", snap.after);
    issue.snapshot = { before: hasBefore, after: hasAfter };
  }
}
```

**실패 정책 결론**: *마이그레이션 중단(throw)*이다. 세 후보 중 나머지 둘은 구조적으로 불가능하거나 해롭다 — "version 미기록"은 zustand가 `setItem`에 `version: options.version`을 고정으로 싣기 때문에(`middleware.mjs:356-362`) 호출부가 통제할 수 없고, "dataURL 보존 후 재시도"는 `IssueSnapshot`이 이미 boolean 스키마라 담을 자리가 없다(자리를 만들면 v5 스키마에 v1 잔재가 영구히 남는다). throw는 저장소를 **원본 그대로** 남기므로 재시도가 무손실이다.

### 항목 71

```ts
// src/store/settings-store.ts — 새 플랫폼이 PlatformId에 추가되면 키 누락으로 컴파일 에러.
const PLATFORM_FALLBACK_RANK = {
  jira: 0, github: 1, linear: 2, gitlab: 3,
  notion: 4, asana: 5, clickup: 6, slack: 7,
} as const satisfies Record<PlatformId, number>;

const PLATFORM_FALLBACK_ORDER = (Object.keys(PLATFORM_FALLBACK_RANK) as PlatformId[])
  .sort((a, b) => PLATFORM_FALLBACK_RANK[a] - PLATFORM_FALLBACK_RANK[b]);
```

`as const satisfies Record<PlatformId, T>`는 `src/types/platform.ts:29`·`src/background/oauth/config.ts:129`가 이미 쓰는 저장소 관용구다. `pickInitialPlatform`(`:330-341`)의 순회 코드는 그대로 둔다.

### 항목 74

```ts
// src/lib/inline-ref.ts — 파싱(INLINE_REF_RE)의 짝이 되는 생성기.
export function inlineRefUrl(refId: string): string {
  return `inline:${refId}`;
}
export function inlineRefMarkdown(refId: string, alt = ""): string {
  return `![${alt}](${inlineRefUrl(refId)})`;
}
```

호출부: `editor-store.ts:557` → `inlineRefMarkdown(refId)` / `TiptapEditor.tsx:526` → `md.replaceAll(blobUrl, inlineRefUrl(refId))` / `submitToAsana.ts:223` → `imageRefs[inlineRefUrl(refId)]`. `INLINE_REF_RE`는 그대로 둔다 — 이 배치는 생성 쪽만 모은다.

## 기존 패턴 준수

- **`IssueRecord`의 비파괴 optional 필드는 버전 bump 없이 추가**(`docs/ARCHITECTURE.md:576`, `issues-store.ts:255-259`의 선례 목록 — `actionLogBlobKey`·`videoStartedAt`·`bufferedElements`·`slackPreserved`). 항목 12의 `apiHostsDerived`가 정확히 그 형태다. `ISSUES_STORE_VERSION`은 **5 유지**.
- **`saveDraft`는 교체가 아니라 병합**(`issues-store.ts:353-355`) — 새 키는 조건부 스프레드 없이 항상 명시.
- **게이트는 컴포넌트가 아니라 lib에**(`apiHostRow.ts:61-62`) — 테스트 파일 없는 컴포넌트에 판정을 두면 회귀가 green으로 통과한다.
- **fail-closed는 사용자 산출물을 담는 저장소의 기본**(`chrome-storage.ts:36-45`, ARCHITECTURE.md:64·66) — 항목 13이 그 규율에 합류한다.
- **크로스레이어 영속 키는 상수 단일 출처**(`session-keys.ts:19-21`, ARCHITECTURE.md:574) — 항목 18.
- **`Record<PlatformId, T>` satisfies로 플랫폼 전수 강제**(`types/platform.ts:29`) — 항목 71.
- **문서 갱신은 문서별 커밋**(`docs(ARCHITECTURE): ...` / `docs(DIRECTORY): ...`) — 항목 17·73.

## 대안 검토

1. **항목 12 / `stripApiHostsRows`를 "source 태그만 보고 지우기"로 단순화** (스키마 확장 불필요) — **기각**. `syncApiHostsRow`의 `promoteEditedRow`(`apiHostRow.ts:118-126`)는 effect가 다시 돌 때만 태그를 벗기는데 그 effect의 deps에 `draft`가 없다(`DraftingPanel.tsx:636-643`). 즉 **사용자가 값만 고치고 저장한 행은 `source:"api-hosts"`를 단 채 영속된다**(행 편집은 `{...next[idx], value}`로 source를 보존한다 — `DraftingPanel.tsx:772-776`). 태그만 보고 지우면 그 사용자 입력이 조용히 소실되고, `DraftDetailDialog`엔 `재현 환경` 편집 UI가 없어(`EnvBlock` 읽기 전용, `:1212-1245`) **복구 수단도 없다**.
2. **항목 12 / `confirmDraft`가 저장 시점에 자동 행을 미리 걷어내기** — **기각**. `logsAttached`는 draft에서 off→on으로 되돌릴 수 있는 가역 토글인데(`:924`·`:1001`), 저장 때 지우면 다시 켜도 행을 되살릴 수 없다. 라이브 규율(로그 off로 사라지는 건 `apiHostsDismissed` 래치를 안 세운다)과도 정면으로 어긋난다.
3. **항목 12 / 구 draft(필드 없음)에서 자동 행을 지우는 쪽** — **기각**, 남기는 쪽 채택. 근거 넷: ① `stripApiHostsRows`의 계약은 "**미수정** 행만 걷어낸다"인데 `lastDerived`가 없으면 미수정임을 증명할 수 없고, 증명 없이 지우면 대안 1과 같은 소실이 난다. ② 라이브 경로도 `apiHostsDerived === null`이면 아무것도 안 지운다 — 같은 함수·같은 입력·같은 결과이고, 구 draft만 다른 규칙을 쓰면 함수가 두 의미를 갖는다. ③ 남길 때의 노출은 **페이지와 같은 registrable domain의 hostname**뿐이고(`deriveApiHostsRow`의 `tldts` 게이트가 타 조직 hostname을 이미 배제 — POSTMORTEM 2026-07-30), 그 도메인은 `Page` 행에 이미 실려 있어 증분이 사실상 없다. 반대 방향의 피해(사용자 입력 소실)는 비대칭적으로 크다. ④ 노출 범위가 유한하다 — 이 필드가 없는 draft는 배포 이전 저장분뿐이고 새 draft부터는 정상 판정된다. **마이그레이션 backfill도 하지 않는다**(저장된 행의 값을 파생값으로 간주하는 것 = ①의 추측을 마이그레이션으로 굳히는 것).
4. **항목 13 / version만 안 올리고 다음 기동 재시도** — **불가능**. zustand persist의 `setItem`이 `{state, version: options.version}`을 고정으로 쓴다(`middleware.mjs:356-362`). 호출부에 버전 통제권이 없다.
5. **항목 13 / 실패한 dataURL을 레코드에 보존해 재시도** — **기각**. `IssueSnapshot`은 v2에서 이미 boolean 스키마이고, 보존 자리를 새로 만들면 v5 스키마에 v1 잔재가 영구히 남는다. 저장소 봉투를 통째로 남기는 throw가 같은 목적(재시도)을 스키마 오염 없이 달성한다.
6. **항목 13 / 모든 실패를 전파(파싱 실패 포함)** — **기각**. `dataUrlToBlob`은 못 읽는 값에 항상 같은 예외를 던지므로(`blob-db.ts:730` + `atob`), 깨진 dataURL 하나가 그 사용자의 hydrate를 **영구히** 막는다. 실패의 성질(일시/영구)로 경계를 나누는 게 fail-closed의 취지이지, 모든 예외를 위로 던지는 게 취지가 아니다.
7. **항목 18 / 상수를 `src/lib/settings-storage.ts`에 두기** — **기각**. 그 파일은 다른 store의 다른 키(`bugshot-settings`)를 다루고 8개 플랫폼 auth 타입을 import한다. 한 글자 차이 이름이 한 파일에 공존하는 것 자체가 사고 지점이다. `session-keys.ts`는 import 0개 leaf이고 background가 이미 쓰는 검증된 자리다.
8. **항목 73 / 코드를 문서에 맞추기(개별 delete 실패를 전파)** — **기각**. 실패 방향이 "미삭제"라 무해하고, 전파하면 delete 하나가 실패할 때마다 세션 플래그가 안 서서 매 기동 전량 재스캔이 돈다. **문서를 코드에 맞춘다.**
9. **항목 71 / `PLATFORM_FALLBACK_ORDER`를 그대로 두고 단위 테스트로 전수 검사** — **기각은 아니지만 후순위**. 런타임 테스트는 잡지만 컴파일이 못 잡는다. `Record` 강제가 저장소 관용구이고 비용이 같다.

## 위험 요소

1. **[치명] 항목 13 — 마이그레이션 abort 세션에서 사용자 이슈가 통째로 덮여 사라질 수 있다.** migrate가 throw하면 `set()`이 안 돌아 `issues: []`가 유지되는데, `issues-store`엔 **렌더 게이트가 없다**(`App.tsx:224`의 게이트는 `editorHydrated`·`settingsHydrated`뿐). 즉 사용자는 "이슈 목록이 비어 보이는" 패널을 정상으로 여기고, 그 상태에서 초안을 하나라도 저장하면 `api.setState`가 `setItem()`을 태워 **구버전 봉투를 `{issues:[새것], version:5}`로 덮어쓴다.** 이 창은 `failClosedLocalStorage` 읽기 실패 경로에 **이미 존재하는 기존 위험**이고 항목 13이 새로 만드는 것이 아니지만(노출은 v0/v1 잔존 사용자 × IDB 장애의 교집합), 구현 중 이 사실을 잊고 "throw했으니 안전"으로 결론내면 안 된다. 완화는 이 배치 밖이다(이슈 목록에 hydrate 실패 배너를 다는 건 별건 — `onStateSaveFailed`류 신호는 비재생 pub/sub이라 모듈 로드 시점 hydrate를 못 받는다). **구현 시 이 위험을 tasks의 수동 체크리스트로 확인만 하고, 완화를 스코프에 끌어들이지 않는다.**
2. **[중] 항목 13 — 부분 성공 잔여물.** `before` 성공 후 `after`에서 abort하면 `${issueId}:before` blob이 남고, 같은 기동의 orphan prune은 스킵된다. 재시도 시 같은 키에 `put`으로 덮이므로 누수는 아니지만(`blob-db.ts:158`), 마이그레이션이 영영 성공하지 못하면 그 blob은 참조 없이 남는다. 수용한다 — 대안(부분 롤백)은 실패 경로에 삭제를 추가하는 것이라 fail-closed 원칙에 정면으로 어긋난다.
3. **[치명] 항목 18 — persist `name` 오타는 전 사용자 설정 초기화다.** `bugshot-app-settings`가 한 글자라도 달라지면 zustand가 저장분을 못 찾아 기본값으로 뜬다(테마·로케일·본문 구성·BYOK 설정 전부). 타입 에러는 안 난다. **상수 값 동일성을 단위 테스트로 잠근다** — `src/lib/__tests__/settings-storage.test.ts:93-95`가 `SETTINGS_STORAGE_KEY`에 대해 하는 것과 같은 형태.
4. **[중] 항목 12 — 라이브 경로 리팩터가 정상 경로를 건드린다.** `buildEditorCapture.ts:55-59`는 **모든** 제출이 지나는 자리다. 게이트를 헬퍼로 옮길 때 로그 ON 분기가 `[...rows]`(새 배열)를 반환하는 현행 동작까지 그대로 유지해야 한다 — 현재도 스프레드로 새 배열을 만든다. `bodyOutputGolden.test.ts`가 8개 빌더 출력을 통째로 잠그고 있으므로 골든 diff가 0이어야 한다.
5. **[중] 항목 12 — `logsAttach` 인자를 `issue.logsAttached`로 직접 넘기면 뒤집힌다.** 필드는 `boolean | undefined`이고 `undefined = 첨부`가 계약이다(`issues-store.ts:212-214`). 반드시 `issue.logsAttached !== false`(`DraftDetailDialog.tsx:311`의 `logsOn`)를 넘긴다.
6. **[중] 항목 14 — 유닛으로 못 고정한다.** `picker.ts`는 브라우저 실동작(시트 주입 → `onCacheReloaded` 발화 → `requestIdleCallback`)이라 jsdom으로 재현할 수 없다. 수동 체크리스트가 유일한 그물이고, 그마저 "한 줄 추가"라 회귀가 조용하다. 대신 `handleStart`/`handleSelectByPath` 두 등록 지점을 코드에서 **서로 인접하게 읽히도록** 주석으로 묶는다.
7. **[소] 항목 76 — 게이트 교체 함정.** `HOST_ID` 제외를 `ANNOTATION_HOST_ID`로 **바꾸면** picker overlay가 DOM Tree에 노출된다. OR로 얹는다(POSTMORTEM 2026-08-04의 "기존 게이트를 새 조건으로 대체"와 같은 계열).
8. **[소] 항목 71 — `as const` 전환이 `PlatformId[]` 소비처를 깨뜨릴 수 있다.** `Object.keys(...) as PlatformId[]`로 mutable 배열을 유지해 `pickInitialPlatform`의 `for...of`가 그대로 돌게 한다.
9. **[소] 항목 74 — `alt` 기본값.** 현재 생성물은 `![](...)`(빈 alt)이다. 헬퍼의 기본값을 빈 문자열로 두지 않으면 본문 마크다운이 바뀌어 골든이 깨진다.
