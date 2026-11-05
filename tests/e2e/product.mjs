import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, relative, extname, sep } from "node:path";
import { chromium, expect } from "@playwright/test";

// Product checks use the packaged site at its real Pages-style subpath. Each
// scenario has a new browser context; no persistent/user browser profile is used.
const distribution = resolve("dist");
const artifacts = resolve(process.env.ATLAS_E2E_ARTIFACTS || "artifacts/product");
const prefix = "/YangAtlas/";
const key = "yangatlas:v1"; // The v2 upgrade deliberately retains the legacy key.
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
let server, browser, base;

before(async () => {
  assert.ok((await stat(resolve(distribution, "index.html"))).isFile(), "Build the site first");
  await mkdir(artifacts, { recursive: true });
  server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (!["GET", "HEAD"].includes(request.method) || !path.startsWith(prefix))
        throw new Error("Not found");
      const local = path.slice(prefix.length) || "index.html";
      if (local.includes("\\") || local.split("/").some((part) => part.startsWith(".")))
        throw new Error("Invalid path");
      const file = resolve(distribution, local);
      const within = relative(distribution, file);
      if (within === ".." || within.startsWith(".." + sep) || !(await stat(file)).isFile())
        throw new Error("Not found");
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}${prefix}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
});

async function pageFor(t, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "vi-VN",
    ...options,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(20000);
  const diagnostics = { errors: [], failedRequests: [], httpErrors: [], writes: [] };
  page.on("pageerror", (error) => diagnostics.errors.push(error.message));
  page.on("dialog", async (dialog) => {
    diagnostics.errors.push(`Unexpected browser dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method()))
      diagnostics.writes.push({ method: request.method(), url: request.url() });
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED")
      diagnostics.failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      diagnostics.httpErrors.push({ url: response.url(), status: response.status() });
  });
  t.after(async () => {
    try {
      assert.deepEqual(diagnostics.errors, [], "No browser runtime errors");
      assert.deepEqual(diagnostics.failedRequests, [], "All required assets must load, including offline");
      assert.deepEqual(diagnostics.httpErrors, [], "No missing packaged resources");
      assert.deepEqual(diagnostics.writes, [], "Personal mode must not make backend writes");
    } finally {
      await context.close();
    }
  });
  return { context, page, diagnostics };
}

async function openApp(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".loading-state")).toHaveCount(0);
  await expect(page).toHaveTitle(/YangAtlas/);
  await page.evaluate(async () => document.fonts.ready.then(() => true));
}

async function saved(page) {
  return page.evaluate((storageKey) => {
    const value = localStorage.getItem(storageKey);
    return value === null ? null : JSON.parse(value);
  }, key);
}

async function noOverflow(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(size.content <= size.width + 1, JSON.stringify(size));
}

async function screenshot(page, name, fullPage = false) {
  await noOverflow(page);
  await page.screenshot({ path: resolve(artifacts, name), fullPage, animations: "disabled" });
}

async function downloadedText(page, button, filename) {
  const pending = page.waitForEvent("download");
  await button.click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), filename);
  assert.equal(await download.failure(), null);
  const stream = await download.createReadStream();
  assert.ok(stream, "The export must be a real browser download");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function backup(page) {
  return JSON.parse(await downloadedText(
    page,
    page.getByRole("button", { name: "Xuất bản sao JSON", exact: true }).first(),
    "yangatlas-backup.json",
  ));
}

async function upload(page, value) {
  await page.locator("#import-file").setInputFiles({
    name: "personal-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8"),
  });
  await page.waitForFunction(() => document.querySelector("#import-file").value === "");
}

async function restore(page, value) {
  await upload(page, value);
  await page.getByRole("dialog", { name: "Khôi phục bản sao?" })
    .getByRole("button", { name: "Thay dữ liệu hiện tại", exact: true }).click();
}

const currentTrip = (value) => value.trips.find((trip) => trip.id === value.activeTripId);
const viewTab = (page, name) => page.getByRole("navigation", { name: "Nội dung chuyến đi" })
  .getByRole("button", { name, exact: true });

async function newTrip(page, values = {}) {
  const firstTrip = page.getByRole("button", { name: "Tạo chuyến đi đầu tiên", exact: true });
  if (await firstTrip.count()) await firstTrip.click();
  else await page.getByRole("button", { name: "Chuyến đi mới", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Bắt đầu một hành trình." });
  const title = values.title || "Hành trình của riêng tôi";
  await dialog.getByLabel("Tên chuyến đi", { exact: true }).fill(title);
  await dialog.getByLabel("Điểm đến", { exact: true }).fill(values.destination || "Huế & Quảng Trị");
  await dialog.getByRole("combobox", { name: "Ảnh bìa minh họa", exact: true }).selectOption("hoian");
  await dialog.getByLabel("Ngày khởi hành", { exact: true }).fill("2031-04-12");
  await dialog.getByLabel("Số ngày", { exact: true }).fill(String(values.days || 2));
  await dialog.getByLabel("Số người", { exact: true }).fill(String(values.travelers || 3));
  await dialog.getByLabel("Hạn mức cả chuyến đi (VND)", { exact: true }).fill("500000");
  await dialog.getByRole("button", { name: "Tạo chuyến đi", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("h1")).toHaveText(title);
}

async function addActivity(page, values = {}) {
  await viewTab(page, "Lịch trình").click();
  await page.getByRole("button", { name: "Thêm hoạt động", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Thêm điều bạn muốn làm." });
  await dialog.getByLabel("Tên hoạt động", { exact: true }).fill(values.title || "Một điểm hẹn riêng");
  await dialog.getByRole("combobox", { name: /^Ngày/ }).selectOption(String(values.day || 0));
  await dialog.getByLabel("Địa chỉ / vị trí", { exact: true }).fill(values.address || "23 Lê Lợi, Huế");
  await dialog.getByLabel("Bắt đầu", { exact: true }).fill(values.start || "09:00");
  await dialog.getByLabel("Thời lượng (phút)", { exact: true }).fill("60");
  await dialog.getByLabel("Chi phí dự kiến (VND)", { exact: true }).fill(String(values.cost ?? 80000));
  await dialog.getByRole("combobox", { name: /^Cách tính/ }).selectOption("person");
  await dialog.getByRole("button", { name: "Thêm vào lịch trình", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function addExpense(page, values = {}) {
  await viewTab(page, "Ngân sách").click();
  await page.getByRole("button", { name: "Ghi khoản chi", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ghi một khoản đã chi." });
  await dialog.getByLabel("Tên khoản chi", { exact: true }).fill(values.title || "Vé tàu đã thanh toán");
  await dialog.getByLabel("Số tiền đã trả (VND)", { exact: true }).fill(String(values.amount ?? 90000));
  await dialog.getByLabel("Ngày chi", { exact: true }).fill("2031-04-11");
  await dialog.getByRole("combobox", { name: "Nhóm chi", exact: true }).selectOption("move");
  await dialog.getByLabel("Người trả (tùy chọn)", { exact: true }).fill(values.payer || "An");
  await dialog.getByLabel("Ghi chú khoản chi", { exact: true }).fill(values.notes || "Đặt trước chuyến đi.");
  await dialog.getByRole("button", { name: "Thêm khoản chi", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function addChecklist(page, title) {
  await viewTab(page, "Chuẩn bị").click();
  await page.getByRole("button", { name: "Thêm việc cần chuẩn bị", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nhớ mang theo điều cần thiết." });
  await dialog.getByLabel("Việc cần chuẩn bị", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "Thêm việc", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function deleteActiveTrip(page) {
  await page.getByRole("button", { name: "Chỉnh sửa chuyến đi", exact: true }).click();
  await page.getByRole("dialog", { name: "Một chút chỉnh sửa." })
    .getByRole("button", { name: "Xóa chuyến đi", exact: true }).click();
  await page.getByRole("dialog", { name: "Xóa chuyến đi này?" })
    .getByRole("button", { name: "Xóa chuyến đi", exact: true }).click();
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const source = text.replace(/^\ufeff/, "");
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if (char === "\r" && source[index + 1] === "\n" && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = ""; index++;
    } else cell += char;
  }
  assert.equal(quoted, false, "CSV quotes must close");
  if (row.length || cell) { row.push(cell); rows.push(row); }
  return rows;
}

// A fixed, independent pre-upgrade fixture. This is not generated by the v2
// validator, so it exercises the compatibility path that real saved users need.
const legacy = {
  version: 1,
  activeTripId: "legacy-trip",
  trips: [{
    id: "legacy-trip",
    title: "Hành trình trước khi nâng cấp",
    destination: "dalat",
    cover: "dalat",
    startDate: "2031-04-12",
    days: 2,
    travelers: 2,
    budget: 900000,
    activities: [{
      id: "legacy-stop",
      placeId: "",
      day: 0,
      title: "Điểm hẹn đã lưu",
      category: "visit",
      start: "09:15",
      duration: 45,
      cost: 70000,
      costMode: "group",
      notes: "Ghi chú cần được giữ nguyên.",
      done: true,
    }],
  }],
};

test("a saved v1 trip migrates in place without loading samples or losing old activity data", { timeout: 40000 }, async (t) => {
  const { context, page } = await pageFor(t);
  await context.addInitScript(({ storageKey, fixture }) => {
    if (localStorage.getItem(storageKey) === null)
      localStorage.setItem(storageKey, JSON.stringify(fixture));
  }, { storageKey: key, fixture: legacy });
  await openApp(page);
  await expect(page.locator("h1")).toHaveText(legacy.trips[0].title);
  await expect(page.locator(".trip-switch")).toHaveCount(1);
  await expect(page.locator(".timeline-row h3")).toHaveText("Điểm hẹn đã lưu");
  await expect(page.getByRole("button", { name: "Đánh dấu chưa ghé: Điểm hẹn đã lưu", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  let migrated = await backup(page);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.trips.length, 1);
  let trip = currentTrip(migrated);
  const original = legacy.trips[0];
  for (const field of ["id", "title", "destination", "cover", "startDate", "days", "travelers", "budget"])
    assert.equal(trip[field], original[field], `Preserve legacy trip.${field}`);
  for (const [field, value] of Object.entries(original.activities[0]))
    assert.equal(trip.activities[0][field], value, `Preserve legacy activity.${field}`);
  assert.equal(trip.activities[0].address, "");
  assert.deepEqual(trip.expenses, []);
  assert.deepEqual(trip.checklist, []);

  await page.getByRole("button", { name: "Sửa: Điểm hẹn đã lưu", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Điều chỉnh điểm dừng." });
  await dialog.getByRole("textbox", { name: "Ghi chú", exact: true }).fill("Ghi chú sau khi nâng cấp.");
  await dialog.getByRole("button", { name: "Lưu hoạt động", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  assert.equal((await saved(page)).version, 2, "The next real edit saves the upgraded schema");
  await page.reload();
  await expect(page.locator("h1")).toHaveText(original.title);
  migrated = await backup(page);
  trip = currentTrip(migrated);
  assert.equal(trip.activities[0].notes, "Ghi chú sau khi nâng cấp.");
  assert.equal(trip.activities[0].done, true);
  assert.equal(trip.activities[0].cost, 70000);
  assert.equal(trip.activities[0].address, "");
  assert.deepEqual(trip.expenses, []);
  assert.deepEqual(trip.checklist, []);

  // Imported multiline addresses must survive editing a different field. The
  // destination is also a valid own-property collision name, not a catalog key.
  const unusual = structuredClone(migrated);
  unusual.trips[0].destination = "constructor";
  const multilineAddress = "23 Lê Lợi\nTầng 2, Huế";
  unusual.trips[0].activities[0].address = multilineAddress;
  await restore(page, unusual);
  await expect(page.locator(".trip-meta")).toContainText("constructor");
  await expect(page.locator(".trip-meta")).not.toContainText("Object");
  await page.getByRole("button", { name: "Sửa: Điểm hẹn đã lưu", exact: true }).click();
  const addressDialog = page.getByRole("dialog", { name: "Điều chỉnh điểm dừng." });
  await expect(addressDialog.getByRole("textbox", { name: "Địa chỉ / vị trí", exact: true }))
    .toHaveValue(multilineAddress);
  await addressDialog.getByLabel("Chi phí dự kiến (VND)", { exact: true }).fill("60000");
  await addressDialog.getByRole("button", { name: "Lưu hoạt động", exact: true }).click();
  await expect(addressDialog).toHaveCount(0);
  const unchangedAddress = currentTrip(await backup(page));
  assert.equal(unchangedAddress.destination, "constructor");
  assert.equal(unchangedAddress.activities[0].address, multilineAddress);
  assert.equal(unchangedAddress.activities[0].cost, 60000);
  const mapURL = new URL(await page.locator(".activity-map-link").getAttribute("href"));
  assert.equal(mapURL.searchParams.get("query"), multilineAddress);
  const calendar = (await downloadedText(page,
    page.getByRole("button", { name: "Xuất lịch .ics", exact: true }), "yangatlas-itinerary.ics"))
    .replace(/\r\n[ \t]/g, "");
  assert.ok(calendar.includes("LOCATION:23 Lê Lợi\\nTầng 2\\, Huế\r\n"));
  // The map fallback must also retain a non-catalog destination literally.
  unusual.trips[0].activities[0].address = "";
  await restore(page, unusual);
  const fallbackMap = new URL(await page.locator(".activity-map-link").getAttribute("href"));
  assert.equal(fallbackMap.searchParams.get("query"), "Điểm hẹn đã lưu, constructor");
  await noOverflow(page);
});

test("restoring a valid empty backup persists an empty workspace and keeps sample trips opt-in", { timeout: 30000 }, async (t) => {
  const { page } = await pageFor(t);
  await openApp(page);
  await expect(page.locator(".trip-switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Xem hành trình mẫu", exact: true })).toBeVisible();
  assert.ok((await saved(page)) === null || (await saved(page)).trips.length === 0);
  await restore(page, { version: 2, activeTripId: "", trips: [] });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".trip-switch")).toHaveCount(0);
  const empty = await backup(page);
  assert.deepEqual(empty, { version: 2, activeTripId: "", trips: [] });
  await page.reload();
  await expect(page.locator(".trip-switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Xem hành trình mẫu", exact: true })).toBeVisible();
  await screenshot(page, "empty-desktop.png");
  await page.getByRole("button", { name: "Xem hành trình mẫu", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Đà Lạt, chậm một nhịp");
  await expect(page.locator(".trip-switch")).toHaveCount(2);
  assert.equal((await backup(page)).trips.length, 2);
});

test("personal destinations, actual-expense CRUD/CSV, checklist and full backup/print preserve distinct user data", { timeout: 70000 }, async (t) => {
  const { page } = await pageFor(t);
  await openApp(page);
  await expect(page.locator(".trip-switch")).toHaveCount(0);
  await newTrip(page);
  await expect(page.locator(".trip-meta")).toContainText("Huế & Quảng Trị");
  const address = '23 Lê Lợi, Huế & <script>alert("atlas")</script>';
  await addActivity(page, { title: "Điểm hẹn ở Huế", address });
  const map = page.locator(".timeline-row .activity-map-link");
  await expect(map).toContainText(address);
  const mapURL = new URL(await map.getAttribute("href"));
  assert.equal(mapURL.origin, "https://www.google.com");
  assert.equal(mapURL.pathname, "/maps/search/");
  assert.equal(mapURL.searchParams.get("query"), address, "Address text is one encoded map query, never executable HTML");
  await expect(map).toHaveAttribute("target", "_blank");
  const relations = (await map.getAttribute("rel")).split(/\s+/);
  assert.ok(relations.includes("noopener") && relations.includes("noreferrer"));
  await expect(page.locator(".timeline-row script")).toHaveCount(0);
  await addActivity(page, { title: "Điểm dừng ngày thứ hai", day: 1, cost: 0 });
  await viewTab(page, "Ngân sách").click();
  await expect(page.locator("[data-actual-total]")).toContainText("0");
  await expect(page.getByRole("region", { name: "Ngân sách dự kiến" }).locator(".budget-total"))
    .toContainText("240.000");
  await addExpense(page);
  const formulaTitle = "=SUM(1,2)";
  const csvNotes = 'Vé "khứ hồi", đã trả\nDòng xác nhận thứ hai';
  await addExpense(page, { title: formulaTitle, amount: 15000, payer: "@người trả", notes: csvNotes });
  await expect(page.locator("[data-actual-total]")).toContainText("105.000");
  await page.getByRole("button", { name: "Sửa khoản chi: Vé tàu đã thanh toán", exact: true }).click();
  const expenseDialog = page.getByRole("dialog", { name: "Điều chỉnh khoản chi." });
  await expenseDialog.getByLabel("Số tiền đã trả (VND)", { exact: true }).fill("95000");
  await expenseDialog.getByRole("button", { name: "Lưu khoản chi", exact: true }).click();
  await expect(expenseDialog).toHaveCount(0);
  await expect(page.locator("[data-actual-total]")).toContainText("110.000");
  await page.getByRole("button", { name: "Xóa khoản chi: " + formulaTitle, exact: true }).click();
  await expect(page.locator(".expense-row")).toHaveCount(1);
  await expect(page.locator("[data-actual-total]")).toContainText("95.000");
  await page.getByRole("button", { name: "Hoàn tác", exact: true }).click();
  await expect(page.locator(".expense-row")).toHaveCount(2);
  await expect(page.locator("[data-actual-total]")).toContainText("110.000");
  await expect(page.getByRole("region", { name: "Ngân sách dự kiến" }).locator(".budget-total"))
    .toContainText("240.000");
  const csv = await downloadedText(page,
    page.getByRole("button", { name: "Xuất CSV", exact: true }), "yangatlas-chi-tieu.csv");
  assert.ok(csv.startsWith("\ufeff"), "UTF-8 CSV keeps its BOM for common spreadsheet readers");
  const rows = parseCSV(csv);
  assert.deepEqual(rows[0], ["Ngày", "Khoản chi", "Nhóm", "Số tiền (VND)", "Người trả", "Ghi chú"]);
  assert.equal(rows.length, 3);
  assert.equal(rows.slice(1).reduce((sum, row) => sum + Number(row[3]), 0), 110000, "CSV exports actual group payments, not the 240000 estimate");
  const safeFormula = rows.find((row) => row[1] === "'" + formulaTitle);
  assert.ok(safeFormula, "Formula-looking titles must be safe in spreadsheet exports");
  assert.equal(safeFormula[4], "'@người trả");
  assert.equal(safeFormula[5], csvNotes.replaceAll("\n", "\r\n"));
  await screenshot(page, "expenses-desktop.png", true);

  await addChecklist(page, "Giấy tờ");
  await page.getByRole("button", { name: "Sửa việc: Giấy tờ", exact: true }).click();
  const checklistDialog = page.getByRole("dialog", { name: "Sửa việc cần chuẩn bị." });
  await checklistDialog.getByLabel("Việc cần chuẩn bị", { exact: true }).fill("Giấy tờ và vé tàu");
  await checklistDialog.getByRole("button", { name: "Lưu việc", exact: true }).click();
  await expect(checklistDialog).toHaveCount(0);
  await page.getByRole("button", { name: "Đánh dấu đã xong: Giấy tờ và vé tàu", exact: true }).click();
  await expect(page.getByRole("button", { name: "Đánh dấu chưa xong: Giấy tờ và vé tàu", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await addChecklist(page, "Mục có thể xóa");
  await page.getByRole("button", { name: "Xóa việc: Mục có thể xóa", exact: true }).click();
  await expect(page.locator(".checklist-item")).toHaveCount(1);
  await expect(page.getByRole("progressbar", { name: "Tiến độ chuẩn bị" }))
    .toHaveAttribute("aria-valuenow", "1");
  await screenshot(page, "checklist-desktop.png", true);
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Hành trình của riêng tôi");
  const original = await backup(page);
  const trip = currentTrip(original);
  assert.equal(original.version, 2);
  assert.equal(original.trips.length, 1);
  assert.equal(trip.destination, "Huế & Quảng Trị");
  assert.equal(trip.activities[0].address, address);
  assert.equal(trip.expenses.reduce((sum, item) => sum + item.amount, 0), 110000);
  assert.ok(trip.expenses.some((item) => item.title === formulaTitle && item.payer === "@người trả"), "CSV safety must not alter the saved records");
  assert.deepEqual(trip.checklist.map(({ title, done }) => ({ title, done })), [{ title: "Giấy tờ và vé tàu", done: true }]);
  const calendar = (await downloadedText(page,
    page.getByRole("button", { name: "Xuất lịch .ics", exact: true }), "yangatlas-itinerary.ics"))
    .replace(/\r\n[ \t]/g, "");
  assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(calendar.includes('LOCATION:23 Lê Lợi\\, Huế & <script>alert("atlas")</script>\r\n'),
    "Calendar export preserves the custom address as escaped text");

  const invalid = structuredClone(original);
  invalid.trips[0].expenses[0].amount = -1;
  await upload(page, invalid);
  await expect(page.locator("#toast")).toContainText("Không nhập dữ liệu");
  assert.deepEqual(await backup(page), original, "Invalid new-field imports must be atomic");
  await newTrip(page, { title: "Chuyến thêm sau bản sao" });
  const changed = await backup(page);
  await upload(page, original);
  await page.getByRole("dialog", { name: "Khôi phục bản sao?" })
    .getByRole("button", { name: "Giữ dữ liệu hiện tại", exact: true }).click();
  assert.deepEqual(await backup(page), changed);
  await restore(page, original);
  assert.deepEqual(await backup(page), original, "All v2 fields round-trip through a real file import");
  await page.reload();
  assert.deepEqual(await backup(page), original);

  // Observe the actual print sheet without opening an OS print dialog. App code
  // still handles the real toolbar click; only the native print endpoint is stubbed.
  await page.evaluate(() => { window.print = () => { window.__atlasPrintRequested = true; }; });
  await page.getByRole("button", { name: "In chuyến đi / Lưu PDF", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__atlasPrintRequested), true);
  const print = page.locator("#print-sheet");
  await expect(print).toContainText("Điểm hẹn ở Huế");
  await expect(print).toContainText("Điểm dừng ngày thứ hai");
  await expect(print).toContainText("Vé tàu đã thanh toán");
  await expect(print).toContainText("Giấy tờ và vé tàu");
  await expect(print).toContainText(address);
  await page.emulateMedia({ media: "print" });
  await expect(print).toBeVisible();
  await expect(page.locator("#app")).not.toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => dispatchEvent(new Event("afterprint")));
  await expect(print).toHaveCount(0);
});

test("deleting the only trip can be undone with all fields, then remains empty after reload", { timeout: 35000 }, async (t) => {
  const { page } = await pageFor(t);
  await openApp(page);
  await newTrip(page, { title: "Chuyến duy nhất" });
  await addActivity(page);
  await addExpense(page);
  await addChecklist(page, "Sạc dự phòng");
  const original = await backup(page);
  await deleteActiveTrip(page);
  await expect(page.locator(".trip-switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Xem hành trình mẫu", exact: true })).toBeVisible();
  assert.deepEqual(await saved(page), { version: 2, activeTripId: "", trips: [] });
  await page.getByRole("button", { name: "Hoàn tác", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Chuyến duy nhất");
  assert.deepEqual(await backup(page), original);
  await deleteActiveTrip(page);
  await page.reload();
  await expect(page.locator(".trip-switch")).toHaveCount(0);
  assert.deepEqual(await backup(page), { version: 2, activeTripId: "", trips: [] });
  await noOverflow(page);
});

test("a stale second tab preserves the newer saved workspace and offers its unsaved edits for backup", { timeout: 35000 }, async (t) => {
  const { context, page: first } = await pageFor(t);
  await openApp(first);
  await newTrip(first, { title: "Hai tab cùng chuyến đi" });
  const second = await context.newPage();
  second.setDefaultTimeout(10000);
  await openApp(second);
  await addChecklist(second, "Thay đổi đã lưu ở tab hai");
  const newer = await backup(second);
  await expect(first.locator(".save-state")).toContainText("Tab khác");
  await addActivity(first, { title: "Bản sửa chưa lưu ở tab một" });
  await expect(first.locator(".storage-alert")).toContainText("tab khác");
  assert.deepEqual(await saved(first), newer, "A stale tab must never overwrite the other tab's saved update");
  const unsaved = await backup(first);
  assert.ok(currentTrip(unsaved).activities.some((item) => item.title === "Bản sửa chưa lưu ở tab một"));
  assert.ok(currentTrip(newer).checklist.some((item) => item.title === "Thay đổi đã lưu ở tab hai"));
  assert.equal(currentTrip(newer).activities.length, 0);
  await first.reload();
  assert.deepEqual(await backup(first), newer);
  await second.close();
});

test("390px personal mode supports expense and checklist dialogs without horizontal overflow", { timeout: 40000 }, async (t) => {
  const { page } = await pageFor(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await openApp(page);
  await screenshot(page, "empty-mobile.png", true);
  await newTrip(page, { title: "Một chuyến trên điện thoại", destination: "Ninh Bình" });
  await addExpense(page, { title: "Vé trên điện thoại", amount: 42000 });
  await expect(page.locator("[data-actual-total]")).toContainText("42.000");
  await screenshot(page, "expenses-mobile.png", true);
  await addChecklist(page, "Căn cước trên điện thoại");
  await page.getByRole("button", { name: "Đánh dấu đã xong: Căn cước trên điện thoại", exact: true }).click();
  await screenshot(page, "checklist-mobile.png", true);
  await page.reload();
  const trip = currentTrip(await backup(page));
  assert.equal(trip.destination, "Ninh Bình");
  assert.equal(trip.expenses[0].amount, 42000);
  assert.equal(trip.checklist[0].done, true);
  await noOverflow(page);
});

test("the installed Pages-scope app reopens with real assets and editable personal data while offline", { timeout: 50000 }, async (t) => {
  const { context, page } = await pageFor(t);
  await openApp(page);
  await newTrip(page, { title: "Mang chuyến đi theo khi mất mạng" });
  await addActivity(page, { title: "Địa chỉ vẫn còn ngoại tuyến" });
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (registration.active?.state !== "activated")
      await new Promise((done) => registration.active.addEventListener("statechange", () => {
        if (registration.active.state === "activated") done();
      }));
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return { scope: registration.scope, script: navigator.serviceWorker.controller.scriptURL };
  });
  assert.equal(worker.scope, base);
  assert.equal(worker.script, new URL("service-worker.js", base).href);
  await expect(page.getByRole("button", { name: "Cập nhật ứng dụng", exact: true }))
    .not.toBeVisible();
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveText("Mang chuyến đi theo khi mất mạng");
  await expect(page.locator(".timeline-row h3")).toHaveText("Địa chỉ vẫn còn ngoại tuyến");
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  assert.ok(await page.locator(".cover img").evaluate((image) => image.naturalWidth > 0));
  await addExpense(page, { title: "Khoản chi ghi khi mất mạng", amount: 23000 });
  await addChecklist(page, "Việc thêm ngoại tuyến");
  await page.reload({ waitUntil: "domcontentloaded" });
  const trip = currentTrip(await backup(page));
  assert.equal(trip.expenses[0].amount, 23000);
  assert.equal(trip.checklist[0].title, "Việc thêm ngoại tuyến");
  assert.equal(trip.activities[0].address, "23 Lê Lợi, Huế");
  await screenshot(page, "offline-personal-desktop.png");
  await context.setOffline(false);
});
