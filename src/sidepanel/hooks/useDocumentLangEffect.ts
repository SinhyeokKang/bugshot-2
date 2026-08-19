import { useEffect } from "react";
import { BCP47 } from "@/i18n/locales";
import { useSettingsUiStore } from "@/store/settings-ui-store";

// index.html의 `lang`은 정적이라 로케일과 어긋난다 — 스크린리더 발음·폰트 선택·브라우저
// 번역 제안이 전부 이 속성을 본다. useThemeEffect에 얹지 않는 건 그 훅이 `system`일 때
// matchMedia를 등록/해제해서다(로케일을 섞으면 전환마다 재구독한다).
export function useDocumentLangEffect(): void {
  const locale = useSettingsUiStore((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = BCP47[locale];
  }, [locale]);
}
