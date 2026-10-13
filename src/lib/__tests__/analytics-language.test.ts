import { describe, expect, it } from "vitest";
import { languageEventProperties } from "../analytics-language";
import { LOCALES } from "@/i18n/locales";

describe("languageEventProperties", () => {
  it("resolves auto for every supported UI locale", () => {
    for (const locale of LOCALES) {
      expect(languageEventProperties(locale, "auto")).toEqual({
        ui_locale: locale, report_locale_setting: "auto", report_locale: locale,
      });
    }
  });

  it("keeps an explicit report language independent of UI language", () => {
    expect(languageEventProperties("ko", "en")).toEqual({
      ui_locale: "ko", report_locale_setting: "en", report_locale: "en",
    });
  });

  it("normalizes untrusted settings without transmitting raw values", () => {
    expect(languageEventProperties("private@example.com", "private-token")).toEqual({
      ui_locale: "en", report_locale_setting: "auto", report_locale: "en",
    });
    expect(languageEventProperties("fr", undefined).report_locale).toBe("fr");
  });
});
