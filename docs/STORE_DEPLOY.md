# Chrome 웹스토어 배포 가이드

## 사전 완료

- [x] 개발자 계정 등록 ($5 일회성)
- [x] 앱 아이콘 128x128 (`src/assets/icons/icon-128.png`)
- [x] v1.0.0 태깅
- [x] GitHub repo public 전환
- [x] 개인정보처리방침 작성 + GitHub Pages 호스팅 (`docs/privacy.md`)

---

## 1. 스토어 등록 정보 준비

### 필수

| 항목 | 요구사항 | 상태 |
|---|---|---|
| 이름 | BugShot | 완료 (manifest `__MSG_EXT_NAME__`) |
| 요약 (132자) | 한 줄 설명 | 작성 필요 |
| 상세 설명 | 기능·사용법 서술 | 작성 필요 |
| 카테고리 | Developer Tools | 선택 필요 |
| 언어 | 한국어 (기본) + English | 설정 필요 |
| 스크린샷 | 1280x800 또는 640x400, 최소 1장 최대 5장 | 촬영 필요 |
| 아이콘 | 128x128 PNG | 완료 |

### 선택 (권장)

| 항목 | 요구사항 |
|---|---|
| 프로모션 타일 (소) | 440x280 PNG/JPEG |
| 프로모션 타일 (대) | 1400x560 PNG/JPEG |
| 홈페이지 URL | GitHub repo 등 |
| 지원 URL | GitHub Issues 등 |

### 스크���샷 촬영 가이드

추천 구성 (5장):
1. **모드 선택 화면** — idle 상태의 3가지 캡처 모드 버튼
2. **DOM 요소 선택** — picker로 요소 hover/선택된 상태 + 사이드 패널
3. **스타일 편집** — 토큰 매핑 + CSS 편집 UI
4. **스크린샷 주석** — 영역 캡처 + markerjs2 주석 편집
5. **Jira 이슈 생성** — 프리뷰 또는 이슈 생성 모달

> 팁: Chrome DevTools의 Device Mode에서 정확히 1280x800으로 맞추고 전체 화면 캡처하면 리사이즈 없이 바로 사용 가능.

---

## 2. 개인정보처리방침 — 완료

- 문서: `docs/privacy.md`
- URL: `https://sinhyeokkang.github.io/bugshot-2/privacy`

---

## 3. 권한 정당화

대시보드 업로드 시 각 권한의 사용 목적을 기술해야 한다.

| 권한 | 사용 목적 |
|---|---|
| `sidePanel` | 메인 UI를 사이드 패널로 표시 |
| `activeTab` | 현재 탭의 DOM 요소 선택 및 스타일 정보 수집 |
| `scripting` | content script 동적 주입 (DOM picker, 영역 선택 오버레이) |
| `storage` | 편집 세션·설정·이슈 기록 영속화 |
| `commands` | 키보드 단축키 (`Alt+Shift+B`) |
| `contextMenus` | 우클릭 메뉴에서 BugShot 실행 |
| `identity` | Atlassian OAuth 3LO 인증 플로우 (`launchWebAuthFlow`) |
| `tabCapture` | 탭 영상 녹화 (최대 60초) |

### host_permissions

| 호스트 | 사용 목적 |
|---|---|
| `*.atlassian.net` | Jira REST API ��출 (이슈 생성, 첨부 파일 업로드) |
| `api.atlassian.com` | Atlassian OAuth API (토큰, 리소스 조회) |
| `auth.atlassian.com` | Atlassian 인가 페이지 |
| OAuth proxy origin | OAuth token 교환 중계 (client_secret 보호) |

---

## 4. 빌드 + 패키징

```bash
# 1. 버전 확인
cat package.json | grep version

# 2. 스토어용 빌드 (manifest key 제거)
pnpm build:store

# 3. zip 패키징
cd dist && zip -r ../bugshot-v$(node -p "require('../package.json').version").zip . && cd ..
```

결과물: `bugshot-v1.0.0.zip`

---

## 5. 대시보드 업로드

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) 접속
2. **새 항목** 클릭
3. zip 파일 업로드
4. **스토어 등록 정보** 탭: 설명·스크린샷·카테고리 입력
5. **개인정보 보호관행** 탭: 개인정보처리방침 URL 입력 + 권한 정당화
6. **배포** 탭: 공개 범위 설정 (공개 / 비공개 / 그룹)
7. **Atlassian OAuth Callback URL 추가** (아래 참고)
8. **제출하여 심사 받기**

### OAuth Callback URL 등록

웹스토어 업로드 ��� 부여되는 **스토어 확장 ID**를 확인한 뒤, Atlassian OAuth 앱에 콜백 URL을 추가해야 한다. 스토어 ID는 개발용 ID(`key`로 고정)와 다르다.

1. 대시보드에서 업로드된 항목의 확장 ID 확인 (예: `abcdefghijklmnopqrstuvwxyz123456`)
2. [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/) → OAuth 앱 → **Authorization** → Callback URL에 추가:
   ```
   https://<STORE_ID>.chromiumapp.org/
   ```
3. 개발용 콜백(`https://<DEV_ID>.chromiumapp.org/`)은 그대로 두면 양쪽 다 동작
4. `VITE_ATLASSIAN_CLIENT_ID`는 동일한 앱이므로 변경 불필요

---

## 6. 심사

- 일반적으로 1~3 영업일
- `tabCapture`, `scripting` ��� 민감 권한 포함 시 추가 심사 가능
- 거부 시 사유와 함께 이메일 수신 → 수정 후 재제출

---

## 7. 업데이트 배포 (이후)

```bash
pnpm version patch    # 또는 minor/major
pnpm build:store
cd dist && zip -r ../bugshot-v$(node -p "require('../package.json').version").zip . && cd ..
```

대시보드에서 기존 항��� → **패키지** 탭 → 새 zip 업로드 → 제출.
