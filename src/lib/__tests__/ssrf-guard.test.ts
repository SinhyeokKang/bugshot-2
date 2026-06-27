import { describe, it, expect } from "vitest";

import { isFetchableSheetUrl } from "../ssrf-guard";

// cross-origin 스타일 보강(css.fetchSheets)에서 background가 페이지 제어 href를
// fetch하기 전 통과시키는 SSRF 가드. http(s) 공개 origin만 허용하고,
// loopback·link-local·사설 IP·비-http 스킴을 차단한다.
describe("isFetchableSheetUrl (SSRF 가드)", () => {
  describe("허용 — 공개 http(s) origin", () => {
    it.each([
      "https://cdn.example.com/main.css",
      "http://example.com/styles/app.css",
      "https://pstatic.net/css/main.css?v=3",
      "http://93.184.216.34/a.css", // 공개 IPv4
      "http://172.32.0.1/a.css", // private 172.16/12 범위 바로 밖
    ])("%s → true", (url) => {
      expect(isFetchableSheetUrl(url)).toBe(true);
    });
  });

  describe("차단 — 비 http(s) 스킴", () => {
    it.each([
      "file:///etc/passwd",
      "data:text/css,body{color:red}",
      "chrome://settings",
      "chrome-extension://abcdef/x.css",
      "ftp://example.com/a.css",
    ])("%s → false", (url) => {
      expect(isFetchableSheetUrl(url)).toBe(false);
    });
  });

  describe("차단 — loopback / localhost", () => {
    it.each([
      "http://127.0.0.1/x.css",
      "http://127.1.2.3/x.css",
      "https://localhost/x.css",
      "http://localhost:6379/x.css",
      "http://[::1]/x.css",
    ])("%s → false", (url) => {
      expect(isFetchableSheetUrl(url)).toBe(false);
    });
  });

  describe("차단 — FQDN 후행 점 우회", () => {
    it.each([
      "http://localhost./x.css",
      "http://127.0.0.1./x.css",
      "http://169.254.169.254./x.css",
    ])("%s → false", (url) => {
      expect(isFetchableSheetUrl(url)).toBe(false);
    });
  });

  describe("차단 — IPv6 사설/loopback/IPv4-mapped", () => {
    it.each([
      "http://[fd00::1]/x.css", // ULA
      "http://[fc00::1]/x.css", // ULA
      "http://[fe80::1]/x.css", // link-local
      "http://[feba::1]/x.css", // link-local /10 상단
      "http://[::ffff:127.0.0.1]/x.css", // IPv4-mapped loopback (dotted)
      "http://[::ffff:169.254.169.254]/x.css", // IPv4-mapped link-local (hex 직렬화)
      "http://[::127.0.0.1]/x.css", // IPv4-compatible(deprecated) loopback (dotted)
      "http://[::7f00:1]/x.css", // IPv4-compatible loopback (hex 직렬화)
      "http://[::a9fe:a9fe]/x.css", // IPv4-compatible link-local 169.254.169.254
    ])("%s → false", (url) => {
      expect(isFetchableSheetUrl(url)).toBe(false);
    });
  });

  describe("차단 — link-local / 클라우드 메타데이터", () => {
    it.each([
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.0.1/x.css",
    ])("%s → false", (url) => {
      expect(isFetchableSheetUrl(url)).toBe(false);
    });
  });

  describe("차단 — 사설 IPv4 (RFC1918) + unspecified", () => {
    it.each([
      "http://10.0.0.1/x.css",
      "http://10.255.255.255/x.css",
      "http://192.168.1.1/x.css",
      "http://172.16.0.1/x.css",
      "http://172.31.255.255/x.css",
      "http://0.0.0.0/x.css",
    ])("%s → false", (url) => {
      expect(isFetchableSheetUrl(url)).toBe(false);
    });
  });

  describe("에러 — 파싱 불가 입력", () => {
    it.each([
      "not a url",
      "",
      "//cdn.example.com/a.css", // 스킴 없음 → new URL() throw
    ])("%j → false", (url) => {
      expect(isFetchableSheetUrl(url)).toBe(false);
    });
  });
});
