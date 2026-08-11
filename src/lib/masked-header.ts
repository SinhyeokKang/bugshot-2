// 네트워크 레코더가 민감 헤더 값을 지울 때 남기는 표식. 소비처(로그 표시·curl 복사)가
// "이건 원문이 아니라 마스킹된 것"을 판정하는 단일 출처다.
//
// 생산자는 `src/content/network-recorder.ts`이고 리터럴을 복제해 갖는다 — 그 파일은
// recorders-entry 청크라 src/content/ 밖을 static import하면 동기 IIFE가 깨져 pre-arm이
// 죽는다(빌드·테스트는 전부 green인 채로). 복제본은 `__tests__/masked-header.test.ts`의
// 소스 대조가 묶는다.
const SENTINEL = /^\*\*\*\[len:\d+\]$/;

export function isMaskedHeaderValue(value: string): boolean {
  return SENTINEL.test(value);
}
