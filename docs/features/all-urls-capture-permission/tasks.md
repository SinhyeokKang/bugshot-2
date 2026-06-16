# 광역 캡처 권한을 `<all_urls>`로 전환 — 구현 태스크

## 선행 조건

- `chrome.permissions.request({ origins: ["<all_urls>"] })`가 실제 Chrome에서 권한 다이얼로그를 띄우고 grant되는지 사전 확인(Task 3 수동 검증과 연동).
- 변경 후 dev 로드 언팩으로 테스트(`pnpm build`, `key` 유지 빌드).

## 태스크

### Task 1: 광역 권한 상수를 `<all_urls>`로 변경
- **변경 대상**: `src/lib/broad-host-origins.ts`
- **작업 내용**: `BROAD_HOST_ORIGINS = ["https://*/*", "http://*/*"]` → `["<all_urls>"]`.
- **검증**:
  - [ ] `BROAD_HOST_ORIGINS`가 `["<all_urls>"]`다.
  - [ ] 이 상수를 참조하는 SettingsTab·use-30s-replay·tab-bindings에 컴파일 에러 없음 (`pnpm typecheck`).

### Task 2: manifest optional_host_permissions 변경
- **변경 대상**: `manifest.config.ts:88`
- **작업 내용**: `optional_host_permissions: ["https://*/*", "http://*/*"]` → `["<all_urls>"]`. `host_permissions`·`permissions`는 변경 없음.
- **검증**:
  - [ ] 빌드 산출 manifest의 `optional_host_permissions`가 `["<all_urls>"]`.
  - [ ] `host_permissions`(특정 플랫폼 목록) 변동 없음.

### Task 3: 가드 단위 테스트 추가/갱신
- **변경 대상**: `src/lib/__tests__/broad-host-origins.test.ts`(신규 또는 기존), 필요 시 `tab-bindings` 분기 테스트 확인.
- **작업 내용**: `BROAD_HOST_ORIGINS`가 `["<all_urls>"]`임을 고정하는 가드 테스트. `resolveNavigationAction`/`isBroadCoveredUrl`은 로직 변경이 없으므로 기존 테스트가 통과하는지만 확인(http/https는 broadCovered=true, file:은 false 유지).
- **검증**:
  - [ ] 신규/기존 단위 테스트 `pnpm test` 통과.
  - [ ] `isBroadCoveredUrl(file:...)`가 여전히 false (file: 비목표 경계 회귀 없음).

### Task 4: 권한 문서 갱신
- **변경 대상**: `PERMISSION.md`, `docs/privacy.md`
- **작업 내용**:
  - `PERMISSION.md`: optional_host_permissions 표기(line 62-63), `BROAD_HOST_ORIGINS` 값(§12 line 540), 분기표 주석(line 144·225·274·279). "광역 권한 보유 시 cross-origin 만료 미발생" 서술이 이제 사실과 일치함을 반영(captureVisibleTab이 `<all_urls>`로 실제 동작).
  - `docs/privacy.md`: line 92·139의 `https://*/*`, `http://*/*` → `<all_urls>`. GitLab self-managed·30s Replay·BYOK 설명의 권한 문자열 일치. 시행일 갱신.
- **검증**:
  - [ ] 두 문서에 구 권한 문자열(`https://*/*`, `http://*/*`)이 광역 권한 맥락에서 남아있지 않음(특정 플랫폼 host_permissions 표기는 별개).
  - [ ] privacy.md 시행일 갱신됨.

## 테스트 계획

- **단위 테스트**: `BROAD_HOST_ORIGINS === ["<all_urls>"]` 가드. `isBroadCoveredUrl` — http/https=true, file:=false 유지 케이스(기존 테스트 재확인).
- **e2e 시나리오**: 권한 다이얼로그(`chrome.permissions.request`)는 Playwright로 제어 불가하고 cross-origin 캡처는 실 권한 grant가 필요 → **자동화 비대상**. (e2e 영향: 없음)
- **수동 테스트** (captureVisibleTab 의존 — Chrome에서 확인):
  - [ ] replay 토글 ON → 권한 다이얼로그에 `<all_urls>`("모든 웹사이트") 표시 → 허가 → replay 활성화.
  - [ ] origin A(https)에서 사이드패널 오픈 → B(다른 https origin)로 이동 → **캡처 성공**(Permission expired 안 뜸).
  - [ ] 같은 흐름에서 pick element → 영역 캡처·inline 캡처 성공.
  - [ ] origin B에서 30s Replay 버퍼가 계속 쌓임(bufferedSeconds 증가).
  - [ ] 구 권한(`https://*/*`)만 가진 프로필에서 업데이트 → replay 자동 비활성화 + permissionRevoked 토스트 → 토글 재ON 시 `<all_urls>` 재요청.
  - [ ] file:// 페이지에서 cross-origin 이동 후 캡처 → 현행대로 만료 처리(회귀 없음).
  - [ ] BYOK LLM 프로바이더 연결(특정 origin 요청) 정상 동작.

## 구현 순서 권장

1. Task 1 → Task 2 (상수·manifest 동시 변경, 둘이 짝).
2. Task 3 (단위 테스트, `pnpm test` 통과 확인).
3. Task 4 (문서 — `/push` 신선도 게이트 충족).
4. 수동 테스트는 Task 1·2 적용 후 dev 로드 언팩으로 실행.

Task 1·2는 병렬 불가(한 PR에 함께). Task 3·4는 Task 1·2 이후 병렬 가능.

## 가이드 영향

`guide/`에 30s Replay 권한 요청을 설명하며 `https://*/*` 등 권한 문자열을 노출하는 페이지가 있으면 ko·en 대조·갱신(`/guide`). 권한 문자열을 언급하지 않고 "권한 허용" 수준으로만 안내한다면 **없음**. `/guide` 단계에서 `guide/AUTHORING.md` 기준으로 30s Replay 관련 페이지(예: `capture/replay.md` 류)에 광역 권한 문자열 노출 여부를 확인 후 결정한다.
