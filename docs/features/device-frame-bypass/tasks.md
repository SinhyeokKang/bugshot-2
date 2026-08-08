# 디바이스 뷰포트 — 프레임 차단 헤더 우회 · 구현 태스크

## 선행 조건

- `@types/chrome@0.0.280`에 `declarativeNetRequest` 타이핑이 있다(확인 완료 —
  `updateSessionRules`·`RuleActionType`·`HeaderOperation`·`ResourceType`).
- `host_permissions: ["<all_urls>"]`를 이미 required로 보유한다 → `modifyHeaders` 액션에
  필요한 host access가 충족된다. 새로 요청할 host 권한이 없다.
- 새 npm 의존성 없음. `pnpm-workspace.yaml`의 `minimumReleaseAge` 정책에 걸릴 것이 없다.
- 착수 전 `docs/POSTMORTEM.md`를 `device`·`arm`·`판정`·`세션` 키워드로 grep한다
  (CLAUDE.md 소환 회로).

---

## 태스크

### Task 1: 룰 빌더 순수 함수 + 테스트 (TDD red 먼저)

- **변경 대상**: `src/background/__tests__/frame-header-rules.test.ts`(신규),
  `src/background/frame-header-rules.ts`(신규)
- **작업 내용**: `ruleIdForTab`·`buildFrameUnblockRule`을 테스트로 먼저 고정한 뒤 구현한다.
  chrome API를 부르지 않는 순수 부분만 이 태스크에 넣는다.
- **검증**:
  - [ ] `buildFrameUnblockRule(7)`이 `id === 7`, `priority === 1`을 갖는다
  - [ ] `action.type`이 `modifyHeaders`이고 `responseHeaders`가 `x-frame-options`·
        `content-security-policy` 둘 다 `remove`로 담고 있다
  - [ ] `condition.tabIds`가 `[7]`이다
  - [ ] **`condition.resourceTypes`가 `["sub_frame"]`이고 `main_frame`을 포함하지 않는다**
        — 이 단언이 "top 문서 CSP는 안 건드린다"는 목표 2의 유일한 자동 그물이다
  - [ ] `action`에 `requestHeaders`가 없다(UA 위조 등 스코프 밖 동작 유입 방지)
  - [ ] `pnpm test` green

### Task 2: 룰 적용·제거·리셋 래퍼 + 호출 계약 테스트

- **변경 대상**: `src/background/frame-header-rules.ts`,
  `src/background/__tests__/frame-header-rules.test.ts`
- **작업 내용**: `applyFrameUnblock`·`removeFrameUnblock`·`resetFrameUnblockRules`를 추가한다.
  `chrome.declarativeNetRequest.updateSessionRules`를 목으로 두고 호출 인자를 검증한다.
  `applyFrameUnblock`은 등록 전에 같은 ID를 `removeRuleIds`로 함께 보내 재등록이 멱등이 되게 한다.
- **검증**:
  - [ ] `applyFrameUnblock(7)`이 `updateSessionRules({ addRules: [rule], removeRuleIds: [7] })`를 부른다
  - [ ] `removeFrameUnblock(7)`이 `updateSessionRules({ removeRuleIds: [7] })`를 부른다
  - [ ] `updateSessionRules`가 reject해도 `applyFrameUnblock`이 **throw하지 않는다**(fail-open)
  - [ ] `resetFrameUnblockRules()`가 `getSessionRules()`로 조회한 기존 룰 ID를 전부 제거한다
  - [ ] `pnpm test` green

### Task 3: 코디네이터에 수명 연결

- **변경 대상**: `src/background/device-frame-coordinator.ts`,
  `src/background/__tests__/device-frame-coordinator.test.ts`
- **작업 내용**:
  - `armDeviceFrame`을 `async`로 바꾸고 `on === true`에서 `await applyFrameUnblock(tabId)`.
  - `clearDeviceFrame`에서 `await removeFrameUnblock(tabId)`.
  - `applyDeviceSignal`에서 `push.type === "frameBlocked"`일 때 `removeFrameUnblock(tabId)`.
  - fail-open이 이 파일의 다른 게이트(fail-closed)와 왜 다른지 한 줄 주석으로 남긴다.
- **검증**:
  - [ ] `armDeviceFrame(tabId, true, url)`이 룰 적용을 부르고, `on:false`에서는 **안 부른다**
        (감시창 종료는 모드 종료가 아니다 — 여기서 지우면 래퍼 안 이동이 다시 차단된다)
  - [ ] `clearDeviceFrame`이 룰 제거를 부른다
  - [ ] `armTimeout`·`errorOccurred`로 `frameBlocked`가 나면 룰 제거가 불린다
  - [ ] `frameLoaded`·`handoff` push에서는 제거가 **안 불린다**(handoff는 top 커밋의
        `clearDeviceFrame`이 소유한다)
  - [ ] 기존 코디네이터 테스트 전부 green (async 전환 파급 확인)

### Task 4: 호출부 await + SW 시작 리셋

- **변경 대상**: `src/background/messages.ts`, `src/background/index.ts`
- **작업 내용**: `device.arm` 케이스에서 `armDeviceFrame`을 await한다(이미 `enqueueForTab`
  콜백 안이므로 `async` 콜백으로만 바꾸면 된다). `onInstalled`·`onStartup`에
  `void resetFrameUnblockRules()`를 추가한다.
- **검증**:
  - [ ] `device.arm {on:true}` 처리가 룰 적용 완료 **뒤에** resolve한다(목의 호출 순서로 단언)
  - [ ] `pnpm typecheck` 통과 — async 전환으로 깨지는 호출부가 없다
  - [ ] `pnpm test` green

### Task 5: manifest 권한 추가

- **변경 대상**: `manifest.config.ts`
- **작업 내용**: `permissions`에 `"declarativeNetRequestWithHostAccess"` 추가.
  `declarativeNetRequest`는 추가하지 않는다.
- **검증**:
  - [ ] `pnpm build` 후 `dist/manifest.json`의 `permissions`에 새 항목이 있고
        `declarativeNetRequest`(무접미)는 **없다**
  - [ ] `chrome://extensions`에서 재로드 시 권한 경고가 "모든 사이트" 외에 늘지 않는다
        (`WithHostAccess`는 별도 경고 문자열이 없다 — 실제 확인 필요)

### Task 6: e2e 픽스처에 CSP 라우트 추가

- **변경 대상**: `e2e/fixtures/extension.ts`
- **작업 내용**: `/e2e-xfo`(`:70`) 옆에 `/e2e-csp-frame` 라우트를 추가한다 —
  `content-security-policy: frame-ancestors 'none'`, 본문에 `#csp-marker`.
- **검증**:
  - [ ] 라우트에 직접 접속하면 200이고 마커가 보인다(top-level 로드는 정상)
  - [ ] 그 페이지를 다른 페이지의 iframe에 넣으면 차단된다(우회 없는 기준선)

### Task 7: e2e 계약 뒤집기

- **변경 대상**: `e2e/device-viewport.spec.ts`
- **작업 내용**: `:379`의 "X-Frame-Options: DENY 페이지에서는 3초 안에 전체로 롤백된다"를
  **성공 검증으로 다시 쓴다**. `/e2e-csp-frame` 케이스를 추가한다. 룰 누수 검증도 넣는다.
- **검증**:
  - [ ] XFO DENY 픽스처에서 폭 390 선택 후 `device-preset-390`이 `aria-selected="true"`가 된다
  - [ ] 같은 상태에서 래퍼(`#__bugshot_device_frame__`)가 존재하고 폭이 390px이다
  - [ ] CSP `frame-ancestors 'none'` 픽스처에서도 동일하게 선다
  - [ ] `전체`로 되돌린 뒤 `chrome.declarativeNetRequest.getSessionRules()`가 빈 배열이다
  - [ ] 모드 ON→OFF를 2회 반복해도 룰이 누적되지 않는다
  - [ ] `pnpm build:e2e && pnpm test:e2e` green

### Task 8: 문서 갱신

- **변경 대상**: `docs/PERMISSION.md`, `docs/privacy.ko.md`, `docs/privacy.en.md`,
  `CLAUDE.md`, `docs/DIRECTORY.md`, `guide/ko/device-viewport.md`, `guide/en/device-viewport.md`
- **작업 내용**:
  - `PERMISSION.md`: `declarativeNetRequestWithHostAccess` 항목 신설 — 목적·적용 범위·수명·
    스토어 심사 사유 문장.
  - `privacy.{ko,en}.md`: 디바이스 뷰포트 문단(ko `:64`)에 **응답 헤더 수정 사실**을 추가한다 —
    무엇을(`X-Frame-Options`·`Content-Security-Policy`) / 어디에(모드가 켜진 탭의 프레임 응답만) /
    언제까지(모드가 켜진 동안) / 왜(그 사이트가 프레임 삽입을 거부해도 폭을 재현하기 위해).
    **ko 원본 → en 번역 순서, 상단 시행일도 함께 갱신.**
  - `CLAUDE.md`: "게이트웨이" 섹션의 permissions 목록에 추가.
  - `DIRECTORY.md`: `src/background/frame-header-rules.ts` 등록.
  - 가이드: ko `:62` / en `:62`의 "프레임 안에서 열 수 없도록 막아 둔 페이지에서는 뷰포트가
    서지 않고 전체로 되돌아갑니다" 문구를 톤 조정한다 — 이제 대부분 서지만 **실패 경로 자체는
    남아 있으므로 문장을 지우지 말고** "드물게"로 약화한다.
- **검증**:
  - [ ] `pnpm sync:agents:check` 통과 (CLAUDE.md 수정 시 Codex 미러 동기화)
  - [ ] ko/en privacy 본문이 대칭이고 시행일이 같다
  - [ ] `/doc-check`로 문서-코드 대조 시 새 stale이 없다

---

## 테스트 계획

### 단위 테스트

| 대상 | 케이스 |
|---|---|
| `buildFrameUnblockRule` | id/priority 매핑 · 헤더 2종 remove · `sub_frame` 한정 · `main_frame` 부재 · `requestHeaders` 부재 |
| `applyFrameUnblock` | `addRules`+`removeRuleIds` 동시 전달(멱등) · reject 삼킴(fail-open) |
| `removeFrameUnblock` | `removeRuleIds`만 전달 · 없는 ID도 에러 없음 |
| `resetFrameUnblockRules` | `getSessionRules` 결과 전량 제거 |
| `armDeviceFrame` | `on:true`만 적용 · `on:false`는 미적용 |
| `clearDeviceFrame` | 제거 호출 |
| `applyDeviceSignal` | `frameBlocked`→제거 / `frameLoaded`·`handoff`→미제거 |

### e2e 시나리오

- `X-Frame-Options: DENY`를 내는 페이지에서 폭 390을 고르면 뷰포트가 390px로 선다.
- CSP `frame-ancestors 'none'`을 내는 페이지에서 폭 390을 고르면 뷰포트가 390px로 선다.
- 차단 페이지에서 모드를 켰다 끄면 세션 룰이 0건으로 돌아온다.
- 모드 ON/OFF를 2회 반복해도 세션 룰이 누적되지 않는다.
- 차단 페이지에서 모드를 켠 뒤 래퍼 안에서 같은 출처의 다른 경로로 이동해도 모드가 유지된다
  (`tabIds`+`SUB_FRAME` 선택이 `urlFilter`보다 옳았다는 것의 그물).

### 수동 테스트

자동화 불가 항목만.

- [ ] github.com에서 폭 390 → 뷰포트가 선다 (실사이트 XFO deny)
- [ ] naver.com에서 폭 390 → 뷰포트가 선다
- [ ] 위 두 사이트에서 캡처·요소 선택·콘솔/네트워크 로그가 평소대로 동작한다
- [ ] **캐시 경로**: 차단 사이트를 먼저 한 번 방문해 캐시를 만든 뒤 모드를 켠다 —
      캐시된 응답에도 헤더 제거가 적용되는지 (DNR 내부 동작이라 자동화 불가)
- [ ] 모드를 끈 뒤 DevTools Network에서 해당 사이트 응답에 `x-frame-options`가 **복귀**했는지
- [ ] `chrome://extensions` 재로드 시 권한 경고 문구가 늘지 않는지

## 구현 순서 권장

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5
                                       ↓
                          Task 6 → Task 7
                                       ↓
                                    Task 8
```

- Task 1·2는 신규 파일 안에서 닫혀 병렬 불가(같은 파일).
- Task 5(manifest)는 Task 4까지 끝난 뒤가 안전하다 — 권한만 먼저 넣으면 e2e가 룰 없이 도는
  중간 상태가 생긴다.
- Task 6은 Task 1~5와 독립이라 **병렬 가능**하다.
- Task 8은 마지막. 특히 privacy는 최종 동작이 확정된 뒤에 쓴다.

## 가이드 영향

- `guide/ko/device-viewport.md`(`:62`) · `guide/en/device-viewport.md`(`:62`) —
  "프레임 안에서 열 수 없도록 막아 둔 페이지에서는 뷰포트가 서지 않는다"는 제약 문구를
  약화한다. **삭제가 아니라 톤 조정** — 실패 경로와 그 UX는 그대로 남는다.
- 구현 후 `/guide`로 처리하고, 작성 전 `guide/AUTHORING.md`를 먼저 읽는다.
