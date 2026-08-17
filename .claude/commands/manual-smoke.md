---
description: e2e 밖에 남은 수동 잔여를 실사이트에서 훑는 리포트 전용 스윕. 브라우저 제어 런타임 전용 — fix·빌드·커밋 안 함.
---

`e2e/COVERAGE.md`의 **수동 잔여** 중 환경 제약으로 자동화 밖에 남은 항목을 실제 사이트에서 훑고 결과만 리포트한다.

**게이트가 아니다.** 실사이트 의존이라 결정론이 없다. e2e 차단 게이트는 CI(`.github/workflows/ci.yml`의 `e2e` 4샤드 → `e2e-gate` required check)가 단독으로 맡고, 이 스킬은 아무것도 차단하지 않는다. 대신 **e2e가 원리적으로 못 보는 축**(실 cross-origin CSS, 실 sticky 사이트, 실 광고 iframe, 픽셀·시각 판정)을 본다.

> **시나리오 정의·판정 기준·대상 사이트·실행 이력은 [`e2e/MANUAL-SMOKE.md`](../../e2e/MANUAL-SMOKE.md)가 단일 출처다.** 이 문서에 복제하지 않는다 — 사이트와 판정 문장은 절차보다 훨씬 자주 바뀌는데, 여기 박으면 그때마다 `pnpm sync:agents`로 미러를 재생성해야 한다.

## 런타임별 종착점

**브라우저를 실제로 조작해 확장 UI를 관측하는 게 본체다.** 제품 이름이 아니라 **능력**으로 판정한다. 아래 넷을 모두 갖춘 런타임만 실행한다.

| # | 필요 능력 | 왜 대체 불가인가 |
|---|---|---|
| 1 | BugShot이 **언팩 확장으로 로드된 브라우저** | 관측 대상 자체 |
| 2 | `chrome-extension://` 페이지를 탭으로 열기 | 패널을 `?tabId=`로 여는 유일한 경로 |
| 3 | **저수준 CDP** — `Emulation.setDeviceMetricsOverride` | 폭·DPR 고정 수단. 고수준 `setViewportSize`류는 Aside에 없다 |
| 4 | **`chrome.tabs`·`chrome.windows`·`chrome.developerPrivate`** | 전제 확인·reload·탭 활성 전환에 필요 |

**Claude Code·Codex에서는 넷 다 없으므로 즉시 중단한다.** 리포트에 "브라우저 제어 런타임이 아니라 실행 불가 — Aside 세션에서 호출"만 남기고 끝낸다. 시나리오를 흉내 내거나 코드를 읽어 추론하지 않는다 — 이 스킬의 가치는 **실제로 관측했다**는 데 있고, 추론으로 채우면 이력 표가 거짓말을 한다.

**현재 Aside 세션만 넷을 만족한다.** Orca 같은 ADE는 에이전트 CLI를 얹는 셸이라 런타임은 그 안의 Claude Code·Codex이고, 내장 브라우저 페인이 있어도 1·4를 노출하지 않으면 마찬가지로 실행 불가다.

## 사용

- `/manual-smoke` — S1~S6 전체.
- `/manual-smoke S1 S3` — 지정한 시나리오만.

인자 없이 호출해도 **S5를 항상 먼저 돌린다**(아래 4단계).

## 상수

```
확장 ID     : dhmffogmoohdjficicjjfolcheklngfm
              (manifest.config.ts의 DEV_KEY에서 결정. store 빌드는 key를 지우므로
               이 ID는 dev·e2e 빌드 전용이고, dist를 수동 로드하는 한 항상 같다)
패널 경로   : chrome-extension://<id>/src/sidepanel/index.html?tabId=<number>
              (바인딩은 src/sidepanel/hooks/useBoundTabId.ts:readQuery)
picker host : #__bugshot_picker_host   ← id다. 태그명이 아니다.
              (대상 페이지 DOM, open shadow root)
테마 영속키 : bugshot-app-settings     (chrome.storage.local, settings-ui-store persist name)
```

## 포커스 규칙 (틀리면 회귀와 구별되지 않는다)

실측으로 확인된 두 방향이 **서로 반대**다.

- **값 편집·다이얼로그 조작은 패널이 앞에 있어야 한다.** 패널이 백그라운드면 cmdk 팝오버가 조용히 안 열린다(`ValueCombobox` 트리거 클릭이 no-op, `bringToFront()` 후 열림).
- **캡처 발행은 대상 탭이 활성이어야 한다.** background 캡처 관문(`captureOwnedTab`)이 `tab.active`를 재확인한다.

그래서 캡처를 부르기 직전에 `chrome.tabs.update(targetTabId, { active: true })`로 대상 탭을 올리고, 패널 버튼은 `click({ force: true })`로 누른다. `e2e/GOTCHAS.md`의 `fixture.bringToFront()` 함정과 같은 것의 Aside판이다.

**증상이 "제품이 안 됨"으로 나오므로**, 예상과 다르면 회귀를 의심하기 전에 포커스 순서부터 다시 본다.

## 절차

1. **런타임 확인.** 위 능력 4개. 없으면 즉시 중단.

2. **전제 확인.** `chrome://extensions`를 열고 그 페이지 컨텍스트에서:
   - `chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true })` → 확장 ID가 있고 `state === "ENABLED"` · `location === "UNPACKED"`인지.
     - 미존재 → 중단 + **수동 로드 안내**(최초 1회 언팩 로드는 자동화 불가 — CDP `Extensions.loadUnpacked`는 pipe 연결 전용이라 `Method not available`, 드래그 경로·AppleScript·file chooser 전부 막힘).
     - ID 불일치 → 중단 + **"store 또는 e2e 빌드를 로드한 것 아닌가"** 안내.
     - `manifestErrors`/`runtimeErrors` > 0 → 중단하지 말고 **리포트 선두에 기재**.
   - **`dist` 신선도**: mtime 비교만으로는 부족하다. 최근 변경한 UI 문자열을 산출물에서 직접 grep한다(`grep -rl "<새 문구>" dist/`). stale이면 중단 + `/build` 안내 — 낡은 빌드를 관측하면 리포트가 통째로 거짓이 된다.

3. **확장 리로드.** `deleteExtensionErrors({ extensionId })`로 이전 실행의 오류를 지운 뒤 `reload(id)`. 리로드 후 다시 조회해 오류 0을 확인한다.

4. **S5 먼저.** 사이트 하나 열고 스냅샷 한 번이라 가장 싸고, 여기서 전제 확인·`?tabId=` 바인딩·탭 정리 배선이 전부 검증된다. **S5가 깨지면 나머지를 돌리지 말고 중단한다** — 같은 지점에서 전부 죽는다.

5. **시나리오 루프.** `e2e/MANUAL-SMOKE.md`의 정의대로. 각 시나리오마다:
   - **전제 단언 먼저.** 깨졌으면 판정하지 말고 `skip(사이트 변경)`. 안 하면 사이트 개편이 회귀로 둔갑한다.
   - 대상 탭 열기 → 패널을 `?tabId=`로 열기 → **캡처가 걸린 시나리오는 패널을 별도 팝업 창으로 뺀다**(`chrome.windows.create({ tabId, type: "popup" })`) — 같은 윈도우의 탭이면 둘 중 하나만 활성일 수 있어 캡처가 조용히 실패한다.
   - 구조 판정(`snapshot()`)을 먼저, 육안 판정(`screenshot()`)은 구조로 못 가르는 축에만.
   - **열고 닫는 것을 짝으로.** 앞 시나리오의 잔여 탭이 있으면 URL 패턴 조회가 엉뚱한 탭을 잡는다.
   - 캡처 실패(quota·`tab.active`)는 **1회 재시도 후 `skip(환경)`**. 연속 실패에만 FAIL로 승격하고 근거(에러 문자열)를 남긴다.

6. **리포트.** 대화 응답으로. **실패·skip을 성공보다 먼저** 쓴다. 각 항목에 재현 정보(사이트 URL·요소 셀렉터·실측 수치·스크린샷 경로)를 붙인다. FAIL이 나오면 `docs/POSTMORTEM.md`를 해당 영역으로 grep해 과거 함정과 대조한 뒤 리포트에 포함한다.

7. **이력 1행.** `e2e/MANUAL-SMOKE.md`의 "최근 실행 이력" 표에 1행 append. **이 스킬이 저장소에 쓰는 것은 이 1행뿐이다.**

## 금지 사항

- **코드 수정 금지.** `src/`·`manifest.config.ts`·`package.json`·`playwright.config.ts`·`scripts/` 일체. FAIL이 나와도 고치지 않는다 — fix는 사용자가 `/tdd`+`/implement`(또는 `/refactor`)로 별도 호출.
- **빌드 금지.** `dist` 신선도 확인까지가 이 스킬의 책임이고, stale이면 중단하고 `/build`를 안내한다.
- **`dist-e2e` 로드 금지.** 테스트 전용 산출물이라 수동 로드하지 않는다. 이 스킬은 **`dist`만** 쓴다.
- **커밋·푸시 안 함.**
- **후속 스킬 자동 제안 금지.**
- 저장소 쓰기는 `e2e/MANUAL-SMOKE.md` 이력 표 **1행으로 한정**. 시나리오 정의를 실행 중에 고치지 않는다(판정 기준을 결과에 맞추면 그물이 죽는다) — 기준이 틀렸다고 판단되면 리포트에 적고 사용자 확인을 받는다.
- **스크린샷을 저장소에 넣지 않는다.** 세션 임시 경로에만 둔다.
