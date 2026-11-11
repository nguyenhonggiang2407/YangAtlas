import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, relative, extname, sep } from "node:path";
import { chromium, expect } from "@playwright/test";

// Serve only the built distribution at the same kind of subpath GitHub Pages uses.
// This driver creates and closes its own ephemeral server and browser.
const distribution = resolve("dist");
const artifacts = resolve(
  process.env.ATLAS_E2E_ARTIFACTS || "artifacts/browser",
);
const prefix = "/YangAtlas/";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
};
let server, browser, base;
const diagnostics = new WeakMap();

before(async () => {
  assert.ok(
    (await stat(resolve(distribution, "index.html"))).isFile(),
    "Run npm run build before browser checks",
  );
  await mkdir(artifacts, { recursive: true });
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const path = decodeURIComponent(url.pathname);
      if (
        !["GET", "HEAD"].includes(request.method) ||
        !path.startsWith(prefix)
      ) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const local = path.slice(prefix.length) || "index.html";
      if (
        local.includes("\\") ||
        local.split("/").some((part) => part.startsWith("."))
      )
        throw new Error("Invalid path");
      const file = resolve(distribution, local);
      const within = relative(distribution, file);
      if (
        within === ".." ||
        within.startsWith(".." + sep) ||
        !(await stat(file)).isFile()
      )
        throw new Error("Not found");
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}${prefix}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
});

async function pageFor(t, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(15000);
  const errors = [],
    failedAssets = [];
  diagnostics.set(page, { errors, failedAssets });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => {
    errors.push("Unexpected browser dialog: " + dialog.message());
    await dialog.dismiss();
  });
  page.on("response", (response) => {
    if (
      new URL(response.url()).origin === new URL(base).origin &&
      response.status() >= 400
    ) {
      failedAssets.push(
        `${response.status()} ${new URL(response.url()).pathname}`,
      );
    }
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin === new URL(base).origin)
      failedAssets.push(
        request.failure()?.errorText + " " + new URL(request.url()).pathname,
      );
  });
  t.after(async () => {
    try {
      assert.deepEqual(
        errors,
        [],
        "The running app must not raise browser errors",
      );
      assert.deepEqual(
        failedAssets,
        [],
        "All built-app requests must work beneath /YangAtlas/",
      );
    } finally {
      await context.close();
    }
  });
  return { context, page };
}

async function openApp(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => !document.querySelector(".loading-state"));
  } catch (error) {
    console.error(
      "App startup diagnostic:",
      JSON.stringify({
        ...diagnostics.get(page),
        url: page.url(),
        loading: await page.locator(".loading-state").count(),
        body: (await page.locator("body").innerText()).slice(0, 500),
      }),
    );
    await page.screenshot({
      path: resolve(artifacts, "startup-failure.png"),
      fullPage: false,
    });
    throw error;
  }
  await expect(page).toHaveTitle(/YangAtlas/);
  // These regression cases intentionally exercise the curated sample planner.
  // Product tests separately assert that a new installation begins empty.
  const samples = page.getByRole("button", {
    name: "Xem hành trình mẫu",
    exact: true,
  });
  if (await samples.count()) {
    await samples.click();
    await expect(page.locator("h1")).toHaveText("Đà Lạt, chậm một nhịp");
  }
}

async function noOverflow(page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "The viewport must not overflow horizontally",
  );
}

async function photographsLoad(page) {
  const photographs = page.locator("img");
  assert.ok(
    (await photographs.count()) > 0,
    "The visual planner must render its real photographs",
  );
  for (const photograph of await photographs.all()) {
    if (!(await photograph.isVisible())) continue;
    if (
      await photograph.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.right <= 0 || box.left >= innerWidth;
      })
    )
      continue;
    await photograph.scrollIntoViewIfNeeded();
    await expect(photograph).toHaveJSProperty("complete", true);
    assert.ok(
      await photograph.evaluate((element) => element.naturalWidth > 0),
      "A visible photograph must decode",
    );
    const source = new URL(await photograph.getAttribute("src"), base);
    assert.equal(
      source.origin,
      new URL(base).origin,
      "Photographs should use the bundled local assets",
    );
    assert.ok(
      source.pathname.startsWith(prefix),
      "Photograph paths must retain the GitHub Pages subpath",
    );
  }
  await page.evaluate(() => scrollTo(0, 0));
}

test("the built application loads its real photographs beneath the GitHub Pages subpath", async (t) => {
  const { page } = await pageFor(t);
  await openApp(page);
  await photographsLoad(page);
  await noOverflow(page);
  await page.screenshot({
    path: resolve(artifacts, "home-desktop.png"),
    fullPage: true,
  });
});

const viewTab = (page, name) =>
  page
    .getByRole("navigation", { name: "Nội dung chuyến đi" })
    .getByRole("button", { name, exact: true });
const activityRow = (page, title) =>
  page
    .locator(".timeline-row")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });

async function newTrip(page, values = {}) {
  const title = values.title || "Chuyến thử trình duyệt";
  await page
    .getByRole("button", { name: "Chuyến đi mới", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Bắt đầu một hành trình." });
  await dialog.getByLabel("Tên chuyến đi", { exact: true }).fill(title);
  await dialog
    .getByLabel("Điểm đến", { exact: true })
    .fill({ dalat: "Đà Lạt", hoian: "Hội An" }[values.destination || "dalat"] || values.destination);
  await dialog
    .getByRole("combobox", { name: "Ảnh bìa minh họa", exact: true })
    .selectOption(values.cover || (values.destination === "hoian" ? "hoian" : "dalat"));
  await dialog
    .getByLabel("Ngày khởi hành", { exact: true })
    .fill(values.startDate || "2030-06-10");
  await dialog
    .getByLabel("Số ngày", { exact: true })
    .fill(String(values.days || 2));
  await dialog
    .getByLabel("Số người", { exact: true })
    .fill(String(values.travelers || 3));
  await dialog
    .getByLabel("Hạn mức cả chuyến đi (VND)", { exact: true })
    .fill(String(values.budget ?? 1000000));
  await dialog
    .getByRole("button", { name: "Tạo chuyến đi", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("h1")).toHaveText(title);
}

async function fillActivity(dialog, values = {}) {
  if (values.title !== undefined)
    await dialog
      .getByLabel("Tên hoạt động", { exact: true })
      .fill(values.title);
  if (values.day !== undefined)
    await dialog
      .getByRole("combobox", { name: /^Ngày/ })
      .selectOption(String(values.day));
  if (values.category !== undefined)
    await dialog
      .getByRole("combobox", { name: /^Loại hoạt động/ })
      .selectOption(values.category);
  if (values.start !== undefined)
    await dialog.getByLabel("Bắt đầu", { exact: true }).fill(values.start);
  if (values.duration !== undefined)
    await dialog
      .getByLabel("Thời lượng (phút)", { exact: true })
      .fill(String(values.duration));
  if (values.cost !== undefined)
    await dialog
      .getByLabel("Chi phí dự kiến (VND)", { exact: true })
      .fill(String(values.cost));
  if (values.costMode !== undefined)
    await dialog
      .getByRole("combobox", { name: /^Cách tính/ })
      .selectOption(values.costMode);
  if (values.notes !== undefined)
    await dialog.getByLabel("Ghi chú", { exact: true }).fill(values.notes);
}

async function addActivity(page, values) {
  await page
    .getByRole("button", { name: "Thêm hoạt động", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Thêm điều bạn muốn làm." });
  await fillActivity(dialog, values);
  await dialog
    .getByRole("button", { name: "Thêm vào lịch trình", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(activityRow(page, values.title)).toBeVisible();
}

async function editActivity(page, title, values) {
  await page
    .getByRole("button", { name: "Sửa: " + title, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Điều chỉnh điểm dừng." });
  await fillActivity(dialog, values);
  await dialog
    .getByRole("button", { name: "Lưu hoạt động", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

async function downloadText(page, button, filename) {
  const pending = page.waitForEvent("download");
  await button.click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), filename);
  const stream = await download.createReadStream();
  assert.ok(stream, "A real downloaded file must be available");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function backup(page) {
  return JSON.parse(
    await downloadText(
      page,
      page
        .getByRole("button", { name: "Xuất bản sao JSON", exact: true })
        .first(),
      "yangatlas-backup.json",
    ),
  );
}

async function uploadBackup(page, content, name = "fixture.json") {
  await page
    .locator("#import-file")
    .setInputFiles({
      name,
      mimeType: "application/json",
      buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"),
    });
  await page.waitForFunction(
    () => document.querySelector("#import-file").value === "",
  );
}

test(
  "trip and activity edits, chronological reordering, party budgets and reload use the real saved workspace",
  { timeout: 30000 },
  async (t) => {
    const { page } = await pageFor(t);
    await openApp(page);
    await newTrip(page, { title: "Một chuyến có kế hoạch" });
    await addActivity(page, {
      title: "Bữa sáng thử",
      category: "food",
      start: "09:00",
      duration: 60,
      cost: 50000,
      costMode: "person",
    });
    await addActivity(page, {
      title: "Xe chung thử",
      category: "move",
      start: "10:30",
      duration: 30,
      cost: 100000,
      costMode: "group",
    });
    await expect(
      page
        .getByRole("region", { name: "Ngân sách dự kiến" })
        .locator(".budget-total"),
    ).toContainText("250.000");
    await editActivity(page, "Bữa sáng thử", {
      title: "Bữa sáng đã sửa",
      cost: 60000,
    });
    await page
      .getByRole("button", {
        name: "Chuyển sớm hơn: Xe chung thử",
        exact: true,
      })
      .click();
    assert.deepEqual(await page.locator(".timeline-row h3").allTextContents(), [
      "Xe chung thử",
      "Bữa sáng đã sửa",
    ]);
    await expect(
      activityRow(page, "Xe chung thử").locator(".time-col"),
    ).toHaveText("09:00");
    await expect(
      activityRow(page, "Bữa sáng đã sửa").locator(".time-col"),
    ).toHaveText("10:00");
    await viewTab(page, "Ngân sách").click();
    await page
      .getByRole("button", { name: "Đặt hạn mức", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Một chút chỉnh sửa." });
    await dialog.getByLabel("Số người", { exact: true }).fill("4");
    await dialog
      .getByLabel("Hạn mức cả chuyến đi (VND)", { exact: true })
      .fill("500000");
    await dialog
      .getByRole("button", { name: "Lưu chuyến đi", exact: true })
      .click();
    await expect(page.locator(".budget-total")).toContainText("340.000");
    await expect(page.locator(".budget-caption").first()).toContainText(
      "85.000",
    );
    await page.screenshot({
      path: resolve(artifacts, "budget-desktop.png"),
      fullPage: true,
    });
    await page.reload();
    await expect(page.locator("h1")).toHaveText("Một chuyến có kế hoạch");
    assert.deepEqual(await page.locator(".timeline-row h3").allTextContents(), [
      "Xe chung thử",
      "Bữa sáng đã sửa",
    ]);
    const saved = await backup(page);
    const trip = saved.trips.find((item) => item.id === saved.activeTripId);
    assert.equal(trip.travelers, 4);
    assert.equal(trip.budget, 500000);
    assert.deepEqual(
      trip.activities.map((item) => [item.title, item.cost, item.costMode]),
      [
        ["Bữa sáng đã sửa", 60000, "person"],
        ["Xe chung thử", 100000, "group"],
      ],
    );
  },
);

test(
  "place search, category filtering and adding a day-two stop lead to real conflict and completion states",
  { timeout: 30000 },
  async (t) => {
    const { page } = await pageFor(t);
    await openApp(page);
    await newTrip(page, { title: "Tìm một điểm dừng" });
    await viewTab(page, "Địa điểm").click();
    await page
      .getByRole("searchbox", { name: "Tìm địa điểm" })
      .fill("ga đà lạt");
    await expect(page.locator(".place-card")).toHaveCount(1);
    await expect(page.locator(".place-card h3")).toHaveText("Ga Đà Lạt");
    await page.getByRole("searchbox", { name: "Tìm địa điểm" }).fill("");
    await page
      .locator(".filter-row")
      .getByRole("button", { name: "Ăn & uống", exact: true })
      .click();
    await expect(page.locator(".place-card")).toHaveCount(1);
    await expect(page.locator(".place-card h3")).toHaveText(
      "Là Việt · Nguyễn Công Trứ",
    );
    await page.screenshot({
      path: resolve(artifacts, "places-desktop.png"),
      fullPage: true,
    });
    await page
      .locator(".place-card")
      .getByRole("button", { name: "Thêm vào ngày", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Dành một chỗ trong lịch.",
    });
    await fillActivity(dialog, {
      day: 1,
      start: "09:00",
      duration: 60,
      cost: 70000,
      notes: "Lịch thử với dự toán hư cấu.",
    });
    await dialog
      .getByRole("button", { name: "Thêm vào lịch trình", exact: true })
      .click();
    await expect(page.getByRole("button", { name: /Ngày 02/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(activityRow(page, "Là Việt · Nguyễn Công Trứ")).toBeVisible();
    await addActivity(page, {
      title: "Điểm hẹn trùng giờ",
      start: "09:30",
      duration: 60,
      cost: 0,
      day: 1,
    });
    await expect(page.locator(".activity-conflict")).toHaveCount(2);
    await page
      .getByRole("button", {
        name: "Đánh dấu đã ghé: Điểm hẹn trùng giờ",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Đánh dấu chưa ghé: Điểm hẹn trùng giờ",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /Ngày 01/ }).click();
    await expect(page.locator(".timeline-row")).toHaveCount(0);
    await page.getByRole("button", { name: /Ngày 02/ }).click();
    await expect(page.locator(".timeline-row")).toHaveCount(2);
  },
);

test(
  "JSON restore is atomic for invalid files and cancellation, while real JSON and ICS downloads preserve user content",
  { timeout: 40000 },
  async (t) => {
    const { page } = await pageFor(t, { timezoneId: "Pacific/Honolulu" });
    await openApp(page);
    await newTrip(page, { title: "Lịch qua năm", startDate: "2030-12-31" });
    await expect(page.locator(".trip-meta")).toContainText("2030");
    await expect(page.locator(".trip-meta")).toContainText("2031");
    const literal = "<img src=x onerror=alert(1)>";
    await addActivity(page, {
      title: literal,
      start: "23:30",
      duration: 90,
      cost: 0,
      notes: "Dòng một; có, dấu\nDòng hai",
    });
    await expect(page.locator(".timeline-row img")).toHaveCount(0);
    const calendar = await downloadText(
      page,
      page.getByRole("button", { name: "Xuất lịch .ics", exact: true }),
      "yangatlas-itinerary.ics",
    );
    assert.ok(calendar.includes("BEGIN:VCALENDAR\r\n"));
    assert.ok(
      calendar.includes("DTSTART:20301231T233000\r\nDTEND:20310101T010000\r\n"),
    );
    assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 1);
    assert.ok(calendar.includes("SUMMARY:" + literal));
    assert.ok(calendar.includes("Dòng một\\; có\\, dấu\\nDòng hai"));
    const original = await backup(page);
    const invalidMoney = structuredClone(original);
    invalidMoney.trips[0].budget = -1;
    for (const content of [
      "{",
      JSON.stringify(invalidMoney),
      '{"version":999,"activeTripId":"","trips":[]}',
      Buffer.alloc(4 * 1024 * 1024 + 1, 32),
    ]) {
      await uploadBackup(page, content, "invalid.json");
      await expect(page.locator("#toast")).toContainText("Không nhập dữ liệu");
      assert.deepEqual(
        await backup(page),
        original,
        "Rejected imports must not alter any stored trip",
      );
    }
    await newTrip(page, { title: "Thay đổi sau bản sao" });
    const changed = await backup(page);
    await uploadBackup(page, JSON.stringify(original));
    let dialog = page.getByRole("dialog", { name: "Khôi phục bản sao?" });
    await dialog
      .getByRole("button", { name: "Giữ dữ liệu hiện tại", exact: true })
      .click();
    assert.deepEqual(
      await backup(page),
      changed,
      "Cancelling a valid import must retain the current workspace",
    );
    await uploadBackup(page, JSON.stringify(original));
    dialog = page.getByRole("dialog", { name: "Khôi phục bản sao?" });
    await dialog
      .getByRole("button", { name: "Thay dữ liệu hiện tại", exact: true })
      .click();
    await expect(page.locator("h1")).toHaveText("Lịch qua năm");
    assert.deepEqual(await backup(page), original);
    await page.reload();
    await expect(page.locator("h1")).toHaveText("Lịch qua năm");
  },
);

test(
  "a backup confirmation preserves a workspace saved by a second tab",
  { timeout: 30000 },
  async (t) => {
    const { context, page } = await pageFor(t);
    await openApp(page);
    await newTrip(page, { title: "Chuyến đi trước khi chọn file" });
    await uploadBackup(page, '{"version":2,"activeTripId":"","trips":[]}');
    const dialog = page.getByRole("dialog", { name: "Khôi phục bản sao?" });
    await expect(dialog).toBeVisible();
    const other = await context.newPage();
    await openApp(other);
    await newTrip(other, { title: "Chuyến đi mới từ tab khác" });
    await dialog.getByRole("button", { name: "Thay dữ liệu hiện tại" }).click();
    await expect(dialog.getByRole("alert")).toContainText("đã thay đổi");
    const saved = await other.evaluate(() => JSON.parse(localStorage.getItem("yangatlas:v1")));
    assert.ok(saved.trips.some((trip) => trip.title === "Chuyến đi mới từ tab khác"));
    await dialog.getByRole("button", { name: "Giữ dữ liệu hiện tại" }).click();
    await page.reload();
    await expect(page.locator("h1")).toHaveText("Chuyến đi mới từ tab khác");
  },
);

test(
  "undo restores the removed entity without rolling back a newer completion or another trip",
  { timeout: 30000 },
  async (t) => {
    const { page } = await pageFor(t);
    await openApp(page);
    await newTrip(page, { title: "Hoàn tác có giới hạn" });
    await addActivity(page, { title: "Điểm dừng A", start: "09:00" });
    await addActivity(page, { title: "Điểm dừng B", start: "11:00" });
    await page
      .getByRole("button", { name: "Xóa: Điểm dừng A", exact: true })
      .click();
    await expect(activityRow(page, "Điểm dừng A")).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "Đánh dấu đã ghé: Điểm dừng B",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Hoàn tác", exact: true }).click();
    await expect(activityRow(page, "Điểm dừng A")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Đánh dấu chưa ghé: Điểm dừng B",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Chỉnh sửa chuyến đi", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Xóa chuyến đi", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Xóa chuyến đi này?" })
      .getByRole("button", { name: "Giữ lại", exact: true })
      .click();
    await expect(page.locator("h1")).toHaveText("Hoàn tác có giới hạn");
    await page
      .getByRole("button", { name: "Chỉnh sửa chuyến đi", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Xóa chuyến đi", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Xóa chuyến đi này?" })
      .getByRole("button", { name: "Xóa chuyến đi", exact: true })
      .click();
    await expect(page.locator("h1")).not.toHaveText("Hoàn tác có giới hạn");
    const first = page.locator(".timeline-row").first();
    const newerTitle = await first.locator("h3").textContent();
    await first
      .getByRole("button", {
        name: "Đánh dấu đã ghé: " + newerTitle,
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Hoàn tác", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Hoàn tác có giới hạn");
    const saved = await backup(page);
    assert.ok(
      saved.trips.some((trip) =>
        trip.activities.some((item) => item.title === newerTitle && item.done),
      ),
      "Undoing a trip deletion must preserve a later edit in the other trip",
    );
  },
);

test(
  "mobile retains JSON restore and native dialog keyboard focus at 390px",
  { timeout: 30000 },
  async (t) => {
    const { page } = await pageFor(t, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await openApp(page);
    await expect(
      page.getByRole("button", { name: "Nhập bản sao JSON", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Mở menu", exact: true }).click();
    const trigger = page.getByRole("button", {
      name: "Chuyến đi mới",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "Bắt đầu một hành trình.",
    });
    await expect(
      dialog.getByLabel("Tên chuyến đi", { exact: true }),
    ).toBeFocused();
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let index = 0; index < 12; index += 1) {
        await page.keyboard.press(key);
        const focus = await page.evaluate(() => ({
          within: Boolean(document.activeElement?.closest("dialog")),
          tag: document.activeElement?.tagName,
          name: document.activeElement?.getAttribute("name"),
          label: document.activeElement?.getAttribute("aria-label"),
        }));
        assert.ok(
          focus.within,
          `Keyboard focus must remain in the open modal: ${key} step ${index + 1}, ${JSON.stringify(focus)}`,
        );
      }
    }
    const bounds = await dialog.boundingBox();
    assert.ok(
      bounds.x >= 0 && bounds.x + bounds.width <= 391,
      "The dialog must fit the mobile viewport",
    );
    await page.screenshot({
      path: resolve(artifacts, "trip-dialog-mobile.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Chuyến đi mới", exact: true }),
    ).toBeFocused();
    assert.ok(
      await page.evaluate(() => {
        const box = document.activeElement.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          box.right > 0 &&
          box.left < innerWidth &&
          box.bottom > 0 &&
          box.top < innerHeight
        );
      }),
      "Closing the modal must restore focus to a control that is on screen",
    );
    await noOverflow(page);
  },
);

test(
  "corrupt saved data is protected from overwrite while a fallback workspace remains usable",
  { timeout: 30000 },
  async (t) => {
    const { context, page } = await pageFor(t);
    const corrupt = '{"version":1,"trips":';
    await context.addInitScript((value) => {
      if (localStorage.getItem("yangatlas:v1") === null)
        localStorage.setItem("yangatlas:v1", value);
    }, corrupt);
    await openApp(page);
    await expect(page.locator(".storage-alert")).toContainText(
      "bản lưu cũ chưa bị ghi đè",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("yangatlas:v1")),
      corrupt,
    );
    await newTrip(page, { title: "Chỉ trong phiên lỗi" });
    assert.equal(
      await page.evaluate(() => localStorage.getItem("yangatlas:v1")),
      corrupt,
    );
    assert.ok(
      (await backup(page)).trips.some(
        (trip) => trip.title === "Chỉ trong phiên lỗi",
      ),
    );
  },
);

test(
  "quota failures keep edits available for JSON backup and show a persistent save warning",
  { timeout: 30000 },
  async (t) => {
    const { context, page } = await pageFor(t);
    await context.addInitScript(() => {
      Object.defineProperty(Storage.prototype, "setItem", {
        configurable: true,
        value() {
          throw new DOMException(
            "Quota exhausted for the browser check",
            "QuotaExceededError",
          );
        },
      });
    });
    await openApp(page);
    await newTrip(page, { title: "Dữ liệu chưa lưu được" });
    await expect(page.locator(".storage-alert")).toContainText("chưa lưu được");
    assert.ok(
      (await backup(page)).trips.some(
        (trip) => trip.title === "Dữ liệu chưa lưu được",
      ),
    );
  },
);

test("the 390px workspace loads real photographs without horizontal overflow", async (t) => {
  const { page } = await pageFor(t, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await openApp(page);
  await photographsLoad(page);
  await noOverflow(page);
  await page.screenshot({
    path: resolve(artifacts, "home-mobile.png"),
    fullPage: true,
  });
});

test("unavailable browser storage shows a visible warning while the planner remains usable", async (t) => {
  const { context, page } = await pageFor(t);
  await context.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"]) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value() {
          throw new DOMException(
            "Storage denied for the browser check",
            "SecurityError",
          );
        },
      });
    }
  });
  await openApp(page);
  await expect(page.locator(".storage-alert")).toBeVisible();
  await expect(page.locator("h1")).toBeVisible();
});
