# AI 초안 생성 — 선입력 컨텍스트 활용 & 이미지 보존 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변화 없음. manifest 변경 없음.
- 신규 의존성 없음.
- 영향 컴포넌트가 공용(`TiptapEditor`)이므로 Task 4는 회귀 확인을 반드시 동반.
- i18n: 프롬프트 문자열은 `buildAiDraftSessionPrompt` 내부 영문 하드코딩(기존 패턴)이라 `src/i18n/`을 건드리지 않는다 → i18n 무영향(각 Task에서 재확인).

## 태스크

### Task 1: 이미지 markdown 추출 유틸 추가
- **변경 대상**: `src/sidepanel/lib/resolveInlineImages.ts`
- **작업 내용**: `extractInlineImageMarkdown(markdown: string): string[]` 추가 — `![alt](inline:ref)` 매치를 alt 포함 통째로 등장 순서대로 반환. 기존 `INLINE_REF_RE`(`/!\[([^\]]*)\]\(inline:([^)]+)\)/g`) 재사용. `extractInlineRefs`는 ref만(Set, 순서·alt 손실) 반환하므로 별도 함수가 필요.
- **검증**:
  - [ ] 이미지 0개 → `[]`
  - [ ] 1개 → alt·ref 보존된 markdown 1개
  - [ ] 여러 개 → 등장 순서 유지(중복 ref도 각각 보존)
  - [ ] 텍스트 사이에 섞인 이미지도 모두 추출
  - [ ] alt에 특수문자 미포함 정상 / ref·alt 경계(`]`,`)` 인접) 케이스 확인

### Task 2: 섹션 병합 순수 함수 추가
- **변경 대상**: `src/sidepanel/lib/mergeAiDraftSections.ts` (신규) + `__tests__/mergeAiDraftSections.test.ts`
- **작업 내용**: `mergeAiSectionsPreservingImages(prevSections, aiSections)` 구현. 섹션별로 `extractInlineImageMarkdown(prev)`의 이미지를 상단에, `aiSections` 텍스트를 그 아래에 결합. **모든 블록을 빈 줄(`\n\n`)로 구분**(`[...images, aiText.trim()].filter(Boolean).join("\n\n")`). 이미지 없으면 ai 텍스트만. ai에 없고 prev 이미지만 있으면 이미지만.
- **검증**:
  - [ ] 이미지 없는 섹션 → ai 텍스트로 전체 교체
  - [ ] 이미지 1개 + ai 텍스트 → `이미지\n\n텍스트`
  - [ ] 이미지 N개 → 원본 순서대로 상단, **이미지끼리도 `\n\n` 구분**, 그 아래 텍스트
  - [ ] ai 텍스트 빈 문자열 + 이미지 있음 → 이미지만(말미 빈 줄 없음)
  - [ ] `aiSections[id]`가 `undefined`(키 없음) + prev 이미지 있음 → 이미지만 남음
  - [ ] `aiSections[id]`가 빈 문자열 → undefined와 동일 취급
  - [ ] ai에만 있는 새 섹션 → 그대로 채택
  - [ ] orderedList 성격 섹션(이미지 ref 없는 텍스트)이 입력에 섞여도 텍스트 교체로만 동작(추출=[])

### Task 3: 세션 프롬프트에 선입력 컨텍스트 주입
- **변경 대상**: `src/sidepanel/lib/buildAiDraftPrompt.ts` + `__tests__/buildAiDraftPrompt.test.ts`
- **작업 내용**: `AiDraftSessionContext`에 `existingDraft?` 추가. `buildAiDraftSessionPrompt`에서 `existingDraft`의 title+각 섹션 텍스트를 `stripInlineImageRefs`로 정제해 "현재 작성본(참고용)" 블록 추가. 모두 공백이면 블록 생략. 응답에 이미지 markdown을 넣지 말라는 규칙 1줄 추가.
- **검증**:
  - [ ] `existingDraft`에 텍스트 있으면 프롬프트에 해당 텍스트 포함
  - [ ] inline 이미지 ref(`inline:`)는 프롬프트에 노출 안 됨(strip)
  - [ ] title도 블록에 포함
  - [ ] title만 비공백 + sections 전부 공백 → 블록 포함(경계)
  - [ ] 빈 draft(모두 공백) → 블록 미포함(기존 출력과 동일)
  - [ ] "이미지 markdown 출력 금지" 규칙 라인 존재
  - [ ] 프롬프트 문자열이 영문 하드코딩 유지(i18n 무영향)

### Task 4: 요청 빌더 순수 함수 추출 (회귀 게이트)
- **변경 대상**: `src/sidepanel/lib/buildAiDraftRequest.ts` (신규) + `__tests__/buildAiDraftRequest.test.ts`
- **작업 내용**: `buildAiDraftRequest({ ctx, modeImages, inlineImageDataUrls })` → `{ systemPrompt, images }`. `systemPrompt = buildAiDraftSessionPrompt(ctx)`. `images = [...(modeImages ?? []), ...inlineImageDataUrls]`, 길이 0이면 `undefined`. (비순수 resolve는 호출부가 수행.)
- **검증**:
  - [ ] modeImages=undefined(video/freeform) + inline=[] → images=undefined (런타임 에러 없음)
  - [ ] modeImages 있음 + inline 있음 → 캡처 먼저, inline 뒤 순서로 concat
  - [ ] modeImages=undefined + inline 있음 → inline만
  - [ ] systemPrompt가 ctx.existingDraft를 반영(Task3 위임 확인)

### Task 5: TiptapEditor 표시 setContent emitUpdate:false (C)
- **변경 대상**: `src/sidepanel/components/TiptapEditor.tsx`
- **작업 내용**: 표시 전용 `setContent` 3곳(mount-resolve `:239`, value-sync resolved `:260`, value-sync unresolved `:278`)을 `{ emitUpdate: false }`로 호출. 직전 불필요해진 `isInternalChange.current = true`(`:238`, `:277`) 제거. 사용자 타이핑 echo는 `onUpdate(:160)` + value-sync `value===currentMd` early-return(`:251`)이 계속 담당.
- **검증**:
  - [ ] (수동) 이미지 있는 섹션에서 AI 생성 시 에디터 화면이 즉시 갱신됨
  - [ ] (수동) 세션 복원 후 inline 이미지가 정상 표시됨
  - [ ] (수동) AI 머지 후 재오픈 시 이미지 유지(세션 영속화)
  - [ ] (수동) 이미지 있는 섹션에서 타이핑 시 커서 점프·내용 손실 없음
  - [ ] (수동) 이미지 drag/paste 삽입 직후 추가 타이핑 정상
  - [ ] (수동) AI 생성 직후(이미지 resolve 진행 중) 연타·재생성 시 표시 깨짐 없음

### Task 6: AiDraftDialog 통합 — 멀티턴 + 컨텍스트/이미지 + 병합
- **변경 대상**: `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**:
  - **멀티턴**: 세션 재사용 분기(`if (isElement || !sessionRef.current)`)를 매 요청 systemPrompt 재빌드 + 세션 재생성으로 변경. 이미지도 매 요청 전송(`isFirstMessageRef` 분기 제거).
  - `inlineImageDataUrls = (await resolveInlineImagesForSections(sections, issueSections)).map(x => x.dataUrl)`.
  - `ctx.existingDraft = { title, sections }`.
  - `{ systemPrompt, images } = buildAiDraftRequest({ ctx, modeImages: getModeImages(store, captureMode), inlineImageDataUrls })`.
  - 응답 적용을 `mergeAiSectionsPreservingImages(prevSections, parsed.sections)`로 변경. title·environment 처리 유지.
- **검증**:
  - [ ] (수동/BYOK) 선입력 텍스트가 LLM 요청 systemPrompt에 포함
  - [ ] (수동/BYOK) 선업로드 이미지가 요청 images에 포함
  - [ ] (수동/BYOK) 재오픈 후 재생성 시 최신 선입력이 전달
  - [ ] (수동) 응답 후 이미지 있던 섹션 = 이미지 상단 + 텍스트 하단
  - [ ] (수동) 이미지 없던 섹션 = 전체 교체
  - [ ] `pnpm test` green, `pnpm typecheck` 통과

## 테스트 계획

### 단위 테스트 (Vitest) — 자동 회귀 게이트
- `mergeAiDraftSections.test.ts`: Task 2 검증 항목 전부(결합자·경계·undefined/빈문자열·orderedList).
- `resolveInlineImages.test.ts`(기존 보강): `extractInlineImageMarkdown` 케이스(순서·중복·특수문자).
- `buildAiDraftPrompt.test.ts`(기존 보강): `existingDraft` 주입/strip/title 단독/생략/규칙 라인.
- `buildAiDraftRequest.test.ts`(신규): images concat·undefined 가드·systemPrompt 위임. **통합 동작의 자동 회귀 게이트**.
- 기존 `parseAiDraftResponse`·`getModeImages` 테스트 회귀 확인.

### e2e 시나리오 (자동화 — BYOK mock, **후속 분리**)
> Chrome 빌트인(Gemini Nano)은 Playwright 환경에서 사용 불가(`useAI`가 `globalThis.LanguageModel.availability`로 판정, fetch 아님 → page.route 무력). **BYOK 경로만 자동화 가능**.
> 함정·결정 사항:
> - **apiKey obfuscation**: `settings-ui-store`는 `apiKeyObfuscatingStorage`로 저장/로드 시 obfuscate/deobfuscate. storage seed 시 평문 apiKey는 깨진다 → seed를 obfuscate된 값으로 넣거나, **route가 apiKey를 검증 안 하면 baseUrl만 mock**으로 우회.
> - **프로바이더 1개 고정**: openai-compatible로 고정, baseUrl=`http://127.0.0.1:<port>/v1`, 가로챌 경로 `**/chat/completions`. (Anthropic은 `**/messages`로 body 구조가 다름 — 혼용 금지.)
> - **payload 판정**: route 핸들러가 받은 request body의 `messages`(system+user content)에서 선입력 텍스트, `images`(content의 image_url) 존재를 단언.
> - **testid 부착 필요**: AI 생성 버튼(트리거)·`aiDraftLoading` 완료 신호에 `data-testid` 부착(현재 미확인). e2e 작성 시 src에 testid 추가만 허용(`/e2e-write` 규칙).
- "이미지를 첨부한 description 섹션에서 AI 초안을 생성하면, 응답 후 이미지가 텍스트 위에 유지된다."
- "이미지 없는 섹션에서 AI 초안을 생성하면, 섹션 내용이 mock 텍스트로 전체 교체된다."
- "AI 요청 시 mock 엔드포인트가 받은 payload에 선입력 텍스트와 이미지가 포함된다."
- "재오픈 후 재생성 시 mock이 받은 payload에 갱신된 최신 선입력이 포함된다."
- (회귀) 기존 `draft-resume`·`freeform-draft` spec이 이미지 섹션 세션 복원을 커버하는지 확인하고, 미흡하면 "이미지 섹션 세션 복원→표시" 1건을 회귀 가드로 추가.

### 수동 테스트 (Chrome — 빌트인 AI 경로)
- 빌트인 AI(Gemini Nano) 가능 환경에서 실제 이미지 첨부 → AI 생성 → 이미지 상단/텍스트 하단 확인.
- Task 5의 수동 회귀 체크리스트(타이핑·세션 복원·재오픈 유지·삽입 직후·resolve 중 연타).

## 구현 순서 권장

1. Task 1 → Task 2 (Task 2가 Task 1 의존).
2. Task 3 → Task 4 (Task 4가 Task 3 위임). 1·2와 병렬 가능.
3. Task 5 (독립, 언제든. Task 6 통합 검증 전 완료 필요 — 안 하면 이미지 섹션 화면 반영 안 됨).
4. Task 6 (1·2·3·4·5 완료 후 통합).

## 가이드 영향

- `guide/ko/settings/issue.md`·`guide/en/settings/issue.md` 또는 AI 초안 관련 가이드 페이지가 "AI 초안 생성이 선입력 내용·이미지를 반영하고 이미지를 보존한다"는 동작 변화를 다뤄야 하면 갱신. AI 초안 생성 동작을 설명하는 페이지가 있는지 `/guide`에서 대조 후 ko·en 동시 갱신. 사용자 노출 동작 변경이므로 갱신 가능성 높음. 판단·작성 기준은 `guide/AUTHORING.md`.
