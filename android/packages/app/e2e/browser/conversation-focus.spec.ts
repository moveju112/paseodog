import { test, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { buildSettingsSectionRoute } from "@/utils/host-routes";

for (const width of [1280, 390]) {
  // 실제 설정 화면의 기본값·닉네임 저장·빈 값 복원을 두 화면 폭에서 확인한다.
  test(`conversation nickname persists and empty input restores Dog at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
      await gotoAppShell(page);
      await page.goto(buildSettingsSectionRoute("chat"));
      const input = page.getByRole("textbox", { name: "Assistant nickname", exact: true });
      await expect(input).toHaveValue("Dog");
      await input.fill("우리 강아지");
      await input.blur();
      await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("@paseo:app-settings") ?? "{}").assistantNickname,
      )).toBe("우리 강아지");
      await page.reload();
      await expect(input).toHaveValue("우리 강아지");
      await input.fill("");
      await input.blur();
      await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("@paseo:app-settings") ?? "{}").assistantNickname,
      )).toBe("");
      await page.reload();
      await expect(input).toHaveValue("Dog");
      await expect.poll(() => page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth,
      )).toBe(true);
  });
}
