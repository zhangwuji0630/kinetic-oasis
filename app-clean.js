const STORAGE_KEYS = {
  records: "kinetic-oasis:records:v2",
  settings: "kinetic-oasis:settings:v2",
};

const DEFAULT_SETTINGS = {
  vehicleName: "Kinetic Oasis",
  tankCapacity: 55,
  preferredFuelType: "95# \u6c7d\u6cb9",
};

const FUEL_TYPES = ["92# \u6c7d\u6cb9", "95# \u6c7d\u6cb9", "98# \u6c7d\u6cb9", "\u67f4\u6cb9"];
const FLASH_MESSAGES = {
  saved: "\u8bb0\u5f55\u5df2\u4fdd\u5b58",
  updated: "\u8bb0\u5f55\u5df2\u66f4\u65b0",
  deleted: "\u8bb0\u5f55\u5df2\u5220\u9664",
};
const UNKNOWN_STATION = "\u672a\u586b\u5199\u6cb9\u7ad9";

let deferredInstallPrompt = null;

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const createId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function getToday(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function normalizeRecord(raw = {}) {
  const liters = asNumber(raw.liters);
  const unitPrice = asNumber(raw.unitPrice ?? raw.price);
  const totalCost = asNumber(raw.totalCost || liters * unitPrice);
  const createdAt = raw.createdAt || raw.savedAt || new Date().toISOString();
  const updatedAt = raw.updatedAt || raw.savedAt || createdAt;

  return {
    id: raw.id || createId(),
    date: String(raw.date || getToday()),
    liters,
    unitPrice,
    totalCost: Number(totalCost.toFixed(2)),
    odometer: asNumber(raw.odometer),
    fuelType: String(raw.fuelType || DEFAULT_SETTINGS.preferredFuelType),
    station: String(raw.station || "").trim(),
    note: String(raw.note || "").trim(),
    isFullTank: Boolean(raw.isFullTank),
    createdAt,
    updatedAt,
  };
}

function compareDesc(a, b) {
  if (a.date !== b.date) {
    return b.date.localeCompare(a.date);
  }
  return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
}

function compareChrono(a, b) {
  if (a.date !== b.date) {
    return a.date.localeCompare(b.date);
  }
  return String(a.createdAt || a.updatedAt || "").localeCompare(String(b.createdAt || b.updatedAt || ""));
}

function compareMileage(a, b) {
  if (a.odometer !== b.odometer) {
    return a.odometer - b.odometer;
  }
  return compareChrono(a, b);
}

function loadRecords() {
  return readJson(STORAGE_KEYS.records, []).map(normalizeRecord).sort(compareDesc);
}

function saveRecords(records) {
  writeJson(
    STORAGE_KEYS.records,
    records.map(normalizeRecord).sort(compareDesc)
  );
}

function loadSettings() {
  const stored = readJson(STORAGE_KEYS.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    tankCapacity: Math.max(10, Math.min(120, asNumber(stored.tankCapacity || DEFAULT_SETTINGS.tankCapacity))),
  };
}

function saveSettings(settings) {
  writeJson(STORAGE_KEYS.settings, settings);
}

function monthKey(value) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonthKey(value) {
  const [yearText, monthText] = value.split("-");
  const date = new Date(Number(yearText), Number(monthText) - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value) {
  const [yearText, monthText] = value.split("-");
  return `${yearText}\u5e74${monthText}\u6708`;
}

function formatDate(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(`${value}T00:00:00`));
}

function formatDateShort(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(asNumber(value));
}

const formatMoney = (value) => `\u00a5 ${formatNumber(value, 2)}`;
const formatLiters = (value) => `${formatNumber(value, 2)} L`;
const formatDistance = (value) => `${formatNumber(value, 0)} km`;
const formatUnitPrice = (value) => `\u00a5 ${formatNumber(value, 2)}/L`;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setNotice(element, message, tone = "") {
  if (!element) return;
  element.hidden = !message;
  element.textContent = message;
  element.className = element.classList.contains("form-message") ? "form-message" : "notice-banner";
  if (tone) element.classList.add(tone);
}

function getFlashMessage() {
  const params = new URLSearchParams(window.location.search);
  const flashKey = params.get("flash");
  if (!flashKey || !FLASH_MESSAGES[flashKey]) return "";
  if (window.history.replaceState) window.history.replaceState({}, "", window.location.pathname);
  return FLASH_MESSAGES[flashKey];
}

function getNeighbors(records, recordId) {
  const ordered = [...records].sort(compareChrono);
  const index = ordered.findIndex((record) => record.id === recordId);
  return {
    previous: index > 0 ? ordered[index - 1] : null,
    next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null,
  };
}

function validateOdometer(records, candidateRecord) {
  const { previous, next } = getNeighbors(records, candidateRecord.id);
  if (previous && candidateRecord.odometer < previous.odometer) {
    return `\u5f53\u524d\u91cc\u7a0b\u4e0d\u80fd\u5c0f\u4e8e\u4e0a\u4e00\u6761\u8bb0\u5f55\uff08${formatDate(previous.date)}\uff0c${formatDistance(previous.odometer)}\uff09`;
  }
  if (next && candidateRecord.odometer > next.odometer) {
    return `\u5f53\u524d\u91cc\u7a0b\u4e0d\u80fd\u5927\u4e8e\u4e0b\u4e00\u6761\u8bb0\u5f55\uff08${formatDate(next.date)}\uff0c${formatDistance(next.odometer)}\uff09`;
  }
  return "";
}

function sampleRecords() {
  return [
    { date: getToday(-90), liters: 43.2, unitPrice: 7.58, odometer: 11820, fuelType: "95# \u6c7d\u6cb9", station: "\u4e2d\u77f3\u5316 \u79d1\u6280\u56ed\u7ad9", isFullTank: true },
    { date: getToday(-68), liters: 39.5, unitPrice: 7.52, odometer: 12195, fuelType: "95# \u6c7d\u6cb9", station: "\u4e2d\u77f3\u5316 \u6ee8\u6c5f\u7ad9", isFullTank: false },
    { date: getToday(-49), liters: 45.8, unitPrice: 7.55, odometer: 12590, fuelType: "95# \u6c7d\u6cb9", station: "\u4e2d\u77f3\u5316 \u79d1\u6280\u56ed\u7ad9", isFullTank: true },
    { date: getToday(-34), liters: 37.6, unitPrice: 7.63, odometer: 12940, fuelType: "95# \u6c7d\u6cb9", station: "\u4e2d\u77f3\u5316 \u4e16\u7eaa\u5927\u9053\u7ad9", isFullTank: false },
    { date: getToday(-22), liters: 44.9, unitPrice: 7.58, odometer: 13330, fuelType: "95# \u6c7d\u6cb9", station: "\u4e2d\u77f3\u5316 \u79d1\u6280\u56ed\u7ad9", isFullTank: true },
    { date: getToday(-13), liters: 41.3, unitPrice: 7.61, odometer: 13670, fuelType: "95# \u6c7d\u6cb9", station: "\u4e2d\u77f3\u5316 \u6ee8\u6c5f\u7ad9", isFullTank: false },
    { date: getToday(-6), liters: 46.1, unitPrice: 7.66, odometer: 14080, fuelType: "95# \u6c7d\u6cb9", station: "\u4e2d\u77f3\u5316 \u56fd\u9645\u6e2f\u7ad9", isFullTank: true },
    { date: getToday(-2), liters: 38.8, unitPrice: 7.62, odometer: 14410, fuelType: "95# \u6c7d\u6cb9", station: "\u4e2d\u77f3\u5316 \u8679\u6865\u7ad9", isFullTank: false },
  ].map(normalizeRecord);
}

function loadSampleData() {
  if (loadRecords().length && !window.confirm("\u52a0\u8f7d\u793a\u4f8b\u6570\u636e\u4f1a\u8986\u76d6\u5f53\u524d\u8bb0\u5f55\uff0c\u786e\u5b9a\u7ee7\u7eed\uff1f")) return false;
  saveRecords(sampleRecords());
  saveSettings({ ...loadSettings(), preferredFuelType: "95# \u6c7d\u6cb9" });
  return true;
}

function clearAllData() {
  localStorage.removeItem(STORAGE_KEYS.records);
  localStorage.removeItem(STORAGE_KEYS.settings);
}

function buildEfficiencySeries(records) {
  const ordered = [...records].filter((record) => record.odometer > 0 && record.liters > 0).sort(compareMileage);
  const series = [];
  let anchor = null;
  let liters = 0;

  ordered.forEach((record) => {
    if (!anchor) {
      if (record.isFullTank) anchor = record;
      return;
    }
    if (record.odometer <= anchor.odometer) {
      if (record.isFullTank) {
        anchor = record;
        liters = 0;
      }
      return;
    }
    liters += record.liters;
    if (!record.isFullTank) return;
    const distance = record.odometer - anchor.odometer;
    const value = distance > 0 ? (liters * 100) / distance : 0;
    if (value > 1 && value < 30) series.push({ date: record.date, value, distance, liters });
    anchor = record;
    liters = 0;
  });

  return series;
}
function summarize(records, efficiencySeries) {
  const totalSpend = records.reduce((sum, record) => sum + record.totalCost, 0);
  const totalLiters = records.reduce((sum, record) => sum + record.liters, 0);
  const distances = records.map((record) => record.odometer).filter((value) => value > 0);
  const distanceCoverage = distances.length > 1 ? Math.max(...distances) - Math.min(...distances) : 0;
  return {
    count: records.length,
    totalSpend,
    totalLiters,
    distanceCoverage,
    avgPrice: totalLiters ? totalSpend / totalLiters : 0,
    avgLiters: records.length ? totalLiters / records.length : 0,
    avgEfficiency: efficiencySeries.length ? efficiencySeries.reduce((sum, item) => sum + item.value, 0) / efficiencySeries.length : 0,
  };
}

function buildMonthTrend(records) {
  const now = new Date();
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const items = records.filter((record) => monthKey(record.date) === key);
    return { key, label: `${date.getMonth() + 1}\u6708`, value: items.reduce((sum, record) => sum + record.totalCost, 0) };
  });
}

function buildPriceTrend(records) {
  return [...records].slice(0, 7).reverse().map((record) => ({ label: formatDateShort(record.date), value: record.unitPrice }));
}

function buildStationAggregates(records) {
  const map = new Map();
  records.forEach((record) => {
    const key = record.station || UNKNOWN_STATION;
    const current = map.get(key) || { name: key, visits: 0, totalSpend: 0, totalLiters: 0, lastDate: "", fuelTypes: new Set(), records: [] };
    current.visits += 1;
    current.totalSpend += record.totalCost;
    current.totalLiters += record.liters;
    current.lastDate = current.lastDate > record.date ? current.lastDate : record.date;
    current.fuelTypes.add(record.fuelType);
    current.records.push(record);
    map.set(key, current);
  });
  return [...map.values()]
    .map((entry) => ({ ...entry, avgPrice: entry.totalLiters ? entry.totalSpend / entry.totalLiters : 0, fuelTypes: [...entry.fuelTypes], records: entry.records.sort(compareDesc) }))
    .sort((a, b) => (a.visits === b.visits ? b.totalSpend - a.totalSpend : b.visits - a.visits));
}

function deriveData(records) {
  const current = monthKey(getToday());
  const previous = previousMonthKey(current);
  const efficiencySeries = buildEfficiencySeries(records);
  const monthlyRecords = records.filter((record) => monthKey(record.date) === current);
  const previousRecords = records.filter((record) => monthKey(record.date) === previous);
  const monthlyEfficiency = efficiencySeries.filter((item) => monthKey(item.date) === current);
  const previousEfficiency = efficiencySeries.filter((item) => monthKey(item.date) === previous);
  const stations = buildStationAggregates(records);
  return {
    monthly: summarize(monthlyRecords, monthlyEfficiency),
    previousMonthly: summarize(previousRecords, previousEfficiency),
    monthTrend: buildMonthTrend(records),
    priceTrend: buildPriceTrend(records),
    recentRecords: records.slice(0, 5),
    stationAggregates: stations,
    mostVisitedStation: stations[0] || null,
    cheapestStation: [...stations].filter((item) => item.name !== UNKNOWN_STATION && item.totalLiters > 0).sort((a, b) => a.avgPrice - b.avgPrice)[0] || null,
    highestCost: [...records].sort((a, b) => b.totalCost - a.totalCost)[0] || null,
    largestFill: [...records].sort((a, b) => b.liters - a.liters)[0] || null,
    latestFullTank: records.find((record) => record.isFullTank) || null,
  };
}

function deltaLabel(currentValue, previousValue) {
  if (!currentValue || !previousValue) return "\u6570\u636e\u4e0d\u8db3";
  const diff = ((currentValue - previousValue) / previousValue) * 100;
  if (Math.abs(diff) < 1) return "\u57fa\u672c\u6301\u5e73";
  return diff < 0 ? `\u4e0b\u964d ${Math.abs(diff).toFixed(0)}%` : `\u4e0a\u5347 ${Math.abs(diff).toFixed(0)}%`;
}

function renderEmptyState(title) {
  return `
    <div class="empty-state">
      <p class="empty-title">${escapeHtml(title)}</p>
      <div class="inline-actions">
        <a class="button" href="./add.html">\u65b0\u589e\u8bb0\u5f55</a>
        <button class="button-secondary" type="button" data-action="load-sample">\u52a0\u8f7d\u793a\u4f8b</button>
      </div>
    </div>
  `;
}

function renderRecordCard(record, options = {}) {
  const compact = Boolean(options.compact);
  const showDelete = Boolean(options.showDelete);
  const showActions = showDelete || !compact;
  const station = record.station || UNKNOWN_STATION;
  return `
    <article class="record-card${compact ? " compact" : ""}">
      <div class="record-top">
        <p class="record-station">${escapeHtml(station)}</p>
        <div class="record-amount">${escapeHtml(formatMoney(record.totalCost))}</div>
      </div>
      <div class="tag-row">
        <span class="tag">${escapeHtml(formatDate(record.date))}</span>
        <span class="tag">${escapeHtml(record.fuelType)}</span>
        <span class="tag">${record.isFullTank ? "\u6ee1\u7bb1" : "\u8865\u6cb9"}</span>
      </div>
      <div class="tag-row">
        <span class="tag">${escapeHtml(formatLiters(record.liters))}</span>
        <span class="tag">${escapeHtml(formatUnitPrice(record.unitPrice))}</span>
        <span class="tag">${escapeHtml(formatDistance(record.odometer))}</span>
      </div>
      ${showActions ? `<div class="record-actions"><a class="button-link" href="./add.html?id=${encodeURIComponent(record.id)}">\u7f16\u8f91</a>${showDelete ? `<button class="button-link danger" type="button" data-delete-id="${escapeHtml(record.id)}">\u5220\u9664</button>` : ""}</div>` : ""}
    </article>
  `;
}

function renderChart(container, series, formatter, accentIndex = -1) {
  if (!container) return;
  if (!series.length || series.every((item) => !item.value)) {
    container.innerHTML = renderEmptyState("\u6682\u65e0\u56fe\u8868\u6570\u636e");
    return;
  }
  const maxValue = Math.max(...series.map((item) => item.value), 1);
  container.innerHTML = `
    <div class="chart-grid">
      ${series.map((item, index) => {
        const height = Math.max(12, (item.value / maxValue) * 100);
        return `<div class="chart-column"><div class="chart-value">${escapeHtml(formatter(item.value))}</div><div class="chart-track"><div class="chart-bar${index === accentIndex ? " is-accent" : ""}" style="height:${height}%"></div></div><div class="chart-label">${escapeHtml(item.label)}</div></div>`;
      }).join("")}
    </div>
  `;
}

function markActiveNavigation() {
  const active = document.body.dataset.navGroup || document.body.dataset.page;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const isActive = link.dataset.nav === active;
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
}

function refreshInstallPanel(message = "") {
  const status = document.getElementById("installStatus");
  const button = document.getElementById("installButton");
  if (!status || !button) return;
  if (isStandalone()) {
    status.textContent = "\u5df2\u5b89\u88c5";
    button.hidden = true;
    return;
  }
  if (message) status.textContent = message;
  else if (deferredInstallPrompt) status.textContent = "\u53ef\u5b89\u88c5";
  else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) status.textContent = "Safari \u6dfb\u52a0\u5230\u4e3b\u5c4f\u5e55";
  else status.textContent = "\u6682\u65e0\u5b89\u88c5\u5165\u53e3";
  button.textContent = "\u5b89\u88c5\u5e94\u7528";
  button.hidden = !deferredInstallPrompt;
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    refreshInstallPanel();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    refreshInstallPanel("\u5df2\u5b89\u88c5");
  });
}

async function handleInstallClick() {
  if (!deferredInstallPrompt) {
    refreshInstallPanel();
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  refreshInstallPanel("\u5b89\u88c5\u4e2d");
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toCsv(records) {
  const header = ["id", "date", "liters", "unitPrice", "totalCost", "odometer", "fuelType", "station", "isFullTank", "note", "createdAt", "updatedAt"];
  const rows = records.map((record) => header.map((key) => {
    const text = String(record[key] ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }));
  return [header, ...rows].map((row) => row.join(",")).join("\r\n");
}
function initDashboardPage() {
  const records = loadRecords();
  const settings = loadSettings();
  const data = deriveData(records);
  setText("dashboardVehicleName", settings.vehicleName);
  setText("dashboardEfficiency", data.monthly.avgEfficiency ? formatNumber(data.monthly.avgEfficiency, 1) : "--");
  setText("dashboardEfficiencyDelta", deltaLabel(data.monthly.avgEfficiency, data.previousMonthly.avgEfficiency));
  setText("dashboardMonthlySpend", formatMoney(data.monthly.totalSpend));
  setText("dashboardMonthlyCount", `${data.monthly.count} \u6b21`);
  setText("dashboardMonthlyLiters", formatLiters(data.monthly.totalLiters));
  setText("dashboardMonthlyDistance", formatDistance(data.monthly.distanceCoverage));

  const recent = document.getElementById("dashboardRecentRecords");
  if (recent) {
    recent.innerHTML = data.recentRecords.length ? data.recentRecords.slice(0, 3).map((record) => renderRecordCard(record, { compact: true })).join("") : renderEmptyState("\u6682\u65e0\u8bb0\u5f55");
  }

  const spotlight = document.getElementById("dashboardStationSpotlight");
  if (spotlight) {
    spotlight.innerHTML = data.mostVisitedStation
      ? `<div class="section-head"><h3>${escapeHtml(data.mostVisitedStation.name)}</h3><a class="text-link" href="./stations.html">\u5168\u90e8</a></div><div class="tag-row"><span class="tag">${data.mostVisitedStation.visits} \u6b21</span><span class="tag">${formatUnitPrice(data.mostVisitedStation.avgPrice)}</span><span class="tag">${formatDateShort(data.mostVisitedStation.lastDate)}</span></div>`
      : renderEmptyState("\u6682\u65e0\u6cb9\u7ad9");
  }
}

function initLogsPage() {
  const monthFilter = document.getElementById("logsMonthFilter");
  const fuelFilter = document.getElementById("logsFuelFilter");
  const stationFilter = document.getElementById("logsStationFilter");
  const searchInput = document.getElementById("logsSearch");
  const list = document.getElementById("logsList");
  const records = loadRecords();
  const months = [...new Set(records.map((record) => monthKey(record.date)))];
  const currentMonth = monthKey(getToday());

  if (monthFilter) {
    monthFilter.innerHTML = [`<option value="all">\u5168\u90e8\u6708\u4efd</option>`, ...months.map((item) => `<option value="${item}">${monthLabel(item)}</option>`)].join("");
    monthFilter.value = months.includes(currentMonth) ? currentMonth : "all";
  }
  if (fuelFilter) {
    fuelFilter.innerHTML = [`<option value="all">\u5168\u90e8\u6cb9\u54c1</option>`, ...FUEL_TYPES.map((item) => `<option value="${item}">${item}</option>`)].join("");
  }
  if (stationFilter) {
    const stations = [...new Set(records.map((record) => record.station || UNKNOWN_STATION))];
    stationFilter.innerHTML = [`<option value="all">\u5168\u90e8\u6cb9\u7ad9</option>`, ...stations.map((item) => `<option value="${item}">${item}</option>`)].join("");
  }

  function render() {
    const filtered = loadRecords().filter((record) => {
      const station = record.station || UNKNOWN_STATION;
      const keyword = (searchInput?.value || "").trim().toLowerCase();
      if (monthFilter && monthFilter.value !== "all" && monthKey(record.date) !== monthFilter.value) return false;
      if (fuelFilter && fuelFilter.value !== "all" && record.fuelType !== fuelFilter.value) return false;
      if (stationFilter && stationFilter.value !== "all" && station !== stationFilter.value) return false;
      if (!keyword) return true;
      return [record.date, record.fuelType, record.station, record.note].join(" ").toLowerCase().includes(keyword);
    });

    const summary = summarize(filtered, buildEfficiencySeries(filtered));
    setText("logsFilteredSpend", formatMoney(summary.totalSpend));
    setText("logsFilteredCount", `${summary.count} \u6761`);
    setText("logsFilteredLiters", formatLiters(summary.totalLiters));
    if (list) {
      list.innerHTML = filtered.length ? filtered.map((record) => renderRecordCard(record, { showDelete: true })).join("") : renderEmptyState("\u6682\u65e0\u5339\u914d\u8bb0\u5f55");
    }
  }

  [monthFilter, fuelFilter, stationFilter, searchInput].forEach((element) => {
    if (!element) return;
    element.addEventListener("input", render);
    element.addEventListener("change", render);
  });

  list?.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-delete-id]");
    if (!trigger) return;
    const recordId = trigger.dataset.deleteId;
    const target = loadRecords().find((record) => record.id === recordId);
    if (!target) return;
    if (!window.confirm(`\u786e\u5b9a\u5220\u9664 ${target.station || "\u8fd9\u6761\u8bb0\u5f55"}\uff1f`)) return;
    saveRecords(loadRecords().filter((record) => record.id !== recordId));
    render();
  });

  render();
}

function initAddPage() {
  const settings = loadSettings();
  const params = new URLSearchParams(window.location.search);
  const editingId = params.get("id");
  const editingRecord = loadRecords().find((record) => record.id === editingId) || null;
  const form = document.getElementById("fuelForm");
  const message = document.getElementById("addFormMessage");
  const totalAmount = document.getElementById("addTotalAmount");
  const fuelTypeGroup = document.getElementById("fuelTypeGroup");
  const deleteWrap = document.getElementById("deleteRecordWrap");
  const deleteButton = document.getElementById("deleteRecordButton");

  const fields = {
    date: document.getElementById("recordDate"),
    liters: document.getElementById("recordLiters"),
    unitPrice: document.getElementById("recordUnitPrice"),
    odometer: document.getElementById("recordOdometer"),
    station: document.getElementById("recordStation"),
    note: document.getElementById("recordNote"),
    isFullTank: document.getElementById("recordFullTank"),
  };

  let selectedFuelType = editingRecord?.fuelType || settings.preferredFuelType;
  const current = editingRecord || { date: getToday(), liters: "", unitPrice: "", odometer: "", station: "", note: "", isFullTank: true };

  setText("addPageHeading", editingRecord ? "\u7f16\u8f91\u52a0\u6cb9\u8bb0\u5f55" : "\u6dfb\u52a0\u52a0\u6cb9\u8bb0\u5f55");
  if (fields.date) fields.date.value = current.date || getToday();
  if (fields.liters) fields.liters.value = current.liters || "";
  if (fields.unitPrice) fields.unitPrice.value = current.unitPrice || "";
  if (fields.odometer) fields.odometer.value = current.odometer || "";
  if (fields.station) fields.station.value = current.station || "";
  if (fields.note) fields.note.value = current.note || "";
  if (fields.isFullTank) fields.isFullTank.checked = Boolean(current.isFullTank);
  if (deleteWrap) deleteWrap.hidden = !editingRecord;

  function renderFuelType() {
    fuelTypeGroup?.querySelectorAll("[data-fuel-type]").forEach((button) => {
      const active = button.dataset.fuelType === selectedFuelType;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateTotal() {
    const liters = asNumber(fields.liters?.value);
    const unitPrice = asNumber(fields.unitPrice?.value);
    if (totalAmount) totalAmount.textContent = formatNumber(liters * unitPrice, 2);
  }

  function draftRecord() {
    return normalizeRecord({
      ...(editingRecord || {}),
      date: fields.date?.value || getToday(),
      liters: asNumber(fields.liters?.value),
      unitPrice: asNumber(fields.unitPrice?.value),
      odometer: asNumber(fields.odometer?.value),
      station: fields.station?.value || "",
      note: fields.note?.value || "",
      fuelType: selectedFuelType,
      isFullTank: Boolean(fields.isFullTank?.checked),
      updatedAt: new Date().toISOString(),
    });
  }

  function validate(record, records) {
    if (!record.date || !record.liters || !record.unitPrice || !record.odometer) return "\u8bf7\u5b8c\u6574\u586b\u5199\u65e5\u671f\u3001\u52a0\u6cb9\u91cf\u3001\u5355\u4ef7\u548c\u91cc\u7a0b";
    const maxLiters = Math.max(settings.tankCapacity * 1.15, settings.tankCapacity + 8);
    if (record.liters > maxLiters) return `\u52a0\u6cb9\u91cf\u5df2\u8d85\u8fc7\u6cb9\u7bb1\u8bbe\u5b9a\uff08${formatNumber(settings.tankCapacity, 0)}L\uff09`;
    return validateOdometer(records, record);
  }

  fuelTypeGroup?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-fuel-type]");
    if (!button) return;
    selectedFuelType = button.dataset.fuelType;
    renderFuelType();
  });

  [fields.liters, fields.unitPrice].forEach((element) => {
    element?.addEventListener("input", updateTotal);
    element?.addEventListener("change", updateTotal);
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const record = draftRecord();
    const nextRecords = editingRecord ? loadRecords().map((item) => (item.id === editingRecord.id ? record : item)) : [record, ...loadRecords()];
    const error = validate(record, nextRecords);
    if (error) {
      setNotice(message, error, "error");
      return;
    }
    saveRecords(nextRecords);
    window.location.href = editingRecord ? "./logs.html?flash=updated" : "./logs.html?flash=saved";
  });

  deleteButton?.addEventListener("click", () => {
    if (!editingRecord) return;
    if (!window.confirm("\u786e\u5b9a\u5220\u9664\u5f53\u524d\u8bb0\u5f55\uff1f")) return;
    saveRecords(loadRecords().filter((record) => record.id !== editingRecord.id));
    window.location.href = "./logs.html?flash=deleted";
  });

  renderFuelType();
  updateTotal();
}
function initStatsPage() {
  const data = deriveData(loadRecords());
  setText("statsEfficiency", data.monthly.avgEfficiency ? formatNumber(data.monthly.avgEfficiency, 1) : "--");
  setText("statsTrendChip", deltaLabel(data.monthly.avgEfficiency, data.previousMonthly.avgEfficiency));
  setText("statsMonthlySpend", formatMoney(data.monthly.totalSpend));
  setText("statsMonthlyCount", `${data.monthly.count} \u6b21`);
  setText("statsAveragePrice", data.monthly.avgPrice ? formatUnitPrice(data.monthly.avgPrice) : "--");
  setText("statsAverageLiters", data.monthly.avgLiters ? formatLiters(data.monthly.avgLiters) : "--");
  renderChart(document.getElementById("statsSpendChart"), data.monthTrend, (value) => `\u00a5${formatNumber(value, 0)}`, data.monthTrend.length - 1);
  renderChart(document.getElementById("statsPriceChart"), data.priceTrend, (value) => formatNumber(value, 2), data.priceTrend.length - 1);

  const insights = document.getElementById("statsInsights");
  if (!insights) return;
  const cards = [];
  if (data.highestCost) cards.push(`<article class="insight-card"><div class="insight-head"><p class="insight-name">\u5355\u6b21\u6700\u9ad8\u652f\u51fa</p><span class="pill">${formatDateShort(data.highestCost.date)}</span></div><div class="insight-body"><span class="insight-value">${formatMoney(data.highestCost.totalCost)}</span><span class="pill">${escapeHtml(data.highestCost.station || UNKNOWN_STATION)}</span></div></article>`);
  if (data.cheapestStation) cards.push(`<article class="insight-card"><div class="insight-head"><p class="insight-name">\u6700\u4f4e\u5747\u4ef7\u6cb9\u7ad9</p><span class="pill">${data.cheapestStation.visits} \u6b21</span></div><div class="insight-body"><span class="insight-value">${formatUnitPrice(data.cheapestStation.avgPrice)}</span><span class="pill">${escapeHtml(data.cheapestStation.name)}</span></div></article>`);
  if (data.largestFill) cards.push(`<article class="insight-card"><div class="insight-head"><p class="insight-name">\u5355\u6b21\u6700\u5927\u6cb9\u91cf</p><span class="pill">${escapeHtml(data.largestFill.fuelType)}</span></div><div class="insight-body"><span class="insight-value">${formatLiters(data.largestFill.liters)}</span><span class="pill">${formatDateShort(data.largestFill.date)}</span></div></article>`);
  if (data.latestFullTank) cards.push(`<article class="insight-card"><div class="insight-head"><p class="insight-name">\u6700\u8fd1\u6ee1\u7bb1</p><span class="pill">${formatDateShort(data.latestFullTank.date)}</span></div><div class="insight-body"><span class="insight-value">${formatMoney(data.latestFullTank.totalCost)}</span><span class="pill">${escapeHtml(data.latestFullTank.station || UNKNOWN_STATION)}</span></div></article>`);
  insights.innerHTML = cards.length ? cards.join("") : renderEmptyState("\u6682\u65e0\u6d1e\u5bdf");
}

function initStationsPage() {
  const data = deriveData(loadRecords());
  const searchInput = document.getElementById("stationSearch");
  const list = document.getElementById("stationsList");
  setText("stationsUniqueCount", `${data.stationAggregates.length} \u4e2a`);
  setText("stationsMostVisited", data.mostVisitedStation ? data.mostVisitedStation.name : "\u6682\u65e0");
  setText("stationsBestPrice", data.cheapestStation ? formatUnitPrice(data.cheapestStation.avgPrice) : "--");

  function render() {
    const keyword = (searchInput?.value || "").trim().toLowerCase();
    const filtered = data.stationAggregates.filter((station) => station.name.toLowerCase().includes(keyword));
    if (!list) return;
    list.innerHTML = filtered.length
      ? filtered.map((station) => `<article class="station-card"><div class="station-head"><p class="station-name">${escapeHtml(station.name)}</p><span class="status-badge">${station.visits} \u6b21</span></div><div class="tag-row"><span class="tag">${formatDate(station.lastDate)}</span>${station.fuelTypes.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div><div class="tag-row"><span class="tag">\u603b ${formatMoney(station.totalSpend)}</span><span class="tag">\u5747 ${formatUnitPrice(station.avgPrice)}</span><span class="tag">\u6cb9 ${formatLiters(station.totalLiters)}</span><span class="tag">\u8fd1 ${formatMoney(station.records[0].totalCost)}</span></div><div class="visit-list">${station.records.slice(0, 3).map((record) => `<div class="visit-item"><strong>${escapeHtml(formatDateShort(record.date))}</strong><span class="status-badge">${escapeHtml(formatMoney(record.totalCost))}</span></div>`).join("")}</div></article>`).join("")
      : renderEmptyState("\u6682\u65e0\u5339\u914d\u6cb9\u7ad9");
  }

  searchInput?.addEventListener("input", render);
  render();
}

function initSettingsPage() {
  const form = document.getElementById("settingsForm");
  const vehicleName = document.getElementById("vehicleName");
  const tankCapacity = document.getElementById("tankCapacity");
  const preferredFuelType = document.getElementById("preferredFuelType");
  const message = document.getElementById("settingsMessage");
  const installButton = document.getElementById("installButton");
  const exportCsvButton = document.getElementById("exportCsvButton");
  const exportJsonButton = document.getElementById("exportJsonButton");
  const importJsonButton = document.getElementById("importJsonButton");
  const importJsonInput = document.getElementById("importJsonInput");
  const clearDataButton = document.getElementById("clearDataButton");
  const loadSampleButton = document.getElementById("loadSampleButton");

  function refresh() {
    const settings = loadSettings();
    const records = loadRecords();
    const stations = buildStationAggregates(records);
    if (vehicleName) vehicleName.value = settings.vehicleName;
    if (tankCapacity) tankCapacity.value = settings.tankCapacity;
    if (preferredFuelType) {
      preferredFuelType.innerHTML = FUEL_TYPES.map((item) => `<option value="${item}">${item}</option>`).join("");
      preferredFuelType.value = settings.preferredFuelType;
    }
    setText("settingsRecordCount", `${records.length} \u6761`);
    setText("settingsStationCount", `${stations.length} \u4e2a`);
    setText("settingsLatestSync", records[0] ? formatDateTime(records[0].updatedAt || records[0].createdAt) : "--");
    refreshInstallPanel();
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSettings({ vehicleName: vehicleName?.value.trim() || DEFAULT_SETTINGS.vehicleName, tankCapacity: Math.max(10, Math.min(120, asNumber(tankCapacity?.value) || DEFAULT_SETTINGS.tankCapacity)), preferredFuelType: preferredFuelType?.value || DEFAULT_SETTINGS.preferredFuelType });
    setNotice(message, "\u8bbe\u7f6e\u5df2\u4fdd\u5b58", "success");
    refresh();
  });

  installButton?.addEventListener("click", handleInstallClick);
  exportCsvButton?.addEventListener("click", () => {
    downloadFile("kinetic-oasis-records.csv", toCsv(loadRecords()), "text/csv;charset=utf-8");
    setNotice(message, "CSV \u5df2\u5bfc\u51fa", "success");
  });
  exportJsonButton?.addEventListener("click", () => {
    downloadFile("kinetic-oasis-backup.json", JSON.stringify({ exportedAt: new Date().toISOString(), settings: loadSettings(), records: loadRecords() }, null, 2), "application/json;charset=utf-8");
    setNotice(message, "JSON \u5df2\u5bfc\u51fa", "success");
  });
  importJsonButton?.addEventListener("click", () => importJsonInput?.click());
  importJsonInput?.addEventListener("change", async () => {
    const file = importJsonInput.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      saveRecords(Array.isArray(payload.records) ? payload.records.map(normalizeRecord) : []);
      saveSettings({ ...loadSettings(), ...(payload.settings || {}) });
      setNotice(message, "\u6570\u636e\u5df2\u5bfc\u5165\uff0c\u9875\u9762\u5373\u5c06\u5237\u65b0", "success");
      setTimeout(() => window.location.reload(), 500);
    } catch {
      setNotice(message, "\u5bfc\u5165\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 JSON \u6587\u4ef6", "error");
    } finally {
      importJsonInput.value = "";
    }
  });
  clearDataButton?.addEventListener("click", () => {
    if (!window.confirm("\u786e\u5b9a\u6e05\u7a7a\u5168\u90e8\u6570\u636e\uff1f")) return;
    clearAllData();
    setNotice(message, "\u672c\u5730\u6570\u636e\u5df2\u6e05\u7a7a", "success");
    setTimeout(() => window.location.reload(), 500);
  });
  loadSampleButton?.addEventListener("click", () => {
    if (!loadSampleData()) return;
    setNotice(message, "\u793a\u4f8b\u6570\u636e\u5df2\u52a0\u8f7d", "success");
    setTimeout(() => window.location.reload(), 500);
  });

  refresh();
}

function setupGlobalEvents() {
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-action='load-sample']");
    if (!trigger) return;
    event.preventDefault();
    if (loadSampleData()) window.location.reload();
  });
}

function initPage() {
  registerServiceWorker();
  setupInstallPrompt();
  setupGlobalEvents();
  markActiveNavigation();
  const flash = getFlashMessage();
  const pageFlash = document.getElementById("pageFlash");
  if (flash && pageFlash) setNotice(pageFlash, flash, "success");

  switch (document.body.dataset.page) {
    case "dashboard":
      initDashboardPage();
      break;
    case "logs":
      initLogsPage();
      break;
    case "add":
      initAddPage();
      break;
    case "stats":
      initStatsPage();
      break;
    case "stations":
      initStationsPage();
      break;
    case "settings":
      initSettingsPage();
      break;
    default:
      break;
  }
}

initPage();
