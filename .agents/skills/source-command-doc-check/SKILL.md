---
name: "source-command-doc-check"
description: "저장소 문서(CLAUDE/DIRECTORY/ARCHITECTURE/DESIGN/README/PERMISSION/privacy/AUTHORING)를 문서별 전담 에이전트가 병렬로 코드베이스와 양방향 대조(사실오류 + 누락 커버리지)해 stale 탐지 → 통합 리포트 → 항목별 확인 → 수정. guide/ko·en 본문은 제외(/guide 전담). 빌드 안 함."
---

# source-command-doc-check

Use this skill when the user asks to run the migrated source command `doc-check`.

## Command Template

저장소의 핵심 문서를 **문서별 전담 에이전트**로 병렬 검사한다. 각 에이전트가 담당 문서 전문을 읽고 현재 코드베이스와 **양방향**으로 대조해 **어긋난 부분(stale)**을 찾는다. 메인 스레드가 결과를 통합 리포트로 제시하고, 사용자 확인을 거쳐 수정·커밋한다.

## `/push`와의 차이 (왜 따로 있나)

`/push`의 신선도 검사는 **푸시될 diff에 걸린 문서만** 트라이아지한다 — 최근 커밋이 건드리지 않은 영역에 누적된 stale은 통과시킨다. `/doc-check`는 **diff와 무관하게 문서 전문 ↔ 현재 코드베이스 전체를 양방향 대조**한다. 즉 오래 방치돼 천천히 어긋난 내용을 잡는 게 목적. `/push`의 검사는 푸시 직전 2차 안전망으로 그대로 둔다.

## guide 본문은 검사 대상 아님 (AUTHORING은 검사함)

`guide/ko·en` **본문 페이지**는 `/doc-check`가 다루지 않는다 — 가이드 본문 신선도는 IA·톤·UI 라벨·ko/en 동기화까지 일관 관리하는 `/guide` 스킬 전담. 다만 가이드 작성 매뉴얼인 **`guide/AUTHORING.md`는 검사한다**: 그 사실 스냅샷(플랫폼 표·단축키·현재 기능 목록 등)이 코드와 어긋나면 `/guide` 작업 전체의 기준이 오염되므로 `/doc-check`가 코드 대조로 잡는다.

## 사용

- `/doc-check` — 8개 문서 전부 병렬 검사.
- `/doc-check <doc> [doc...]` — 지정 문서만. 키워드: `claude`, `directory`, `architecture`, `design`, `readme`, `permission`, `privacy`, `authoring`.

예시:

```
/doc-check                       → 8개 전부
/doc-check architecture          → docs/ARCHITECTURE.md만
/doc-check architecture claude   → docs/ARCHITECTURE.md + CLAUDE.md
/doc-check design                → docs/DESIGN.md만
```

## 검사 대상 (문서별 에이전트)

| 키워드 | 문서 | 대조 관점 |
|---|---|---|
| `claude` | **CLAUDE.md** | 스택·명령어 표·코드 컨벤션·게이트웨이·워크플로우(스킬 라인업)·permissions/host_permissions·env 목록이 현재 `package.json`·`manifest.config.ts`·`.claude/commands/`·코드와 일치하는지 |
| `directory` | **docs/DIRECTORY.md** | 디렉터리 구조·파일별 역할이 현재 `src/` 트리와 일치하는지 (없는 파일 설명·새 파일 누락·이동/리네임) |
| `architecture` | **docs/ARCHITECTURE.md** | Side Panel 탭 스코프, user gesture, 세션 영속화, 6개 플랫폼 인증, 어댑터 패턴, 토큰 체인 resolve, CSSOM 캐시, DOM lazy load, 마크다운 복사, 이슈 섹션 구성, 마이그레이션 등 설계 상세가 실제 구현과 일치하는지 |
| `design` | **docs/DESIGN.md** | 디자인 토큰·다크모드·타이포·버튼/아이콘 사이즈·레이아웃·반응형·공용 합성 컴포넌트·상태 표현 컨벤션이 현재 `tailwind.config.js`·`globals.css`·`src/components/ui/`·`src/sidepanel/components/`·실제 사용처와 일치하는지 |
| `readme` | **README.md** | 기능 목록·설치/사용법·스크린샷 설명·지원 플랫폼이 현재 코드와 맞는지 |
| `permission` | **docs/PERMISSION.md** | activeTab 라이프사이클·OAuth 토큰 흐름·optional permission 등 권한 레퍼런스가 현재 `manifest.config.ts`·코드 사용처와 일치하는지 |
| `privacy` | **docs/privacy.ko.md · docs/privacy.en.md** | 권한·host_permissions·수집 정보·외부 전송 대상·저장 방식이 현재 매니페스트뿐 아니라 **실제 코드 동작**(캡처/수집/전송)과 일치하는지 + **ko(원본)↔en(번역) 내용 동기화** 여부 |
| `authoring` | **guide/AUTHORING.md** | 가이드 작성 매뉴얼의 사실 스냅샷(플랫폼 표·단축키·로그 정책·현재 기능 목록·파일 트리·footer·검증 체크리스트)이 현재 코드/구조와 어긋났는지. **guide 본문 페이지는 검사하지 않고, 작성 기준인 이 매뉴얼만** 코드 대조 |

## 절차

### 1. 대상 결정

인자가 있으면 해당 키워드 문서만, 없으면 8개 전부. 존재하지 않는 키워드는 무시하고 보고에 명시. `guide`(ko/en 본문)는 의도적 비대상 — 들어오면 "guide 본문은 `/guide` 전담"으로 안내(`authoring`은 검사 대상이니 별개).

### 2. 공통 컨텍스트 로드 (메인, 1회)

각 에이전트에 넘길 코드베이스 기준점을 메인에서 미리 읽는다:
- `CLAUDE.md` (아키텍처 원칙·컨벤션·게이트웨이)
- `package.json` (scripts·deps), `manifest.config.ts` (권한·명령어·스킴)
- `src/` 트리 개요 (`git ls-files src | ...` 수준의 파일 목록)

이 컨텍스트는 에이전트가 "문서가 주장하는 사실"을 빠르게 검증하는 출발점일 뿐, 에이전트는 실제 소스를 직접 열어 확인한다.

### 3. 문서별 병렬 검사

활성 문서마다 에이전트를 **동시에** 실행한다 (`subagent_type: general-purpose`). 각 에이전트에:
- 담당 문서 **전문** (전체를 읽고 섹션 단위로 검증)
- 위 공통 컨텍스트
- 아래 검사 지침

각 문서 에이전트는 **2-pass**로 검사한다. 한 방향만 보면 못 잡는 stale이 갈린다 — Pass 1은 문서→코드(틀린 단언), Pass 2는 코드→문서(빠진 내용). **둘 다 돌려야 한다.**

**Pass 1 — 문서→코드 (사실오류 탐지)**
1. 담당 문서를 섹션/주장 단위로 분해하고 **코드베이스에서 검증할 사실 목록**을 만든다 (파일 경로, 함수명, 권한 문자열, 명령어, 플랫폼 수, UI 라벨, **기본값·매트릭스 셀** 등 검증 가능한 단언).
2. 항목별로 Explore 하위 에이전트를 **병렬** 생성 (`subagent_type: Explore`)해 실제 코드와 대조한다. ("이 파일/함수가 실재하는가", "이 권한이 manifest에 있는가", "이 표의 셀 값(예: 모드별 기본값)이 코드와 같은가").

**Pass 2 — 코드→문서 (누락 커버리지 탐지)** ← 이게 한 방향 검사의 사각이다
3. 문서가 **다루기로 선언한 주제 영역**을 식별한다 (그 문서의 섹션 제목·범위가 곧 책임 범위). 예: ARCHITECTURE는 "서브시스템 설계", DIRECTORY는 "src 파일별 역할", PERMISSION은 "권한별 사용처".
4. 그 영역의 **코드에 실재하는 핵심 동작·기본값·엣지케이스·하위 기능**을 Explore로 훑어, 문서에 **반영 안 된 것**을 찾는다. 두 종류를 본다:
   - **통째 누락**: 코드엔 있는 서브시스템/파일/플랫폼인데 문서에 섹션·항목 자체가 없음.
   - **섹션 내부 누락**(가장 놓치기 쉬움): 섹션은 있는데 그 안의 기본값·토글·분기·캡 같은 디테일이 빠짐. 예: "로그 정책 매트릭스"는 있는데 모드별 첨부 기본값 셀이 코드와 다르거나, "이슈 섹션 구성"은 있는데 파일 첨부 서브시스템 서술이 없음.
5. **노이즈 억제**: 코드의 *모든 것*을 요구하지 말 것. "설계상 의미 있는 누락"(동작을 바꾸는 기본값, 안전 캡, 회귀 위험 분기, 새 하위 시스템)만 올린다. 문서가 의도적으로 범위 밖이라 한 것은 제외.

6. 두 pass 결과를 합쳐 **문서 ↔ 코드 불일치만** 추린다. 일치 항목은 보고하지 않는다(노이즈 금지).

#### 에이전트 출력 형식

각 문서 에이전트는 아래 형식으로 **구조화된 stale 목록만** 반환:

```
## [문서명] 신선도 검사

### 발견 (stale)
각 항목:
- 위치: <문서 섹션/라인 추정. 섹션 자체가 없으면 "없음(누락)">
- 문서 주장: <문서가 말하는 것. 누락이면 "(서술 없음)">
- 실제 코드: <코드베이스 사실 + 근거 파일:라인>
- 종류: forward(틀린 단언) / coverage(누락)
- 심각도: 🔴 사실 오류(틀린 경로/권한/동작/기본값) / 🟡 누락(코드엔 있는데 문서에 없음) / ⚪ 표현/사소
- 제안 수정: <한 줄>

### 깨끗 (참고)
"검증한 N개 단언 중 불일치 M개 / 커버리지 점검한 K개 주제 중 누락 J개" 한 줄 요약. 일치 항목 나열 금지.
```

stale이 없으면 "발견 0 — Pass1 N개 단언·Pass2 K개 주제 모두 일치" 한 줄.

### 4. 통합 리포트 (메인)

전 에이전트 결과를 **문서별 → 심각도순**으로 한 번에 정리해 제시한다. 사용자가 전체 그림을 먼저 본다. 심각도 집계(🔴 n / 🟡 n / ⚪ n)를 상단에.

### 5. 항목별 확인 → 수정

심각도 순(🔴 → 🟡 → ⚪)으로 수정 후보를 **AskUserQuestion으로** 던진다:
- 🔴 명백한 사실 오류는 묶어서 일괄 수정 허락을 구할 수 있다.
- 🟡/⚪ 는 항목별로 적용/제외 선택지 제시.
- 합의된 항목만 Edit으로 반영.
- docs/privacy.{ko,en}.md를 갱신하면 **ko/en 양쪽 본문과 상단 시행일**을 오늘 날짜로 함께 갱신(en은 ko 번역이라 항상 동기화).
- AUTHORING.md를 고칠 땐 사실 스냅샷(표·목록)만 코드에 맞춰 정정한다. 가이드 본문(`guide/ko·en`)이 함께 어긋났다고 판단되면 여기서 손대지 말고 **`/guide`로 분리** 권고만 보고에 남긴다.

### 6. 커밋

수정된 문서를 **문서별 별도 커밋**으로 묶는다 (영문):
`docs(CLAUDE): ...` / `docs(DIRECTORY): ...` / `docs(ARCHITECTURE): ...` / `docs(DESIGN): ...` / `docs(README): ...` / `docs(PERMISSION): ...` / `docs(privacy): ...` / `docs(guide): ...` (AUTHORING.md)

수정 없으면 커밋 없이 "변경 불필요" 보고.

### 7. 종료

수정 요약 보고 후 끝. 후속 액션 자동 실행 금지.

## 금지 사항

- **코드 수정 금지** — `src/`, `manifest`, `package.json` 등 프로덕션 코드는 손대지 않는다. 문서만 수정.
- **빌드/테스트 실행 금지** — 읽기 전용 검사. 타입 확인이 필요하면 보고만.
- **에이전트 직접 수정 금지** — 에이전트는 stale 목록만 반환. 수정은 사용자 합의 후 메인이.
- **노이즈 금지** — 코드와 일치하는 항목을 "확인했다"고 나열하지 않는다. 불일치만 보고.
- **푸시 금지** — 커밋까지만. 푸시는 `/push`.
