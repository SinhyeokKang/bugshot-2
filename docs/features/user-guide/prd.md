# User Guide 진입점

> 구현 반영 갱신(2026-06-01): 초기 설계의 **상단 전역 배너 + dismiss/버전 재팝업**은 **폐기**. 가이드 본문이 충분히 완숙되기 전에는 배너를 노출하지 않기로 결정. 진입점은 **푸터 버튼 2곳**(항상 노출)으로 단순화하고, 가이드는 **ko/en 양국어**(GitBook 별도 site)로 운영한다. 배너 UI는 가이드 완숙 후 별도 작업으로 재도입 가능(이번 스코프 밖).

## 배경

BugShot은 DOM 선택·스타일 비교·6개 플랫폼 이슈 등록 등 기능이 많지만, 사이드패널 안에 "어떻게 쓰는지" 안내하는 진입점이 없다. 신규 사용자가 첫 실행 시 무엇부터 해야 할지 알기 어렵다. 사용 가이드 문서를 외부(GitBook)에 ko/en으로 호스팅하고, 사용자가 자연스럽게 가이드를 찾는 지점에 진입 버튼을 둔다.

## 목표

- **진입점 2곳**(둘 다 항상 노출, 닫기·영속 로직 없음):
  1. **설정 > 앱 설정 푸터** 좌측 [BugShot 가이드] 버튼 (기존 [개인정보 처리방침] 버튼을 교체).
  2. **이슈 작성 진입(idle) 화면 푸터** 좌측 [BugShot 가이드] 버튼 (우측 freeform draft 버튼과 양끝 배치). 사용자가 이슈를 만들기 직전에 사용법을 찾는 지점이라는 판단.
- 두 버튼 모두 좌측에 `BookOpen` 아이콘 + "BugShot 가이드" 라벨, 클릭 시 **현재 locale에 맞는** GitBook 가이드를 **새 탭**으로 연다.
- 가이드를 **ko/en 양국어**로 제공한다. 확장 locale(ko/en)에 따라 해당 언어 가이드 URL로 분기한다.
- 가이드 콘텐츠를 **이 repo 안의 마크다운(`guide/ko`·`guide/en`)으로 관리**하고 GitBook으로 호스팅하며, 기능 변경 시 가이드 갱신을 `/push` 신선도 검사로 강제한다(코드 워크플로우 편입).
- 앱 내 privacy 링크는 제거 — 스토어 등록 정보의 privacy URL에만 존재.

## 비목표 (Non-goals)

- **상단 전역 배너 + dismiss/버전 재팝업** — 초기 설계였으나 폐기. 가이드 완숙 후 재도입은 별도 스코프.
- **가이드 본문 콘텐츠 작성** — 이번 스코프는 "문서를 어떻게 관리/호스팅하고 어떻게 진입하는가"까지. GitBook 내 실제 페이지 텍스트는 별도 작업(현재는 골격만).
- 가이드를 확장 내부에 번들링(log-viewer식 standalone HTML). 외부 GitBook URL을 새 탭으로 여는 방식으로 확정.
- GitBook **content variants(단일 site 다국어)** — 유료(Premium+) 기능이라 미채택. 무료 plan에서 가능한 **별도 site 2개(space 분기)**로 양국어 운영.
- 첫 실행 온보딩 투어·툴팁·코치마크.
- 가이드 검색·앱 내 임베드(iframe).
- 진입 트래킹·애널리틱스. 이번 스코프는 계측 없음.

## 문서 관리 방식 (확정) — in-repo 마크다운 + GitBook 양국어 site + 워크플로우 신선도 검사

가이드를 **바이브 코딩 워크플로우 안에서 코드로 관리**한다. 소스는 이 repo 안에 두고, 다른 문서처럼 작성·갱신하며, `/push` 신선도 검사가 같이 본다. GitBook은 그 마크다운을 동기화해 **렌더·호스팅만** 담당.

- **소스 위치**: `guide/ko`·`guide/en` (repo). 기존 `docs/`(Jekyll privacy)와 분리해 충돌 없음.
  - 각 디렉터리에 `.gitbook.yaml`(`root: ./`, `structure.summary: SUMMARY.md`) + `SUMMARY.md`(목차) + `README.md`(첫 페이지) + `assets/`(이미지).
- **동기화**: GitBook GitHub Sync, **repo → GitBook 단방향**(Initial sync를 GitHub 쪽 콘텐츠로). 각 GitBook **space**의 **Project directory**를 `guide/ko`·`guide/en`로 지정(monorepo). GitBook UI 편집은 안 쓴다 → main에 봇 역커밋 없음.
- **호스팅**: GitBook 무료 plan, 별도 site 2개. 공개 URL:
  - ko: `https://bugshot.gitbook.io/bugshot/`
  - en: `https://bugshot.gitbook.io/bugshot-en/`
- **워크플로우 편입**:
  - 작성: 사용자 노출 UX·기능이 바뀌면 `guide/ko`·`guide/en` **양쪽** 갱신(CLAUDE.md 작업 원칙).
  - 신선도: `/push` 문서 신선도 목록에 `guide/` 추가(CLAUDE.md 「문서 신선도」 + `push` 스킬 정의).
- **URL 상수화**: 가이드 URL은 `src/lib/external-links.ts`의 `USER_GUIDE_URLS`(locale별) 한 곳에서 관리.
- 일상 갱신은 확장 재배포와 무관(확장은 URL만 가리킴). 확장 코드를 고치는 건 URL slug가 바뀔 때뿐.

## 사용자 시나리오

1. 사용자가 설정 > 앱 설정으로 들어가 푸터의 [BugShot 가이드]를 클릭 → 새 탭에서 현재 언어의 GitBook 가이드가 열린다.
2. 또는 디버그 탭에서 이슈 작성을 시작하려다 진입 화면(idle) 푸터의 [BugShot 가이드]를 클릭 → 같은 동작.
3. ko/en 전환 시 버튼 문구와 연결 URL이 각 언어 가이드로 바뀐다.

엣지 케이스:
- 새 탭 열기 실패(드물게 `chrome.tabs` 거부): 조용히 무시(기존 외부 링크 버튼과 동일).

## 성공 기준

- 설정 푸터 [BugShot 가이드] 버튼이 항상 노출되고 클릭 시 가이드가 열린다(privacy 버튼은 사라짐).
- 이슈 작성 진입(idle) 화면 푸터 좌측에 [BugShot 가이드] 버튼이 노출되고 클릭 시 가이드가 열린다(우측 freeform 버튼 유지).
- ko/en 전환 시 두 버튼 문구가 바뀌고, 클릭 시 각 언어 가이드 URL(ko `/bugshot/`, en `/bugshot-en/`)로 열린다.
- 두 GitBook site가 publish되어 공개 URL이 깨지지 않는다(렌더 확인).
- `pnpm test` 통과, `pnpm typecheck` 무오류.
