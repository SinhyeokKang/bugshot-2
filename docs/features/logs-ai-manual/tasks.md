# logs.html AI 소비 매뉴얼 — 구현 태스크

## 선행 조건

- 추가 권한·env·OAuth·외부 API 없음. 순수 클라이언트 문자열 주입.
- 매뉴얼 본문은 `design.md`의 "인터페이스 설계" 골자를 따른다. **리터럴 `</script` 미포함** 원칙 준수.
- 빌드는 검증 시점에만(`pnpm build:log-viewer`로 placeholder 보존 확인). 평소엔 `pnpm typecheck`.

## 태스크

### Task 1: 매뉴얼 단위 테스트 작성 (test-first)
- **변경 대상**: `src/sidepanel/lib/__tests__/aiLogsManual.test.ts` (신규)
- **작업 내용**: `AI_LOGS_MANUAL` 상수에 대한 불변식 테스트.
  - `</script`(대소문자 무시) 미포함.
  - 핵심 토큰 포함: `__BUGSHOT_DATA__`, `__BUGSHOT_META__`, `report`, `consoleLog`, `networkLog`, `actionLog`, `video`, `screenshot`, `gzip`(또는 `gunzip`), `base64`, `epoch`.
- **검증**:
  - [ ] 테스트 작성 후 (상수 미구현 상태면) import 실패/red 확인 → Task 2 후 green.

### Task 2: 매뉴얼 상수 추가
- **변경 대상**: `src/sidepanel/lib/aiLogsManual.ts` (신규)
- **작업 내용**: `export const AI_LOGS_MANUAL: string` 정의. `design.md` 골자대로 영문 마크다운 작성(디코드 레시피 Python+Node, 최상위 키 설명, report 우선, video/screenshot data URL, 타임스탬프 epoch ms, "respond in user's language"). 데이터 참조 시 닫는 script 태그 표기 금지.
- **검증**:
  - [ ] `pnpm test aiLogsManual` green.
  - [ ] `pnpm typecheck` 통과.

### Task 3: 템플릿에 placeholder 추가
- **변경 대상**: `src/log-viewer/index.html`
- **작업 내용**: `<head>`의 **첫 자식**으로 `<script id="__BUGSHOT_AI__" type="text/markdown"></script>` 추가.
- **검증**:
  - [ ] `pnpm build:log-viewer` 후 `dist-log-viewer/index.html`에 `id="__BUGSHOT_AI__"` 존재.
  - [ ] 산출물에서 매뉴얼 placeholder가 head 내 조기 위치(가능하면 거대 inline 모듈 스크립트보다 앞). 번들이 앞서면 허용이나 위치 기록.

### Task 4: buildLogsHtml에 주입 추가
- **변경 대상**: `src/sidepanel/lib/buildLogsHtml.ts`
- **작업 내용**: `AI_LOGS_MANUAL` import. `__BUGSHOT_AI__` placeholder를 매뉴얼로 치환하는 `.replace()` 추가(DATA/META와 동일하게 함수형 replacement). 정규식: `/<script id="__BUGSHOT_AI__"[^>]*><\/script>/` → `() => \`<script id="__BUGSHOT_AI__" type="text/markdown">${AI_LOGS_MANUAL}</script>\``.
- **검증**:
  - [ ] `pnpm typecheck` 통과.

### Task 5: buildLogsHtml 테스트 갱신
- **변경 대상**: `src/sidepanel/lib/__tests__/buildLogsHtml.test.ts`
- **작업 내용**:
  - 목 템플릿 문자열(`vi.mock(... dist-log-viewer/index.html?raw)`)의 `<head></head>`를 `<head><script id="__BUGSHOT_AI__" type="text/markdown"></script></head>`로 교체.
  - 케이스 추가: 결과 HTML에 `<script id="__BUGSHOT_AI__" type="text/markdown">`가 존재하고 그 안에 매뉴얼 핵심 토큰(`__BUGSHOT_DATA__`)이 포함된다.
  - 케이스 추가: 매뉴얼 주입이 기존 DATA/META 추출(`extractData`)을 깨지 않는다(round-trip 유지).
- **검증**:
  - [ ] `pnpm test buildLogsHtml` green.

### Task 6: 실제 산출물 수동 확인
- **변경 대상**: 없음(검증 전용)
- **작업 내용**: `pnpm build` 후, BugShot으로 임의 캡처 → `logs.html` 내보내기 → (a) 브라우저로 열어 뷰어 외형·동작 이전과 동일(매뉴얼 비가시) (b) 텍스트 에디터로 열어 `__BUGSHOT_AI__` 매뉴얼이 상단에 보이고, 레시피대로 Python으로 `__BUGSHOT_DATA__` 복원되는지 확인.
- **검증**:
  - [ ] 뷰어 렌더 회귀 없음.
  - [ ] 매뉴얼 비가시(화면에 텍스트 안 뜸).
  - [ ] Python 레시피로 console/network/action/report 복원 성공.

## 테스트 계획

- **단위 테스트**:
  - `aiLogsManual.test.ts`(신규): `</script` 부재 + 핵심 토큰 포함.
  - `buildLogsHtml.test.ts`(갱신): `__BUGSHOT_AI__` 주입 존재 + 매뉴얼 토큰 포함 + DATA/META round-trip 불변.
- **e2e 시나리오**: 해당 없음 — logs.html은 뷰어 정적 산출물이고, 매뉴얼은 비렌더 텍스트라 Playwright UI 판정 대상이 아니다. (뷰어 회귀는 기존 `e2e/logview/log-viewer.spec.ts`가 커버. 매뉴얼 추가로 뷰어 셀렉터·렌더가 바뀌지 않으므로 신규 spec 불요.)
- **수동 테스트**: Task 6 — 빌드 산출물에서 뷰어 비회귀 + 매뉴얼 비가시 + Python 디코드 레시피 동작.

## 구현 순서 권장

- Task 1 → Task 2 (test-first: 상수 불변식 먼저).
- Task 3 → Task 4 → Task 5 (placeholder → 주입 → 주입 테스트). Task 3은 Task 1·2와 병렬 가능.
- Task 6은 전체 후 빌드 1회로 최종 확인.

## 가이드 영향: 없음

사용자 노출 UI·플로우 변경 없음(매뉴얼은 비가시, export 동작·버튼 불변). `guide/ko·en` 갱신 불요. `docs/privacy.md`도 새 캡처·수집·전송 없음 → 트리거 아님(design.md 위험 요소 참조).
