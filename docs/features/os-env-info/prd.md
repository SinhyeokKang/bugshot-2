# OS 환경 정보

## 배경
browser-env-info(Chrome 버전)가 이슈 환경 섹션에 추가됐다. 버그 리포트에 OS 정보(macOS 15.2, Windows 11 등)도 기본 환경 정보로 필요하다. browser-env-info와 동일한 패턴으로 OS 행을 추가한다.

## 목표
- 이슈 환경 섹션에 OS 행을 추가한다 (OS → Browser → Page → ... 순서)
- 정확한 OS 버전을 표시한다 (Chrome UA frozen 문제를 `navigator.userAgentData.getHighEntropyValues()` API로 해결)
- 모든 캡처 모드(element/screenshot/video/freeform)에서 동일하게 표시한다
- 4개 플랫폼(GitHub/Jira/Linear/Notion) 이슈 본문과 마크다운 복사에 포함한다

## 비목표
- OS 아이콘 표시
- OS별 조건부 동작 분기
- 사용자가 OS 정보를 직접 편집하는 기능

## 사용자 시나리오

### 기본 플로우
1. 사용자가 요소를 선택하고 이슈를 작성한다
2. 환경 섹션에 OS(macOS 15.2), Browser(Chrome 128.0...), Page, DOM 등이 readonly로 표시된다
3. 이슈를 플랫폼에 제출하면 본문 환경 섹션에 OS가 첫 행으로 포함된다
4. 마크다운 복사에도 OS가 포함된다

### 출력 형식 예시
- macOS: `macOS 15.2`
- Windows 11: `Windows 11`
- Windows 10: `Windows 10`
- Linux: `Linux`
- Chrome OS: `Chrome OS 120.0`

### 엣지 케이스
- `getHighEntropyValues()` 실패 시: OS 행 생략 (null fallback, Browser 행이 환경 섹션 첫 행이 됨)
- side panel 로드 직후 매우 빠르게 이슈 제출 시: OS가 아직 resolve 안 됐을 수 있음 → null, 행 생략 (로컬 브라우저 API라 실질적으로 발생하지 않음)

## 성공 기준
- [ ] 4개 캡처 모드에서 환경 섹션에 OS 행이 표시된다
- [ ] OS 행이 Browser 위, 환경 섹션 첫 번째에 위치한다
- [ ] macOS에서 "macOS XX.Y" 형식으로 정확한 버전이 표시된다
- [ ] Windows에서 "Windows 10" 또는 "Windows 11"로 구분 표시된다
- [ ] Linux에서 "Linux"로 표시된다
- [ ] 4개 플랫폼 이슈 본문에 OS가 포함된다
- [ ] 마크다운 복사에 OS가 포함된다
- [ ] `formatOsInfo` 순수 함수에 대한 단위 테스트가 존재한다
- [ ] 기존 `deriveReadonlyEnvRows` 테스트에 os 필드가 반영된다
- [ ] 기존 `buildGithubIssueBody` 테스트에 os 필드가 반영된다
