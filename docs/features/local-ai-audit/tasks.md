# 전체 감사 후속 수정

감사일: 2026-10-22. 사용자 승인: `orchestrate 하자. 모두 수정`.

## 수용 기준

- [x] A / 감사 1: 여러 패널에서 설정을 변경해도 해제한 LLM·키가 되살아나지 않는다. 다른 필드 변경도 보존한다. 저장 실패·동시 쓰기·늦은 hydrate를 검증한다. dev `0d5e9794`·`1c72c606`, 전체9218·독립 리뷰 통과.
- [x] B / 감사 2: 초안 확정 시 영상·각 로그의 목적 키 저장 실패는 기존 pending 원본을 보존한다. 성공 경로만 원본을 정리한다. dev `1fd0f382`, 전체 9196 tests·독립 리뷰 통과.
- [ ] C / 감사 3: AI 생성 중 키보드로 배경 제목·본문을 변경할 수 없다. 중단 버튼은 접근 가능하고 종료 후 포커스가 복원된다. 자동재현·초안·스타일 3표면 및 성공·실패·중단 종료, 닫히는 Dialog portal과의 포커스 경합을 실제 키보드 e2e로 검증한다.
  - 구현은 dev `843d8ff6`, 초안·스타일링 e2e는 `7c25e38b` 5건 2회 통과. 세 표면 공용 jsdom과 자동재현 훅 검증은 통과했으나 실제 영상으로 발화하는 자동재현 브라우저 경로는 수동 잔여로 남긴다. 빠른 종료 300ms 경계의 결정적 근거는 jsdom red→green이다.
- [ ] D / 감사 4: Chrome AI 지원 언어 선언과 초안·재현·스타일 explanation 프롬프트가 일치한다. 한국어 요청을 영어로 대체하지 않는다. Chrome 미지원 언어는 생성·다운로드를 막고 외부 AI 연결을 안내한다. Ollama의 기존 언어 동작은 유지한다.
- [ ] D / 감사 5: downloadable/downloading/available/unavailable 상태를 구분한다. 사용자의 명시적 클릭으로 다운로드를 시작하고 진행·실패·완료를 표시한다. 자동 재현 생성이 다운로드를 시작하지 않는다.
- [ ] D1 / 감사 6: 명시적 중단 신호가 Chrome native prompt까지 전달돼 추론을 중단하고 세션을 정리한다. 취소 결과가 초안에 적용되지 않는다. D2(감사 4–5)와 분리해 언어 결정과 무관하게 먼저 진행한다.
  - dev `84657f0e`·`22c8d5e7`에서 native signal/late-create cleanup/늦은 결과 거부 검증. 전체9193·최종 targeted181 통과. 실제 모델 연산 중단은 런타임 잔여다.

## 완료 게이트

각 배치 회귀 테스트 red→green, typecheck·전체 test·sync:agents:check, 독립 리뷰, dev 통합, 문서·가이드 갱신, 필요한 런타임 검증, 원격 dev HEAD 일치 및 해당 SHA의 verify/e2e-gate 성공. main 머지·배포는 범위 밖이다.

## D 상세 검증

- [ ] no-BYOK + 앱 시작 전 LanguageModel mock 주입 e2e fixture로 availability/create/monitor를 제어한다. 기존 BYOK HTTP mock으로 대체하지 않는다.
- [ ] 다운로드 중→완료→모든 생성 소비처 활성화, 실패→재시도, 중복 클릭, 늦은 probe와 BYOK/로케일 변경을 검증한다.
- [ ] 설정 AI 화면→다른 메인 탭→설정 AI 복귀에서 상태를 재조회한다(hidden 마운트 유지 포함).
- [ ] 짧은 창·확대·긴 번역에서도 스크롤로 모든 CTA에 키보드 접근 가능하다.
- [ ] 실제 useAI→useReproPrefill 연결과 deferred native session으로 생성 도중 로케일 변경/checking/available 왕복, 결과의 1회 적용·로딩 해제, 명시 중단 후 미적용을 검증한다.
