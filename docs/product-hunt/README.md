# Product Hunt 런치 킷

BugShot의 Product Hunt 제출용 카피·자산·규정 요약. **제출 폼에 그대로 붙여넣는 것이 목적**이라 본문 카피는 영문으로 둔다.

새 이미지·영상은 만들지 않는다 — 갤러리는 웹스토어 리스팅 스크린샷을, 썸네일은 `bugshot-web`의 심볼을 재사용한다.

## 제출 폼 값

| 필드 | 값 |
|---|---|
| Name | `BugShot` |
| Tagline (≤60) | `Discover, fix, capture, and report bugs in one shot.` (52자, [주석](#tagline)) |
| Topics (≤3) | Chrome Extensions · Developer Tools · Productivity |
| Website | https://bug-shot.com |
| Chrome Web Store | https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig |
| GitHub | https://github.com/SinhyeokKang/bugshot-2 |
| Open source? | **체크 안 함** — 레포는 public이지만 LICENSE가 없어 법적으로 All Rights Reserved |
| Pricing | Free |
| Video | 없음 (선택 항목) |
| Thumbnail | [`assets/thumbnail-240.png`](./assets/thumbnail-240.png) |
| Shoutouts (≤3) | Claude Code · Cloudflare Workers · PostHog ([아래](#shoutouts)) |

### Tagline

`in one shot`이 제품명 `BugShot`을 에코한다 — PH는 제품명과 tagline을 나란히 렌더링하므로 tagline 안에서 이름을 반복할 필요가 없다.

웹스토어 en `EXT_DESCRIPTION`은 `...in one workflow.`로 **다르게 둔다**(의도적). 스토어 리스팅 문구를 바꾸면 다음 심사에 걸리므로 PH에서만 `one shot`을 쓴다. ko `EXT_DESCRIPTION`("...한 번에.")과는 원래 결이 같다.

### Description

제한 **500자, 개행 문자도 센다**(제출 폼에서 실측). 앞 250자만 펼치지 않고 노출되므로 1문단이 단독으로 성립해야 한다. 아래는 491자 — 1문단 242 + 2문단 167 + 3문단 78 + 개행 4 = 491, 여유 9. 1문단이 242자라 250 컷 안에 통째로 들어간다.

```
A Chrome side panel that turns a bug into a complete report. Capture it, annotate it, and file it to Jira, GitHub, Linear, Notion, Slack and more — with the environment, console/network logs, and any CSS you fixed on the way already attached.

No need to reproduce it twice. Capture after the bug and the last 30 seconds of the tab come with it — console errors, failed requests, and every click that led there.

Free, no account, and your report goes straight to your tracker — never to us.
```

> **경쟁 서비스와 비교하는 카피는 쓰지 않는다.** 자사 강점만 진술한다.

> **CSS 편집을 주인공으로 세우지 않는다.** 갤러리에선 차별점이라 2번으로 당기지만(gallery-spec 참조), description의 질문은 "왜 너냐"가 아니라 "왜 관심 가져야 하냐"다. CSS 편집은 CSS 버그에만 걸리고, 크래시·500·깨진 플로우엔 무력하다. 모든 버그에 걸리는 축(소급 캡처·로그·8개 트래커)을 앞에 둔다.

> **"상시 녹화 중"이라고 쓰지 않는다.** 30s replay 폴링은 리플레이 모드가 `enabled`일 때만 돈다(`use-30s-replay.ts:48`, 60프레임/30초 롤링 `FrameBuffer`). 로그도 active origin(한 번이라도 armed된 origin)에 한해 pre-arm 버퍼링된다. 참인 주장은 "**버그가 터진 뒤에 눌러도 직전 30초가 남아 있다**"까지다.

> **자수는 반드시 실측한다.** 눈대중으로 적은 값이 40자 틀려 폼에서 걸린 적 있다. `python3 -c "print(len(open('x.txt').read()))"` 로 개행 포함 확인.

> **"우리 서버를 안 거친다"고 쓰지 않는다.** OAuth 프록시가 6개 플랫폼(Jira·GitHub·Notion·Asana·ClickUp·Slack)의 인가 코드 교환을 중계한다 — Linear·GitLab만 PKCE로 직행. PostHog 익명 이벤트도 나간다. 정확한 주장은 "**리포트**가 우리를 안 거친다"이고, 이건 참이다. `docs/privacy.ko.md` §3과 표현을 맞춘다.

## Shoutouts

3개까지. 각 shoutout은 **상대 제품 페이지에 founder review로 박히고** 일반 리뷰 위에 노출되며 BugShot 링크가 함께 달린다 — 사실상 백링크 3장. PH는 shoutout이 있는 런치가 홈·뉴스레터에 featured될 확률이 높다고 밝히고 있다.

"어떻게 만들었나 / 프라이버시를 어떻게 지키나 / 어떻게 측정하나" 세 축에 하나씩 대응시켜 first comment 서사와 겹치게 골랐다.

| 제품 | 노트 (폼에 붙여넣을 문구) |
|---|---|
| **Claude Code** | `BugShot was built end to end with Claude Code — the whole workflow lives in .claude/commands/ in the repo.` |
| **Cloudflare Workers** | `Runs the OAuth proxy that relays token exchange for Jira, GitHub, Notion, Asana, ClickUp and Slack — and stores nothing.` |
| **PostHog** | `Anonymous usage counts, and the only telemetry BugShot sends anywhere.` |

Claude Code를 넣는 건 "AI로 만든 확장"이라고 공개 선언하는 것과 같다. `CLAUDE.md`가 이미 public이라 새 정보는 아니지만 코멘트 톤이 그쪽으로 쏠릴 수 있다. 피하고 싶으면 shadcn/ui로 교체.

## 갤러리

6장. 카피·목업 지시서는 **[gallery-spec.md](./gallery-spec.md)** 가 단일 출처다.

최소 2장이 필요하고, 갤러리 첫 장은 썸네일이 아니다(썸네일은 별도 240×240 필드).

| # | 헤드라인 | 보여주는 것 |
|---|---|---|
| 1 | The report writes itself | 완성된 이슈 (환경 자동 수집) |
| 2 | Fix the bug before you file it | **라이브 CSS 편집 + before/after 표** ← 신규 |
| 3 | Capture exactly what broke | 캡처 모드 5종 + 어노테이션 |
| 4 | Console, network, actions. All captured | 로그 자동 수집 |
| 5 | AI drafts the report | 재현 절차 AI 초안 |
| 6 | Send dev-ready reports in one shot | 8개 플랫폼 + 무료·가입 없음 |

웹스토어 리스팅 순서를 따르지 않는다. 웹스토어는 "이게 뭔지"를 설명하지만 PH 방문자는 tagline·description으로 그걸 이미 읽었다. 그래서 차별점(2번)을 앞으로 당겼다.

[`assets/gallery/`](./assets/gallery/)의 웹스토어 en 스크린샷 5장(1280×800)이 베이스다. **2번만 신규 제작하면 나머지는 카피만 얹어 재사용**할 수 있다 — 대응표는 gallery-spec.md 참조.

### 쓰지 않는 웹스토어 에셋

- `marquee.png` (1400×560) — 비율 2.5:1이라 PH 갤러리에서 심하게 레터박스된다.
- `og.png` (1200×630) — 마찬가지. OG 태그 전용.
- `thumbnail.png` (440×280) — 웹스토어 타일용 가로형. PH 썸네일은 240×240 정사각이라 부적합.

## First comment (maker)

> **하드랩 금지.** PH 코멘트 입력창은 textarea라 개행이 그대로 보존된다. 문단은 반드시 한 줄로 두고(에디터에서 소프트랩), 불릿 항목만 개행한다. 아래 블록을 통째로 복사해 붙여넣으면 된다.

```
Hey Product Hunt 👋

I built BugShot because filing a decent bug report is mostly clerical work. You reproduce the bug, screenshot it, copy the URL and the browser version, dig through the console, then paste it all into a tracker. By the time you're done you've forgotten what you were actually working on.

BugShot is a Chrome side panel that collapses that into one pass:

- Pick an element and fix it live. Edit its CSS right on the page — through form fields or a real CSS editor with autocomplete and color swatches. Every change is tracked as a before → after table in the report, so a developer sees exactly which properties to change. It resolves var() chains too, so the report says --color-primary instead of rgb(79, 70, 229).
- Capture what you need. An element, a region, a screen recording, or the last 30 seconds of the tab. Annotate it before attaching.
- Logs come along for free. Console, network, and user actions are recorded while BugShot is running, including inside cross-origin iframes.
- File it where you already work. Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp — or share straight to a Slack channel or DM.

No sign-up, no account. Everything runs locally in the extension and posts directly to your tracker — your screenshots, logs and report text never touch a server of mine. The one exception is OAuth: platforms that require a client secret (Jira, GitHub, Notion, Asana, ClickUp, Slack) have their auth code exchanged through a small proxy that relays the token and stores nothing. Linear and GitLab use PKCE and skip it entirely.

I'd love to hear where it breaks for you — especially which tracker or workflow you'd want next. Happy to answer anything in the comments.
```

## 규정 (2026-07 기준, 출처 = PH 공식 헬프센터·런치 가이드)

- **업보트를 요청하면 안 된다.** 친구·가족·커뮤니티에 upvote를 부탁하는 행위를 공식 가이드라인이 금지한다. 알고리즘이 비정상 투표 패턴을 감지해 순위를 내리거나 홈에서 제거한다. 공유하고 **피드백·토론을 요청**하는 건 허용 — first comment도 그렇게 썼다.
- **Coming Soon / Teaser 페이지는 2025년 8월경 폐지됐다.** 사전에 알림을 모아두는 전략은 못 쓴다. 런치 당일 바로 시작한다.
- **런치는 PT 자정(12:01 AM)에 라이브**되고 최대 한 달 전까지 예약된다. 그 시각에 맞춰야 만 24시간 노출을 확보한다.
- **셀프 헌팅이 정상이다.** 헌터에게 비용을 지불할 필요 없고, 유명 헌터 섭외의 효과는 예전보다 약하다.
- **영상은 선택이다.** 다만 2021년 이후 Product of the Day 달성작의 약 53%가 영상을 포함했다(PH 공식 통계). 순위를 노린다면 이게 가장 큰 레버다.
- 요일은 화·수·목이 강하다는 게 통념이다(공식 규칙 아님).

## 런치 전 체크리스트

런치 시점에 스토어에 올라가 있는 버전이 곧 유입이 설치하는 버전이다. **웹스토어 심사 통과 확인이 게이트다** — 통과 전에 날짜를 잡으면 당일 유입이 구버전을 받는다.

- [ ] `/merge` — 버전 bump + main 스쿼시
- [ ] `/deploy` — tag push + 스토어 빌드 + GitHub Release draft + 심사 제출
- [ ] 웹스토어 심사 통과 확인 (보통 수일)
- [ ] `bug-shot.com` 접속·설치 링크 동작 확인
- [ ] PH 런치 예약 (화~목, PT 자정)
- [ ] 런치 직후 first comment 게시
