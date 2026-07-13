---
name: "source-command-tdd"
description: "테스트 코드만 작성. 구현·픽스·커밋 안 함. 새 인터페이스 박기 또는 버그 회귀 테스트 박기."
---

# source-command-tdd

Use this skill when the user asks to run the migrated source command `tdd`.

## Command Template

테스트 코드를 **먼저** 짜는 단계 전용 스킬. 구현은 다음 단계에서 사용자 판단으로. 이 스킬은 **테스트 파일만** 만들고, fail 확인하고, 끝낸다.

## 사용

- `/tdd` — 직전 컨텍스트(방금 끝낸 `/feature` 결과물 / `/code-review` 발견)에서 모드 자동 판단.
- `/tdd interface <대상 설명>` — **A 모드 명시**: 신규 함수·헬퍼 시그니처를 테스트로 결정.
- `/tdd regression <버그 설명>` — **B 모드 명시**: 발견된 버그·엣지케이스를 재현하는 테스트.

## 두 가지 모드

### A. 신규 인터페이스 박기 (`/feature` 직후)

새 헬퍼·함수를 **테스트가 시그니처를 결정하게**. 입력·출력·엣지케이스를 먼저 굳히면 구현이 외과적이 된다.

- 대상 모듈이 아직 없어도 OK — import 실패가 첫 red.
- 시그니처는 호출하는 쪽 관점으로 짠다 (이름, 인자 순서, 반환 타입).
- 케이스 순서: 가장 단순한 정상 → 엣지(빈 입력, undefined, 경계값) → 에러.

### B. 회귀 테스트 박기 (`/code-review` 직후, 또는 버그 발견 시)

발견된 버그를 **재현하는 테스트**부터. 픽스 전에 빨간불을 확인해야 진짜 같은 버그를 잡았다고 보장 가능.

- 대상은 `/code-review`에서 🔴/🟡로 분류된 항목 또는 사용자 지정 버그.
- 테스트는 "이 입력에서 이 결과가 나와야 한다"로 — 픽스 후의 기대값을 박는다.
- 기존 테스트가 있으면 같은 파일에 case 추가, 없으면 신규.

## TDD 강제 vs 스킵 (이 프로젝트 기준)

판단을 매번 즉흥으로 하지 않도록 분류표를 박아둔다.

### ✅ TDD 강제 (이 스킬을 거의 항상 호출)

- **순수 함수 헬퍼**: `src/lib/*`, `src/sidepanel/lib/build*.ts`, `parseXxx` / `formatXxx` / `extractXxx`
- **마이그레이션 함수**: `src/store/*-migrations.ts`, `migrateV*ToV*` pure helper
- **초기값 / reconcile 헬퍼**: `initial*Fields`, `reconcile*Fields`
- **정규식·매핑 테이블**: 색 카테고리 매핑, URL 파싱, key 분류
- **API 응답 mapper (pure)**: `parseDatabaseSchema`, `buildXxxAuthHeader` 같은 부수효과 없는 함수
- **재현되는 버그**: 입력으로 깨지는 게 확정된 케이스

### ❌ TDD 스킵 OK (사후 수동 검증 또는 `/build` 체크리스트로)

- **React 컴포넌트 동작·레이아웃·인터랙션** — 실 브라우저 검증이 더 정확
- **content script DOM 측정** — picker, overlay, MutationObserver
- **MV3 메시지 라우터 자체** — 핸들러 분배 코드 (개별 핸들러의 pure 부분은 강제)
- **OAuth 플로우** — `chrome.identity.launchWebAuthFlow` 의존
- **외부 API 직접 호출** — fetch 모킹 비용 > 가치인 케이스
- **service worker init** — `chrome.runtime.onInstalled` 등 lifecycle hook

스킵 결정 시 **이유를 한 줄로 보고**하고 종료. "스킵 OK라 안 짭니다" 무성의 금지.

## 절차

### 1. 모드·범위 결정

- 인자에서 모드 추출 (`interface` / `regression` / 자동).
- 자동 모드: 직전 대화에서 `/feature` 산출물(`docs/features/.../tasks.md` 등)이면 A. `/code-review` 발견 리스트면 B.
- 대상 후보를 추려서 분류표(위 ✅/❌)와 대조. 강제/스킵을 먼저 결론.
- 스킵이면 이유 보고 후 종료.

### 2. 테스트 파일 위치 결정

- 컨벤션: 대상과 같은 디렉터리의 `__tests__/*.test.ts`.
- 기존 테스트 파일에 케이스 추가가 자연스러우면 신규 생성 금지.
- 새 파일은 대상 모듈명과 매칭: `notion-page-id.ts` → `__tests__/notion-page-id.test.ts`.

### 3. 테스트 작성

- **Vitest** 사용 (`describe` / `it` / `expect` / `vi`).
- 한국어 describe/it 허용 (기존 테스트도 그렇게 작성됨).
- AAA: Arrange / Act / Assert. 한 `it`에 한 가지만.
- i18n 의존 코드 테스트할 땐 mock — 기존 패턴 그대로:
  ```ts
  vi.mock("@/i18n", () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (params) {
        let s = key;
        for (const [k, v] of Object.entries(params)) s += ` ${k}=${v}`;
        return s;
      }
      return key;
    },
    dateBcp47: () => "en-US",
  }));
  ```
- chrome API 의존하면 `vi.stubGlobal("chrome", {...})` 최소 모킹 (notion-oauth.test.ts 참고).
- 케이스 갯수: 정상 1~2 + 엣지 2~4 + 에러 1~2가 표준. 과잉 테스트 금지 — 같은 분기를 다섯 번 검증하지 말 것.

### 4. fail 확인 (red 단계)

- `pnpm test --run <테스트파일경로>` 또는 `pnpm test --run`으로 새 테스트 실행.
- A 모드: import 실패 또는 함수 미정의로 fail이 정상 → "red 확인됨" 보고.
- B 모드: 새 테스트가 fail (현재 코드가 버그를 재현하므로) 또는 pass (예상과 다름).
  - fail이면: "red 확인됨, 픽스 단계로" 보고.
  - 예상치 않게 pass면: 테스트가 버그를 진짜로 재현 못 함 — 입력·기대값 재검토.

### 5. 종료

- 변경 파일 목록과 fail 메시지 핵심만 보고.
- **구현·픽스 안 함**. **커밋 안 함**. **빌드 안 함**.
- 다음에 사용자가 할 일 한 줄 안내: "`/implement`로 구현하면 green으로 전환됩니다." 정도.

## 다른 스킬과의 분리

- `/feature` — 설계 문서. 테스트도 코드도 안 만듦.
- `/tdd` ← 여기. **테스트 파일만**.
- `/implement` — 이 테스트를 green으로 만드는 구현 단계.
- `/code-review` — 진단 리포트만.
- `/build` — 빌드 + 수동 테스트 체크리스트.

## 금지 사항

- **구현 코드 작성 금지**. 테스트가 import하는 모듈이 없어 fail이어도 그게 정상. 모듈을 만들지 말 것.
- **기존 테스트 임의 수정 금지**. 단, 회귀 테스트가 기존 테스트의 잘못된 기대값을 드러내면 그 한 케이스만 수정하고 이유 보고.
- **테스트를 통과시키려고 모킹 남발 금지**. 모킹은 외부 의존(chrome, i18n, 네트워크)에만. 검증 대상 함수 자체는 모킹 안 함.
- **빌드·typecheck·커밋 안 함**. `pnpm test`만 실행.
- **추측성 케이스 남발 금지**. 분류표·코드 컨벤션·실제 발견 사항에 근거 댈 수 있는 케이스만.

## 보고 형식

```
모드: <A 또는 B>
대상: <함수/모듈 이름 + 파일 경로>
판단: <강제 / 스킵 — 이유>

(스킵이면 여기서 종료)

테스트 파일: <경로>
케이스: <N개>
- 정상: ...
- 엣지: ...
- 에러: ...

실행 결과: red 확인됨 (X tests failed) / 예상치 않게 pass — 재검토 필요
다음 단계: 구현 진행
```
