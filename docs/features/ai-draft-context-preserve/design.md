# AI 초안 생성 — 선입력 컨텍스트 활용 & 이미지 보존 — 기술 설계

## 개요

세 갈래 변경이다. (A) `buildAiDraftSessionPrompt`에 선입력 draft를 컨텍스트로 주입 + `AiDraftDialog`에서 선업로드 inline 이미지를 LLM `images`에 합쳐 전달. (B) 응답 적용부에서 기존 이미지를 보존하며 텍스트만 교체하는 순수 함수 도입. (C) `TiptapEditor`의 `isInternalChange` 잔류로 외부 `value` 변경을 1회 삼키는 버그 수정. 신규 상태·메시지·권한·env는 없다.

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
    - 이미지가 있으면 결과 = `이미지들.join("\n") + "\n\n" + aiText.trim()` (aiText 비면 이미지들만).
    - 이미지가 없으면 결과 = `aiSections[id]`.
    - `aiSections`에만 있는 id(이전엔 없던 섹션)는 그대로 채택. `prevSections`에만 있고 `aiSections`에 없는 id는 이미지가 있으면 이미지만 남기고, 없으면 제외(기존 텍스트는 버림 — 덮어쓰기 정책 유지).

### `src/sidepanel/lib/resolveInlineImages.ts` (변경)
- 현재: inline ref 추출/치환/resolve 유틸 모음.
- 변경: `extractInlineImageMarkdown(markdown: string): string[]` 추가 — `![alt](inline:ref)` 매치를 alt 포함 통째로 순서대로 반환. `mergeAiSectionsPreservingImages`가 사용. (기존 `extractInlineRefs`는 ref만 반환해 alt 손실 → 별도 함수 필요.)

### `src/sidepanel/tabs/AiDraftDialog.tsx` (변경)
- 현재: 세션 생성 → `prompt(msg, {responseSchema, images})` → `parseAiDraftResponse` → `setDraft` 전체 교체.
- 변경:
  - 세션 프롬프트 빌드 시 `existingDraft: { title: store.draft?.title ?? "", sections: store.draft?.sections ?? {} }` 전달.
  - 첫 메시지 `images`에 **선업로드 inline 이미지**를 합친다: `resolveInlineImagesForSections(store.draft?.sections ?? {}, settingsUi.issueSections)`로 `{refId, dataUrl}[]`를 얻어 `dataUrl`만 추출 → `getModeImages(...)`(캡처 이미지) 결과와 concat. 둘 다 없으면 `undefined`.
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
- 현재: inline 이미지 mount-resolve effect가 `setContent` 직전 `isInternalChange.current = true`로 설정(:238-239). 이 플래그는 직후 외부 `value` 변경을 value-sync effect(:245-249)가 1회 무시하게 만든다.
- 변경: mount-resolve effect의 `isInternalChange.current = true`를 제거한다. 해당 `setContent`는 표시 변환(blob URL)일 뿐 `onUpdate`를 발화하지 않고(`emitUpdate` 기본 false) `value`/`editor` deps도 안 바꿔 value-sync를 재실행시키지 않으므로, 플래그를 세울 필요가 없다. 사용자 타이핑 echo 방지는 `onUpdate`(:160)의 `isInternalChange = true`와 value-sync의 `value === currentMd` early-return(:251)이 계속 담당한다.

## 데이터 흐름

```
[요청]
draft(store) ──┬─ title+sections(텍스트) ──stripInlineImageRefs──▶ systemPrompt(existingDraft 블록)
               └─ sections(paragraph) ──resolveInlineImagesForSections──▶ dataUrl[] ─┐
captureMode ── getModeImages ──▶ 캡처 dataUrl[] ────────────────────────────────────┴─▶ images[]
                                                          session.prompt(msg, {responseSchema, images})

[응답]
raw ── parseAiDraftResponse ──▶ {title, sections(텍스트)}
prevSections + aiSections ── mergeAiSectionsPreservingImages ──▶ sections(이미지 보존)
                                                              setDraft({title, sections, environment})
                                                              ──▶ TiptapEditor value 변경 ──▶ (C로 정상 반영)
```

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
```

기존 `AISession.prompt(input, { responseSchema, images })`·`resolveInlineImagesForSections(sections, sectionConfig)` 시그니처는 변경 없이 재사용.

## 기존 패턴 준수

- **순수 함수 + 단위 테스트 우선**: 병합·추출 로직은 순수 함수로 분리해 `__tests__`에 테스트 작성(CLAUDE.md 테스트 우선).
- **inline 이미지 규약**: `![alt](inline:ref)` + IndexedDB blob, paragraph·enabled 섹션만 — 기존 `resolveInlineImages.ts` 규약을 그대로 따른다.
- **덮어쓰기 정책 유지**: 확인 다이얼로그 없이 즉시 반영(기존 UX 유지).
- **세션 영속화**: `setDraft` 경로만 거치므로 `useEditorSessionSync`의 기존 저장 흐름에 그대로 편승(추가 작업 없음).

## 대안 검토

- **C 수정안 비교**: (1) 잔류 `isInternalChange = true` 한 줄 제거 vs (2) `lastEmittedValue` ref로 값 비교 재설계. (2)가 mount-resolve와 외부 변경이 경합하는 희귀 케이스까지 견고하지만, 변경 범위가 넓고 회귀 위험이 크다. 외과적 원칙에 따라 (1)을 채택. 경합 케이스는 위험 요소에 기록.
- **이미지 보존을 LLM에 위임**(응답에 이미지 ref를 그대로 돌려달라고 요청): LLM이 ref를 누락·변조할 위험이 크고 비결정적. 코드에서 결정적으로 병합하는 편이 안전 → 기각.
- **응답 적용을 전체 교체 유지하고 이미지만 사후 재삽입**: 결국 병합 로직이 필요하므로 `mergeAiSectionsPreservingImages` 한 곳에 모으는 게 단순 → 분리 함수 채택.

## 위험 요소

- **TiptapEditor 회귀 범위**: 모든 본문 paragraph 섹션이 공용 컴포넌트라, C 수정은 이미지 있는/없는 섹션 + 세션 복원 + 타이핑 echo + drag/paste 삽입 흐름까지 회귀 확인이 필요. 특히 "타이핑 직후 커서 점프 없음", "세션 복원 후 이미지 표시", "이미지 삽입 직후 추가 타이핑 정상"을 수동 확인.
- **mount-resolve vs 외부 변경 경합**: inline 이미지 resolve 비동기가 끝나기 전에 AI 응답이 도착하면 표시 순서 경합 가능(희귀). C(1) 수정으로 잔류 플래그는 사라지지만 이 경합 자체는 남는다 — 관측되면 (2)안으로 후속 처리.
- **이미지 다수 전송 시 토큰/용량**: 캡처 이미지 + 모든 paragraph inline 이미지를 전부 전송하므로 큰 이미지가 많으면 LLM 요청이 커진다. 1차 구현은 전부 전송(스펙대로). 과대 payload가 문제되면 후속에서 상한 도입.
- **LLM 텍스트에 markdown 이미지 포함 시**: 응답 텍스트에 `![](...)`가 섞여오면 그대로 본문에 들어간다. 프롬프트 규칙에 "이미지 markdown을 출력하지 말 것"을 명시해 완화.
