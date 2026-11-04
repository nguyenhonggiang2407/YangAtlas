import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  validateState,
  createTrip,
  createActivity,
  defaultState,
  dateForDay,
  budgetForTrip,
  conflictsForDay,
  sortActivities,
  moveActivity,
  exportCalendar,
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
  version: 1,
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
    { ...existing, version: 2 },
    { ...existing, activeTripId: "missing" },
  ]) {
    assert.throws(() => validateState(input));
  }
  assert.equal(JSON.stringify(existing), snapshot);
  assert.deepEqual(defaultState(), { version: 1, activeTripId: "", trips: [] });
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
  assert.throws(() => validateState(" ".repeat(1024 * 1024 + 1)), /1 MB/);
  assert.throws(
    () => validateState({ ...state(), extra: "đ".repeat(530_000) }),
    /1 MB/,
  );
  const plan = trip({ activities: [activity({ notes: "đ".repeat(2000) })] });
  assert.equal(
    validateState(state(plan)).trips[0].activities[0].notes.length,
    2000,
  );
});

test("trip/activity count limits and duplicate identifiers are checked", () => {
  const plans = Array.from({ length: 11 }, (_, i) => trip({ id: "trip-" + i }));
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
            activities: Array.from({ length: 101 }, (_, i) =>
              activity({ id: "a-" + i }),
            ),
          }),
        ),
      ),
    /100/,
  );
});

test("invalid money, roles, dates, time and out-of-trip days are rejected", () => {
  for (const field of [
    { budget: -1 },
    { travelers: 0 },
    { travelers: 21 },
    { days: 15 },
    { days: 1.5 },
    { startDate: "2026-02-29" },
    { cover: "https://x.test/a.jpg" },
    { destination: "../dalat" },
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
