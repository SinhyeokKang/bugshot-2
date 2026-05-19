# bugshot-web

## 배경

Bugshot은 Chrome 웹스토어에 게시된 확장 프로그램이지만 전용 소개 페이지가 없다. 웹스토어 상세 페이지만으로는 제품의 핵심 가치를 전달하기 어렵고, 검색(SEO)·공유·브랜딩 채널이 부재하다. ui-inspector.com, jam.dev 같은 경쟁 제품은 모두 독립 랜딩 사이트를 운영하며 설치 전환을 유도한다.

## 목표

1. Bugshot의 핵심 기능을 시각적으로 전달하는 싱글 페이지 랜딩 사이트를 만든다.
2. Chrome 웹스토어 설치 CTA를 명확히 노출해 전환율을 높인다.
3. SEO를 확보해 "chrome bug reporting extension" 등 키워드로 유입을 만든다.
4. 별도 레포지토리(`bugshot-web`)로 운영하되, bugshot-2와 스택 친화성을 유지한다.

## 비목표 (Non-goals)

- 블로그, 문서(docs), 프라이싱 페이지 — 이번 스코프에서 제외.
- 사용자 후기/소셜프루프 섹션 — 소재가 없으므로 제외 (추후 추가 가능).
- 제품 내 데모/인터랙티브 위젯 — 목업 이미지로 대체.
- Bugshot 확장 코드 변경 — 웹사이트는 독립 프로젝트.

## 사용자 시나리오

### 시나리오 1: 검색 유입 → 설치
1. 사용자가 "chrome css inspector extension" 등으로 검색
2. 랜딩 페이지 도달 → 히어로에서 제품 가치 인지
3. 기능 섹션 스크롤하며 상세 확인
4. "Add to Chrome" CTA 클릭 → 웹스토어로 이동

### 시나리오 2: 공유 링크 → 설치
1. 동료/커뮤니티에서 bugshot 링크를 받음
2. 히어로의 한 줄 설명 + 목업 이미지로 즉시 이해
3. 통합 플랫폼 섹션에서 자신이 쓰는 도구(Jira/GitHub 등) 확인
4. CTA 클릭 → 설치

### 시나리오 3: 모바일 접속
1. 모바일에서 링크 도달
2. 반응형 레이아웃으로 콘텐츠 정상 확인
3. CTA 버튼 텍스트를 조건부 변경: 모바일은 "View in Web Store", 데스크톱은 "Add to Chrome". 버튼은 동일하게 웹스토어 링크로 이동

## 페이지 섹션 구성

| # | 섹션 | 역할 | 참고 |
|---|------|------|------|
| 1 | **Header** | 로고 + "Add to Chrome" CTA (sticky) | ui-inspector 상단 |
| 2 | **Hero** | 헤드라인 + 서브카피 + CTA + 제품 목업 이미지 | ui-inspector 히어로 |
| 3 | **Feature Cards** | 핵심 기능 4-5개를 카드로 소개 (이미지 + 카피) | jam.dev 피처 카드 |
| 4 | **How It Works** | 3-5단계 워크플로우 시각화 | ui-inspector의 Edit→Collect→Refine→Track→Export |
| 5 | **Integrations** | Jira / GitHub / Linear / Notion 로고 + 한 줄 설명 | jam.dev 통합 섹션 |
| 6 | **Bottom CTA** | 최종 설치 유도 (히어로 CTA 반복) | 양쪽 레퍼런스 공통 |
| 7 | **Footer** | 링크 (Privacy Policy, GitHub, Chrome Web Store) | — |

### Feature Cards (5개 확정)

1. **Element Picker & Live CSS** — DOM 요소 선택 + 실시간 스타일 편집 + 디자인 토큰 인식. Bugshot의 핵심 차별 기능.
2. **Screenshot & Recording** — 영역 크롭 + 어노테이션 + 60초 화면 녹화. 시각적 맥락 전달의 핵심.
3. **Network & Console Logs** — 자동 캡처 + 이슈에 첨부. 개발자에게 재현 부담을 줄이는 킬러 피처.
4. **AI Draft & Styling** — BYOK AI로 이슈 초안 + 스타일 제안. 작성 시간 단축.
5. **One-Click Issue Filing** — Jira/GitHub/Linear/Notion 한 번에 등록. Integrations 섹션과 일부 겹치지만, 워크플로우 완결성을 보여주는 독립 카드로 유지.

### How It Works 스텝 (확정)

1. **Detect** — DOM 요소를 선택하면 CSS 토큰과 스타일 체인을 실시간 추출
2. **Resolve** — 디자인 토큰을 인식하고 스타일 수정·비교를 자동 생성
3. **Capture** — 스크린샷·녹화·네트워크/콘솔 로그를 자동 수집해 맥락 완성
4. **Deliver** — 플랫폼(Jira/GitHub/Linear/Notion)에 맞는 이슈 포맷을 자동 생성·등록

## 성공 기준

- [ ] 싱글 페이지 랜딩이 Vercel에 배포되어 커스텀 도메인으로 접근 가능
- [ ] Lighthouse Performance ≥ 90, SEO ≥ 90
- [ ] Chrome 웹스토어 링크 CTA가 히어로·하단 두 곳에 노출
- [ ] 모바일 반응형 레이아웃 정상 동작
- [ ] OG 메타 태그 설정으로 SNS 공유 시 썸네일·설명 정상 노출
