# i18n Namespace Split — 구현 태스크

## 선행 조건

- 작업 시작 전 `git status` 깨끗.
- 시작 상태에서 `pnpm typecheck` 통과 확인.
- 분할 전 키 베이스라인 기록 (검증용):

```bash
awk -F'"' '/^  "[a-z]/ { print $2 }' src/i18n/ko.ts | sort > /tmp/i18n-keys-before.txt
wc -l /tmp/i18n-keys-before.txt  # 537이 나와야 함
```

## 태스크

### Task 1: 디렉터리 신설 + 첫 번째 ns 파일로 패턴 검증 (`common.ts`)

- **변경 대상**:
  - 신설: `src/i18n/namespaces/common.ts`
  - 수정 없음 (ko.ts·en.ts는 아직 그대로 — namespace 파일이 추가돼도 진입점에서 import 안 하면 build/test 영향 0)
- **작업 내용**:
  - 디렉터리 `src/i18n/namespaces/` 생성.
  - design.md "신설 파일 내부 형식" 패턴(`as const` + `type Bundle = Record<keyof typeof ko, string>` + `satisfies Bundle`)대로 `common.ts` 작성.
  - ko.ts에서 `common.*`·`time.*`·`bg.*` prefix 키 25개를 ko 객체로 복사 (들여쓰기 2칸, 정확히 동일한 따옴표 스타일 유지 — `awk`/`diff` 도구가 의존).
  - en.ts에서 같은 키 25개를 en 객체로 복사.
  - export `{ common = { ko, en } }`.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] common.ts의 ko 키 수가 25 (`awk -F'"' '/^  "[a-z]/ { print $2 }' src/i18n/namespaces/common.ts | sort -u | wc -l` → 25, ko·en이 같은 키를 갖는다는 가정 하에 합집합).
  - [ ] 분할 전 baseline의 common/time/bg 키와 정확히 일치 (`grep -E '^  "(common|time|bg)\.' src/i18n/ko.ts | awk -F'"' '{print $2}' | sort > /tmp/common-keys-source.txt`로 source 추출 후 `diff /tmp/common-keys-source.txt /tmp/common-keys-after.txt` 0 diff).
  - [ ] 타입 강제 자체 검증은 **Task 3 직후 진입점 교체 시점에 typecheck가 모든 키 일치를 강제하므로 별도 수동 fail/restore 테스트 생략** — 8개 ns 진행 중 의도치 않은 누락이 생기면 Task 3에서 즉시 fail.

### Task 2: 나머지 7개 ns 파일 신설

- **변경 대상**:
  - 신설: `src/i18n/namespaces/{app,issue,editor,integrations,settings,logs,ai}.ts`
- **작업 내용**:
  - Task 1과 동일 패턴으로 나머지 7개 파일 작성.
  - 각 파일이 묶을 prefix는 design.md "변경 범위 — 신설 디렉터리" 표 참조.
  - 각 ns 파일이 ko/en 양쪽 키 수가 일치하는지 작성 직후 점검.
  - **중간 일시 중단 시나리오**: Task 2 도중 작업을 멈춰야 하면 — 그 시점까지 추가된 namespace 파일들은 ko.ts/en.ts 진입점이 import 안 하므로 build·test에 영향 없음. `git add src/i18n/namespaces/` 후 자유롭게 stash·branch 전환. 재개 시 `wc -l src/i18n/namespaces/*.ts`로 어디까지 했는지 즉시 파악.
- **검증**:
  - [ ] 8개 파일 모두 존재.
  - [ ] `pnpm typecheck` 통과 (이 시점에서 ko.ts/en.ts는 namespace를 import하지 않으므로 namespace 파일 자체의 satisfies 검증만 통과).
  - [ ] 8개 파일의 ko 객체 키 총합 537:
    ```bash
    awk -F'"' '/^  "[a-z][a-zA-Z]*\..*": / { print $2 }' src/i18n/namespaces/*.ts | sort -u | wc -l
    # → 537
    ```
    (ko·en이 같은 키 보유, sort -u로 중복 제거하면 정확히 537개.)

### Task 3: ko.ts·en.ts 진입점 교체

- **변경 대상**:
  - 수정: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**:
  - ko.ts: 642줄 객체 리터럴 제거. 8개 ns import + spread merge + `as const` + `TranslationKey`/`TranslationMap` export + `satisfies TranslationMap`. design.md "수정 파일: src/i18n/ko.ts" 블록 그대로.
  - en.ts: 642줄 객체 리터럴 제거. 8개 ns import + spread merge + `satisfies TranslationMap`. design.md "수정 파일: src/i18n/en.ts" 블록 그대로.
  - 기존 default export 유지.
  - **한 commit에서 ko.ts·en.ts 동시 교체** — 어느 한쪽만 바꾸면 두 진입점 사이 키 일관성이 깨져 typecheck fail.
- **검증**:
  - [ ] `wc -l src/i18n/ko.ts` < 50.
  - [ ] `wc -l src/i18n/en.ts` < 50.
  - [ ] `pnpm typecheck` 통과 — 이 시점에서 8개 ns 파일 + 진입점 양쪽이 모든 키 일치를 강제. 어느 한 ns에서 키 누락 시 `satisfies TranslationMap` fail이 정확히 가리킴.
  - [ ] 호출처 어느 파일에서도 import 에러 없음 (200+ 위치의 `t("...")` 호출이 TranslationKey union 추론 그대로 받음).
  - [ ] `git diff src/i18n/index.ts` 결과 없음 (index.ts 변경 없는지 확인).
  - [ ] `git diff src/i18n/bg-init.ts` 결과 없음 (bg-init.ts 영향 없는지 확인).

### Task 4: 키 보존 검증 + 베이스라인 비교

- **변경 대상**: 없음 (검증 전용).
- **작업 내용**:
  - 분할 후 키 합집합 추출 (ko·en이 같은 키를 보유하므로 sort -u로 537 unique 기대):

```bash
awk -F'"' '/^  "[a-z][a-zA-Z]*\..*": / { print $2 }' src/i18n/namespaces/*.ts | sort -u > /tmp/i18n-keys-after.txt
wc -l /tmp/i18n-keys-after.txt  # 537이 나와야 함
```

  - 베이스라인(분할 전 ko.ts에서 추출)과 비교:

```bash
diff /tmp/i18n-keys-before.txt /tmp/i18n-keys-after.txt
# 출력 0 lines = 키 집합 완벽 일치
```

  - **ko/en 대칭 검증은 typecheck로 갈음** — `satisfies TranslationMap`이 양방향(ns 파일 내부 + ko.ts/en.ts 진입점) 누락·여분 모두 잡는다. awk로 ns 파일 안에서 ko·en을 분리 추출하려면 파일 구조 파싱이 필요해 부정확. 신뢰할 수 있는 검증은 `pnpm typecheck`.
- **검증**:
  - [ ] `diff /tmp/i18n-keys-before.txt /tmp/i18n-keys-after.txt` 0 lines (완전 일치).
  - [ ] `pnpm typecheck` 통과 (ko·en 양쪽이 모든 키 보유 강제).
  - [ ] (옵션) 동일 키 중복 정의 적발: `awk -F'"' '/^  "[a-z][a-zA-Z]*\..*": / { print $2 }' src/i18n/namespaces/*.ts | sort | uniq -c | awk '$1 != 2 { print }'` — 정상이면 모든 키가 2회(ko + en) 등장, 카운트가 2 아닌 키만 출력. 결과 0 lines이어야 함.

### Task 5: 호출처·테스트 회귀 확인

- **변경 대상**: 없음 (검증 전용).
- **작업 내용**:
  - `pnpm test` 전체 실행. 기존 i18n 테스트가 있다면 함께 통과.
  - 수동 검증: 사이드패널 한 번 띄워서 (a) 한국어 모드 (b) 영어 모드 전환 시 라벨이 모두 표시되는지 sample 확인.
    - 디버그 탭의 캡처 모드 선택 화면 4종 (DOM/화면/영상/자유)
    - 이슈 작성 → drafting 패널의 섹션 라벨 4종
    - 연동 탭의 Jira·GitHub·Linear·Notion sub-tab 4종
    - 설정 탭의 AI 모델 sub-tab
    - 이슈 목록 탭의 필터 칩 + status badge popover
- **검증**:
  - [ ] `pnpm test` 0 실패.
  - [ ] 수동 회귀 — 깨진 라벨(빈 문자열·undefined·키 그대로 노출) 없음.

## 테스트 계획

### 단위 테스트

- 신규 추가 없음 (PRD "비목표" 명시). 기존 `src/i18n/__tests__/`가 있다면 그대로 통과시킨다.

### 수동 테스트 시나리오 체크리스트 (Task 5)

- [ ] 사이드패널 첫 진입 — 4개 메인 탭 라벨(디버그/이슈 목록/연동/설정) 표시.
- [ ] 한국어 ↔ 영어 토글 → 위 4 라벨 변화.
- [ ] 디버그 탭 빈 상태 → 캡처 모드 4종 라벨.
- [ ] 이슈 작성 진입 → drafting 패널의 환경 정보·발생 현상·재현 과정·기대 결과·비고 라벨.
- [ ] 이슈 목록 → 필터 칩(전체/제출됨/드래프트) + 검색 placeholder + 빈 상태.
- [ ] 연동 탭 → 4 플랫폼 sub-tab + 각 form 안의 label·placeholder·도움말.
- [ ] 설정 탭 → 이슈 섹션 on/off 라벨 + AI 모델 sub-tab.
- [ ] OAuth 만료 다이얼로그 (각 플랫폼 1회씩 트리거 — 실제로 만료 안 됐어도 코드에서 메시지 확인).
- [ ] Toast 에러 메시지 (잘못된 입력 trigger).

## 구현 순서 권장

```
Task 1 (common.ts 신설 — 패턴 검증 + 작은 ns로 워밍업)
   │
   └─→ Task 2 (나머지 7 ns 신설)
          │
          └─→ Task 3 (ko.ts·en.ts 교체)
                 │
                 └─→ Task 4 (키 보존 검증)
                        │
                        └─→ Task 5 (호출처·테스트 회귀)
```

- 모두 직렬. 분기 없음.
- Task 1·2는 작업량이 큰 편 — 한 ns 파일당 25~156줄(ko) + 동일 수의 en. 큰 namespace(integrations 156, logs 88, editor 81)는 복사·붙여넣기 실수가 회귀로 직결되므로 한 prefix 묶음 단위로 ko·en 동시 작성 → 작성 직후 typecheck로 확인.
- Task 3 직전까지는 ko.ts·en.ts가 그대로라 i18n 동작 영향 없음. Task 3에서 ko.ts·en.ts를 한 commit 안에서 동시 교체 (어느 한쪽만 바꾸면 둘 사이 키 일관성이 깨져 typecheck fail).
