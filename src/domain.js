/** Pure planning rules. No network, DOM, storage or third-party runtime code. */
const CATEGORIES = ["visit", "food", "stay", "move", "other"];
const MAX_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const fail = (message) => {
  throw new Error(message);
};
const object = (value, label) => {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail(`${label} không hợp lệ.`);
  }
  return value;
};
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${label} phải là số nguyên từ ${min} đến ${max}.`);
  }
  return value;
};
const text = (value, max, label, { empty = false, multiline = false } = {}) => {
  if (typeof value !== "string") fail(`${label} phải là văn bản.`);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (
    (!empty && !normalized) ||
    normalized.length > max ||
    !normalized.isWellFormed() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized) ||
    (!multiline && /[\n\t]/.test(normalized))
  ) {
    fail(`${label} không hợp lệ hoặc dài quá ${max} ký tự.`);
  }
  return normalized;
};
const identifier = (value, label, empty = false) => {
  if (empty && value === "") return "";
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)
  ) {
    fail(`${label} không hợp lệ.`);
  }
  return value;
};
const key = (value, label) => {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,59}$/.test(value)) {
    fail(`${label} phải là mã địa điểm, không phải đường dẫn hay URL.`);
  }
  return value;
};
const newId = () => {
  if (!globalThis.crypto?.randomUUID)
    fail("Trình duyệt chưa hỗ trợ tạo mã an toàn.");
  return globalThis.crypto.randomUUID();
};

function calendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail("Ngày phải có dạng YYYY-MM-DD.");
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 2199) fail("Năm phải nằm trong khoảng 1900–2199.");
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    fail("Ngày không tồn tại trong lịch.");
  }
  return date;
}

const isoDate = (date) => date.toISOString().slice(0, 10);

function minutes(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    fail("Giờ phải có dạng HH:mm trong khoảng 00:00–23:59.");
  }
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

const clock = (value) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

function activity(input) {
  object(input, "Hoạt động");
  const start = input.start;
  minutes(start);
  const category = input.category;
  if (!CATEGORIES.includes(category)) fail("Nhóm hoạt động không hợp lệ.");
  if (!["person", "group"].includes(input.costMode))
    fail("Cách tính chi phí không hợp lệ.");
  if (typeof input.done !== "boolean")
    fail("Trạng thái hoàn thành không hợp lệ.");
  return {
    id: identifier(input.id, "Mã hoạt động"),
    placeId: identifier(input.placeId, "Mã địa điểm", true),
    day: integer(input.day, 0, 89, "Ngày hoạt động"),
    title: text(input.title, 120, "Tên hoạt động"),
    category,
    start,
    duration: integer(input.duration, 5, 720, "Thời lượng"),
    cost: integer(input.cost, 0, 100_000_000, "Chi phí"),
    costMode: input.costMode,
    notes: text(input.notes, 2000, "Ghi chú", { empty: true, multiline: true }),
    address: text(input.address === undefined ? "" : input.address, 400, "Địa chỉ", {
      empty: true,
      multiline: true,
    }),
    done: input.done,
  };
}

function expense(input) {
  object(input, "Khoản chi");
  calendarDate(input.date);
  if (!CATEGORIES.includes(input.category)) fail("Nhóm khoản chi không hợp lệ.");
  return {
    id: identifier(input.id, "Mã khoản chi"),
    title: text(input.title, 120, "Tên khoản chi"),
    amount: integer(input.amount, 0, 1_000_000_000, "Số tiền"),
    date: input.date,
    category: input.category,
    payer: text(input.payer === undefined ? "" : input.payer, 80, "Người trả", {
      empty: true,
    }),
    notes: text(input.notes === undefined ? "" : input.notes, 2000, "Ghi chú", {
      empty: true,
      multiline: true,
    }),
  };
}

function checklistItem(input) {
  object(input, "Việc cần chuẩn bị");
  if (typeof input.done !== "boolean") fail("Trạng thái chuẩn bị không hợp lệ.");
  return {
    id: identifier(input.id, "Mã việc cần chuẩn bị"),
    title: text(input.title, 200, "Việc cần chuẩn bị"),
    done: input.done,
  };
}

function collection(input, validate, label) {
  const value = input === undefined ? [] : input;
  if (!Array.isArray(value) || value.length > 500) {
    fail(`Một chuyến đi có tối đa 500 ${label}.`);
  }
  const items = value.map(validate);
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    fail(`Mã ${label} bị trùng.`);
  }
  return items;
}

function trip(input) {
  object(input, "Chuyến đi");
  calendarDate(input.startDate);
  const days = integer(input.days, 1, 90, "Số ngày");
  // The whole trip must fit the supported calendar range.
  const lastDate = calendarDate(input.startDate);
  lastDate.setUTCDate(lastDate.getUTCDate() + days - 1);
  if (lastDate.getUTCFullYear() > 2199)
    fail("Ngày kết thúc vượt ngoài năm 2199.");
  if (!Array.isArray(input.activities) || input.activities.length > 500) {
    fail("Một chuyến đi có tối đa 500 hoạt động.");
  }
  const activities = input.activities.map(activity);
  if (new Set(activities.map((item) => item.id)).size !== activities.length)
    fail("Mã hoạt động bị trùng.");
  if (activities.some((item) => item.day >= days))
    fail("Hoạt động nằm ngoài số ngày của chuyến đi.");
  return {
    id: identifier(input.id, "Mã chuyến đi"),
    title: text(input.title, 120, "Tên chuyến đi"),
    destination: text(input.destination, 120, "Điểm đến"),
    startDate: input.startDate,
    days,
    travelers: integer(input.travelers, 1, 100, "Số người"),
    budget: integer(input.budget, 0, 1_000_000_000, "Ngân sách"),
    cover: key(input.cover, "Ảnh bìa"),
    activities,
    expenses: collection(input.expenses, expense, "khoản chi"),
    checklist: collection(input.checklist, checklistItem, "việc cần chuẩn bị"),
  };
}

/** Reject cycles/accessors/prototypes before JSON size measurement invokes code. */
function inspectJson(value, seen = new Set(), depth = 0, count = { nodes: 0 }) {
  if (depth > 30 || ++count.nodes > 1_000_000)
    fail("Tệp sao lưu quá phức tạp.");
  if (value === null || ["string", "number", "boolean"].includes(typeof value))
    return;
  if (typeof value !== "object")
    fail("Tệp sao lưu phải chứa dữ liệu JSON thông thường.");
  if (seen.has(value)) fail("Tệp sao lưu chứa tham chiếu vòng.");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype)
      fail("Mảng dữ liệu không hợp lệ.");
  } else object(value, "Dữ liệu");
  seen.add(value);
  for (const [name, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (
      ["__proto__", "prototype", "constructor"].includes(name) ||
      descriptor.get ||
      descriptor.set
    ) {
      fail("Tệp sao lưu chứa thuộc tính không được phép.");
    }
    inspectJson(descriptor.value, seen, depth + 1, count);
  }
  seen.delete(value);
}

/** Import is atomic: return a new validated state; never change the input/store. */
export function validateState(input) {
  let parsed = input;
  if (typeof input === "string") {
    if (encoder.encode(input).byteLength > MAX_BYTES)
      fail("Tệp sao lưu vượt quá 4 MB.");
    try {
      parsed = JSON.parse(input);
    } catch {
      fail("Tệp sao lưu không phải JSON hợp lệ.");
    }
  }
  inspectJson(parsed);
  if (encoder.encode(JSON.stringify(parsed)).byteLength > MAX_BYTES)
    fail("Tệp sao lưu vượt quá 4 MB.");
  object(parsed, "Bản sao lưu");
  if (![1, 2].includes(parsed.version))
    fail("Phiên bản sao lưu chưa được hỗ trợ.");
  if (!Array.isArray(parsed.trips) || parsed.trips.length > 50)
    fail("Có thể lưu tối đa 50 chuyến đi.");
  const trips = parsed.trips.map(trip);
  if (new Set(trips.map((item) => item.id)).size !== trips.length)
    fail("Mã chuyến đi bị trùng.");
  const activeTripId = identifier(
    parsed.activeTripId,
    "Chuyến đi đang chọn",
    trips.length === 0,
  );
  if (
    trips.length === 0
      ? activeTripId !== ""
      : !trips.some((item) => item.id === activeTripId)
  ) {
    fail("Chuyến đi đang chọn không có trong bản sao lưu.");
  }
  // V1 uses the same storage key: only append empty new collections/address.
  // In particular, do not rename legacy destination keys or regenerate IDs.
  return { version: 2, activeTripId, trips };
}

export function createTrip(input = {}) {
  object(input, "Chuyến đi");
  return trip({
    id: input.id ?? newId(),
    title: input.title ?? "Chuyến đi mới",
    destination: input.destination ?? "dalat",
    startDate: input.startDate,
    days: input.days ?? 3,
    travelers: input.travelers ?? 2,
    budget: input.budget ?? 3_000_000,
    cover:
      input.cover ??
      (["dalat", "hoian"].includes(input.destination)
        ? input.destination
        : "dalat"),
    activities: [],
    expenses: [],
    checklist: [],
  });
}

export function createActivity(input = {}) {
  object(input, "Hoạt động");
  return activity({
    id: input.id ?? newId(),
    placeId: input.placeId ?? "",
    day: input.day ?? 0,
    title: input.title ?? "Hoạt động mới",
    category: input.category ?? "other",
    start: input.start ?? "09:00",
    duration: input.duration ?? 60,
    cost: input.cost ?? 0,
    costMode: input.costMode ?? "person",
    notes: input.notes ?? "",
    address: input.address ?? "",
    done: input.done ?? false,
  });
}

export function createExpense(input = {}) {
  object(input, "Khoản chi");
  return expense({
    id: input.id ?? newId(),
    title: input.title ?? "Khoản chi mới",
    amount: input.amount ?? 0,
    date: input.date,
    category: input.category ?? "other",
    payer: input.payer ?? "",
    notes: input.notes ?? "",
  });
}

export function createChecklistItem(input = {}) {
  object(input, "Việc cần chuẩn bị");
  return checklistItem({
    id: input.id ?? newId(),
    title: input.title ?? "Việc cần chuẩn bị mới",
    done: input.done ?? false,
  });
}

export function defaultState(trips = []) {
  if (!Array.isArray(trips)) fail("Danh sách chuyến đi không hợp lệ.");
  return validateState({ version: 2, activeTripId: trips[0]?.id ?? "", trips });
}

/** Calendar arithmetic uses UTC only as a date counter; browser timezone is irrelevant. */
export function dateForDay(startDate, day) {
  const date = calendarDate(startDate);
  integer(day, 0, 3660, "Khoảng ngày");
  date.setUTCDate(date.getUTCDate() + day);
  if (date.getUTCFullYear() > 2199) fail("Ngày vượt ngoài năm 2199.");
  return isoDate(date);
}

export function budgetForTrip(input) {
  const plan = trip(input);
  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => [category, 0]),
  );
  for (const item of plan.activities) {
    byCategory[item.category] +=
      item.cost * (item.costMode === "person" ? plan.travelers : 1);
  }
  const total = Object.values(byCategory).reduce(
    (sum, amount) => sum + amount,
    0,
  );
  return {
    total,
    perPerson: total / plan.travelers,
    remaining: plan.budget - total,
    percent:
      plan.budget === 0 ? 0 : Math.round((total / plan.budget) * 10_000) / 100,
    byCategory,
  };
}

/** Actual expenses are whole-party amounts, independent of itinerary estimates. */
export function expenseSummary(input) {
  const plan = trip(input);
  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => [category, 0]),
  );
  for (const item of plan.expenses) byCategory[item.category] += item.amount;
  const total = Object.values(byCategory).reduce((sum, amount) => sum + amount, 0);
  const remaining = plan.budget - total;
  return { total, remaining, over: Math.max(0, -remaining), byCategory };
}

const CATEGORY_NAMES = {
  visit: "Tham quan",
  food: "Ăn uống",
  stay: "Lưu trú",
  move: "Di chuyển",
  other: "Khác",
};

function csvCell(value) {
  const source = String(value);
  // Detect full-width equivalents without altering the user's original text.
  const candidate = source.normalize("NFKC").replace(/^[\s\u200b\ufeff]+/u, "");
  const safe = /^[=+@-]/u.test(candidate) ? "'" + source : source;
  return '"' + safe.replace(/"/g, '""').replace(/\r\n?|\n/g, "\r\n") + '"';
}

/** CSV is UTF-8 text with BOM, header, quoted fields and CRLF (RFC 4180).
 * Formula-looking user text is prefixed with an apostrophe in this export only;
 * the source records stay unchanged. This is not a spreadsheet roundtrip format.
 */
export function exportExpensesCSV(input) {
  const plan = trip(input);
  const rows = [["Ngày", "Khoản chi", "Nhóm", "Số tiền (VND)", "Người trả", "Ghi chú"]];
  for (const item of [...plan.expenses].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([
      item.date,
      item.title,
      CATEGORY_NAMES[item.category],
      item.amount,
      item.payer,
      item.notes,
    ]);
  }
  return "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function sortActivities(input, day) {
  const plan = trip(input);
  integer(day, 0, plan.days - 1, "Ngày hoạt động");
  // Modern ECMAScript sort is stable, so ties retain the input order.
  return plan.activities
    .filter((item) => item.day === day)
    .sort((a, b) => minutes(a.start) - minutes(b.start));
}

export function conflictsForDay(input, day) {
  const plan = trip(input);
  integer(day, 0, plan.days - 1, "Ngày hoạt động");
  const beginning = day * 1440;
  const ending = beginning + 1440;
  const intervals = plan.activities
    .map((item) => ({
      id: item.id,
      start: item.day * 1440 + minutes(item.start),
      end: item.day * 1440 + minutes(item.start) + item.duration,
    }))
    .filter((item) => item.start < ending && item.end > beginning);
  const conflicts = [];
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      const a = intervals[i],
        b = intervals[j];
      if (
        Math.max(a.start, b.start, beginning) < Math.min(a.end, b.end, ending)
      ) {
        conflicts.push([a.id, b.id]);
      }
    }
  }
  return conflicts;
}

/** Swap chronological neighbors; keep duration and a non-negative existing gap. */
export function moveActivity(input, activityId, direction) {
  const plan = trip(input);
  if (![-1, 1].includes(direction)) fail("Hướng di chuyển không hợp lệ.");
  const selected = plan.activities.find((item) => item.id === activityId);
  if (!selected) fail("Không tìm thấy hoạt động.");
  const ordered = sortActivities(plan, selected.day);
  const index = ordered.findIndex((item) => item.id === activityId);
  const adjacent = index + direction;
  if (adjacent < 0 || adjacent >= ordered.length)
    fail("Hoạt động đã ở đầu hoặc cuối ngày.");
  const first = ordered[Math.min(index, adjacent)];
  const second = ordered[Math.max(index, adjacent)];
  const firstStart = minutes(first.start);
  const gap = Math.max(0, minutes(second.start) - firstStart - first.duration);
  const newSecondStart = firstStart + second.duration + gap;
  if (newSecondStart + first.duration > 1440)
    fail("Đổi thứ tự sẽ làm lịch vượt quá nửa đêm.");
  return {
    ...plan,
    activities: plan.activities.map((item) =>
      item.id === second.id
        ? { ...item, start: first.start }
        : item.id === first.id
          ? { ...item, start: clock(newSecondStart) }
          : item,
    ),
  };
}

const icalText = (value) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n?|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");

/** RFC 5545 §3.1: at most75 UTF-8 octets per line, never split a code point. */
function fold(line) {
  const parts = [];
  let current = "",
    bytes = 0;
  for (const character of line) {
    const length = encoder.encode(character).byteLength;
    if (bytes + length > 75) {
      parts.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += length;
  }
  parts.push(current);
  return parts.join("\r\n");
}

function compactDateTime(startDate, time, additionalMinutes = 0) {
  const date = calendarDate(startDate);
  date.setUTCMinutes(minutes(time) + additionalMinutes);
  if (date.getUTCFullYear() > 2199)
    fail("Hoạt động kết thúc vượt ngoài năm 2199.");
  return date.toISOString().slice(0, 19).replace(/[-:]/g, "");
}

/** DTSTART/DTEND are deliberately floating; recipients use their local timezone. */
export function exportCalendar(input, { now = new Date() } = {}) {
  const plan = trip(input);
  if (!(now instanceof Date) || Number.isNaN(now.getTime()))
    fail("Thời điểm xuất lịch không hợp lệ.");
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//YangAtlas//Trip planner//VI",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:" + icalText(plan.title),
    "X-WR-CALDESC:" +
      icalText(
        "Giờ địa phương theo thiết bị nhận lịch; không có múi giờ cố định. Chi phí chỉ là dự toán.",
      ),
  ];
  for (const day of Array.from({ length: plan.days }, (_, index) => index)) {
    for (const item of sortActivities(plan, day)) {
      const date = dateForDay(plan.startDate, day);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${plan.id}.${item.id}@yangatlas.local`,
        "DTSTAMP:" + stamp,
        "DTSTART:" + compactDateTime(date, item.start),
        "DTEND:" + compactDateTime(date, item.start, item.duration),
        "SUMMARY:" + icalText(item.title),
        "DESCRIPTION:" +
          icalText(
            [
              item.notes,
              "Giờ địa phương theo thiết bị nhận lịch; chi phí chỉ là dự toán.",
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        ...(item.address ? ["LOCATION:" + icalText(item.address)] : []),
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
