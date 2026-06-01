# 플랫폼 연동

플랫폼 연결은 **연동** 탭에서 합니다. 연결된 플랫폼이 없으면 "플랫폼 추가" 화면으로, 하나라도 있으면 "내 연동" 화면으로 들어갑니다.

## 연결하는 법

생각보다 간단합니다. 세 단계면 됩니다.

1. "플랫폼 추가"에서 연결할 플랫폼을 고릅니다.
2. 연결 방식 선택 다이얼로그가 뜨면 **OAuth**(브라우저 로그인) 또는 **토큰 직접 입력** 중 하나를 고릅니다.
3. OAuth면 로그인 창에서 권한을 허용하면 끝, 토큰 방식이면 발급한 토큰과 필요한 값을 입력합니다.

![연결 방식 선택 다이얼로그](../assets/dummy.jpg)

대부분은 OAuth가 가장 편합니다. 다만 조직 정책으로 OAuth를 못 쓰거나 토큰을 선호하신다면 토큰 방식을 쓰면 됩니다.

## 플랫폼별 연결 정보

| 플랫폼 | 연결 방식 | 토큰 입력 시 필요값 | 토큰 발급 |
|---|---|---|---|
| Jira | OAuth / API Token | baseUrl, email, apiToken | id.atlassian.com → API tokens |
| GitHub | OAuth / PAT | PAT | github.com/settings/tokens |
| Linear | OAuth / API Key | apiKey | linear.app 보안 설정 |
| Notion | OAuth / Internal Token | token | notion.so 통합(Integration) |
| GitLab | OAuth / PAT | instanceUrl(self-managed만), pat | gitlab.com PAT |
| Asana | OAuth / PAT | pat | app.asana.com my-apps |

> GitLab self-managed 인스턴스나 직접 입력 LLM을 연결할 때는 해당 도메인 접근 권한을 추가로 요청할 수 있습니다. 놀라지 마시고 허용해 주시면 연결이 마무리됩니다.

## 연결 후 기본값

연결하면 그 플랫폼에서 이슈를 만들 위치의 기본값을 골라 둘 수 있습니다 — Jira·GitLab의 프로젝트, GitHub의 저장소, Linear의 팀, Notion의 데이터베이스, Asana의 프로젝트처럼요. 한 번만 정해 두면 이슈를 쓸 때마다 다시 고르지 않아도 되니 한결 편합니다.

![연결 후 기본값 설정](../assets/dummy.jpg)

## 연결 해제

"내 연동"에서 플랫폼별로 연결을 끊을 수 있고(플러그 해제 아이콘), 모든 연결을 한 번에 해제하는 것도 가능합니다. 해제해도 이미 제출한 이슈에는 아무 영향이 없으니 안심하세요.

---

🌐 [English](https://bugshot.gitbook.io/bugshot-en/)
