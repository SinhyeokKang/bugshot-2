---
name: 웹스토어 확장 ID
description: 로컬 dev / 웹스토어 배포판 extension ID 및 oauth-proxy ALLOWED_ORIGINS 설정 정보
type: reference
---

- 로컬 dev ID: `dhmffogmoohdjficicjjfolcheklngfm` (manifest key에서 파생)
- 웹스토어 ID: `ohakhekagkodklkickemonmifdcbhmig`
- Cloudflare Worker(`bugshot-oauth`)의 `ALLOWED_ORIGINS` secret에 두 origin 콤마 나열로 등록됨
- 설정 위치: Cloudflare Dashboard → Workers & Pages → bugshot-oauth → Settings → Variables and Secrets
