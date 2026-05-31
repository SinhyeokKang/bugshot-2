# User Guide 진입 배너

## 배경

BugShot은 DOM 선택·스타일 비교·6개 플랫폼 이슈 등록 등 기능이 많지만, 사이드패널 안에 "어떻게 쓰는지" 안내하는 진입점이 없다. 신규 사용자가 첫 실행 시 무엇부터 해야 할지 알기 어렵다. 사용 가이드 문서를 외부에 호스팅하고, 사이드패널 어디서나 한 번에 진입할 수 있는 얇은 배너를 둔다.

## 목표

- 사이드패널 전역(모든 탭 공통)에 높이 약 16–20px의 얇은 배너를 노출한다.
- 배너 클릭 시 외부 사용 가이드 문서를 **새 탭**으로 연다.
- 배너는 **닫기(dismiss) 가능**하며, 닫으면 `chrome.storage`에 영속되어 이후 재노출하지 않는다.
- ko/en 양쪽 문구를 제공한다.
- 가이드 콘텐츠를 **이 repo 안의 마크다운으로 관리**하고 GitBook으로 호스팅하며, 기능 변경 시 가이드 갱신을 `/push` 신선도 검사로 강제한다(코드 워크플로우 편입).

## 비목표 (Non-goals)

- **가이드 본문 콘텐츠 작성** — 이번 스코프는 "문서를 어떻게 관리/호스팅하고 어떻게 진입하는가"까지. GitBook 내 실제 페이지 텍스트는 별도 작업.
- 가이드 내용을 확장 내부에 번들링하는 것 (log-viewer식 standalone HTML). 외부 GitBook URL을 새 탭으로 여는 방식으로 확정.
- 배너 재노출 토글 UI(설정에서 다시 켜기). 닫으면 끝.
- 첫 실행 온보딩 투어·툴팁·코치마크.
- 가이드 검색·앱 내 임베드(iframe).

## 문서 관리 방식 (확정) — in-repo 마크다운 + GitBook 호스팅 + 워크플로우 신선도 검사

가이드를 **바이브 코딩 워크플로우 안에서 코드로 관리**한다. 소스는 이 repo 안에 두고, Claude가 다른 문서처럼 작성·갱신하며, `/push` 신선도 검사가 같이 본다. GitBook은 그 마크다운을 동기화해 **렌더·호스팅만** 담당.

- **소스 위치**: `guide/` (repo 루트). 기존 `docs/`(Jekyll privacy)와 분리해 충돌 없음.
  - `guide/SUMMARY.md`(목차) + `guide/*.md`(페이지). repo 루트 `.gitbook.yaml`이 `root: ./guide`로 가리킴.
- **동기화**: GitBook GitHub Sync, **repo → GitBook 단방향**. 코드(`guide/*.md`)로만 편집하고 GitBook UI 편집은 안 쓴다 → main에 봇 역커밋이 안 생겨 dev→main squash 흐름이 깨끗.
- **호스팅**: GitBook 무료 플랜. `https://<org>.gitbook.io/bugshot` 공개 URL. UI는 GitBook 기본 테마(깔끔)를 그대로 사용.
- **워크플로우 편입**:
  - 작성: 사용자 노출 UX·기능이 바뀌면 `guide/*.md`도 함께 갱신(CLAUDE.md 작업 원칙에 명시).
  - 신선도: `/push` 문서 신선도 목록에 `guide/` 추가 — CLAUDE.md 「문서 신선도」 섹션 + `push` 스킬 정의 수정.
- **URL 상수화**: privacy policy URL(`SettingsTab.tsx`에 하드코딩된 `https://sinhyeokkang.github.io/bugshot-2/privacy`)과 동일한 결의 외부 링크. 가이드 URL은 새로 추가하는 상수 한 곳에서 관리.
- 일상 갱신은 확장 재배포와 무관(확장은 URL만 가리킴). 확장 코드를 고치는 건 `USER_GUIDE_URL`이 바뀔 때뿐.

## 사용자 시나리오

1. 사용자가 BugShot 사이드패널을 연다.
2. 탭 헤더 위(또는 아래)에 "사용 방법이 궁금하다면? 가이드 →" 배너가 보인다.
3. 배너 본문을 클릭 → 새 탭에서 GitBook 가이드가 열린다. 사이드패널은 그대로 유지.
4. 배너 우측 X를 클릭 → 배너가 사라지고, 이후 사이드패널을 다시 열어도 나타나지 않는다.

엣지 케이스:
- 설정 store가 아직 hydrate 안 된 초기 프레임: 배너를 깜빡 노출했다가 dismissed=true로 즉시 숨는 플리커를 막기 위해 hydrate 완료 전에는 배너를 렌더하지 않는다.
- 새 탭 열기 실패(드물게 `chrome.tabs` 거부): 조용히 무시(기존 외부 링크 버튼과 동일하게 별도 에러 처리 없음).

## 성공 기준

- 모든 최상위 탭(debug/issue-list/integrations/settings)에서 배너가 동일하게 보인다.
- 배너 본문 클릭 시 GitBook URL이 새 탭으로 열린다.
- X 클릭 후 사이드패널을 닫았다 다시 열어도 배너가 안 보인다(영속 확인).
- ko/en 전환 시 문구가 각각 바뀐다.
- `pnpm test` 통과(아래 단위 테스트 포함), `pnpm typecheck` 무오류.
