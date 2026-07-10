# Product Hunt 런치 킷

BugShot의 Product Hunt 제출용 카피·자산·규정 요약. **제출 폼에 그대로 붙여넣는 것이 목적**이라 본문 카피는 영문으로 둔다.

새 이미지·영상은 만들지 않는다 — 갤러리는 웹스토어 리스팅 스크린샷을, 썸네일은 `bugshot-web`의 심볼을 재사용한다.

## 제출 폼 값

| 필드 | 값 |
|---|---|
| Name | `BugShot` |
| Tagline (≤60) | `Bug reports in one shot — no sign-up, no video calls` (52자) |
| Topics (≤3) | Chrome Extensions · Developer Tools · Productivity |
| Website | https://bug-shot.com |
| Chrome Web Store | https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig |
| Pricing | Free |
| Video | 없음 (선택 항목) |
| Thumbnail | [`assets/thumbnail-240.png`](./assets/thumbnail-240.png) |

### Description

앞 250자만 노출되므로 핵심을 앞에 둔다. 아래는 253자.

```
A Chrome side panel that turns a bug you spotted into a complete report. Edit an element's CSS live, capture a screenshot or a recording, and file it to Jira, GitHub, Linear, Notion, Slack and more — with environment, before/after styles, and console/network logs already attached. No sign-up.
```

> **글자 수는 폼에서 직접 확인한다.** 공식 헬프센터는 260자, 공식 런치 가이드는 500자로 서로 다르게 적혀 있다. 위 카피는 어느 쪽이든 통과한다.

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

```
Hey Product Hunt 👋

I built BugShot because filing a decent bug report is mostly clerical work.
You reproduce the bug, screenshot it, copy the URL and the browser version,
dig through the console, then paste it all into a tracker. By the time you're
done you've forgotten what you were actually working on.

BugShot is a Chrome side panel that collapses that into one pass:

- Pick an element and fix it live. Edit its CSS right on the page — through
  form fields or a real CSS editor with autocomplete and color swatches. Every
  change is tracked as a before → after table in the report, so a developer sees
  exactly which properties to change. It resolves var() chains too, so the
  report says --color-primary instead of rgb(79, 70, 229).
- Capture what you need. An element, a region, a screen recording, or the last
  30 seconds of the tab. Annotate it before attaching.
- Logs come along for free. Console, network, and user actions are recorded in
  the background, including inside cross-origin iframes.
- File it where you already work. Jira, GitHub, Linear, Notion, GitLab, Asana,
  ClickUp — or share straight to a Slack channel or DM.

No sign-up, no account, no server of ours in the middle. Everything runs locally
in the extension and talks directly to your tracker.

I'd love to hear where it breaks for you — especially which tracker or workflow
you'd want next. Happy to answer anything in the comments.
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
