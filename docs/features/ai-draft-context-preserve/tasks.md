# AI 초안 생성 — 선입력 컨텍스트 활용 & 이미지 보존 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변화 없음. manifest 변경 없음.
- 신규 의존성 없음.
- 영향 컴포넌트가 공용(`TiptapEditor`)이므로 Task 4는 회귀 확인을 반드시 동반.

## 태스크

### Task 1: 이미지 markdown 추출 유틸 추가
- **변경 대상**: `src/sidepanel/lib/resolveInlineImages.ts`
- **작업 내용**: `extractInlineImageMarkdown(markdown: string): string[]` 추가 — `![alt](inline:ref)` 매치를 alt 포함 통째로 등장 순서대로 반환. 기존 `INLINE_REF_RE` 재사용 또는 동등 정규식.
- **검증**:
  - [ ] 이미지 0개 → `[]`
  - [ ] 1개 → alt·ref 보존된 markdown 1개
  - [ ] 여러 개 → 등장 순서 유지
  - [ ] 텍스트 사이에 섞인 이미지도 모두 추출

### Task 2: 섹션 병합 순수 함수 추가
- **변경 대상**: `src/sidepanel/lib/mergeAiDraftSections.ts` (신규) + `__tests__/mergeAiDraftSections.test.ts`
- **작업 내용**: `mergeAiSectionsPreservingImages(prevSections, aiSections)` 구현. 섹션별로 `extractInlineImageMarkdown(prev)`의 이미지를 상단에, `aiSections` 텍스트를 그 아래(`이미지\n\n텍스트`)에 결합. 이미지 없으면 ai 텍스트만. ai에 없고 prev 이미지만 있으면 이미지만.
- **검증**:
  - [ ] 이미지 없는 섹션 → ai 텍스트로 전체 교체
  - [ ] 이미지 1개 + ai 텍스트 → `이미지\n\n텍스트`
  - [ ] 이미지 N개 → 원본 순서대로 상단, 그 아래 텍스트
  - [ ] ai 텍스트 빈 문자열 + 이미지 있음 → 이미지만
  - [ ] ai에 누락된 섹션 + prev 이미지 있음 → 이미지만 남음
  - [ ] ai에만 있는 새 섹션 → 그대로 채택

### Task 3: 세션 프롬프트에 선입력 컨텍스트 주입
- **변경 대상**: `src/sidepanel/lib/buildAiDraftPrompt.ts` + `__tests__/buildAiDraftPrompt.test.ts`
- **작업 내용**: `AiDraftSessionContext`에 `existingDraft?` 추가. `buildAiDraftSessionPrompt`에서 `existingDraft`의 title+각 섹션 텍스트를 `stripInlineImageRefs`로 정제해 "현재 작성본(참고용)" 블록 추가. 모두 공백이면 블록 생략. 응답에 이미지 markdown을 넣지 말라는 규칙 1줄 추가.
- **검증**:
  - [ ] `existingDraft`에 텍스트 있으면 프롬프트에 해당 텍스트 포함
  - [ ] inline 이미지 ref(`inline:`)는 프롬프트에 노출 안 됨(strip)
  - [ ] title도 블록에 포함
  - [ ] 빈 draft → 블록 미포함(기존 출력과 동일)
  - [ ] "이미지 markdown 출력 금지" 규칙 라인 존재

### Task 4: TiptapEditor 잔류 플래그 버그 수정 (C)
- **변경 대상**: `src/sidepanel/components/TiptapEditor.tsx`
- **작업 내용**: mount inline-resolve effect의 `isInternalChange.current = true`(현재 :238 부근) 제거. value-sync·onUpdate 경로는 유지.
- **검증**:
  - [ ] (수동) 이미지 있는 섹션에서 AI 생성 시 에디터 화면이 즉시 갱신됨
  - [ ] (수동) 세션 복원 후 inline 이미지가 정상 표시됨
  - [ ] (수동) 이미지 있는 섹션에서 타이핑 시 커서 점프·내용 손실 없음
  - [ ] (수동) 이미지 drag/paste 삽입 직후 추가 타이핑 정상

### Task 5: AiDraftDialog 통합 — 컨텍스트 전달 + 이미지 합치기 + 병합 적용
- **변경 대상**: `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**:
  - `buildAiDraftSessionPrompt` 호출에 `existingDraft: { title, sections }` 추가.
  - 첫 메시지 `images`에 `resolveInlineImagesForSections(sections, issueSections)`의 `dataUrl`들을 `getModeImages` 결과와 concat(둘 다 없으면 undefined).
  - 응답 적용을 `mergeAiSectionsPreservingImages(prevSections, parsed.sections)`로 변경. title·environment 처리 유지.
- **검증**:
  - [ ] (수동/BYOK) 선입력 텍스트가 LLM 요청 systemPrompt에 포함
  - [ ] (수동/BYOK) 선업로드 이미지가 요청 images에 포함
  - [ ] (수동) 응답 후 이미지 있던 섹션 = 이미지 상단 + 텍스트 하단
  - [ ] (수동) 이미지 없던 섹션 = 전체 교체
  - [ ] `pnpm test` green, `pnpm typecheck` 통과

## 테스트 계획

### 단위 테스트 (Vitest)
- `mergeAiDraftSections.test.ts`: Task 2 검증 항목 전부.
- `resolveInlineImages.test.ts`(기존 파일 있으면 보강): `extractInlineImageMarkdown` 케이스.
- `buildAiDraftPrompt.test.ts`(기존): `existingDraft` 주입/strip/생략/규칙 라인.
- 기존 `parseAiDraftResponse`·`getModeImages` 테스트 회귀 확인.

### e2e 시나리오 (자동화 — BYOK mock 필요)
> Chrome 빌트인(Gemini Nano)은 Playwright 환경에서 사용 불가(`useAI`의 availability가 항상 unavailable). **BYOK 경로로만 자동화 가능**: settings에 더미 LLM(baseUrl+modelId) 주입 후 `page.route`로 LLM 엔드포인트(`/chat/completions` 또는 `/messages`)를 고정 JSON으로 mock.
- 신규 fixture: LLM 응답 mock 헬퍼(`page.route`) + 더미 LLM 설정 주입.
- "이미지를 첨부한 description 섹션에서 AI 초안을 생성하면, 응답 후 이미지가 텍스트 위에 유지된다."
- "이미지 없는 섹션에서 AI 초안을 생성하면, 섹션 내용이 mock 텍스트로 전체 교체된다."
- "AI 요청 시 mock 엔드포인트가 받은 payload에 선입력 텍스트와 이미지가 포함된다."
- (선택) BYOK mock fixture는 신규 인프라라 난이도 있음 — 우선 단위 테스트로 핵심 로직을 덮고, e2e는 fixture 구축 후 추가.

### 수동 테스트 (Chrome — 빌트인 AI 경로)
- 빌트인 AI(Gemini Nano) 사용 가능한 환경에서 실제 이미지 첨부 → AI 생성 → 이미지 상단/텍스트 하단 확인.
- Task 4의 수동 회귀 체크리스트(타이핑·세션 복원·삽입 직후).

## 구현 순서 권장

1. Task 1 → Task 2 (Task 2가 Task 1 의존). 병렬 불가.
2. Task 3 (독립, 1·2와 병렬 가능).
3. Task 4 (독립, 언제든. 단 Task 5 통합 검증 전 완료 필요 — 안 하면 이미지 섹션 화면 반영 안 됨).
4. Task 5 (1·2·3·4 완료 후 통합).

## 가이드 영향

- `guide/ko/settings/issue.md`·`guide/en/settings/issue.md` 또는 AI 초안 관련 가이드 페이지가 "AI 초안 생성이 선입력 내용·이미지를 반영하고 이미지를 보존한다"는 동작 변화를 다뤄야 하면 갱신. AI 초안 생성 동작을 설명하는 페이지가 있는지 `/guide`에서 대조 후 ko·en 동시 갱신. 사용자 노출 동작 변경이므로 갱신 가능성 높음. 판단·작성 기준은 `guide/AUTHORING.md`.
