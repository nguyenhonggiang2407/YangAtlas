import { places, destinations, sampleTrips, photoCredits } from "./catalog.js";
import {
  validateState,
  createTrip,
  createActivity,
  dateForDay,
  budgetForTrip,
  sortActivities,
  conflictsForDay,
  moveActivity,
  exportCalendar,
} from "./domain.js";

const KEY = "yangatlas:v1";
const app = document.querySelector("#app");
const labels = {
  visit: "Tham quan",
  food: "Ăn & uống",
  stay: "Nghỉ ngơi",
  move: "Di chuyển",
  other: "Trải nghiệm",
};
const categoryIcons = {
  visit: "compass",
  food: "cup",
  stay: "home",
  move: "route",
  other: "spark",
};
const shapes = {
  atlas: "M4 19 11 4h2l7 15M8 13h8M12 4v16",
  compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M16 8l-2 6-6 2 2-6Z",
  calendar: "M5 5h14v16H5ZM8 3v4m8-4v4M5 10h14M8 14h2m4 0h2m-8 3h2",
  map: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Zm6-3v15m6-12v15",
  wallet: "M4 6h14v3M4 6a2 2 0 0 1 2-2h13v16H4V6Zm11 6h6v5h-6Z",
  pin: "M18 9c0 5-6 11-6 11S6 14 6 9a6 6 0 0 1 12 0Zm-4 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0",
  users:
    "M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 21v-3a6 6 0 0 1 12 0v3m2-15a3 3 0 0 1 0 6m1 3a5 5 0 0 1 5 5",
  chevron: "m9 5 7 7-7 7",
  down: "m5 9 7 7 7-7",
  up: "m5 15 7-7 7 7",
  plus: "M12 5v14M5 12h14",
  edit: "m15 4 5 5-10 10-6 1 1-6Zm-8 8 5 5",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v6l4 2",
  external: "M14 3h7v7m0-7L10 14M10 5H4v15h15v-6",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Zm7 5v2",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 10v7m0-10v.1",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6",
  cup: "M5 8h12v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4ZM17 9h2a3 3 0 0 1 0 6h-2M8 2v3m6-3v3",
  home: "m3 11 9-8 9 8M5 10v11h14V10m-10 11v-7h6v7",
  route:
    "M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4m12 12a2 2 0 1 0 0 4 2 2 0 0 0 0-4M6 8v7a3 3 0 0 0 3 3h7M6 6h8a4 4 0 0 1 0 8h-3",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
  menu: "M4 6h16M4 12h16M4 18h16",
  image: "M3 4h18v16H3Zm0 12 6-6 5 5 3-3 4 4M16 8h.1",
  dots: "M5 12h.1M12 12h.1M19 12h.1",
};
const icon = (name, extra = "") =>
  `<svg ${extra} viewBox="0 0 24 24" aria-hidden="true"><path d="${shapes[name] || shapes.compass}"/></svg>`;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (value) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value) +
  " ₫";
const number = (value) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value);
const placeById = (id) => places.find((p) => p.id === id);
const destinationOf = (trip) => destinations[trip.cover] || destinations.dalat;
const dayDate = (trip, day) =>
  new Date(dateForDay(trip.startDate, day) + "T12:00:00");
const shortDate = (trip, day) =>
  dayDate(trip, day).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
  });
const dateRange = (trip) => {
  const startYear = trip.startDate.slice(0, 4);
  const endYear = dateForDay(trip.startDate, trip.days - 1).slice(0, 4);
  const beginning = shortDate(trip, 0) + (startYear === endYear ? "" : `/${startYear}`);
  return `${beginning} — ${shortDate(trip, trip.days - 1)}/${endYear}`;
};
let view = "plan",
  selectedDay = 0,
  search = "",
  category = "all",
  sidebarOpen = false,
  toastTimer,
  undoAction,
  storageError = "",
  protectStored = false;
function validWorkspace(input) {
  const value = validateState(input);
  if (!value.trips.length)
    throw new Error(
      "Bản sao cần có ít nhất một chuyến đi. Dữ liệu hiện tại vẫn giữ nguyên.",
    );
  if (
    value.trips.some(
      (t) =>
        !Object.hasOwn(destinations, t.destination) ||
        !Object.hasOwn(destinations, t.cover),
    )
  )
    throw new Error(
      "Bản sao có điểm đến chưa được hỗ trợ. Dữ liệu hiện tại vẫn giữ nguyên.",
    );
  return value;
}
const sample = () => {
  const start = new Date();
  start.setDate(start.getDate() + 14);
  const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return validateState({
    version: 1,
    activeTripId: sampleTrips[0].id,
    trips: sampleTrips.map((trip, i) => ({
      ...trip,
      startDate: dateForDay(date, i * 7),
    })),
  });
};
let state;
try {
  const stored = localStorage.getItem(KEY);
  state = stored ? validWorkspace(stored) : sample();
} catch {
  state = sample();
  storageError =
    "Không thể đọc bản lưu. Thay đổi chỉ giữ trong phiên này; bản lưu cũ chưa bị ghi đè.";
  protectStored = true;
}
const active = () =>
  state.trips.find((trip) => trip.id === state.activeTripId) || state.trips[0];

function notify(message, undo) {
  clearTimeout(toastTimer);
  undoAction = undo;
  const toast = document.querySelector("#toast");
  toast.innerHTML = `<span>${esc(message)}</span>${undo ? '<button data-action="undo">Hoàn tác</button>' : ""}`;
  toast.classList.add("show");
  toastTimer = setTimeout(
    () => {
      toast.classList.remove("show");
      undoAction = undefined;
    },
    undo ? 12000 : 6500,
  );
}
function commit(next, { restore = false } = {}) {
  state = validWorkspace(next);
  if (restore) {
    protectStored = false;
    storageError = "";
  }
  if (!protectStored) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageError = "";
    } catch {
      storageError =
        "Trình duyệt chưa lưu được thay đổi. Hãy xuất bản sao trước khi đóng trang.";
    }
  }
  selectedDay = Math.min(selectedDay, active().days - 1);
  render();
}
function replaceTrip(trip) {
  commit({
    ...state,
    trips: state.trips.map((t) => (t.id === trip.id ? trip : t)),
  });
}
function changeView(next) {
  view = next;
  sidebarOpen = false;
  render();
  document.querySelector("#main")?.focus({ preventScroll: true });
}
function control(action, label, name, attrs = "") {
  return `<button class="icon-button ${action === "close-sidebar" ? "mobile-close" : ""}" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon(name)}</button>`;
}

function render() {
  const trip = active(),
    destination = destinationOf(trip),
    budget = budgetForTrip(trip);
  app.innerHTML = `<div class="workspace">
    ${sidebarOpen ? '<button class="sidebar-shade" data-action="close-sidebar" aria-label="Đóng điều hướng"></button>' : ""}
    <aside class="sidebar ${sidebarOpen ? "open" : ""}" aria-label="Điều hướng">
      <div class="brand">${icon("atlas")}<span>YangAtlas</span></div>${control("close-sidebar", "Đóng menu", "close")}
      <p class="sidebar-label">ĐI ĐÂU CŨNG CÓ CÂU CHUYỆN</p>
      <nav class="side-nav" aria-label="Không gian chuyến đi">${[
        ["plan", "compass", "Hành trình"],
        ["places", "map", "Khám phá địa điểm"],
        ["budget", "wallet", "Ngân sách"],
      ]
        .map(
          ([key, symbol, title]) =>
            `<button data-action="view" data-view="${key}" class="${view === key ? "active" : ""}" ${view === key ? 'aria-current="page"' : ""}>${icon(symbol)}${title}${key === "plan" ? `<span class="nav-count">${state.trips.length.toString().padStart(2, "0")}</span>` : ""}</button>`,
        )
        .join("")}</nav>
      <p class="sidebar-label">CHUYẾN ĐI CỦA BẠN</p>
      <div class="trip-nav">${state.trips.map((t) => `<button class="trip-switch ${t.id === trip.id ? "selected" : ""}" data-action="trip" data-id="${esc(t.id)}" aria-label="Mở chuyến đi ${esc(t.title)}" ${t.id === trip.id ? 'aria-current="true"' : ""}><img src="${esc(destinationOf(t).cover)}" alt=""/><span><strong>${esc(t.title)}</strong><small>${t.days} ngày · ${t.travelers} người</small></span>${t.id === trip.id ? '<i class="dot"></i>' : ""}</button>`).join("")}</div>
      <button class="new-trip" id="new-trip" data-action="new-trip">${icon("plus")} Chuyến đi mới</button>
      <div class="sidebar-bottom"><div class="privacy-line">${icon("lock")}<span><strong>Một góc nhỏ, của riêng bạn.</strong>Không tài khoản. Lưu trên trình duyệt.</span></div><p class="save-state ${storageError ? "warn" : ""}">${storageError ? "Chưa lưu · hãy xuất bản sao" : "Sẵn sàng lưu trên thiết bị"}</p><button class="about-link" data-action="about">${icon("info")} Về YangAtlas & nguồn ảnh</button></div>
    </aside>
    <div class="main-shell"><header class="topbar"><div class="breadcrumbs"><button class="icon-button mobile-menu" data-action="open-sidebar" aria-label="Mở menu">${icon("menu")}</button><span>Không gian riêng</span>${icon("chevron")}<strong>Hành trình của bạn</strong></div><div class="top-actions">${control("import", "Nhập bản sao JSON", "upload")}${control("backup", "Xuất bản sao JSON", "download")}<button class="button secondary" data-action="calendar">${icon("calendar")} Xuất lịch .ics</button><span class="avatar" title="Lưu riêng trên trình duyệt">YA</span></div></header>
    <main id="main" class="main-inner" tabindex="-1">
      ${storageError ? `<div class="storage-alert" role="status">${icon("info")} ${esc(storageError)} <button data-action="backup">Xuất bản sao JSON</button></div>` : ""}
      <section class="cover" aria-label="Chuyến đi ${esc(trip.title)}"><img src="${esc(destination.cover)}" alt="${esc(destination.coverAlt || "Ảnh phong cảnh minh họa " + destination.name)}" fetchpriority="high"/><div class="cover-content"><p class="eyebrow"><span class="eyebrow-line"></span> VIỆT NAM · YOUR NEXT CHAPTER</p><h1>${esc(trip.title)}</h1><div class="trip-meta"><span>${icon("pin")}${esc(destinations[trip.destination]?.name || trip.destination)}</span><span>${icon("calendar")}${dateRange(trip)}</span><span>${icon("users")}${trip.travelers} người</span></div></div><button class="button cover-edit" data-action="edit-trip">${icon("edit")} Chỉnh sửa chuyến đi</button><button class="cover-credit" data-action="about">${icon("image")} Ảnh chụp minh họa · Nguồn ảnh</button></section>
      <div class="intro-bar"><nav class="view-tabs" aria-label="Nội dung chuyến đi">${[
        ["plan", "route", "Lịch trình"],
        ["places", "pin", "Địa điểm"],
        ["budget", "wallet", "Ngân sách"],
      ]
        .map(
          ([key, symbol, title]) =>
            `<button class="view-tab ${view === key ? "active" : ""}" data-action="view" data-view="${key}" ${view === key ? 'aria-current="page"' : ""}>${icon(symbol)}${title}</button>`,
        )
        .join(
          "",
        )}</nav><p class="hint-line">${icon("lock")} Chỉ bạn và những dự định nhỏ</p></div>
      ${view === "plan" ? renderPlan(trip, budget) : view === "places" ? renderPlaces(trip) : renderBudget(trip, budget)}
      <footer class="bottomline"><span>YangAtlas · Dành chỗ cho những điều bất ngờ.<br>Địa điểm gợi mở. Chi phí mẫu có thể chỉnh sửa.</span><button data-action="about">Riêng tư & nguồn ảnh ${icon("external")}</button></footer>
    </main></div></div><input type="file" id="import-file" accept=".json,application/json" hidden>`;
}

function renderPlan(trip, budget) {
  const activities = sortActivities(trip, selectedDay);
  const conflicts = conflictsForDay(trip, selectedDay).flat();
  const totalMinutes = activities.reduce((sum, a) => sum + a.duration, 0);
  return `<div class="planning-grid"><section aria-label="Lịch trình từng ngày"><div class="days" aria-label="Chọn ngày">${Array.from({ length: trip.days }, (_, i) => `<button class="day-button ${i === selectedDay ? "active" : ""}" data-action="day" data-day="${i}" ${i === selectedDay ? 'aria-pressed="true"' : 'aria-pressed="false"'}><strong>Ngày ${String(i + 1).padStart(2, "0")}</strong><small>${shortDate(trip, i)}</small></button>`).join("")}</div>
    <div class="day-heading"><div><h2>${selectedDay === 0 ? "Bắt đầu thật thong thả" : selectedDay === trip.days - 1 ? "Thêm một chút vấn vương" : "Đi theo những điều mình thích"}</h2><p>${activities.length} điểm dừng · ${totalMinutes ? `${Math.floor(totalMinutes / 60)} giờ ${totalMinutes % 60 ? (totalMinutes % 60) + " phút" : ""} trải nghiệm` : "Một ngày còn trống, đầy khả năng"}${conflicts.length ? " · Có lịch trùng giờ" : ""}</p></div><button class="button primary" id="add-activity" data-action="add-activity">${icon("plus")} Thêm hoạt động</button></div>
    ${activities.length ? `<div class="timeline">${activities.map((activity, index) => renderActivity(trip, activity, index, activities.length, conflicts.includes(activity.id))).join("")}</div><button class="add-line" data-action="add-activity">${icon("plus")} Dành thêm một điểm dừng cho ngày hôm nay</button>` : `<div class="empty">${icon("compass")}<h3>Một ngày, rất nhiều khả năng.</h3><p>Chọn một địa điểm từ thư viện hoặc tự thêm điều bạn muốn làm. Không cần lên lịch cho mọi phút.</p><button class="button primary" data-action="view" data-view="places">${icon("map")} Khám phá địa điểm</button></div>`}
    </section><aside class="planning-aside">${renderMap(trip, activities)}${budgetCard(trip, budget)}<div class="field-note"><p class="eyebrow">${icon("spark")} MỘT GHI CHÚ NHỎ</p><p>“Đôi khi, điều hay nhất trong chuyến đi là một khoảng trống trong lịch.”</p><small>Gợi ý từ YangAtlas · không phải đánh giá du lịch</small></div></aside></div>`;
}
function renderActivity(trip, a, index, count, conflict) {
  const place = placeById(a.placeId),
    cost = a.cost * (a.costMode === "person" ? trip.travelers : 1);
  return `<article class="timeline-row" data-activity-id="${esc(a.id)}"><div class="time-col">${esc(a.start)}</div><div class="activity-card ${a.done ? "complete" : ""} ${conflict ? "conflict" : ""}">
    ${place?.image ? `<figure class="activity-visual"><img class="activity-photo" src="${esc(place.image)}" alt="${esc(place.imageCaption || "Ảnh minh họa " + destinations[place.destination]?.name)}" loading="lazy"><figcaption>${/không phải|minh họa/.test(place.imageCaption || "") ? "Ảnh điểm đến" : "Ảnh chụp"}</figcaption></figure>` : `<div class="photo-placeholder">${icon(categoryIcons[a.category])}</div>`}
    <div class="activity-info"><div class="category ${a.category}">${icon(categoryIcons[a.category])}${labels[a.category]}</div><h3>${esc(a.title)}</h3><p class="activity-note">${esc(a.notes || place?.description || "Một trải nghiệm do bạn tự lên kế hoạch.")}</p><div class="activity-details"><span>${icon("clock")}${a.duration} phút</span><span class="price">${icon("wallet")}${cost ? money(cost) : "Chưa dự tính chi phí"}${cost ? ` / ${trip.travelers} người` : ""}</span></div>${conflict ? '<p class="activity-conflict">Trùng giờ với một hoạt động khác.</p>' : ""}<div class="activity-tools">${control("move", "Chuyển sớm hơn: " + a.title, "up", `data-id="${esc(a.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""}`)}${control("move", "Chuyển muộn hơn: " + a.title, "down", `data-id="${esc(a.id)}" data-direction="1" ${index === count - 1 ? "disabled" : ""}`)}${control("edit-activity", "Sửa: " + a.title, "edit", `data-id="${esc(a.id)}"`)}${control("remove-activity", "Xóa: " + a.title, "trash", `data-id="${esc(a.id)}"`)}</div></div>
    <button class="done-button ${a.done ? "done" : ""}" data-action="done" data-id="${esc(a.id)}" aria-label="${a.done ? "Đánh dấu chưa ghé" : "Đánh dấu đã ghé"}: ${esc(a.title)}" aria-pressed="${a.done}">${a.done ? icon("check") : ""}</button>
  </div></article>`;
}
function renderMap(trip, activities) {
  const selected = activities
    .map((a) => placeById(a.placeId))
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const pool = places.filter(
    (p) =>
      p.destination === trip.destination &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng),
  );
  const basis = [...pool, ...selected];
  const latitudes = basis.map((p) => p.lat),
    longitudes = basis.map((p) => p.lng);
  const minLat = Math.min(...latitudes),
    maxLat = Math.max(...latitudes),
    minLng = Math.min(...longitudes),
    maxLng = Math.max(...longitudes);
  const points = selected.map((p) => ({
    x: 35 + ((p.lng - minLng) / Math.max(maxLng - minLng, 0.01)) * 180,
    y: 155 - ((p.lat - minLat) / Math.max(maxLat - minLat, 0.01)) * 110,
  }));
  const href = selected[0]
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected[0].mapQuery || selected[0].name)}`
    : "";
  return `<section class="side-card" aria-label="Sơ đồ địa điểm"><div class="card-top"><h3>Những điểm mình sẽ ghé</h3><span>${selected.length} địa điểm</span></div><div class="route-map"><svg viewBox="0 0 250 200" role="img" aria-label="Sơ đồ tọa độ gần đúng của các địa điểm, không dùng để dẫn đường"><defs><pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0v25" class="map-grid" fill="none"/></pattern></defs><rect width="250" height="200" fill="url(#grid)"/><path class="map-contour" d="M-20 30Q40-15 80 20T180 55 275 15M-20 43Q40-2 80 33T180 68 275 28M-20 56Q40 11 80 46T180 81 275 41M-20 150Q70 100 130 140T270 125M-20 163Q70 113 130 153T270 138M-20 176Q70 126 130 166T270 151"/>${points.length > 1 ? `<polyline class="route-line" points="${points.map((p) => p.x + "," + p.y).join(" ")}"/>` : ""}${points.map((p, i) => `<circle class="map-point" cx="${p.x}" cy="${p.y}" r="11"/><text class="map-point-text" x="${p.x}" y="${p.y}">${i + 1}</text>`).join("")}${!points.length ? '<text class="map-point-caption" x="125" y="100">Thêm địa điểm để thấy sơ đồ</text>' : ""}</svg></div><p class="map-caption">Tọa độ gần đúng · Đường nối là thứ tự ghé, không phải tuyến đường dẫn đường.</p>${href ? `<a class="map-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Mở điểm đầu trên Google Maps ${icon("external")}</a>` : '<button class="map-link" data-action="view" data-view="places">Khám phá thư viện địa điểm</button>'}</section>`;
}
function budgetCard(trip, budget) {
  return `<section class="side-card" aria-label="Ngân sách dự kiến"><div class="card-top"><h3>Ngân sách chuyến đi</h3><button class="icon-button" data-action="edit-trip" aria-label="Chỉnh ngân sách">${icon("edit")}</button></div><div class="budget-content"><p class="budget-total">${number(budget.total)}<small>₫</small></p><p class="budget-caption">Chi phí dự kiến · ${money(budget.perPerson)} / người</p><div class="budget-track"><div class="budget-fill ${budget.remaining < 0 ? "over" : ""}" style="width:${Math.min(100, Math.max(0, budget.percent))}%"></div></div><div class="budget-comparison"><span>${trip.budget ? Math.round(budget.percent) + "% dự tính" : "Chưa đặt hạn mức"}</span><span>Hạn mức ${money(trip.budget)}</span></div><div class="budget-foot">${icon("info")}<span>${budget.remaining < 0 ? "Dự tính vượt hạn mức " + money(-budget.remaining) + "." : "Chi phí mẫu chỉ để lên kế hoạch; không phải giá bán hoặc báo giá hiện tại."}</span></div></div></section>`;
}
function filteredPlaces(trip) {
  const query = search
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return places.filter(
    (p) =>
      p.destination === trip.destination &&
      (category === "all" || p.category === category) &&
      (!query ||
        (p.name + " " + p.description + " " + (p.tags || []).join(" "))
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase()
          .includes(query)),
  );
}
function placeCards(trip) {
  const list = filteredPlaces(trip);
  return list.length
    ? list
        .map(
          (p) =>
            `<article class="place-card"><img src="${esc(p.image)}" alt="${esc(p.imageCaption || "Ảnh minh họa điểm đến")}" loading="lazy"><small class="photo-caption">${esc(p.imageCaption || "Ảnh chụp minh họa điểm đến")}</small><div class="place-body"><p class="category ${p.category}">${icon(categoryIcons[p.category])}${labels[p.category]} · ${esc(destinations[p.destination]?.name)}</p><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><div class="place-footer"><span>${p.duration} phút · ${p.cost ? money(p.cost) : "Chưa dự tính chi phí"}</span><button class="button subtle" data-action="add-place" data-id="${esc(p.id)}">${icon("plus")} Thêm vào ngày</button></div><a class="place-source" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">Thông tin điểm đến ${icon("external")}</a></div></article>`,
        )
        .join("")
    : `<div class="empty"><h3>Chưa thấy địa điểm phù hợp.</h3><p>Thử một từ khóa khác hoặc tự thêm hoạt động vào lịch trình.</p><button class="button secondary" data-action="add-activity">Tự thêm hoạt động</button></div>`;
}
function renderPlaces(trip) {
  return `<section aria-label="Thư viện địa điểm"><div class="places-header"><div><h2 class="section-title">Những nơi đáng để dành thời gian.</h2><p class="section-subtitle">Một vài gợi mở ở ${esc(destinations[trip.destination]?.name || trip.destination)}. Câu chuyện còn lại do bạn viết.</p></div><label class="search-field">${icon("search")}<input id="place-search" type="search" placeholder="Tìm một địa điểm…" aria-label="Tìm địa điểm" value="${esc(search)}"></label></div><div class="filter-row" aria-label="Loại địa điểm">${[
    ["all", "Tất cả"],
    ["visit", "Tham quan"],
    ["food", "Ăn & uống"],
    ["other", "Trải nghiệm"],
  ]
    .map(
      ([key, label]) =>
        `<button class="filter-chip ${category === key ? "active" : ""}" data-action="filter" data-category="${key}" aria-pressed="${category === key}">${label}</button>`,
    )
    .join(
      "",
    )}</div><div class="place-grid" id="place-grid">${placeCards(trip)}</div><p class="places-note">Ảnh chụp minh họa điểm đến có thể được dùng lại giữa các thẻ, không đại diện từng cơ sở. Thời lượng và chi phí là dữ liệu mẫu có thể sửa; hãy kiểm tra lịch mở cửa và giá trước khi đi.</p></section>`;
}
function renderBudget(trip, budget) {
  const list = trip.activities;
  return `<section aria-label="Bảng chi phí"><div class="budget-header"><div><h2 class="section-title">Đi nhẹ đầu, chi rõ ràng.</h2><p class="section-subtitle">Ước tính cho ${trip.travelers} người · ${trip.days} ngày. Chỉnh từng khoản theo kế hoạch của bạn.</p></div><button class="button secondary" data-action="edit-trip">${icon("edit")} Đặt hạn mức</button></div><div class="budget-overview">${budgetCard(trip, budget)}<section class="side-card budget-breakdown"><h3>Dự tính theo trải nghiệm</h3>${Object.entries(
    labels,
  )
    .map(
      ([key, label]) =>
        `<div class="breakdown-row"><span class="category-dot ${key}"></span><span>${label}</span><strong>${money(budget.byCategory[key] || 0)}</strong></div>`,
    )
    .join("")}</section></div>${
    list.length
      ? `<div class="budget-table"><div class="budget-table-row heading"><span>HOẠT ĐỘNG</span><span>CÁCH TÍNH</span><span class="row-money">CẢ NHÓM</span><span></span></div>${list
          .slice()
          .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
          .map(
            (a) =>
              `<div class="budget-table-row"><span>${esc(a.title)}<small>Ngày ${a.day + 1} · ${labels[a.category]}</small></span><span class="scope">${a.costMode === "person" ? money(a.cost) + " / người" : "Cho cả nhóm"}</span><span class="row-money">${money(a.cost * (a.costMode === "person" ? trip.travelers : 1))}</span>${control("edit-activity", "Sửa chi phí: " + a.title, "edit", `data-id="${esc(a.id)}"`)}</div>`,
          )
          .join("")}</div>`
      : '<div class="empty"><h3>Chưa có khoản chi nào.</h3><p>Thêm hoạt động và chi phí dự kiến để xem tổng ngân sách.</p></div>'
  }<p class="places-note">Tổng chi phí chỉ cộng các hoạt động đã thêm. Chưa bao gồm vé máy bay, chỗ ở hoặc khoản phát sinh nếu bạn chưa nhập chúng. Không thực hiện thanh toán hay đặt dịch vụ.</p></section>`;
}

function dialog(title, subtitle, body, submit) {
  const focused = document.activeElement;
  const node = document.createElement("dialog");
  node.id = "atlas-dialog";
  node.setAttribute("aria-labelledby", "dialog-title");
  node.innerHTML = `<div class="dialog-head"><div><h2 id="dialog-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button class="icon-button" type="button" data-close aria-label="Đóng hộp thoại">${icon("close")}</button></div><div class="dialog-body">${body}</div>`;
  document.querySelector("#dialog-root").append(node);
  node
    .querySelector("[data-close]")
    .addEventListener("click", () => node.close());
  node.addEventListener("click", (e) => {
    if (e.target.closest("[data-cancel]")) node.close();
  });
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const choices = [
      ...node.querySelectorAll(
        "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]",
      ),
    ].filter(
      (element) =>
        element.tabIndex >= 0 &&
        element.getClientRects().length &&
        getComputedStyle(element).visibility !== "hidden",
    );
    const first = choices[0],
      last = choices.at(-1);
    if (!first) {
      event.preventDefault();
      node.focus();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !node.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
        !node.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  });
  node.addEventListener("close", () => {
    node.remove();
    const visible = (element) => {
      if (!element?.isConnected || element.disabled) return false;
      const box = element.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.height > 0 &&
        box.left >= 0 &&
        box.right <= innerWidth + 1 &&
        box.top >= 0 &&
        box.bottom <= innerHeight + 1
      );
    };
    const candidates = [
      focused,
      focused?.id ? document.getElementById(focused.id) : null,
      ...app.querySelectorAll("button:not(:disabled)"),
    ];
    candidates.find(visible)?.focus({ preventScroll: true });
  });
  if (submit)
    node.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      try {
        submit(new FormData(e.target), node);
      } catch (error) {
        node.querySelector(".form-error").textContent =
          error.message || "Không thể lưu. Vui lòng kiểm tra dữ liệu.";
      }
    });
  node.showModal();
  return node;
}
const field = (label, name, value, type = "text", attrs = "", full = false) =>
  `<label class="field ${full ? "full" : ""}">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
function tripDialog(edit = false) {
  const trip = edit ? active() : null;
  const today = new Date(),
    defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  dialog(
    edit ? "Một chút chỉnh sửa." : "Bắt đầu một hành trình.",
    edit
      ? "Điều chỉnh theo nhịp của bạn. Dữ liệu chỉ lưu trên trình duyệt."
      : "Không cần có đủ kế hoạch. Chỉ cần một nơi muốn đến.",
    `<form><div class="form-grid">${field("Tên chuyến đi", "title", trip?.title || "", "text", 'required maxlength="120" placeholder="Ví dụ: Đà Lạt, chậm một nhịp" autofocus', true)}<label class="field">Điểm đến<select name="destination" aria-label="Điểm đến">${Object.entries(
      destinations,
    )
      .map(
        ([key, d]) =>
          `<option value="${key}" ${trip?.destination === key ? "selected" : ""}>${esc(d.name)}</option>`,
      )
      .join(
        "",
      )}</select></label>${field("Ngày khởi hành", "startDate", trip?.startDate || defaultDate, "date", 'required min="1900-01-01" max="2199-12-31"')}${field("Số ngày", "days", trip?.days || 3, "number", 'required min="1" max="14" step="1"')}${field("Số người", "travelers", trip?.travelers || 2, "number", 'required min="1" max="20" step="1"')}${field("Hạn mức cả chuyến đi (VND)", "budget", trip?.budget ?? 3000000, "number", 'required min="0" max="1000000000" step="1"', true)}<p class="field-note-small field full">Hạn mức dùng để so với dự tính, không phải một khoản thanh toán. Tối đa 14 ngày và 20 người.</p></div><p class="form-error" role="alert"></p><div class="dialog-actions">${edit && state.trips.length > 1 ? '<button type="button" class="delete-trip" data-delete-trip>Xóa chuyến đi</button>' : ""}<button type="button" class="button secondary" data-cancel>Để sau</button><button class="button primary" type="submit">${edit ? "Lưu chuyến đi" : "Tạo chuyến đi"}</button></div></form>`,
    (data, node) => {
      if (!edit && state.trips.length >= 10)
        throw new Error(
          "Bạn đã có 10 chuyến đi. Hãy xuất bản sao hoặc xóa một chuyến trước.",
        );
      const input = {
        title: data.get("title"),
        destination: data.get("destination"),
        startDate: data.get("startDate"),
        days: Number(data.get("days")),
        travelers: Number(data.get("travelers")),
        budget: Number(data.get("budget")),
        cover: data.get("destination"),
      };
      const created = createTrip(input);
      if (edit) {
        if (trip.activities.some((a) => a.day >= created.days))
          throw new Error(
            "Hãy chuyển hoặc xóa hoạt động ở những ngày bị rút ngắn trước.",
          );
        replaceTrip({ ...created, id: trip.id, activities: trip.activities });
      } else {
        selectedDay = 0;
        view = "plan";
        sidebarOpen = false;
        commit({
          ...state,
          activeTripId: created.id,
          trips: [...state.trips, created],
        });
      }
      node.close();
      notify(
        edit ? "Đã lưu thay đổi chuyến đi." : "Hành trình mới đã sẵn sàng.",
      );
    },
  );
  document
    .querySelector("[data-delete-trip]")
    ?.addEventListener("click", () => {
      document.querySelector("#atlas-dialog").close();
      confirmDeleteTrip(trip);
    });
}
function confirmDeleteTrip(trip) {
  dialog(
    "Xóa chuyến đi này?",
    "Bạn có thể xuất bản sao JSON trước khi xóa.",
    `<p class="dialog-copy">${esc(trip.title)} và ${trip.activities.length} hoạt động sẽ được xóa khỏi trình duyệt này.</p><form><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" data-cancel>Giữ lại</button><button type="submit" class="button danger">Xóa chuyến đi</button></div></form>`,
    (_, node) => {
      const remaining = state.trips.filter((t) => t.id !== trip.id);
      commit({ ...state, activeTripId: remaining[0].id, trips: remaining });
      node.close();
      notify("Đã xóa chuyến đi.", () => {
        if (!state.trips.some((t) => t.id === trip.id))
          commit({
            ...state,
            activeTripId: trip.id,
            trips: [...state.trips, trip],
          });
      });
    },
  );
}
function activityDialog(activity, place) {
  const trip = active(),
    day = activity?.day ?? selectedDay;
  const last = sortActivities(trip, day).at(-1);
  let start = activity?.start || "09:00";
  if (!activity && last) {
    const [hour, minute] = last.start.split(":").map(Number);
    const next = Math.min(22 * 60, hour * 60 + minute + last.duration + 30);
    start =
      String(Math.floor(next / 60)).padStart(2, "0") +
      ":" +
      String(next % 60).padStart(2, "0");
  }
  dialog(
    activity
      ? "Điều chỉnh điểm dừng."
      : place
        ? "Dành một chỗ trong lịch."
        : "Thêm điều bạn muốn làm.",
    place?.imageCaption ||
      "Thời gian và chi phí là dự tính, bạn có thể thay đổi bất cứ lúc nào.",
    `<form><div class="form-grid">${field("Tên hoạt động", "title", activity?.title || place?.name || "", "text", 'required maxlength="120" placeholder="Một quán cà phê, một buổi đi dạo…" autofocus', true)}<label class="field">Ngày<select name="day" aria-label="Ngày">${Array.from({ length: trip.days }, (_, i) => `<option value="${i}" ${i === day ? "selected" : ""}>Ngày ${i + 1} · ${shortDate(trip, i)}</option>`).join("")}</select></label><label class="field">Loại hoạt động<select name="category" aria-label="Loại hoạt động">${Object.entries(
      labels,
    )
      .map(
        ([key, label]) =>
          `<option value="${key}" ${key === (activity?.category || place?.category || "other") ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label>${field("Bắt đầu", "start", start, "time", "required")}${field("Thời lượng (phút)", "duration", activity?.duration || place?.duration || 60, "number", 'required min="5" max="720" step="1"')}${field("Chi phí dự kiến (VND)", "cost", activity?.cost ?? place?.cost ?? 0, "number", 'required min="0" max="100000000" step="1"')}<label class="field">Cách tính<select name="costMode" aria-label="Cách tính"><option value="person" ${(activity?.costMode || place?.costMode || "person") === "person" ? "selected" : ""}>Cho mỗi người</option><option value="group" ${(activity?.costMode || place?.costMode) === "group" ? "selected" : ""}>Cho cả nhóm</option></select></label><label class="field full">Ghi chú<textarea name="notes" maxlength="2000" placeholder="Những điều muốn nhớ cho điểm dừng này…">${esc(activity?.notes || "")}</textarea></label></div><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" data-cancel>Để sau</button><button type="submit" class="button primary">${activity ? "Lưu hoạt động" : "Thêm vào lịch trình"}</button></div></form>`,
    (data, node) => {
      if (!activity && trip.activities.length >= 100)
        throw new Error("Tối đa 100 hoạt động mỗi chuyến đi.");
      const created = createActivity({
        id: activity?.id,
        placeId: activity?.placeId || place?.id || "",
        title: data.get("title"),
        day: Number(data.get("day")),
        category: data.get("category"),
        start: data.get("start"),
        duration: Number(data.get("duration")),
        cost: Number(data.get("cost")),
        costMode: data.get("costMode"),
        notes: data.get("notes"),
        done: activity?.done || false,
      });
      replaceTrip({
        ...trip,
        activities: activity
          ? trip.activities.map((a) => (a.id === activity.id ? created : a))
          : [...trip.activities, created],
      });
      selectedDay = created.day;
      view = "plan";
      render();
      node.close();
      notify(
        activity
          ? "Đã cập nhật hoạt động."
          : "Đã thêm một điểm dừng vào lịch trình.",
      );
    },
  );
}
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function about() {
  dialog(
    "Một nơi cho những dự định.",
    "YangAtlas · Lên lịch chuyến đi, dành chỗ cho điều bất ngờ.",
    `<div class="dialog-copy"><p><strong>Dữ liệu ở trên trình duyệt của bạn.</strong> Không đăng nhập, không đồng bộ máy chủ và không gửi lịch trình tới dịch vụ AI. Hãy xuất bản sao JSON để chuyển thiết bị hoặc đề phòng trình duyệt xóa dữ liệu.</p><p>Các chuyến đi ban đầu là mẫu minh họa. Chi phí và thời lượng không phải báo giá. YangAtlas không đặt vé, không xử lý thanh toán, không hiển thị thời tiết hay đánh giá trực tiếp.</p><p>Sơ đồ chỉ nối các tọa độ gần đúng theo thứ tự trong ngày. Khi đi thực tế, hãy dùng công cụ dẫn đường và kiểm tra thông tin địa điểm.</p><p>Lịch .ics dùng giờ địa phương (floating time); ứng dụng lịch nhận file sẽ sử dụng múi giờ thiết bị. Thời lượng qua nửa đêm được chuyển sang ngày kế tiếp.</p><p><a href="https://github.com/nguyenhonggiang2407/YangAtlas" target="_blank" rel="noopener noreferrer">Mã nguồn trên GitHub</a></p><div class="credit-list"><strong>Ảnh chụp thật, có nguồn.</strong>${photoCredits.map((p) => `<div class="credit-entry"><strong>${esc(p.title)}</strong>${esc(p.author)} · ${esc(p.license)}<br><a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">Trang ảnh gốc</a><a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener noreferrer">Giấy phép</a></div>`).join("")}</div></div>`,
  );
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action,
    trip = active();
  try {
    if (action === "view") {
      changeView(button.dataset.view);
      return;
    }
    if (action === "trip") {
      selectedDay = 0;
      category = "all";
      search = "";
      sidebarOpen = false;
      commit({ ...state, activeTripId: button.dataset.id });
      return;
    }
    if (action === "open-sidebar" || action === "close-sidebar") {
      sidebarOpen = action === "open-sidebar";
      render();
      return;
    }
    if (action === "day") {
      selectedDay = Number(button.dataset.day);
      render();
      return;
    }
    if (action === "new-trip") {
      tripDialog();
      return;
    }
    if (action === "edit-trip") {
      tripDialog(true);
      return;
    }
    if (action === "add-activity") {
      activityDialog();
      return;
    }
    if (action === "add-place") {
      activityDialog(undefined, placeById(button.dataset.id));
      return;
    }
    if (action === "edit-activity") {
      activityDialog(trip.activities.find((a) => a.id === button.dataset.id));
      return;
    }
    if (action === "done") {
      replaceTrip({
        ...trip,
        activities: trip.activities.map((a) =>
          a.id === button.dataset.id ? { ...a, done: !a.done } : a,
        ),
      });
      return;
    }
    if (action === "move") {
      replaceTrip(
        moveActivity(trip, button.dataset.id, Number(button.dataset.direction)),
      );
      notify("Đã đổi thứ tự và giờ của hai hoạt động.");
      return;
    }
    if (action === "remove-activity") {
      const removed = trip.activities.find((a) => a.id === button.dataset.id);
      replaceTrip({
        ...trip,
        activities: trip.activities.filter((a) => a.id !== button.dataset.id),
      });
      notify("Đã bỏ hoạt động khỏi lịch trình.", () => {
        const current = state.trips.find((t) => t.id === trip.id);
        if (!current) throw new Error("Chuyến đi không còn tồn tại.");
        if (!current.activities.some((a) => a.id === removed.id))
          replaceTrip({
            ...current,
            activities: [...current.activities, removed],
          });
      });
      return;
    }
    if (action === "filter") {
      category = button.dataset.category;
      render();
      return;
    }
    if (action === "backup") {
      download(
        "yangatlas-backup.json",
        JSON.stringify(state, null, 2),
        "application/json;charset=utf-8",
      );
      notify("Đã xuất bản sao. Cất file ở nơi riêng của bạn.");
      return;
    }
    if (action === "calendar") {
      if (!trip.activities.length) {
        notify("Thêm một hoạt động trước khi xuất lịch.");
        return;
      }
      download(
        "yangatlas-itinerary.ics",
        exportCalendar(trip),
        "text/calendar;charset=utf-8",
      );
      notify("Đã xuất lịch theo giờ địa phương.");
      return;
    }
    if (action === "import") {
      document.querySelector("#import-file").click();
      return;
    }
    if (action === "about") {
      about();
      return;
    }
  } catch (error) {
    notify(error.message || "Không thể thực hiện thao tác.");
  }
});
app.addEventListener("input", (event) => {
  if (event.target.id === "place-search") {
    search = event.target.value;
    document.querySelector("#place-grid").innerHTML = placeCards(active());
  }
});
app.addEventListener("change", async (event) => {
  if (event.target.id !== "import-file") return;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error("Bản sao tối đa 1 MB.");
    const imported = validWorkspace(await file.text());
    dialog(
      "Khôi phục bản sao?",
      "Chỉ tiếp tục nếu bạn muốn thay lịch trình hiện tại.",
      `<p class="dialog-copy">Bản sao có ${imported.trips.length} chuyến đi. Dữ liệu trên trình duyệt này sẽ được thay bằng nội dung file. Hãy xuất bản sao hiện tại trước nếu cần giữ lại.</p><form><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" data-cancel>Giữ dữ liệu hiện tại</button><button type="submit" class="button primary">Thay dữ liệu hiện tại</button></div></form>`,
      (_, node) => {
        selectedDay = 0;
        view = "plan";
        commit(imported, { restore: true });
        node.close();
        notify("Đã khôi phục bản sao.");
      },
    );
  } catch (error) {
    notify(
      "Không nhập dữ liệu: " +
        (error.message ||
          "File không hợp lệ. Dữ liệu hiện tại vẫn giữ nguyên."),
    );
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#toast").addEventListener("click", (event) => {
  if (event.target.closest('[data-action="undo"]') && undoAction) {
    const callback = undoAction;
    undoAction = undefined;
    try {
      callback();
      notify("Đã hoàn tác.");
    } catch (error) {
      notify("Không thể hoàn tác: " + error.message);
    }
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    sidebarOpen &&
    !document.querySelector("dialog[open]")
  ) {
    sidebarOpen = false;
    render();
  }
});
render();
