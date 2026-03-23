import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = process.env.README_SCREENSHOT_BASE_URL || "http://127.0.0.1:5173";
const OUTPUT_DIR = path.resolve(process.cwd(), "docs/assets/readme");

const VIEWPORT = { width: 1440, height: 900 };

const TAB_LABELS = {
  upload: [/上传/i, /涓婁紶/i],
  download: [/下载/i, /涓嬭浇/i],
  simple: [/简化模式/i],
};

const ensureOutputDir = async () => {
  await mkdir(OUTPUT_DIR, { recursive: true });
};

const clickTab = async (page, key) => {
  const patterns = TAB_LABELS[key] || [];

  for (const pattern of patterns) {
    const locator = page.getByRole("button", { name: pattern });
    if ((await locator.count()) > 0) {
      await locator.first().click();
      await page.waitForTimeout(500);
      return;
    }
  }

  throw new Error(`Unable to locate tab button for "${key}"`);
};

const capture = async (page, fileName) => {
  const target = path.join(OUTPUT_DIR, fileName);
  await page.screenshot({ path: target, fullPage: true });
  console.log(`[docs:screenshot] captured ${target}`);
};

const run = async () => {
  await ensureOutputDir();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });

  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    await clickTab(page, "upload");
    await capture(page, "mode-upload.png");

    await clickTab(page, "download");
    await capture(page, "mode-download.png");

    await clickTab(page, "simple");
    await capture(page, "mode-simple.png");

    console.log("[docs:screenshot] done");
  } finally {
    await browser.close();
  }
};

run().catch((error) => {
  console.error("[docs:screenshot] failed:", error);
  process.exit(1);
});
