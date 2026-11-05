import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, relative, extname, sep } from "node:path";
import { chromium, expect } from "@playwright/test";

const distribution = resolve("dist");
const artifacts = resolve(process.env.ATLAS_E2E_ARTIFACTS || "artifacts/reuse");
const prefix = "/YangAtlas/";
const key = "yangatlas:v1";
const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".ttf": "font/ttf", ".woff2": "font/woff2",
};
let server, browser, base;

before(async () => {
  assert.ok((await stat(resolve(distribution, "index.html"))).isFile(), "Build first");
  await mkdir(artifacts, { recursive: true });
  server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (!["GET", "HEAD"].includes(request.method) || !path.startsWith(prefix)) throw new Error();
      const local = path.slice(prefix.length) || "index.html";
      if (local.includes("\\") || local.split("/").some((part) => part.startsWith("."))) throw new Error();
      const file = resolve(distribution, local);
      const within = relative(distribution, file);
      if (within === ".." || within.startsWith(".." + sep) || !(await stat(file)).isFile()) throw new Error();
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}${prefix}`;
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
});

async function pageFor(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(20000);
  const errors = [], failedRequests = [], httpErrors = [], writes = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => { errors.push(dialog.message()); await dialog.dismiss(); });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") failedRequests.push(request.failure()?.errorText + " " + request.url());
  });
  page.on("response", (response) => { if (response.status() >= 400) httpErrors.push(response.status() + " " + response.url()); });
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(request.method() + " " + request.url()); });
  t.after(async () => {
    try {
      assert.deepEqual(errors, [], "No runtime errors");
      assert.deepEqual(failedRequests, [], "No failed resources");
      assert.deepEqual(httpErrors, [], "All built resources load beneath the Pages subpath");
      assert.deepEqual(writes, [], "Only isolated browser-local edits");
    } finally { await context.close(); }
  });
  return { context, page };
}

const sourceState = {
  version: 2, activeTripId: "reuse-source", trips: [{
    id: "reuse-source", title: "Hành trình đã có để dùng lại", destination: "Huế",
    cover: "hoian", startDate: "2032-01-01", days: 90, travelers: 2, budget: 2000000,
    activities: [
      { id: "reuse-first", placeId: "", day: 0, title: "Điểm hẹn ngày đầu", category: "food", start: "09:00", duration: 60, cost: 80000, costMode: "person", address: "23 Lê Lợi\nTầng 2, Huế", notes: "Ghi chú nguồn cần giữ.", done: true },
      { id: "reuse-last", placeId: "", day: 89, title: "Điểm hẹn ngày cuối", category: "visit", start: "14:00", duration: 90, cost: 100000, costMode: "group", address: "Huế", notes: "Ngày cuối của kế hoạch.", done: true },
    ],
    expenses: [{ id: "reuse-paid", title: "Khoản thực tế đã thanh toán", amount: 450000, date: "2032-01-02", category: "move", payer: "An", notes: "Không được đưa vào chuyến mới." }],
    checklist: [{ id: "reuse-packed", title: "Giấy tờ và vé tàu", done: true }, { id: "reuse-charger", title: "Sạc dự phòng", done: false }],
  }],
};

async function openFixture(context, page) {
  await context.addInitScript(({ storageKey, fixture }) => {
    if (localStorage.getItem(storageKey) === null) localStorage.setItem(storageKey, JSON.stringify(fixture));
  }, { storageKey: key, fixture: sourceState });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".loading-state")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveText(sourceState.trips[0].title);
}

const viewTab = (page, name) => page.getByRole("navigation", { name: "Nội dung chuyến đi" })
  .getByRole("button", { name, exact: true });
async function stateFrom(page) {
  return page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
}
async function noOverflow(page) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(size.content <= size.viewport + 1, JSON.stringify(size));
}
async function downloadText(page, button, filename) {
  const pending = page.waitForEvent("download");
  await button.click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), filename);
  assert.equal(await download.failure(), null);
  const stream = await download.createReadStream();
  assert.ok(stream, "The export must be an actual downloaded file");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
async function backup(page) {
  return JSON.parse(await downloadText(page,
    page.getByRole("button", { name: "Xuất bản sao JSON", exact: true }).first(), "yangatlas-backup.json"));
}

test("a selected last day stays visible and keyboard-focused in the 90-day mobile strip", { timeout: 25000 }, async (t) => {
  const { context, page } = await pageFor(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await openFixture(context, page);
  const last = page.getByRole("button", { name: /^Ngày 90/ });
  await last.click();
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".timeline-row h3")).toHaveText("Điểm hẹn ngày cuối");
  const position = await page.evaluate(() => {
    const strip = document.querySelector(".days"), active = strip.querySelector(".day-button.active");
    const a = active.getBoundingClientRect(), b = strip.getBoundingClientRect();
    return { scrollLeft: strip.scrollLeft, activeLeft: a.left, activeRight: a.right, stripLeft: b.left, stripRight: b.right };
  });
  await page.screenshot({ path: resolve(artifacts, "last-day-mobile.png"), fullPage: false });
  assert.ok(position.activeLeft >= position.stripLeft - 1 && position.activeRight <= position.stripRight + 1,
    "The active day must remain inside the horizontal strip after rendering: " + JSON.stringify(position));
  await expect(last).toBeFocused();
  await noOverflow(page);
});

test("keyboard checklist completion keeps focus on the updated control", { timeout: 25000 }, async (t) => {
  const { context, page } = await pageFor(t);
  await openFixture(context, page);
  await viewTab(page, "Chuẩn bị").click();
  const toggle = page.getByRole("button", { name: "Đánh dấu đã xong: Sạc dự phòng", exact: true });
  await toggle.focus();
  await page.keyboard.press("Space");
  const updated = page.getByRole("button", { name: "Đánh dấu chưa xong: Sạc dự phòng", exact: true });
  await expect(updated).toHaveAttribute("aria-pressed", "true");
  await expect(updated).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Đánh dấu đã xong: Sạc dự phòng", exact: true })).toBeFocused();
  const saved = await stateFrom(page);
  assert.equal(saved.trips[0].checklist.find((item) => item.id === "reuse-charger").done, false);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`duplicate a real saved plan at ${viewport.width}px without copying payments or changing the source`, { timeout: 45000 }, async (t) => {
    const mobile = viewport.width === 390;
    const { context, page } = await pageFor(t, { viewport, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    await openFixture(context, page);
    const original = await stateFrom(page);
    const trigger = page.getByRole("button", { name: "Nhân bản chuyến đi", exact: true });
    await trigger.click();
    let dialog = page.getByRole("dialog", { name: "Dành kế hoạch này cho một chuyến mới." });
    await expect(dialog.getByLabel("Tên chuyến đi mới", { exact: true }))
      .toHaveValue(sourceState.trips[0].title + " — bản sao");
    await expect(dialog.getByLabel("Ngày khởi hành mới", { exact: true })).toHaveValue("2032-01-01");
    await expect(dialog.locator(".copy-summary")).toContainText("2 hoạt động · 2 việc chuẩn bị");
    await expect(dialog.locator(".copy-summary")).toContainText("Sổ chi tiêu thực tế của bản mới bắt đầu trống");
    if (mobile) await page.screenshot({ path: resolve(artifacts, "duplicate-dialog-mobile.png"), fullPage: false });
    await dialog.getByRole("button", { name: "Để sau", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    assert.deepEqual(await stateFrom(page), original, "Cancelling reuse must not change or create a saved trip");

    await trigger.click();
    dialog = page.getByRole("dialog", { name: "Dành kế hoạch này cho một chuyến mới." });
    const title = mobile ? "Chuyến mới từ điện thoại" : "Chuyến mới từ kế hoạch cũ";
    await dialog.getByLabel("Tên chuyến đi mới", { exact: true }).fill(title);
    await dialog.getByLabel("Ngày khởi hành mới", { exact: true }).fill("2199-12-31");
    await dialog.getByRole("button", { name: "Tạo bản sao", exact: true }).click();
    await expect(dialog.locator(".form-error")).toContainText("2199");
    assert.deepEqual(await stateFrom(page), original, "A trip ending beyond the supported calendar must fail atomically");
    await dialog.getByLabel("Ngày khởi hành mới", { exact: true }).fill("2033-02-01");
    await noOverflow(page);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
    if (mobile) {
      for (const direction of ["Tab", "Shift+Tab"]) {
        for (let index = 0; index < 8; index++) {
          await page.keyboard.press(direction);
          assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog"))), "Reuse dialog keeps keyboard focus within itself");
        }
      }
    }
    await dialog.getByRole("button", { name: "Tạo bản sao", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("h1")).toHaveText(title);
    const copiedState = await backup(page);
    assert.equal(copiedState.trips.length, 2);
    assert.deepEqual(copiedState.trips.find((trip) => trip.id === original.activeTripId), original.trips[0]);
    const copied = copiedState.trips.find((trip) => trip.id === copiedState.activeTripId);
    assert.notEqual(copied.id, original.activeTripId);
    assert.equal(copied.title, title);
    assert.equal(copied.startDate, "2033-02-01");
    for (const field of ["destination", "cover", "days", "travelers", "budget"])
      assert.equal(copied[field], original.trips[0][field], `Reuse preserves ${field}`);
    assert.deepEqual(copied.expenses, [], "Previously paid expenses belong exclusively to their source trip");
    assert.deepEqual(copied.activities.map(({ id, done, ...plan }) => plan),
      original.trips[0].activities.map(({ id, done, ...plan }) => plan));
    assert.ok(copied.activities.every((item) => item.done === false));
    assert.deepEqual(copied.checklist.map((item) => ({ title: item.title, done: item.done })),
      original.trips[0].checklist.map((item) => ({ title: item.title, done: false })));
    const oldIDs = new Set([original.activeTripId, ...original.trips[0].activities.map((item) => item.id),
      ...original.trips[0].checklist.map((item) => item.id), ...original.trips[0].expenses.map((item) => item.id)]);
    const newIDs = [copied.id, ...copied.activities.map((item) => item.id), ...copied.checklist.map((item) => item.id)];
    assert.equal(new Set(newIDs).size, newIDs.length);
    assert.ok(newIDs.every((id) => !oldIDs.has(id)), "The copy owns new identities for all copied entities");
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode())); scrollTo(0, 0); });
    await noOverflow(page);
    await page.screenshot({ path: resolve(artifacts, mobile ? "duplicate-mobile.png" : "duplicate-desktop.png"), fullPage: false });

    await page.getByRole("button", { name: /^Ngày 90/ }).click();
    await expect(page.locator(".timeline-row h3")).toHaveText("Điểm hẹn ngày cuối");
    await expect(page.getByRole("button", { name: "Đánh dấu đã ghé: Điểm hẹn ngày cuối", exact: true }))
      .toHaveAttribute("aria-pressed", "false");
    const calendar = (await downloadText(page,
      page.getByRole("button", { name: "Xuất lịch .ics", exact: true }), "yangatlas-itinerary.ics"))
      .replace(/\r\n[ \t]/g, "");
    assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.ok(calendar.includes("DTSTART:20330201T090000\r\n"));
    assert.ok(calendar.includes("DTSTART:20330501T140000\r\n"));
    assert.ok(calendar.includes("LOCATION:23 Lê Lợi\\nTầng 2\\, Huế\r\n"));
    assert.ok(!calendar.includes("Khoản thực tế đã thanh toán"), "Calendar does not mix actual source payments into the new plan");

    await viewTab(page, "Ngân sách").click();
    await expect(page.locator("[data-actual-total]")).toContainText("0");
    await expect(page.getByRole("region", { name: "Ngân sách dự kiến" }).locator(".budget-total"))
      .toContainText("260.000");
    await viewTab(page, "Chuẩn bị").click();
    await page.getByRole("button", { name: "Đánh dấu đã xong: Sạc dự phòng", exact: true }).click();
    const edited = await backup(page);
    assert.deepEqual(edited.trips.find((trip) => trip.id === original.activeTripId), original.trips[0],
      "Editing the copy must preserve the source's completed checklist and actual expense records");
    assert.equal(edited.trips.find((trip) => trip.id === copied.id).checklist[1].done, true);
    await page.reload();
    await expect(page.locator("h1")).toHaveText(title);
    assert.deepEqual(await backup(page), edited, "The copy and untouched source both survive reload and a real JSON download");
    await noOverflow(page);
  });
}
