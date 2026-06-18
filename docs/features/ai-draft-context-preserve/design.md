# AI 초안 생성 — 선입력 컨텍스트 활용 & 이미지 보존 — 기술 설계

## 개요

세 갈래 변경이다. (A) `buildAiDraftSessionPrompt`에 선입력 draft를 컨텍스트로 주입 + `AiDraftDialog`에서 선업로드 inline 이미지를 LLM `images`에 합쳐 전달하되, **매 요청마다 최신 선입력을 전송**(세션 재사용 분기 변경). 요청 구성은 순수 함수 `buildAiDraftRequest`로 추출해 단위 테스트로 회귀를 막는다. (B) 응답 적용부에서 기존 이미지를 보존하며 텍스트만 교체하는 순수 함수 도입. (C) `TiptapEditor`의 표시 전용 `setContent`를 `{emitUpdate:false}`로 호출해, 내부 표시 변환이 `onUpdate`→store echo→`isInternalChange` 잔류로 외부 `value` 변경(AI 덮어쓰기)을 1회 삼키는 버그를 제거. 신규 상태·메시지·권한·env는 없다.

## 변경 범위

### `src/sidepanel/lib/buildAiDraftPrompt.ts` (변경)
- 현재: 세션 프롬프트 빌드 + 응답 파싱.
- 변경:
  - `AiDraftSessionContext`에 `existingDraft?: { title: string; sections: Record<string, string> }` 추가.
  - `buildAiDraftSessionPrompt`가 `existingDraft`가 있고 내용이 비어있지 않으면, 각 텍스트에서 `stripInlineImageRefs`로 inline 이미지 ref를 제거한 뒤 "현재 작성본(참고용, 비어있을 수 있음)" 블록을 프롬프트에 추가. title도 포함.
  - 빈(모두 공백) 경우 블록 생략.
  - `parseAiDraftResponse`는 시그니처·동작 변경 없음(텍스트 sections만 반환). 이미지 병합은 호출부(B)에서 수행.

### `src/sidepanel/lib/mergeAiDraftSections.ts` (신규)
- 역할: LLM 텍스트 응답과 기존 섹션의 이미지를 병합하는 순수 함수.
- 함수:
  - `mergeAiSectionsPreservingImages(prevSections, aiSections): Record<string, string>`
    - 각 섹션 id에 대해 `prevSections[id]`에서 inline 이미지 markdown을 추출하고, `aiSections[id]`(텍스트)와 결합한다.
    - 이미지가 있으면 결과 = `[...이미지들, aiText.trim()].filter(Boolean).join("\n\n")` — **모든 블록(이미지끼리·이미지↔텍스트)을 빈 줄(`\n\n`)로 통일**해 Tiptap markdown이 각 이미지를 독립 블록으로 파싱하도록 보장(단일 `\n`은 `breaks:true`라도 paragraph 병합 위험). aiText가 비면 이미지들만.
    - 이미지가 없으면 결과 = `aiSections[id]`.
    - `aiSections`에만 있는 id(이전엔 없던 섹션)는 그대로 채택. `prevSections`에만 있고 `aiSections`에 없는 id는 이미지가 있으면 이미지만 남기고, 없으면 제외(기존 텍스트는 버림 — 덮어쓰기 정책 유지).
    - **섹션 타입 무관 순수 함수**: orderedList 섹션도 입력으로 들어올 수 있으나, 해당 섹션 텍스트에는 inline 이미지 ref가 없어 `extractInlineImageMarkdown`이 `[]`를 반환하므로 자연히 텍스트 교체로 동작한다(호출부에서 별도 필터 불필요).
    - **경계**: `aiSections[id]`가 `undefined`(키 자체 없음 — `parseAiDraftResponse`가 비-string을 누락)와 빈 문자열을 동일하게 "텍스트 없음"으로 취급.

### `src/sidepanel/lib/resolveInlineImages.ts` (변경)
- 현재: inline ref 추출/치환/resolve 유틸 모음.
- 변경: `extractInlineImageMarkdown(markdown: string): string[]` 추가 — `![alt](inline:ref)` 매치를 alt 포함 통째로 순서대로 반환. `mergeAiSectionsPreservingImages`가 사용. (기존 `extractInlineRefs`는 ref만 반환해 alt 손실 → 별도 함수 필요.)

### `src/sidepanel/lib/buildAiDraftRequest.ts` (신규)
- 역할: LLM 요청(systemPrompt + 최종 images 배열)을 **결정적으로 조립하는 순수 함수**. 비순수 부분(IndexedDB에서 inline 이미지 blob을 dataURL로 resolve)은 호출부(AiDraftDialog)가 먼저 수행해 결과만 입력으로 넘긴다 → 함수 자체는 순수해 단위 테스트로 회귀 게이트가 된다(QA 🔴3 대응).
- 함수:
  ```ts
  export function buildAiDraftRequest(input: {
    ctx: AiDraftSessionContext;          // existingDraft 포함
    modeImages: string[] | undefined;    // getModeImages 결과 (캡처)
    inlineImageDataUrls: string[];       // resolveInlineImagesForSections에서 추출 (선업로드)
  }): { systemPrompt: string; images: string[] | undefined };
  ```
  - `systemPrompt = buildAiDraftSessionPrompt(ctx)`.
  - `images = [...(modeImages ?? []), ...inlineImageDataUrls]` → 길이 0이면 `undefined` (getModeImages가 video/freeform에서 `undefined`를 반환하므로 `?? []` 가드 필수 — 안 하면 spread 런타임 에러).

### `src/sidepanel/tabs/AiDraftDialog.tsx` (변경)
- 현재: 세션 생성(비-element는 재사용) → 첫 메시지만 `images` 전송 → `prompt(...)` → `parseAiDraftResponse` → `setDraft` 전체 교체.
- 변경:
  - **멀티턴**: 세션 재사용 분기(`if (isElement || !sessionRef.current)`)를 바꿔, **매 요청마다 systemPrompt를 최신 `existingDraft`로 재빌드하고 세션을 재생성**한다(이전 세션 `destroy` 후 새로 `createSession`). 이미지도 매 요청 재전송(`isFirstMessageRef` 분기 제거). 초안 생성은 단발성이라 멀티턴 대화 맥락 유지 이점보다 최신 컨텍스트 반영이 우선.
  - 요청 조립을 `buildAiDraftRequest`로 위임:
    - `inlineImageDataUrls`: `await resolveInlineImagesForSections(store.draft?.sections ?? {}, settingsUi.issueSections)`로 `{refId, dataUrl}[]`를 얻어 `dataUrl`만 추출.
    - `ctx.existingDraft = { title: store.draft?.title ?? "", sections: store.draft?.sections ?? {} }`.
    - `{ systemPrompt, images } = buildAiDraftRequest({ ctx, modeImages: getModeImages(store, captureMode), inlineImageDataUrls })`.
    - `session = await createSession(systemPrompt)` → `session.prompt(msg, { responseSchema, images })`.
  - 응답 적용을 전체 교체에서 병합으로 변경:
    ```ts
    const prevSections = useEditorStore.getState().draft?.sections ?? {};
    useEditorStore.getState().setDraft({
      title: aiTitle,
      sections: mergeAiSectionsPreservingImages(prevSections, parsed.sections),
      environment: prevDraft?.environment ?? [],
    });
    ```
  - title 처리(prefix 재부착)·environment 보존은 기존 그대로.

### `src/sidepanel/components/TiptapEditor.tsx` (변경 — C)
- **버그 메커니즘 (코드 확인됨)**: Tiptap v3.23.4 `setContent`의 `emitUpdate` 기본값은 **`true`**(`@tiptap/core/dist/index.js:1148` — `emitUpdate = true`). 즉 표시 전용 `setContent`(mount-resolve `:239`, value-sync `:260`/`:278`)도 옵션을 생략하면 `onUpdate(:159-162)`를 발화한다. `onUpdate`는 `isInternalChange.current = true`를 세우고 `onChange(editorMarkdown(...))`로 store에 echo한다. 이때 내보내는 markdown은 blob URL을 `inline:ref`로 역변환(`editorMarkdown`, `:113-114`)해 원래 `value`와 **동일**하므로, `setDraft` 후 `value` prop이 값이 같아 value-sync effect(`[value, editor]` deps)가 **재실행되지 않는다** → `isInternalChange`가 `true`로 잔류 → 직후 도착하는 AI 덮어쓰기(`value` 실제 변경)의 value-sync가 `:246`에서 1회 삼킨다. 이미지 있는 섹션이 화면에 안 바뀌는 원인.
  - ※ 이전 설계의 "라인 238 한 줄 제거"는 무효: 라인 238을 지워도 같은 `setContent`가 `onUpdate(:160)` 경로로 동일한 잔류 `true`를 만든다.
- **변경**: 표시 전용 `setContent` 호출 3곳을 `{ emitUpdate: false }`로 호출한다.
  - mount-resolve resolve 후(`:239`), value-sync resolved 경로(`:260`), value-sync unresolved resolve 후(`:278`).
  - 이들은 store가 아니라 화면 표시(blob URL)만 갱신하므로 store로 echo할 필요가 없다. `emitUpdate:false`면 `onUpdate`가 안 돌아 `isInternalChange` 잔류 자체가 생기지 않는다.
  - 이에 따라 위 세 곳 직전의 `isInternalChange.current = true`(`:238`, `:277`)는 불필요해져 제거한다.
  - **사용자 타이핑 echo 방지는 유지**: 실제 입력은 `onUpdate(:160)`가 store로 보내고(이건 emitUpdate와 무관, 실 입력 이벤트), value-sync의 `value === currentMd` early-return(`:251`)이 같은 값 재진입을 흡수한다. 즉 `isInternalChange` 플래그 없이도 echo는 `:251`이 막는다 → 플래그 의존 제거가 가능하면 함께 정리(아니면 onUpdate 경로만 유지).

## 데이터 흐름

```
[요청] — 매 handleSubmit마다 최신 draft로 재조립 + 세션 재생성
draft(store) ──┬─ title+sections(텍스트) ──stripInlineImageRefs──▶ ctx.existingDraft 블록
               └─ sections(paragraph, enabled 전체) ──resolveInlineImagesForSections(async)──▶ dataUrl[] ─┐
captureMode ── getModeImages(sync) ──▶ 캡처 dataUrl[] | undefined ─────────────────────────────────────┤
                                                                                                        ▼
                          buildAiDraftRequest(순수) ──▶ { systemPrompt, images=[...(mode??[]),...inline] | undefined }
                          createSession(systemPrompt) ──▶ session.prompt(msg, {responseSchema, images})

[응답]
raw ── parseAiDraftResponse ──▶ {title, sections(텍스트)}
prevSections + aiSections ── mergeAiSectionsPreservingImages ──▶ sections(이미지 보존, 블록 \n\n 구분)
                                                              setDraft({title, sections, environment})
                                                              ──▶ TiptapEditor value 변경 ──▶ (C: emitUpdate:false로 정상 반영)
```

- **이미지 전송 단위 ≠ 보존 단위**: 요청 images에는 enabled paragraph **전 섹션**의 inline 이미지가 합쳐 들어가지만(전역), 보존(B)은 **섹션별**로 자기 이미지만 유지한다. 동작상 충돌은 없으나 단위가 다름을 유의.
- **이미지-섹션 매핑 끊김 (의도된 트레이드오프)**: 텍스트에서 ref를 strip하고 이미지는 `images`로 따로 보내므로, LLM은 어떤 이미지가 어느 섹션의 것인지 알 수 없다. 이미지는 "참고용 비주얼"로만 쓰이고 섹션 귀속은 코드(B)가 결정적으로 처리하므로 수용 가능한 트레이드오프로 본다.

## 인터페이스 설계

```ts
// buildAiDraftPrompt.ts
export interface AiDraftSessionContext {
  // ...기존 필드...
  existingDraft?: { title: string; sections: Record<string, string> };
}

// resolveInlineImages.ts
export function extractInlineImageMarkdown(markdown: string): string[];

// mergeAiDraftSections.ts (신규)
export function mergeAiSectionsPreservingImages(
  prevSections: Record<string, string>,
  aiSections: Record<string, string>,
): Record<string, string>;

// buildAiDraftRequest.ts (신규, 순수)
export function buildAiDraftRequest(input: {
  ctx: AiDraftSessionContext;
  modeImages: string[] | undefined;
  inlineImageDataUrls: string[];
}): { systemPrompt: string; images: string[] | undefined };
```

기존 `AISession.prompt(input, { responseSchema, images })`·`resolveInlineImagesForSections(sections, sectionConfig)` 시그니처는 변경 없이 재사용. `setContent`는 v3.23.4 기준 `editor.commands.setContent(content, { emitUpdate })` 형태로 옵션 객체를 받는다(2번째 인자 객체).

## 기존 패턴 준수

- **순수 함수 + 단위 테스트 우선**: 병합·추출 로직은 순수 함수로 분리해 `__tests__`에 테스트 작성(CLAUDE.md 테스트 우선).
- **inline 이미지 규약**: `![alt](inline:ref)` + IndexedDB blob, paragraph·enabled 섹션만 — 기존 `resolveInlineImages.ts` 규약을 그대로 따른다.
- **덮어쓰기 정책 유지**: 확인 다이얼로그 없이 즉시 반영(기존 UX 유지).
- **세션 영속화**: `setDraft` 경로만 거치므로 `useEditorSessionSync`의 기존 저장 흐름에 그대로 편승(추가 작업 없음).

## 대안 검토

- **C 수정안 비교 (재검토)**: 후보 ① 잔류 `isInternalChange=true` 한 줄 제거 — **기각**. Tiptap v3 `setContent` 기본 `emitUpdate=true`(코드 확인)라 같은 `setContent`가 `onUpdate` 경로로 동일한 잔류 `true`를 만들어 버그가 안 고쳐진다(사실오류 기반 안). ② **표시 전용 `setContent`에 `{emitUpdate:false}`** — **채택**. echo의 근원(내부 표시 변환의 store 반영)을 끊어 잔류 플래그 자체를 없앤다. 변경 3곳으로 외과적이고 근본적. ③ `lastEmittedValue` ref 비교 — 보류. ②로 echo 근원이 사라지면 불필요. ②로도 mount-resolve 비동기와 외부 변경의 동시 경합이 남으면 후속으로 ③ 검토(위험 요소 기록).
- **멀티턴 세션 유지 vs 매 요청 재생성**: 세션을 재사용하면 멀티턴 대화 맥락이 쌓이지만 첫 턴 컨텍스트·이미지만 반영돼 최신 선입력이 누락된다. 초안 생성은 단발성 성격이 강해 **매 요청 최신 컨텍스트 반영**을 우선(세션 재생성) → 채택.
- **요청 조립을 AiDraftDialog 내부에 유지 vs 순수 함수 추출**: 내부 유지 시 통합 동작이 비순수라 자동 회귀 불가. `buildAiDraftRequest` 순수 함수로 추출해 단위 테스트 게이트 확보 → 추출 채택.
- **이미지 보존을 LLM에 위임**(응답에 이미지 ref를 그대로 돌려달라고 요청): LLM이 ref를 누락·변조할 위험이 크고 비결정적. 코드에서 결정적으로 병합하는 편이 안전 → 기각.
- **응답 적용을 전체 교체 유지하고 이미지만 사후 재삽입**: 결국 병합 로직이 필요하므로 `mergeAiSectionsPreservingImages` 한 곳에 모으는 게 단순 → 분리 함수 채택.

## 위험 요소

- **TiptapEditor 회귀 범위**: 모든 본문 paragraph 섹션이 공용 컴포넌트라, C 수정은 이미지 있는/없는 섹션 + 세션 복원 + 타이핑 echo + drag/paste 삽입 흐름까지 회귀 확인이 필요. 특히 "타이핑 직후 커서 점프 없음", "세션 복원 후 이미지 표시", "이미지 삽입 직후 추가 타이핑 정상", "AI 머지 후 재오픈 시 이미지 유지"를 수동 확인. 자동 단위 테스트는 Tiptap 의존이라 비현실적 — 수동 분류가 맞고, PR/README에 회귀 우선순위를 명시해 리뷰어가 반드시 밟게 한다.
- **`emitUpdate:false` 전환의 부작용 점검**: 표시 전용 setContent가 더 이상 store로 echo하지 않으므로, 그 변환 결과가 store에 반영되어야 하는 흐름이 없는지 확인. 현재 inline ref↔blob URL 역변환은 저장 시 `editorMarkdown`이 처리하므로 표시 setContent의 store 반영은 불필요(안전). 단 세션 저장은 `value`(=store) 기준이므로, 표시 변환이 store에 안 가도 저장 무결성에 영향 없음을 회귀로 확인.
- **mount-resolve vs 외부 변경 경합**: inline 이미지 resolve 비동기가 끝나기 전에 AI 응답이 도착하면 표시 순서 경합 가능. ② 수정으로 잔류 플래그는 사라지지만 이 비동기 경합 자체는 남는다 — 관측되면 `lastEmittedValue`(③)안으로 후속 처리. AI 생성 직후(이미지 resolve 진행 중) 연타·재생성을 수동 검증 항목에 포함.
- **이미지 다수 전송 시 토큰/용량 + 대기 UX 악화**: 캡처 이미지 + 모든 paragraph inline 이미지를 전부 전송하므로 큰 이미지가 많으면 LLM 요청이 커지고 **응답 지연이 길어진다**. 현재 생성 중 UI는 다이얼로그 닫힘 + 전역 shimmer 오버레이뿐이고 진행률·취소가 없어, 이미지 많은 섹션에서 체감 지연이 늘어나는 신규 부작용이 있다. 1차 구현은 전부 전송(스펙대로). 과대 payload·대기 UX가 문제되면 후속에서 상한·취소 도입.
- **LLM 텍스트에 markdown 이미지 포함 시**: 응답 텍스트에 `![](...)`가 섞여오면 그대로 본문에 들어간다. 프롬프트 규칙에 "이미지 markdown을 출력하지 말 것"을 명시해 완화.
