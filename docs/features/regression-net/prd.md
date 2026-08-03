# 회귀 검출 그물 (regression-net)

## 배경

v1.7.x 릴리스 11개에서 잡은 버그의 상당수가 **도그푸딩 중 실사용에서** 발견됐다. 그 전에 `/audit`·`/code-review`를 여러 라운드 돌렸는데도 통과했다. 왜 통과했는지는 `pnpm postmortem:report` 집계가 답을 갖고 있다 (회고 79건 기준):

| 계열 | 건수 | 왜 정적 리뷰로 안 잡히나 |
|---|---|---|
| `라이브러리전제` | 28 (35%) | 코드는 정합적이고 **전제가 틀렸다**. 리뷰어가 나와 같은 전제를 공유하므로 같이 통과시킨다. |
| `미검증단언` | 26 (33%) | 잘못된 값이 그럴듯하게 렌더돼 **조용히** 살아남는다. 눈으로 이상하다고 느낄 때까지 신호가 없다. |
| `복제본` | 23 (29%) | 리뷰는 "이 파일이 맞나"를 보지 **"저 파일과 같나"** 를 안 본다. 대칭성은 파일 단위 리뷰의 구조적 사각. |
| `드리프트` | 8 (10%) | 하드코딩이 단일 출처와 갈라진 것. 위와 같은 사각. |

구체적 사례:

- `Chrome이 custom property를 완전 치환한다`는 전제를 안 세워서 토큰 이름이 `#fff`로 바뀐 채 출력 (2026-08-03)
- `Chrome이 Tailwind `2xl:mt-4`를 `.\32 xl\:mt-4`로 직렬화한다`를 몰라 specificity가 부풀었다 (2026-08-03)
- 오버레이를 숨기는 그 동작이 곧 hit target 포기라는 걸 몰라 hover가 스크린샷에 찍혔다 (2026-08-03)
- 팔레트를 "단일 출처로 승격했다"고 커밋했는데 복제본이 그대로 남아 있었다 — **diff에 등장하지 않는 파일이라 diff 리뷰의 사각** (2026-07-16)

그리고 유닛 테스트는 이 종류를 **원리적으로** 못 잡는다. `e2e/style-specificity.spec.ts` 주석이 그 이유를 적어놨다 — `selectorText`·`el.matches`·`parentRule`을 전부 스텁하면 "브라우저가 무엇을 돌려주는가"라는 전제 자체를 테스트가 동어반복으로 승인한다. 그물 태그에서 `unit`이 47%로 1위인 건 "유닛이 잡았어야 했다"가 아니라 **유닛이 잡은 척했다**에 가깝다.

## 목표

1. **복제본 쌍이 갈라지면 `pnpm test`에서 실패한다.** 새 복제본을 만들 때 대조 테스트 등록을 강제하고, 미등록·편도(one-way) 마커·죽은 checker를 전부 차단한다.
2. **미검증 외부 전제가 큐로 누적된다.** `/audit`·`/code-review`가 "이 코드가 딛고 선 외부 전제 + 무엇으로 검증됐나"를 산출하고, 미검증 항목이 `docs/ASSUMPTIONS.md`에 쌓여 `/e2e-write`의 입력이 된다.
3. **불변식 위반이 도그푸딩 중 눈에 보인다.** dev·일반 빌드에서 불변식이 깨지면 사이드패널 상단에 배너가 뜬다. store 빌드는 no-op.
4. **e2e가 불변식 위반을 승격한다.** spec 종료 시 위반이 남아 있으면 그 spec을 실패시킨다 — 도그푸딩을 기다리지 않고 자동 그물이 먼저 잡는다.
5. **캐스케이드 판정이 실제 Chrome CSSOM 위에서 전수 검증된다.** 프레임워크 CSS 코퍼스의 요소를 훑어 확장의 specified 판정을 브라우저와 대조한다.

## 비목표 (Non-goals)

- **사용자 노출 기능 아님.** UI 변경은 dev 전용 불변식 배너 하나뿐이고 store 빌드에는 존재하지 않는다.
- **문서 쌍(`README.md` ↔ `README.ko.md`, `docs/privacy.{ko,en}.md`)은 복제본 레지스트리 대상에서 제외.** 번역이라 값 일치 검사가 불가능하고, 이미 `/push` 4단계가 트라이아지한다.
- **`AGENTS.md`·`.agents/skills/` 미러도 제외.** `pnpm sync:agents:check`가 이미 게이트다.
- **전제 큐 집계 스크립트 없음.** `postmortem:report` 같은 랭킹은 만들지 않는다. 큐는 "쌓고 비우는" 용도지 세는 용도가 아니다.
- **어댑터 8개 전수 record-replay 안 함.** 회귀 이력이 있는 3개(Jira·Slack·GitHub)만.
- **시각 diff를 사이드패널 전반에 깔지 않음.** 표면 3개로 좁힌다 — 베이스라인 유지비와 xvfb 렌더 flaky가 커버리지 이득을 넘어선다.
- **라이브 사이트를 테스트 입력으로 쓰지 않음.** CI 비결정성 + 네트워크 의존.
- **기존 대조 테스트 3벌을 다시 쓰지 않음.** `src/i18n/__tests__/locales.test.ts`·`src/log-viewer/__tests__/i18n.test.ts`·`src/styles/__tests__/tokens.test.ts`는 그대로 두고 마커만 붙인다.

## 사용자 시나리오

여기서 "사용자"는 이 저장소에서 작업하는 개발자(Claude Code·Codex 세션 포함)다.

### S1. 새 복제본을 만든다

1. `recorders-entry` 청크 제약 때문에 `src/content/foo.ts`를 `src/sidepanel/lib/foo.ts`로 복사한다.
2. `pnpm test` → **실패**: `duplicate-markers: src/sidepanel/lib/foo.ts는 src/content/foo.ts와 내용이 거의 같은데 마커가 없다`
3. 양쪽에 마커 3줄(`@duplicate-of` / `@duplicate-checker` / `@duplicate-reason`)을 넣고 대조 테스트를 작성한다.
4. `pnpm test` 통과.

**엣지**: 한쪽에만 마커를 넣으면 편도 마커로 실패한다. `@duplicate-checker`가 가리키는 테스트 파일이 없거나 두 경로 중 하나를 언급하지 않아도 실패한다.

### S2. 복제본 한쪽만 고친다

1. `src/log-viewer/i18n.ts`의 `koDict`에 키를 추가하고 `src/i18n/namespaces/logs.ts`는 안 고친다.
2. `pnpm test` → 기존 `src/log-viewer/__tests__/i18n.test.ts`가 잡는다 (현행 동작 유지).

### S3. 리뷰가 미검증 전제를 뽑아낸다

1. `/code-review`를 돌린다.
2. 시급도 리포트 끝에 **"미검증 외부 전제"** 섹션이 붙는다: `css-resolve.ts:matchedSpecificity`는 `el.matches()`가 `:has()` 셀렉터에서 throw하지 않는다고 전제 — 검증: 없음
3. 사용자가 승인하면 메인 세션이 `docs/ASSUMPTIONS.md`에 항목을 추가한다(기존 항목과 중복이면 스킵).
4. 나중에 `/e2e-write`를 돌릴 때 이 큐를 읽어 spec 대상 후보로 쓴다. spec이 green이 되면 해당 항목을 삭제한다.

**엣지**: 이미 `검증: e2e:<spec>`인 항목이 다시 뽑히면 갱신만 하고 중복 추가하지 않는다.

### S4. 도그푸딩 중 불변식이 깨진다

1. `pnpm build` 후 실제 탭에서 element 모드로 스타일을 편집한다.
2. before/after 캡처 기준이 어긋나는 순간 사이드패널 상단에 빨간 배너: `⚠ invariant(capture): before/after basis mismatch — container vs element`
3. 배너를 클릭하면 위반 목록(최대 50건)이 펼쳐지고, 복사 버튼으로 전문을 클립보드에 담는다.
4. store 빌드에는 이 코드가 아예 없다(`__DEV_CHECKS__` define이 false → 죽은 분기 제거).

### S5. e2e가 불변식을 승격한다

1. 아무 spec이나 돌린다.
2. spec 종료 시 fixture가 사이드패널·content·background 세 컨텍스트의 위반 배열을 수집한다.
3. 비어 있지 않으면 그 spec을 실패시키고 위반 전문을 리포트에 출력한다.

**엣지**: 위반을 **의도적으로** 유발하는 spec은 fixture 옵션으로 그 스코프를 면제한다.

### S6. 캐스케이드 판정을 코퍼스로 검증한다

1. `pnpm test:e2e --project=cascade`
2. Playwright가 확장 없이 프레임워크 코퍼스 페이지를 열고, 번들된 `css-resolve` 프로브를 주입한다.
3. 페이지의 요소 표본을 훑어 각 prop마다 **적용 왕복 검사**를 한다 — 확장이 고른 specified 값을 그 요소에 인라인으로 다시 적용했을 때 computed가 변하지 않아야 승자 판정이 맞다.
4. 불일치가 나오면 `요소 셀렉터 / prop / 확장 판정 / computed(전) / computed(후)`를 출력하고 실패.

**엣지**: 확장이 판정을 포기하고 computed 폴백으로 떨어진 prop은 왕복이 자명하게 성립하므로 **판정 대상에서 제외하고 카운트만** 남긴다(폴백률이 갑자기 치솟으면 그 자체가 신호).

## 성공 기준

- [ ] 현재 살아 있는 복제본 쌍 전부에 마커가 붙고, 마커 없는 신규 복제본이 `pnpm test`에서 실패한다.
- [ ] 편도 마커·죽은 checker·checker가 한쪽 경로만 언급하는 경우가 각각 실패한다(뮤턴트 3종으로 red 확인).
- [ ] `/audit`·`/code-review` 리포트에 "미검증 외부 전제" 섹션이 나오고, `docs/ASSUMPTIONS.md`가 생성돼 최소 5개 항목으로 시드된다.
- [ ] `__DEV_CHECKS__`가 false인 `build:store` 산출물에 불변식 문자열이 0건이다(`grep`으로 확인).
- [ ] 초기 불변식 4개가 각각 인위적 위반으로 배너를 띄우고, e2e가 그 위반으로 실패한다.
- [ ] cascade project가 프레임워크 코퍼스에서 green이고, `matchedSpecificity` 비교를 무력화하는 뮤턴트에서 red가 된다.
- [ ] 시각 diff 3표면이 CI에서 green이고 로컬에서는 skip된다.
- [ ] Jira·Slack·GitHub record-replay 픽스처에 토큰·PII가 0건이다(스크러빙 체크리스트 통과).
