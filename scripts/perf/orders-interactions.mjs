import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { chromium } = await import(pathToFileURL(resolve('../../outputs/perf-runtime/node_modules/playwright/index.mjs')).href);
const label = process.argv[2] ?? 'current';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const role of ['admin', 'employee', 'franchisee']) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === 'localhost' && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(`http://localhost:3011/scripts/perf/orders.html?role=${role}`, { waitUntil: 'networkidle' });
    await page.getByText('查看明細', { exact: true }).first().waitFor();
    async function measure(action) {
      return page.evaluate(async action => {
        const start = performance.now();
        const button = action === 'increment'
          ? document.querySelector('button[aria-label="加一"]')
          : [...document.querySelectorAll('button')].find(el => el.textContent.trim().endsWith(action));
        if (!button) throw new Error(`Missing action ${action}`);
        button.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return Math.round(performance.now() - start);
      }, action);
    }
    const expandMs = await measure('查看明細');
    const editMs = await measure('調整貨量');
    const incrementMs = [];
    for (let i = 0; i < 4; i++) incrementMs.push(await measure('increment'));
    const input = page.locator('input[aria-label*="叫貨數量"]').first();
    assert.equal(await input.inputValue(), '14');
    await page.getByRole('button', { name: '加一', exact: true }).first().tap();
    assert.equal(await input.inputValue(), '15');
    await input.fill('17');
    assert.equal(await input.inputValue(), '17');
    await page.getByRole('button', { name: '儲存貨量', exact: true }).click();
    await page.waitForFunction(() => {
      const orders = JSON.parse(localStorage.getItem('dongshan_order_history_v1') ?? '[]');
      return orders.find(order => order.id === 'perf-0')?.lines[0]?.qty === 17;
    });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dongshan_order_history_v1'))
      .find(order => order.id === 'perf-0'));
    assert.equal(saved.totalAmount, 1628);
    assert.equal(saved.lines[1].qty, 10);
    const tabMs = await measure('已盤點');
    await page.waitForFunction(() => document.body.textContent.includes('perf-2'));
    const backMs = await measure('未完成訂單');
    await page.getByText('查看明細', { exact: true }).first().waitFor();
    await page.evaluate(() => {
      const key = 'dongshan_order_history_v1';
      const orders = JSON.parse(localStorage.getItem(key));
      orders.find(order => order.id === 'perf-1').status = '已取消';
      localStorage.setItem(key, JSON.stringify(orders));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });
    await page.waitForFunction(() => [...document.querySelectorAll('button')]
      .filter(button => button.textContent.trim().endsWith('查看明細')).length === 1);
    await page.screenshot({ path: resolve(`../../outputs/orders-${label}-${role}.png`) });
    assert.equal(errors.length, 0);
    results.push({ role, cpuSlowdown: 4, orderCount: 600, expandMs, editMs, incrementMs, tabMs, backMs,
      savedQty: saved.lines[0].qty, savedAmount: saved.totalAmount, errors });
    console.log(JSON.stringify(results.at(-1)));
    await writeFile(resolve(`../../outputs/orders-${label}.json`), JSON.stringify(results, null, 2));
    await context.close();
  }
} finally {
  await browser.close();
}
await mkdir(resolve('../../outputs'), { recursive: true });
await writeFile(resolve(`../../outputs/orders-${label}.json`), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
