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
  - **self-match 가드**: 레시피가 base64 문자셋 앵커를 쓴다 — `[A-Za-z0-9+/=` 포함, 그리고 단순 첫-매치 캡처 `>([^<]*)`(또는 `[^<]*)`)를 **포함하지 않음**.
  - fallback 안내 포함: `ask the user`(또는 동등 문구).
  - 캡 신호 언급 포함: `warnings`, `totalSeen`(또는 `captured`).
- **검증**:
  - [x] 테스트 작성 후 (상수 미구현 상태면) import 실패/red 확인 → Task 2 후 green.

### Task 2: 매뉴얼 상수 추가
- **변경 대상**: `src/sidepanel/lib/aiLogsManual.ts` (신규)
- **작업 내용**: `export const AI_LOGS_MANUAL: string` 정의. `design.md`의 "인터페이스 설계" 매뉴얼 골자를 **그대로** 옮긴다:
  - 디코드 레시피 Python+Node — **base64 문자셋 앵커**(`([A-Za-z0-9+/=\s]{100,})`)로 매치(첫-매치 self-match 회피), 파일명은 `the uploaded file`로 일반화, whitespace 제거 후 디코드.
  - 코드 실행 불가 AI용 **fallback 한 줄**("ask the user to run the snippet and paste the decoded JSON").
  - 최상위 키 설명: report 우선 + `report.env`(배열, `environment` 아님)·`sections`는 동적 `value` 배열·`report.copy.markdown` 우선 강조 / console·network·action 엔트리 / video·screenshot data URL.
  - `meta.createdAt`은 **ISO 문자열**(epoch 아님), `issueKey`/`issueUrl`은 트래커 제출 시만 채워지고 미제출 시 빈 문자열.
  - 캡 신호(`totalSeen` vs `captured`, `networkLog.warnings`) → "로그 잘림" 감안 안내.
  - "All log timestamps are epoch ms", "respond in user's language".
  - 데이터 참조 시 닫는 script 태그(`</script`) 표기 금지.
  - **TS 작성 주의**: 백틱 템플릿 리터럴로 쓰면 본문의 백틱·`${`가 깨진다. 레시피는 펜스·`${` 없는 들여쓰기 코드로 유지하거나, 안전하게 일반 문자열 결합/`String.raw`를 검토.
- **검증**:
  - [x] `pnpm test aiLogsManual` green.
  - [x] `pnpm typecheck` 통과.

### Task 3: 템플릿에 placeholder 추가
- **변경 대상**: `src/log-viewer/index.html`
- **작업 내용**: `<head>`의 `<meta charset="UTF-8" />` **바로 다음**(둘째 자식)에 `<script id="__BUGSHOT_AI__" type="text/markdown"></script>` 추가. (charset 앞에 두지 말 것 — 1024바이트 규칙 위반 → 비-ASCII META mojibake.)
- **검증**:
  - [x] `pnpm build:log-viewer` 후 `dist-log-viewer/index.html`에 `id="__BUGSHOT_AI__"`가 **여전히 빈 `<script id="__BUGSHOT_AI__" ...></script>` 형태로 보존**(Task 4 정규식 `[^>]*><\/script>`가 매치 가능)되는지 — vite가 drop/reorder/속성변형 시 buildLogsHtml이 silent no-op로 매뉴얼을 누락한다. → `pnpm build` 후 grep 매치 1건 확인.
  - [x] 산출물에서 placeholder가 `<meta charset>` 다음·거대 inline 모듈 스크립트보다 앞에 위치. → 순서 `charset → __BUGSHOT_AI__ → script type=module` 확인.
  - [x] **dist 재빌드 의존 명시**: `dist-log-viewer/index.html`을 재빌드하지 않으면 매뉴얼이 조용히 빠진다(buildLogsHtml은 `?raw`로 이 파일을 읽음). `/build`는 `build:log-viewer`를 자동 선행하므로 정상 빌드 시 갱신됨. → `pnpm build`로 09:43 재생성 완료.

### Task 4: buildLogsHtml에 주입 추가
- **변경 대상**: `src/sidepanel/lib/buildLogsHtml.ts`
- **작업 내용**: `AI_LOGS_MANUAL` import. `__BUGSHOT_AI__` placeholder를 매뉴얼로 치환하는 `.replace()` 추가(DATA/META와 동일하게 함수형 replacement). 정규식: `/<script id="__BUGSHOT_AI__"[^>]*><\/script>/` → `() => \`<script id="__BUGSHOT_AI__" type="text/markdown">${AI_LOGS_MANUAL}</script>\``.
- **검증**:
  - [x] `pnpm typecheck` 통과.

### Task 5: buildLogsHtml 테스트 갱신
- **변경 대상**: `src/sidepanel/lib/__tests__/buildLogsHtml.test.ts`
- **작업 내용**:
  - 목 템플릿 문자열(`vi.mock(... dist-log-viewer/index.html?raw)`)의 `<head></head>`를 `<head><script id="__BUGSHOT_AI__" type="text/markdown"></script></head>`로 교체.
  - 케이스 추가: 결과 HTML에서 **`__BUGSHOT_AI__` 태그 본문을 정규식으로 추출한 뒤** 그 안에서 매뉴얼 토큰을 단언한다. (주의: 목 템플릿 body에도 `id="__BUGSHOT_DATA__"`가 있어 "HTML에 `__BUGSHOT_DATA__` 포함" 단언은 매뉴얼 없이도 통과하는 false-positive — 반드시 AI 태그 본문 추출 후 단언.)
  - 케이스 추가: 매뉴얼 주입이 기존 DATA/META 추출(`extractData`)을 깨지 않는다(round-trip 유지).
  - 케이스 추가(불변식 승격): 매뉴얼이 평문 `"issueUrl":""` 마커를 **추가하지 않는다** — 기존 test16(`split('"issueUrl":""').length-1 === 1`)이 자동으로 이를 가드하지만, 매뉴얼 주입 후에도 META 태그에만 마커가 정확히 1개임을 명시 단언(injectIssueUrl `lastIndexOf` 오작동 방지).
- **검증**:
  - [x] `pnpm test buildLogsHtml` green.
  - [ ] 주의: `vi.mock` 목 템플릿은 **빈 placeholder**라 self-match·실제 매뉴얼 내용은 검증 못 함 — 그건 Task 6(실제 산출물)에서 확인.

### Task 6: 실제 산출물 수동 확인 (self-match·가치 검증의 유일 게이트)
- **변경 대상**: 없음(검증 전용)
- **작업 내용**: `pnpm build` 후, BugShot으로 임의 캡처(console·network·action 섞이게, 가능하면 한글 issueTitle 포함) → `logs.html` 내보내기 → 아래 검증.
- **검증**:
  - [ ] 뷰어 렌더 회귀 없음 + 한글 issueTitle·로그 mojibake 없음(charset 보존).
  - [ ] 매뉴얼 비가시(화면에 텍스트 안 뜸).
  - [ ] 매뉴얼이 `<meta charset>` 직후에 보임.
  - [x] **매뉴얼 안의 레시피를 그대로 복붙 실행**(빈 목 아님, 실제 매뉴얼 포함 파일) → 진짜 `__BUGSHOT_DATA__`(매뉴얼 자신 아님)를 매치해 console/network/action/report 복원 성공. ← self-match 함정은 여기서만 잡힌다. → 실제 레시피 정규식으로 프로그램 검증: 진짜 blob 캡처·디코드 성공, naive 첫-매치였다면 self-match로 깨짐을 대조 확인.
  - [ ] **실제 AI 스모크**: 같은 파일을 Claude.ai 분석 도구(또는 ChatGPT Python)에 1회 업로드 → AI가 매뉴얼을 읽고 디코드해 실제 로그·report를 인용·진단하는지 확인.

## 테스트 계획

- **단위 테스트**:
  - `aiLogsManual.test.ts`(신규): `</script` 부재 + 핵심 토큰 포함 + base64 앵커 사용(첫-매치 캡처 부재) + fallback·캡신호 문구 포함.
  - `buildLogsHtml.test.ts`(갱신): AI 태그 **본문 추출 후** 토큰 단언 + DATA/META round-trip 불변 + `"issueUrl":""` 마커 1개 불변식.
  - 한계: 목 템플릿이 빈 placeholder라 **레시피 self-match·실제 매뉴얼 내용은 단위 테스트로 못 잡는다** → Task 6가 유일 게이트.
- **e2e 시나리오**: 해당 없음 — 매뉴얼은 비렌더 텍스트라 Playwright UI 판정 대상이 아니다. 단 기존 `e2e/logview/log-viewer.spec.ts`는 실제 `dist-log-viewer/index.html`을 `setContent`로 로드하므로 매뉴얼이 DOM에 실제로 들어간다 → **매뉴얼 추가 후 기존 spec을 1회 재실행**해 뷰어 회귀(셀렉터·렌더) 없음을 확인(신규 spec은 불요).
- **수동 테스트**: Task 6 — 뷰어 비회귀(+charset/한글) + 매뉴얼 비가시 + 실제 파일 레시피 복원(self-match 게이트) + 실제 AI 스모크.

## 구현 순서 권장

- Task 1 → Task 2 (test-first: 상수 불변식 먼저).
- Task 3 → Task 4 → Task 5 (placeholder → 주입 → 주입 테스트). Task 3은 Task 1·2와 병렬 가능.
- Task 6은 전체 후 빌드 1회로 최종 확인.

## 가이드 영향: 없음

사용자 노출 UI·플로우 변경 없음(매뉴얼은 비가시, export 동작·버튼 불변). `guide/ko·en` 갱신 불요. `docs/privacy.md`도 새 캡처·수집·전송 없음 → 트리거 아님(design.md 위험 요소 참조).
