import { describe, expect, it } from "vitest";
import { brandTranslations } from "./paseodog-brand";

describe("PaseoDog display branding", () => {
  it("brands nested translations without mutating upstream strings or keys", () => {
    const original = { inPaseo: "Paseo에 오신 것을 환영합니다", nested: { title: "Welcome to Paseo" } };
    expect(brandTranslations(original)).toEqual({
      inPaseo: "PaseoDog에 오신 것을 환영합니다",
      nested: { title: "Welcome to PaseoDog" },
    });
    expect(original.inPaseo).toBe("Paseo에 오신 것을 환영합니다");
  });
  it("preserves existing branding, CLI names, commands, links and interpolation", () => {
    const value = "PaseoDog / Paseo CLI / paseo daemon / paseo:// / {{name}}";
    expect(brandTranslations(value)).toBe(value);
  });
});
