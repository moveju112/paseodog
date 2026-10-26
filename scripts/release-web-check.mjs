import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function verifyReleaseWeb({ url, output }, playwright) {
    const { chromium, expect } = playwright ??
        createRequire(new URL('../android/packages/app/package.json', import.meta.url))('@playwright/test');
    const html = await readFile(resolve(output, 'index.html'), 'utf8');
    const entry = /src="([^"]*\/index-[^"]+\.js)"/.exec(html)?.[1];
    assert.ok(entry, 'Exported entry bundle missing');
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        assert.equal(response.status(), 200);
        await page.getByTestId('welcome-direct-connection').click({ timeout: 30000 });
        await page.getByTestId('direct-host-input').fill('example.invalid');
        await page.getByTestId('direct-port-input').fill('6768');
        const password = page.getByTestId('direct-password-input');
        await password.fill('release-check-only');
        await expect(password).toHaveJSProperty('type', 'password');
        await page.getByTestId('direct-password-visibility-toggle').click();
        // type 속성이 생략돼도 DOM의 기본 type=text는 유효하다.
        await expect(password).toHaveJSProperty('type', 'text');
        await page.getByTestId('direct-password-visibility-toggle').click();
        await expect(password).toHaveJSProperty('type', 'password');
        const deep = await page.goto(new URL('/h/release-check/settings', url).href,
            { waitUntil: 'networkidle', timeout: 60000 });
        assert.equal(deep.status(), 200);
        await page.getByTestId('startup-splash').waitFor({ state: 'hidden', timeout: 30000 });
        const refreshed = await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
        assert.equal(refreshed.status(), 200);
        await page.getByTestId('startup-splash').waitFor({ state: 'hidden', timeout: 30000 });
        const body = await page.locator('body').innerText();
        assert.ok(body.trim());
        assert.doesNotMatch(body, /Unmatched Route|404 Not Found/);
        const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src));
        assert.ok(scripts.includes(new URL(entry, url).href), 'Production bundle differs from exported commit');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { await verifyReleaseWeb({ url: process.argv[2], output: process.argv[3] }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
