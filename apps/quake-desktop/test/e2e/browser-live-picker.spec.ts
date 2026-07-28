import { expect, test } from "@playwright/test";
import { buildPickerScript } from "../../electron/browser-inspector";

test("keeps the inspected page live while selecting multiple elements", async ({ page }) => {
  await page.setContent(`
    <style>
      body { margin: 0; min-height: 900px; font-family: system-ui; }
      button { position: absolute; left: 80px; width: 180px; height: 44px; }
      #first { top: 100px; }
      #second { top: 320px; }
    </style>
    <output id="ticks">0</output>
    <button id="first">Birinci element</button>
    <button id="second">İkinci element</button>
    <script>
      window.pageClicks = 0;
      document.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => { window.pageClicks += 1; });
      });
      setInterval(() => {
        const output = document.querySelector("#ticks");
        output.textContent = String(Number(output.textContent) + 1);
      }, 20);
    </script>
  `);

  await page.evaluate((source) => {
    const runtime = (0, eval)(source) as Promise<unknown>;
    (window as any).__pickerResult = null;
    void runtime.then((result) => { (window as any).__pickerResult = result; });
  }, buildPickerScript());

  const first = await page.locator("#first").boundingBox();
  const second = await page.locator("#second").boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();

  await page.mouse.click(first!.x + 20, first!.y + 20);
  const ticksAfterFirstPick = Number(await page.locator("#ticks").textContent());
  await page.waitForTimeout(120);
  expect(Number(await page.locator("#ticks").textContent())).toBeGreaterThan(ticksAfterFirstPick);

  await page.keyboard.down("Control");
  await page.mouse.click(second!.x + 20, second!.y + 20);
  await page.keyboard.up("Control");

  expect(await page.evaluate(() => (window as any).pageClicks)).toBe(0);
  const sendButtonRect = await page.evaluate(() => (window as any).__quakeElementPickerSession.getSendButtonRect());
  await page.mouse.click(
    sendButtonRect.x + sendButtonRect.width / 2,
    sendButtonRect.y + sendButtonRect.height / 2,
  );
  await expect.poll(() => page.evaluate(() => (window as any).__pickerResult?.status)).toBe("completed");

  const result = await page.evaluate(() => (window as any).__pickerResult);
  expect(result.annotations).toHaveLength(2);
  expect(result.annotations.map((entry: any) => entry.target.id)).toEqual(["first", "second"]);

  await page.locator("#first").click();
  expect(await page.evaluate(() => (window as any).pageClicks)).toBe(1);
});
