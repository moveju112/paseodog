import { test } from "../support/fixtures";
import { expect } from "@playwright/test";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import {
  expectRelayConsent,
  openPairDeviceModal,
  preparePairingHost,
  closePairDeviceModal,
} from "../support/helpers/pair-device";

test.use({ screenshot: "off", video: "off", trace: "off" });

test("opens relay consent in browser web", async ({ page }) => {
  const daemon = await startIsolatedHostDaemon("pair-device-browser-relay-off", {
    mutableRelay: { enabled: false },
  });
  try {
    await preparePairingHost(page, daemon);
    await openPairDeviceModal(page);
    await expectRelayConsent(page);
  } finally {
    await daemon.close();
  }
});

// 비밀번호 입력 전에는 주소를 숨기고 재발급에도 기존 암호를 요구한다.
test("requires a relay password before generating or reissuing a link", async ({ page }) => {
  const daemon = await startIsolatedHostDaemon("pair-device-browser-password", {
    mutableRelay: { enabled: true },
  });
  try {
    await preparePairingHost(page, daemon);
    await openPairDeviceModal(page);
    const input = page.getByTestId("pair-device-password");
    const generate = page.getByTestId("pair-device-generate");
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("type", "password");
    await expect(generate).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Pairing link" })).toHaveCount(0);
    await input.fill("relay-e2e-secret");
    await generate.click();
    const link = page.getByRole("textbox", { name: "Pairing link" });
    await expect(link).toHaveValue(/#offer=/);
    expect(await link.inputValue()).not.toContain("relay-e2e-secret");

    await closePairDeviceModal(page);
    await openPairDeviceModal(page);
    await expect(input).toHaveValue("");
    await expect(link).toHaveCount(0);
    await input.fill("wrong-password");
    await generate.click();
    await expect(page.getByRole("alert")).toContainText("Incorrect relay password");
    await expect(link).toHaveCount(0);
    await input.fill("relay-e2e-secret");
    await generate.click();
    await expect(link).toHaveValue(/#offer=/);
    const oldLink = await link.inputValue();

    // 잊은 비밀번호 재설정: 새 주소를 발급하고 이전 비밀번호는 거부한다(호스트 재시작 포함).
    await closePairDeviceModal(page);
    await openPairDeviceModal(page);
    await page.getByTestId("pair-device-reset-toggle").click();
    await input.fill("relay-e2e-renewed");
    await generate.click();
    await expect(link).toHaveValue(/#offer=/, { timeout: 30_000 });
    expect(await link.inputValue()).not.toBe(oldLink);
    await expect(
      page.getByRole("alert").filter({ hasText: "Password and link were reset" }),
    ).toBeVisible();
    await closePairDeviceModal(page);
    await openPairDeviceModal(page);
    await input.fill("relay-e2e-secret");
    await generate.click();
    await expect(page.getByRole("alert")).toContainText("Incorrect relay password", {
      timeout: 30_000,
    });
  } finally {
    await daemon.close();
  }
});
