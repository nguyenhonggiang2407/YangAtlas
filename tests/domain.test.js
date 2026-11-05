import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  validateState,
  createTrip,
  duplicateTrip,
  createActivity,
  createExpense,
  createChecklistItem,
  defaultState,
  dateForDay,
  budgetForTrip,
  conflictsForDay,
  sortActivities,
  moveActivity,
  exportCalendar,
  expenseSummary,
  exportExpensesCSV,
} from "../src/domain.js";

const activity = (extra = {}) =>
  createActivity({ id: "a", title: "Đi dạo", ...extra });
const trip = (extra = {}) => ({
  ...createTrip({
    id: "trip-a",
    title: "Chậm một nhịp",
    startDate: "2028-02-28",
  }),
  ...extra,
});
const state = (plan = trip()) => ({
  version: 2,
  activeTripId: plan.id,
  trips: [plan],
});

test("creation provides safe fresh identifiers and complete defaults", () => {
  const a = createActivity(),
    b = createActivity();
  assert.notEqual(a.id, b.id);
  assert.equal(a.done, false);
  assert.equal(a.placeId, "");
  assert.equal(a.cost, 0);
  assert.equal(a.start, "09:00");
  const plan = createTrip({ title: "  Cuối tuần  ", startDate: "2026-11-20" });
  assert.equal(plan.title, "Cuối tuần");
  assert.equal(plan.destination, "dalat");
  assert.deepEqual(plan.activities, []);
});

test("valid backup is detached, strips extra properties and has no unknown persisted keys", () => {
  const original = state(
    trip({
      secret: "unused",
      activities: [{ ...activity(), image: "https://example.test" }],
    }),
  );
  original.extra = { arbitrary: true };
  const restored = validateState(JSON.stringify(original));
  assert.deepEqual(Object.keys(restored), ["version", "activeTripId", "trips"]);
  assert.equal(restored.trips[0].secret, undefined);
  assert.equal(restored.trips[0].activities[0].image, undefined);
  restored.trips[0].activities[0].title = "Khác";
  assert.equal(original.trips[0].activities[0].title, "Đi dạo");
  assert.equal(Object.getPrototypeOf(restored), Object.prototype);
});

test("HTML-like user text remains plain data; calendar cannot inject properties", () => {
  const plan = trip({
    activities: [
      activity({
        title: "<img src=x onerror=alert(1)>",
        notes: "Ghi chú\r\nBEGIN:VEVENT\r\nSUMMARY:khác",
      }),
    ],
  });
  const restored = validateState(state(plan));
  assert.equal(
    restored.trips[0].activities[0].title,
    "<img src=x onerror=alert(1)>",
  );
  const calendar = exportCalendar(plan, {
    now: new Date("2026-11-04T12:00:00Z"),
  });
  assert.equal((calendar.match(/^BEGIN:VEVENT\r?$/gm) || []).length, 1);
  assert.ok(calendar.includes("Ghi chú\\nBEGIN:VEVENT\\nSUMMARY:khác"));
});

test("malformed JSON, unsupported versions and missing active trip fail atomically", () => {
  const existing = state();
  const snapshot = JSON.stringify(existing);
  for (const input of [
    "{",
    "null",
    "[]",
    { ...existing, version: 3 },
    { ...existing, activeTripId: "missing" },
  ]) {
    assert.throws(() => validateState(input));
  }
  assert.equal(JSON.stringify(existing), snapshot);
  assert.deepEqual(defaultState(), { version: 2, activeTripId: "", trips: [] });
  assert.throws(() =>
    validateState({ version: 1, activeTripId: "missing", trips: [] }),
  );
});

test("prototype payloads, unusual prototypes, accessors and cycles cannot execute or persist", () => {
  assert.throws(() =>
    validateState(
      '{"version":1,"activeTripId":"","trips":[],"__proto__":{"polluted":true}}',
    ),
  );
  assert.equal({}.polluted, undefined);
  assert.throws(() => validateState(Object.create({ version: 1 })));
  let invoked = false;
  const input = state();
  Object.defineProperty(input, "extra", {
    enumerable: true,
    get() {
      invoked = true;
      return 1;
    },
  });
  assert.throws(() => validateState(input));
  assert.equal(invoked, false);
  const cyclic = state();
  cyclic.extra = cyclic;
  assert.throws(() => validateState(cyclic));
});

test("import byte limits count UTF-8 and prevent oversized input before parsing", () => {
  assert.throws(() => validateState(" ".repeat(4 * 1024 * 1024 + 1)), /4 MB/);
  assert.throws(
    () => validateState({ ...state(), extra: "đ".repeat(2_100_000) }),
    /4 MB/,
  );
  const plan = trip({ activities: [activity({ notes: "đ".repeat(2000) })] });
  assert.equal(
    validateState(state(plan)).trips[0].activities[0].notes.length,
    2000,
  );
});

test("trip/activity count limits and duplicate identifiers are checked", () => {
  const plans = Array.from({ length: 51 }, (_, i) => trip({ id: "trip-" + i }));
  assert.throws(() =>
    validateState({ version: 1, activeTripId: "trip-0", trips: plans }),
  );
  assert.throws(
    () =>
      validateState({
        version: 1,
        activeTripId: "trip-a",
        trips: [trip(), trip()],
      }),
    /trùng/,
  );
  assert.throws(
    () => validateState(state(trip({ activities: [activity(), activity()] }))),
    /trùng/,
  );
  assert.throws(
    () =>
      validateState(
        state(
          trip({
            activities: Array.from({ length: 501 }, (_, i) =>
              activity({ id: "a-" + i }),
            ),
          }),
        ),
      ),
    /500/,
  );
});

test("invalid money, roles, dates, time and out-of-trip days are rejected", () => {
  for (const field of [
    { budget: -1 },
    { travelers: 0 },
    { travelers: 101 },
    { days: 91 },
    { days: 1.5 },
    { startDate: "2026-02-29" },
    { cover: "https://x.test/a.jpg" },
    { destination: "" },
    { destination: "d".repeat(121) },
  ]) {
    assert.throws(() => validateState(state(trip(field))));
  }
  for (const fields of [
    { start: "24:00" },
    { start: "9:00" },
    { duration: 0 },
    { duration: 721 },
    { cost: 1.5 },
    { cost: Infinity },
    { costMode: "total" },
    { category: "admin" },
    { done: "yes" },
    { title: "A\nB" },
  ]) {
    assert.throws(() => createActivity(fields));
  }
  assert.throws(() =>
    validateState(state(trip({ days: 1, activities: [activity({ day: 1 })] }))),
  );
});

test("calendar date arithmetic handles leap years, month/year transitions and timezone changes", () => {
  assert.equal(dateForDay("2028-02-28", 1), "2028-02-29");
  assert.equal(dateForDay("2028-02-28", 2), "2028-03-01");
  assert.equal(dateForDay("2026-12-31", 1), "2027-01-01");
  assert.throws(() => dateForDay("2026-04-31", 0));
  assert.throws(() => dateForDay("1900-02-29", 0));
  assert.equal(dateForDay("2000-02-28", 1), "2000-02-29");
  assert.throws(() => dateForDay("2026-11-01", -1));
  const moduleUrl = new URL("../src/domain.js", import.meta.url).href;
  for (const timezone of [
    "Pacific/Honolulu",
    "Asia/Ho_Chi_Minh",
    "Pacific/Kiritimati",
  ]) {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {dateForDay} from ${JSON.stringify(moduleUrl)};process.stdout.write(dateForDay('2026-12-31',1))`,
      ],
      { encoding: "utf8", env: { ...process.env, TZ: timezone } },
    );
    assert.equal(output, "2027-01-01");
  }
});

test("budget uses person/group costs correctly and remains independent of done status", () => {
  const plan = trip({
    travelers: 3,
    budget: 400_000,
    activities: [
      activity({
        id: "food",
        category: "food",
        cost: 50_000,
        costMode: "person",
        done: true,
      }),
      activity({
        id: "taxi",
        category: "move",
        cost: 100_000,
        costMode: "group",
      }),
    ],
  });
  assert.deepEqual(budgetForTrip(plan), {
    total: 250_000,
    perPerson: 250_000 / 3,
    remaining: 150_000,
    percent: 62.5,
    byCategory: { visit: 0, food: 150_000, stay: 0, move: 100_000, other: 0 },
  });
  assert.equal(budgetForTrip({ ...plan, travelers: 4 }).total, 300_000);
  assert.equal(budgetForTrip({ ...plan, budget: 0 }).percent, 0);
  assert.equal(budgetForTrip({ ...plan, budget: 1 }).remaining, -249_999);
  assert.equal(budgetForTrip(trip()).total, 0);
});

test("sorting is chronological and stable without mutating original activity data", () => {
  const plan = trip({
    activities: [
      activity({ id: "late", start: "13:00" }),
      activity({ id: "first", start: "09:00" }),
      activity({ id: "second", start: "09:00" }),
      activity({ id: "next", day: 1, start: "08:00" }),
    ],
  });
  const snapshot = JSON.stringify(plan);
  assert.deepEqual(
    sortActivities(plan, 0).map((item) => item.id),
    ["first", "second", "late"],
  );
  assert.equal(JSON.stringify(plan), snapshot);
  assert.throws(() => sortActivities(plan, 3));
});

test("conflicts use half-open ranges, detect contained overlaps and ignore other days", () => {
  const plan = trip({
    activities: [
      activity({ id: "long", start: "09:00", duration: 180 }),
      activity({ id: "inside", start: "10:00", duration: 15 }),
      activity({ id: "adjacent", start: "12:00", duration: 30 }),
      activity({ id: "otherday", day: 1, start: "09:00", duration: 180 }),
    ],
  });
  assert.deepEqual(conflictsForDay(plan, 0), [["long", "inside"]]);
  assert.deepEqual(conflictsForDay(plan, 1), []);
});

test("overnight activities conflict with following day only during the shared interval", () => {
  const plan = trip({
    activities: [
      activity({ id: "overnight", start: "23:30", duration: 90 }),
      activity({ id: "early", day: 1, start: "00:30", duration: 15 }),
      activity({ id: "boundary", day: 1, start: "01:00", duration: 30 }),
    ],
  });
  assert.deepEqual(conflictsForDay(plan, 0), []);
  assert.deepEqual(conflictsForDay(plan, 1), [["overnight", "early"]]);
});

test("reorder swaps actual timeline neighbors, preserving durations, a positive gap and other days", () => {
  const plan = trip({
    activities: [
      activity({ id: "a", start: "09:00", duration: 120 }),
      activity({ id: "b", start: "11:30", duration: 30 }),
      activity({ id: "next", day: 1, start: "08:00" }),
    ],
  });
  const snapshot = JSON.stringify(plan);
  const moved = moveActivity(plan, "b", -1);
  assert.deepEqual(
    sortActivities(moved, 0).map((item) => [
      item.id,
      item.start,
      item.duration,
    ]),
    [
      ["b", "09:00", 30],
      ["a", "10:00", 120],
    ],
  );
  assert.deepEqual(
    moved.activities.find((item) => item.id === "next"),
    plan.activities.find((item) => item.id === "next"),
  );
  assert.equal(JSON.stringify(plan), snapshot);
  const restored = moveActivity(moved, "b", 1);
  assert.deepEqual(
    sortActivities(restored, 0).map((item) => [item.id, item.start]),
    [
      ["a", "09:00"],
      ["b", "11:30"],
    ],
  );
});

test("reorder rejects invalid target, boundaries, direction and schedules past midnight", () => {
  const plan = trip({
    activities: [
      activity({ id: "a", start: "09:00" }),
      activity({ id: "b", start: "10:00" }),
    ],
  });
  for (const [id, direction] of [
    ["missing", 1],
    ["a", -1],
    ["b", 1],
    ["a", 0],
  ])
    assert.throws(() => moveActivity(plan, id, direction));
  const night = trip({
    activities: [
      activity({ id: "a", start: "23:00", duration: 120 }),
      activity({ id: "b", start: "23:30", duration: 30 }),
    ],
  });
  assert.throws(() => moveActivity(night, "b", -1), /nửa đêm/);
});

test("calendar has escaped text, stable distinct UIDs, real UTC stamp and floating local event times", () => {
  const plan = trip({
    title: "Đà Lạt, phố; và\\rừng",
    activities: [
      activity({
        title: "Cà phê, bánh; đẹp\\lắm",
        notes: "Dòng một\nDòng hai",
      }),
      activity({ id: "b", day: 1 }),
    ],
  });
  const calendar = exportCalendar(plan, {
    now: new Date("2026-11-04T12:34:56Z"),
  });
  assert.ok(calendar.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(calendar.endsWith("END:VCALENDAR\r\n"));
  assert.ok(calendar.includes("DTSTAMP:20261104T123456Z\r\n"));
  assert.ok(
    calendar.includes("DTSTART:20280228T090000\r\nDTEND:20280228T100000\r\n"),
  );
  assert.ok(calendar.includes("DTSTART:20280229T090000\r\n"));
  assert.ok(calendar.includes("SUMMARY:Cà phê\\, bánh\\; đẹp\\\\lắm"));
  assert.ok(calendar.includes("Dòng một\\nDòng hai"));
  assert.ok(!calendar.includes("TZID="));
  assert.equal(
    new Set([...calendar.matchAll(/^UID:(.+)\r$/gm)].map((match) => match[1]))
      .size,
    2,
  );
  const second = exportCalendar(plan, {
    now: new Date("2026-11-05T00:00:00Z"),
  });
  assert.deepEqual(
    [...calendar.matchAll(/^UID:(.+)\r$/gm)].map((match) => match[1]),
    [...second.matchAll(/^UID:(.+)\r$/gm)].map((match) => match[1]),
  );
});

test("calendar carries midnight through a leap day/year boundary without corrupting Vietnamese UTF-8 folds", () => {
  const title = "Đà Lạt 🌿 và những buổi sáng thật chậm "
    .repeat(3)
    .slice(0, 120);
  const plan = trip({
    startDate: "2026-12-31",
    activities: [
      activity({
        title,
        start: "23:30",
        duration: 90,
        notes: "Đường phố và cà phê 🌿 ".repeat(70),
      }),
    ],
  });
  const calendar = exportCalendar(plan, {
    now: new Date("2026-11-04T00:00:00Z"),
  });
  assert.ok(calendar.includes("DTEND:20270101T010000\r\n"));
  assert.ok(calendar.includes("\r\n "));
  for (const line of calendar.split("\r\n"))
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, line);
  const unfolded = calendar.replace(/\r\n[ \t]/g, "");
  assert.ok(unfolded.includes("SUMMARY:" + title.trim()));
  assert.ok(!calendar.includes("\ufffd"));
  assert.equal(calendar.replace(/\r\n/g, "").includes("\n"), false);
  assert.throws(() => exportCalendar(plan, { now: new Date("invalid") }));
});

test("empty trip exports a valid calendar without inventing events", () => {
  const calendar = exportCalendar(trip(), {
    now: new Date("2026-11-04T00:00:00Z"),
  });
  assert.ok(calendar.includes("X-WR-CALNAME:Chậm một nhịp"));
  assert.ok(!calendar.includes("BEGIN:VEVENT"));
});

test("malformed Unicode is rejected rather than silently replacing part of user text", () => {
  assert.throws(() => createActivity({ notes: "bad\ud800" }));
  assert.throws(() => createActivity({ title: "\udc00bad" }));
  assert.equal(createActivity({ title: "Đi dạo 🌿" }).title, "Đi dạo 🌿");
});

const expense = (extra = {}) => createExpense({
  id: "expense-a", title: "Bữa trưa", amount: 120_000, date: "2028-02-28", category: "food", ...extra,
});
const checklist = (extra = {}) => createChecklistItem({ id: "pack-a", title: "Sạc dự phòng", ...extra });

test("v1 migrates in place logically without regenerating IDs or changing legacy destinations/data", () => {
  for (const destination of ["dalat", "hoian"]) {
    const legacyTrip = trip({ destination, cover: destination, activities: [activity({ done: true, notes: "Ghi chú đã lưu" })] });
    delete legacyTrip.expenses;
    delete legacyTrip.checklist;
    delete legacyTrip.activities[0].address;
    const legacy = { version: 1, activeTripId: legacyTrip.id, trips: [legacyTrip] };
    const original = JSON.stringify(legacy);
    const migrated = validateState(original);
    assert.equal(migrated.version, 2);
    assert.equal(migrated.activeTripId, legacy.activeTripId);
    assert.deepEqual(migrated.trips[0], {
      ...legacyTrip, activities: [{ ...legacyTrip.activities[0], address: "" }], expenses: [], checklist: [],
    });
    assert.equal(JSON.stringify(legacy), original, "Migration must not mutate an existing in-memory state");
    assert.deepEqual(validateState(migrated), migrated, "Migration is idempotent");
  }
  assert.deepEqual(validateState({ version: 1, activeTripId: "", trips: [] }), { version: 2, activeTripId: "", trips: [] });
});

test("v2 arbitrary destination, activity address, expense and checklist survive JSON backup/restore", () => {
  const destination = "Kyoto · 京都 / một nơi tự chọn";
  const plan = trip({
    destination,
    activities: [activity({ address: "12 Đường nhỏ\nTầng 2, Kyoto", notes: "Lịch trình riêng" })],
    expenses: [expense({ payer: "An", notes: "Đã trả tiền mặt" })],
    checklist: [checklist({ done: true })],
  });
  const restored = validateState(JSON.stringify(state(plan)));
  assert.deepEqual(restored, state(plan));
  assert.equal(restored.trips[0].destination, destination);
  const created = createTrip({ title: "Đi một nơi khác", destination, startDate: "2028-03-01" });
  assert.equal(created.destination, destination);
  assert.equal(created.cover, "dalat", "A free-form destination cannot become an arbitrary image URL/key");
  assert.deepEqual(created.expenses, []);
  assert.deepEqual(created.checklist, []);
  assert.equal(createTrip({ title: "Phố cổ", destination: "hoian", startDate: "2028-03-01" }).cover, "hoian");
});

test("new personal limits accept 50 trips, 90 days, 100 travelers and 500 activities", () => {
  const plans = Array.from({ length: 50 }, (_, index) => trip({ id: "trip-" + index, days: 90, travelers: 100 }));
  plans[0].activities = Array.from({ length: 500 }, (_, index) => activity({ id: "activity-" + index, day: index % 90 }));
  const restored = validateState({ version: 2, activeTripId: "trip-0", trips: plans });
  assert.equal(restored.trips.length, 50);
  assert.equal(restored.trips[0].activities.length, 500);
  assert.equal(restored.trips[0].travelers, 100);
  assert.equal(sortActivities(restored.trips[0], 89)[0].day, 89);
  const calendar = exportCalendar(trip({ days: 90, activities: [activity({ day: 89 })] }), { now: new Date("2026-11-05T00:00:00Z") });
  assert.ok(calendar.includes("DTSTART:20280527T090000"));
  assert.throws(() => createActivity({ day: 90 }));
});

test("a real canonical backup above the old 1 MiB/node limits restores within the new 4 MiB limit", () => {
  const plans = Array.from({ length: 5 }, (_, planIndex) => trip({
    id: "large-" + planIndex,
    days: 90,
    activities: Array.from({ length: 500 }, (_, index) => activity({ id: "a-" + index, day: index % 90, notes: "đ".repeat(200) })),
    expenses: Array.from({ length: 100 }, (_, index) => expense({ id: "e-" + index, notes: "đ".repeat(200) })),
    checklist: Array.from({ length: 100 }, (_, index) => checklist({ id: "c-" + index })),
  }));
  const input = JSON.stringify({ version: 2, activeTripId: "large-0", trips: plans });
  assert.ok(Buffer.byteLength(input, "utf8") > 1024 * 1024);
  assert.ok(Buffer.byteLength(input, "utf8") < 4 * 1024 * 1024);
  const restored = validateState(input);
  assert.equal(restored.trips[4].activities.length, 500);
  assert.equal(restored.trips[4].expenses[99].notes, "đ".repeat(200));
});

test("expense/checklist creation uses fresh IDs and explicit conservative defaults", () => {
  const first = createExpense({ date: "2028-02-28" });
  const second = createExpense({ date: "2028-02-28" });
  assert.notEqual(first.id, second.id);
  assert.equal(first.amount, 0);
  assert.equal(first.category, "other");
  assert.equal(first.payer, "");
  assert.equal(first.notes, "");
  assert.throws(() => createExpense(), /Ngày/);
  const item = createChecklistItem({ title: "  Giấy tờ  " });
  assert.equal(item.title, "Giấy tờ");
  assert.equal(item.done, false);
  assert.notEqual(item.id, createChecklistItem().id);
});

test("expenses validate integer amounts, calendar dates, category and bounded user text", () => {
  for (const patch of [
    { amount: -1 }, { amount: 1.5 }, { amount: 1_000_000_001 }, { amount: "100" },
    { amount: NaN }, { date: "2026-02-29" }, { date: "2028-02-30" }, { date: "2028-2-28" },
    { category: "transfer" }, { title: "" }, { title: "t".repeat(121) },
    { payer: "a".repeat(81) }, { notes: "a".repeat(2001) }, { payer: "A\nB" },
  ]) assert.throws(() => expense(patch));
  assert.equal(expense({ amount: 1_000_000_000, date: "2028-02-29" }).amount, 1_000_000_000);
  assert.equal(expense({ date: "2020-01-01" }).date, "2020-01-01", "Pre-trip deposits may have an earlier date");
  assert.throws(() => validateState(state(trip({ expenses: [{ ...expense(), payer: null }] }))));
  assert.throws(() => validateState(state(trip({ activities: [activity({ address: "a".repeat(401) })] }))));
});

test("expense/checklist collections reject duplicate IDs, malformed collections and counts above 500", () => {
  for (const plan of [
    trip({ expenses: [expense(), expense()] }),
    trip({ checklist: [checklist(), checklist()] }),
    trip({ expenses: null }), trip({ checklist: {} }),
    trip({ expenses: Array.from({ length: 501 }, (_, i) => expense({ id: "e-" + i })) }),
    trip({ checklist: Array.from({ length: 501 }, (_, i) => checklist({ id: "c-" + i })) }),
    trip({ checklist: [{ ...checklist(), done: "true" }] }),
    trip({ checklist: [{ ...checklist(), title: "x".repeat(201) }] }),
  ]) assert.throws(() => validateState(state(plan)));
});

test("actual expense summaries never multiply whole-party amounts or mix in itinerary estimates", () => {
  const plan = trip({
    travelers: 100, budget: 300_000,
    activities: [activity({ cost: 9_999_999, costMode: "person" })],
    expenses: [expense(), expense({ id: "taxi", category: "move", amount: 240_000 })],
  });
  const before = JSON.stringify(plan);
  assert.deepEqual(expenseSummary(plan), {
    total: 360_000, remaining: -60_000, over: 60_000,
    byCategory: { visit: 0, food: 120_000, stay: 0, move: 240_000, other: 0 },
  });
  assert.equal(expenseSummary({ ...plan, travelers: 1 }).total, 360_000);
  assert.equal(JSON.stringify(plan), before);
  assert.deepEqual(expenseSummary(trip({ budget: 0 })), {
    total: 0, remaining: 0, over: 0,
    byCategory: { visit: 0, food: 0, stay: 0, move: 0, other: 0 },
  });
  const full = trip({ expenses: Array.from({ length: 500 }, (_, index) => expense({ id: "e-" + index, amount: 1_000_000_000 })) });
  assert.equal(expenseSummary(full).total, 500_000_000_000);
});

test("invalid expense/checklist restore does not mutate a usable existing state", () => {
  const existing = state(trip({ expenses: [expense()], checklist: [checklist()] }));
  const snapshot = JSON.stringify(existing);
  const incoming = JSON.parse(snapshot);
  incoming.trips[0].expenses[0].amount = -1;
  assert.throws(() => validateState(incoming));
  assert.equal(JSON.stringify(existing), snapshot);
  assert.equal(expenseSummary(existing.trips[0]).total, 120_000);
});

// Independent minimal CSV reader checks the output's record/cell boundaries.
function readCsv(source) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = source.startsWith("\ufeff") ? 1 : 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && character === ",") { row.push(cell); cell = ""; }
    else if (!quoted && character === "\r" && source[index + 1] === "\n") {
      row.push(cell); rows.push(row); row = []; cell = ""; index += 1;
    } else cell += character;
  }
  assert.equal(quoted, false, "Every CSV quote must be closed");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test("expense CSV is UTF-8 with header, stable date order, quotes/commas/newlines and no extra records", () => {
  const plan = trip({ expenses: [
    expense({ id: "later", date: "2028-03-01", title: 'Phí xe, "buổi tối"', payer: "Hằng 🌿", notes: 'Dòng một\nDòng hai, "đã trả"' }),
    expense({ id: "earlier", date: "2028-02-28", title: "Cà phê", amount: 0 }),
  ] });
  const before = JSON.stringify(plan);
  const csv = exportExpensesCSV(plan);
  assert.ok(csv.startsWith("\ufeff"));
  assert.ok(csv.endsWith("\r\n"));
  assert.ok(!csv.includes("\ufffd"));
  assert.deepEqual(readCsv(csv), [
    ["Ngày", "Khoản chi", "Nhóm", "Số tiền (VND)", "Người trả", "Ghi chú"],
    ["2028-02-28", "Cà phê", "Ăn uống", "0", "", ""],
    ["2028-03-01", 'Phí xe, "buổi tối"', "Ăn uống", "120000", "Hằng 🌿", 'Dòng một\r\nDòng hai, "đã trả"'],
  ]);
  assert.equal(JSON.stringify(plan), before);
  assert.equal(csv.replace(/\r\n/g, "").includes("\n"), false);
});

test("formula-looking CSV cells are exported as text without changing saved records", () => {
  const values = ["=HYPERLINK(\"https://example.test\",\"x\")", "+1", "-1", "@SUM(1,2)", "＝1+2", "＋1", "－1", "＠SUM(1,2)", "\u200b=1+2"];
  const plan = trip({ expenses: values.map((value, index) => expense({ id: "e-" + index, title: value, payer: value.slice(0, 80), notes: value })) });
  const before = JSON.stringify(plan);
  const rows = readCsv(exportExpensesCSV(plan));
  for (let index = 1; index < rows.length; index += 1) {
    for (const column of [1, 4, 5]) assert.equal(rows[index][column], "'" + values[index - 1]);
  }
  assert.equal(JSON.stringify(plan), before);
  assert.equal(readCsv(exportExpensesCSV(trip())).length, 1, "An empty ledger exports only its header");
});

test("ICS LOCATION includes custom addresses as folded escaped text without invented coordinates", () => {
  const address = 'Ngõ 1, Nhà "Gió"; lối sau\\cổng\n' + "Đà Lạt 🌿 ".repeat(20);
  const plan = trip({ activities: [activity({ address })] });
  const calendar = exportCalendar(plan, { now: new Date("2026-11-05T00:00:00Z") });
  const unfolded = calendar.replace(/\r\n[ \t]/g, "");
  assert.ok(unfolded.includes('LOCATION:Ngõ 1\\, Nhà "Gió"\\; lối sau\\\\cổng\\n'));
  assert.ok(!calendar.includes("GEO:"));
  for (const line of calendar.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  assert.ok(!exportCalendar(trip({ activities: [activity()] })).includes("LOCATION:"));
});

test("duplicateTrip preserves the reusable plan while clearing actual payments and all completed flags", () => {
  const source = trip({
    destination: "Huế", days: 3, travelers: 4, budget: 6_000_000,
    activities: [
      activity({ id: "a-1", placeId: "dalat-station", day: 0, start: "08:30", duration: 90, cost: 120_000, costMode: "group", address: "23 Lê Lợi\nTầng 2, Huế", notes: "Mang máy ảnh", done: true }),
      activity({ id: "a-2", day: 2, start: "14:15", category: "food", cost: 80_000, done: false }),
    ],
    expenses: [expense({ id: "paid-1", amount: 555_000, payer: "An" })],
    checklist: [checklist({ id: "c-1", done: true }), checklist({ id: "c-2", title: "Áo mưa", done: false })],
  });
  const before = JSON.stringify(source);
  Object.freeze(source);
  source.activities.forEach(Object.freeze);
  source.checklist.forEach(Object.freeze);
  const copy = duplicateTrip(source);
  assert.equal(copy.title, source.title + " — bản sao");
  for (const field of ["destination", "startDate", "days", "travelers", "budget", "cover"]) assert.equal(copy[field], source[field]);
  assert.deepEqual(copy.expenses, []);
  assert.equal(expenseSummary(copy).total, 0);
  assert.equal(expenseSummary(source).total, 555_000);
  assert.deepEqual(budgetForTrip(copy), budgetForTrip(source));
  const reusableActivity = ({ id: _id, done: _done, ...fields }) => fields;
  assert.deepEqual(copy.activities.map(reusableActivity), source.activities.map(reusableActivity));
  assert.ok(copy.activities.every((item) => item.done === false));
  assert.deepEqual(copy.checklist.map((item) => ({ title: item.title, done: item.done })), source.checklist.map((item) => ({ title: item.title, done: false })));
  assert.equal(JSON.stringify(source), before);
  copy.activities[0].notes = "Ghi chú của chuyến mới";
  copy.checklist[0].title = "Việc riêng cho chuyến mới";
  assert.equal(source.activities[0].notes, "Mang máy ảnh");
  assert.equal(source.checklist[0].title, "Sạc dự phòng");
});

test("duplicateTrip gives every new entity a fresh globally distinct ID and a separate calendar identity", () => {
  const source = trip({ activities: [activity({ id: "a-1" }), activity({ id: "a-2", day: 1 })], expenses: [expense()], checklist: [checklist()] });
  const first = duplicateTrip(source);
  const second = duplicateTrip(source);
  const ids = (plan) => [plan.id, ...plan.activities.map((item) => item.id), ...plan.expenses.map((item) => item.id), ...plan.checklist.map((item) => item.id)];
  const all = [...ids(source), ...ids(first), ...ids(second)];
  assert.equal(new Set(all).size, all.length);
  for (const id of [...ids(first), ...ids(second)]) assert.match(id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  const now = new Date("2026-11-05T00:00:00Z");
  const calendarIds = [source, first, second].flatMap((plan) => [...exportCalendar(plan, { now }).matchAll(/^UID:(.+)\r$/gm)].map((match) => match[1]));
  assert.equal(new Set(calendarIds).size, calendarIds.length);
});

test("duplicateTrip shifts the start date across a year without changing day positions or floating times", () => {
  const source = trip({ activities: [activity({ day: 2, start: "23:30", duration: 90, address: "Nhà nhỏ" })] });
  const copy = duplicateTrip(source, { title: "Chuyến đi năm mới", startDate: "2030-12-31" });
  assert.equal(copy.title, "Chuyến đi năm mới");
  assert.equal(dateForDay(copy.startDate, copy.activities[0].day), "2031-01-02");
  assert.equal(copy.activities[0].start, "23:30");
  const calendar = exportCalendar(copy, { now: new Date("2026-11-05T00:00:00Z") });
  assert.ok(calendar.includes("DTSTART:20310102T233000\r\nDTEND:20310103T010000"));
  assert.equal(source.startDate, "2028-02-28");
});

test("duplicateTrip default title remains bounded without cutting emoji code points", () => {
  const suffix = " — bản sao";
  for (const title of ["🌿".repeat(60), "Huế rất đẹp ".repeat(10)]) {
    const source = trip({ title });
    const copy = duplicateTrip(source);
    assert.ok(copy.title.length <= 120);
    assert.equal(copy.title.isWellFormed(), true);
    assert.ok(copy.title.endsWith(suffix));
    const prefix = copy.title.slice(0, -suffix.length);
    assert.ok(source.title.startsWith(prefix));
    if (title.startsWith("🌿")) assert.ok([...prefix].every((character) => character === "🌿"));
  }
  assert.equal(duplicateTrip(trip(), { title: "Tên tự chọn" }).title, "Tên tự chọn");
});

test("duplicateTrip rejects invalid source/date/title before touching an existing plan", () => {
  const source = trip({ expenses: [expense()], checklist: [checklist({ done: true })] });
  const before = JSON.stringify(source);
  for (const options of [{ startDate: "2026-02-29" }, { startDate: "2199-12-31" }, { title: "" }, { title: "x".repeat(121) }]) assert.throws(() => duplicateTrip(source, options));
  assert.throws(() => duplicateTrip({ ...source, activities: [activity({ day: 5 })] }));
  assert.throws(() => duplicateTrip({ ...source, expenses: [{ ...expense(), amount: -1 }] }));
  assert.equal(JSON.stringify(source), before);
});

test("duplicateTrip retries an ID collision instead of reusing a source or newly allocated entity ID", (t) => {
  const source = trip({ activities: [activity()], checklist: [checklist()] });
  const candidates = [source.id, "new-trip", "new-trip", source.activities[0].id, "new-activity", source.checklist[0].id, "new-checklist"];
  t.mock.method(globalThis.crypto, "randomUUID", () => candidates.shift());
  const copy = duplicateTrip(source);
  assert.deepEqual([copy.id, copy.activities[0].id, copy.checklist[0].id], ["new-trip", "new-activity", "new-checklist"]);
});
