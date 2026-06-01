# 가이드 문서 작성 매뉴얼 (AUTHORING)

`guide/ko`·`guide/en` 사용자 가이드를 **만들거나 고칠 때 이 문서를 먼저 읽는다.** 운영 방식·IA·톤·사실 대조·검증까지 가이드 작성에 필요한 모든 규칙이 여기 있다. 기능별 PRD/설계 문서(`docs/features/<slug>/`)는 구현 후 삭제되므로, 영속 지식은 이 파일이 단일 출처다.

> 이 파일은 `guide/` 루트(ko/en 상위)에 있어 **GitBook 동기 대상이 아니다** — 레포에만 남는 내부 문서다. 사용자에게 노출되지 않는다.

---

## 1. 운영 방식

- `guide/ko`·`guide/en`은 GitBook으로 공개되는 사용자 가이드의 in-repo 소스다. **레포 → GitHub Sync 단방향**(코드가 진실, GitBook에서 직접 편집하지 않는다).
- **언어별 독립 사이트**다:
  - ko → `https://bugshot.gitbook.io/ko`
  - en → `https://bugshot.gitbook.io/en`
  - URL 정의: `src/lib/external-links.ts`의 `USER_GUIDE_URLS`. 사이드패널 푸터의 "BugShot 가이드" 버튼이 로케일에 맞춰 이 URL로 보낸다.
- 두 사이트가 독립이므로 **assets도 언어별로 따로** 둔다(`guide/ko/assets/`, `guide/en/assets/`).
- 각 언어 `.gitbook.yaml`은 `root: ./`, `structure.summary: SUMMARY.md`. **변경하지 않는다.**
- 커밋 prefix는 **`docs(guide): ...`** (`/push` 신선도 검사의 guide 트리거 대상).

## 2. IA / 파일 트리 (언어당 동일 — ko/en 양쪽 대칭)

23페이지 × 2언어 = 46개 마크다운 + 언어별 `SUMMARY.md` + 언어별 더미 이미지.

```
README.md                       # 1. 소개
quick-start.md                  # 1-1. 빠른 시작
integrations/README.md          # 2. 연동 설정 (개요 + 바로가기)
integrations/platforms.md       # 2-1. 플랫폼 연동
integrations/issue-tracking.md  # 2-2. 이슈 트래킹
settings/README.md              # 3. 기본 설정 (개요 + 바로가기)
settings/issue.md               # 3-1. 이슈 설정
settings/ai.md                  # 3-2. AI LLM 연동
element/README.md               # 4. 요소 선택 & 스타일링 (개요 + 바로가기)
element/picker.md               # 4-1. 요소 선택
element/styling.md              # 4-2. 스타일링
element/issue.md                # 4-3. 이슈 작성 (요소 모드, 자기완결)
screenshot/README.md            # 5. 스크린샷 캡처 (개요 + 바로가기)
screenshot/capture.md           # 5-1. 스크린샷 캡처
screenshot/annotation.md        # 5-2. 어노테이션
screenshot/issue.md             # 5-3. 이슈 작성 (스크린샷 모드, 자기완결)
video/README.md                 # 6. 녹화 (개요 + 바로가기)
video/record.md                 # 6-1. 실시간 녹화
video/replay.md                 # 6-2. 30초 리플레이
video/issue.md                  # 6-3. 이슈 작성 (녹화 모드, 자기완결)
logs/README.md                  # 7. 로그 (개요 + 바로가기)
logs/live.md                    # 7-1. 실시간 로그 (+ freeform 흡수)
logs/viewer.md                  # 7-2. 로그 뷰어 (logs.html, 개발자 관점)
assets/dummy.jpg                # 더미 스크린샷
```

**섹션 README는 개요 1~2문단 + 하위 페이지 바로가기**로만 구성한다. 각 섹션 `issue.md`는 캡처 모드별로 **자기완결**(반복 허용) — 사용자가 자기 모드 문서 하나만 열어도 전체 흐름을 알게 한다.

`SUMMARY.md`는 위 트리를 그대로 중첩 리스트로 반영한다(ko 한글 제목 / en 영문 제목, 경로는 동일).

## 3. 페이지 구성 원칙

각 페이지는 (a) 1~2문단 도입 (b) 단계/항목 설명 (c) 스크린샷 자리로 구성한다. 새 페이지를 추가하면 **ko·en을 그 자리에서 동시에** 작성한다(분리 금지 — 드리프트·컨텍스트 손실 방지).

### 이슈 작성 공통 흐름 (단일 출처 — 3개 `issue.md` 드리프트 방지)

element/screenshot/video 세 `issue.md`는 아래 7단계를 **그대로 반복**하고, 각 페이지는 "고유분"(미디어 종류 + 녹화 모드 로그 정책)만 다르게 쓴다.

| 단계 | 내용 |
|---|---|
| 1. 제목 | 설정의 제목 접두어(prefill) 적용 |
| 2. 재현 환경 | 자동 메타(OS/브라우저/URL/뷰포트/시각) readonly + 사용자 추가 변수 row |
| 3. 미디어 | **모드별 고유** — 요소=before/after 스타일 표 / 스크린샷=주석 이미지 / 녹화=영상 |
| 4. 본문 섹션 | 발생 현상·재현 과정·기대 결과·비고(설정 토글대로). **AI 초안 작성** 배너(AI 연결 시) |
| 5. 로그 첨부 | 요소=없음 / 스크린샷=콘솔·네트워크 기본 off / 녹화=콘솔·네트워크·액션 기본 on |
| 6. 미리보기 | 제출 전 본문 확인 + 마크다운 복사 |
| 7. 제출 | 플랫폼 필드 입력 → 완료 URL |

## 4. 사실 대조 소스 (코드가 진실 — 추측 금지)

가이드의 사실이 코드와 어긋나면 안 된다. 불확실하면 **반드시 아래 소스를 재확인**한다.

| 사실 | 소스 경로 |
|---|---|
| 단축키 | `manifest.config.ts` commands (배정값 신뢰 — 화면은 `chrome.commands.getAll()`로 동적 표시) |
| 본문 섹션 기본값·형식 | `src/store/settings-ui-store.ts` (`DEFAULT_ISSUE_SECTIONS`) |
| 본문 섹션 라벨/플레이스홀더 | `src/i18n/namespaces/issue.ts`, `editor.ts` |
| 캡처 모드·freeform 버튼 라벨 | `src/i18n/namespaces/issue.ts` (`issue.mode.*`, `issue.startDraft`) |
| 스타일 패널 섹션·순서 | `src/sidepanel/tabs/StyleEditorPanel.tsx` (라벨은 `editor.ts`) |
| AI 배너 라벨 | `src/i18n/namespaces/ai.ts`, `editor.ts` |
| 어노테이션 | `src/sidepanel/components/AnnotationOverlay.tsx` (markerjs2 — 도구 제한 없으면 라이브러리 기본 영문 툴바) |
| 로그 정책(모드별 기본 on/off) | `src/sidepanel/lib/captureLogSupport.ts`, `src/store/editor-store.ts` |
| 로그 뷰어 마커 | `src/log-viewer/markers.ts` (`MarkerType`: console/network/action, navigate는 action variant) |
| GitBook URL | `src/lib/external-links.ts` (`USER_GUIDE_URLS`) |
| 연동 탭 자동 진입 | `src/sidepanel/tabs/integrationsTabUtils.ts` |

### 현재 사실 스냅샷 (작성 시점 기준 — 코드 변경 시 갱신)

- **단축키**: `Cmd/Ctrl+Shift+E`(패널 토글) / `Cmd/Ctrl+Shift+S`(요소) / `Cmd/Ctrl+Shift+F`(스크린샷) / `Cmd/Ctrl+Shift+X`(영상). best-effort라 OS·타 확장 충돌 시 미배정될 수 있음을 한 줄 안내.
- **본문 섹션**: 발생 현상(켜짐·문단) / 재현 과정(켜짐·번호 목록) / 기대 결과(켜짐·문단) / 비고(꺼짐·문단). 라벨·플레이스홀더 override 가능.
- **로그 정책**: 요소=로그 없음 / 스크린샷=콘솔·네트워크 토글 **기본 off** / 녹화=콘솔·네트워크·액션 **기본 on**. 액션 로그는 **녹화 모드 전용**. 자동 수집 주기 ~1.5초.
- **로그 뷰어 마커**: 콘솔/네트워크/액션 3종. 페이지 이동은 액션 마커의 variant(별도 타입 아님). `logs.html`은 빌드 산출물 → 일반 사용자는 "이슈 첨부로 받은 리포트를 여는" 개발자 관점으로만 기술.
- **플랫폼 표** (현 시점 6개 스냅샷):

  | 플랫폼 | 연결 방식 | 토큰 입력 시 필요값 | 토큰 발급 |
  |---|---|---|---|
  | Jira | OAuth / API Token | baseUrl, email, apiToken | id.atlassian.com → API tokens |
  | GitHub | OAuth / PAT | PAT | github.com/settings/tokens |
  | Linear | OAuth / API Key | apiKey | linear.app 보안 설정 |
  | Notion | OAuth / Internal Token | token | notion.so 통합 |
  | GitLab | OAuth / PAT | instanceUrl(self-managed만), pat | gitlab.com PAT |
  | Asana | OAuth / PAT | pat | app.asana.com my-apps |

  > **플랫폼 표는 stale 위험이 크다.** 신규 플랫폼(예: azure-devops·clickup)이 머지되면 이 표와 `integrations/platforms.md`(ko/en)를 즉시 갱신한다. 플랫폼 추가는 별도 `docs(guide)` 갱신 대상.

## 5. 톤앤매너

bug-shot.com 랜딩 기준. **친절하고 캐주얼하게.** ko/en은 같은 정보를 담되 **직역하지 않고** 각 언어 톤으로 자연스럽게 쓴다.

### 한국어

- **"-습니다" 종결어미 유지**(해요체로 바꾸지 않는다). 그 위에 캐주얼·친절한 톤을 입힌다.
- 공감형 도입 한 마디("~하던 작업, 막막했던 적 있으시죠.").
- 쿠션어를 자연스럽게(과하지 않게): "혹시 ~라면", "걱정 마세요", "어렵지 않습니다", "괜찮습니다", "딱 한 번만 해두면 됩니다", "신경 쓰지 않으셔도 됩니다".

```
[Before] 사이드패널은 네 개의 탭으로 나뉩니다.
[After]  복잡해 보여도 걱정 마세요. 사이드패널은 딱 네 개의 탭으로 나뉘어 있어서, 하나씩 보면 금방 익숙해집니다.
```

### English

- 친절·격려 톤. ko의 공감/쿠션에 대응하되 영어식으로(직역 아님): "No worries", "don't worry", "It's simpler than it sounds", "so don't sweat it", "nothing to worry about", "with peace of mind".
- 동사 시작·짧은 문장 선호. 핵심어: "in one shot / one click", "automatically".

```
[Before] BugShot is a Chrome side panel extension that lets you pick DOM elements...
[After]  Ever spotted a bug and thought, "how do I even explain this?" That's exactly the moment BugShot was built for. BugShot is a Chrome side panel extension...
```

## 6. UI 라벨 표기 규칙 (중요)

- 가이드 본문은 **로케일별 실제 화면 라벨**을 인용한다(ko 가이드=ko UI, en 가이드=en UI). 실제 문구는 i18n 기준(`src/i18n/namespaces/`).
- **영문 식별자를 그대로 쓰지 않는다.** 코드/설계의 영문 라벨(Element/Repick/Stop 등)은 식별용일 뿐이다. 예시(과거 실제 교정 사례):
  - `dom.repick` → ko "다시 선택" / en "Pick another element" (❌ "Repick")
  - `issue.recording.stop` → ko "녹화 완료" / en "Stop recording" (❌ "Stop")
  - `networkLog.clear` → ko "로그 지우기" / en "Clear Log" (❌ "Clear")
  - `networkLog.detail.copyCurl` → ko "cURL 복사" / en "Copy as cURL" (❌ "Copy cURL")
- **예외**: 실제 UI가 영문인 항목(스타일 패널 섹션명 Class/Layout/… 등)은 영문 그대로 쓰되 "화면에서 영문 표시"라고 한 줄 안내.
- 캡처 모드 라벨: ko "DOM 요소 선택 / 화면 캡처 / 영상 녹화" · en "Select DOM element / Screenshot / Record video".
- freeform 진입 버튼: ko "이슈 작성" · en "Write issue".
- **"이슈 작성 / Write an Issue"로 통일**한다(과거 video만 "버그 리포트 작성"이었다가 통일함). 모드 간 라벨을 일관되게.

## 7. 마크다운·GitBook 규칙

- **GitBook 확장 문법(`{% hint %}` 등) 미사용.** 주의/경고/선행조건은 plain 인용구(`>`)로.
- **이미지**: 모든 스크린샷 자리에 더미 + 의미 있는 alt/캡션. 경로 깊이를 페이지 위치에 맞춘다:
  - 루트 페이지(`README.md`, `quick-start.md`): `![설명](assets/dummy.jpg)`
  - 1단계 하위(`integrations/*.md` 등): `![설명](../assets/dummy.jpg)`
  - 캡션은 "여기엔 무슨 스크린샷"인지 사용자가 나중에 교체할 수 있게 구체적으로.
  - 더미 원본은 `~/Desktop/bugshot-guide-dummy.jpg` → 언어별 `assets/dummy.jpg`로 복사. 실제 스크린샷 교체는 사용자 몫(비목표).
- **언어 전환 footer**: 본문 페이지(SUMMARY 제외) **맨 아래**에 한 줄. 각 언어 사이트 **홈**으로 연결(slug 무관·무파손).
  - ko 페이지 끝:
    ```
    ---

    🌐 [English](https://bugshot.gitbook.io/en)
    ```
  - en 페이지 끝:
    ```
    ---

    🌐 [한국어](https://bugshot.gitbook.io/ko)
    ```
  - 페이지당 정확히 1개. SUMMARY.md에는 넣지 않는다.

## 8. ko/en 대칭 원칙

- 파일 트리·페이지 수·섹션 구성(헤딩)이 ko/en 1:1 대응이어야 한다.
- 한쪽만 페이지/섹션을 추가·삭제하지 않는다.
- 헤딩 텍스트를 바꿀 땐 ko/en 양쪽을 함께(의미 일치 유지).

## 9. 검증 체크리스트 (작업 후 실행)

순수 문서라 `pnpm test` 영향 없음. 아래 정적 점검으로 대체한다(`cd guide`).

```bash
# 1. 플레이스홀더 잔존 0건
grep -rn "작성 예정\|coming soon" .

# 2. ko/en 파일 트리 대칭
diff <(cd ko && find . -name '*.md'|sort) <(cd en && find . -name '*.md'|sort)

# 3. ko/en 페이지별 헤딩 수 대칭
for p in $(cd ko && find . -name '*.md'|sort); do
  kc=$(grep -c '^#' "ko/$p"); ec=$(grep -c '^#' "en/$p")
  [ "$kc" != "$ec" ] && echo "MISMATCH $p ko=$kc en=$ec"
done

# 4. 내부 .md 링크 깨짐 (앵커·외부 URL 제외)
for lang in ko en; do
  while IFS= read -r line; do
    f="${line%%:*}"; rest="${line#*:}"; dir=$(dirname "$f")
    echo "$rest" | grep -oE '\]\([^)]+\.md[^)]*\)' | sed 's/^](//; s/)$//' | while read -r link; do
      case "$link" in http*) continue;; esac
      [ ! -f "$dir/${link%%#*}" ] && echo "BROKEN: $f -> $link"
    done
  done < <(grep -rnE '\]\([^)]+\.md' "$lang")
done

# 5. 더미 이미지 경로 깊이 유효 (루트 assets/, 하위 ../assets/)
for lang in ko en; do
  while IFS= read -r line; do
    f="${line%%:*}"; rest="${line#*:}"
    img=$(echo "$rest" | sed -n 's/.*](\([^)]*dummy.jpg\)).*/\1/p'); [ -z "$img" ] && continue
    dir=$(dirname "$f"); [ ! -f "$dir/$img" ] && echo "BROKEN IMG: $f -> $img"
  done < <(grep -rn "dummy.jpg" "$lang")
done

# 6. footer 페이지당 1개 (SUMMARY 제외)
for f in $(find ko en -name '*.md' ! -name 'SUMMARY.md'); do
  c=$(grep -c '🌐' "$f"); [ "$c" != "1" ] && echo "ABNORMAL $f: $c"
done
```

수동: GitBook 동기 후(또는 로컬 미리보기) 좌측 트리·이미지·내부 링크 렌더 확인.

## 10. 작업 팁

- 섹션 단위로 끊어 ko·en을 함께 작성(46파일을 한 번에 쓰면 품질 편차). 톤 일관성을 위해 소개(README)를 먼저 써서 어휘·문체 기준을 잡는다.
- 라벨/사실 일괄 변경은 `sed`로, 톤 워싱은 페이지별 재작성으로(문맥 의존).
- 이 문서(`guide/AUTHORING.md`)도 IA·톤·운영 방식·사실 스냅샷이 바뀌면 함께 갱신한다.
- 가이드 작성·갱신은 **`/guide` 스킬**이 이 매뉴얼을 로드해 실행한다(`.claude/commands/guide.md`). `/feature` tasks의 "가이드 영향" + `/implement` 보고의 "가이드 영향 ⚠️" 플래그가 진입 신호. `/push`는 stale을 감지하는 게이트일 뿐, 무거운 작성은 `/guide`로 분리한다.
