const STORAGE_KEYS = {
  records: "kinetic-oasis:records:v2",
  settings: "kinetic-oasis:settings:v2",
  legacyRecord: "kinetic-oasis:last-record",
  legacyHistory: "kinetic-oasis:records",
};

const SERVICE_WORKER_URL = "./service-worker.js";

const DEFAULT_SETTINGS = {
  vehicleName: "Kinetic Oasis",
  tankCapacity: 55,
  preferredFuelType: "92# 汽油",
};

const FUEL_TYPES = ["92# 汽油", "95# 汽油", "98# 汽油", "柴油"];

const FLASH_MESSAGES = {
  saved: "记录已保存。",
  updated: "记录已更新。",
  deleted: "记录已删除。",
};

const UNKNOWN_STATION = "未填写油站";

let deferredInstallPrompt = null;

function safeRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function safeWrite(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

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
  const station = String(raw.station || "").trim();
  const note = String(raw.note || "").trim();
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
    station,
    isFullTank: Boolean(raw.isFullTank),
    note,
    createdAt,
    updatedAt,
  };
}

function compareRecordsDesc(left, right) {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }
  return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
}

function compareRecordsChronological(left, right) {
  if (left.date !== right.date) {
    return left.date.localeCompare(right.date);
  }

  const leftStamp = String(left.createdAt || left.updatedAt || "");
  const rightStamp = String(right.createdAt || right.updatedAt || "");
  if (leftStamp !== rightStamp) {
    return leftStamp.localeCompare(rightStamp);
  }

  return String(left.id || "").localeCompare(String(right.id || ""));
}

function compareRecordsMileage(left, right) {
  if (left.odometer !== right.odometer) {
    return left.odometer - right.odometer;
  }
  if (left.date !== right.date) {
    return left.date.localeCompare(right.date);
  }
  return compareRecordsChronological(left, right);
}

function getChronologicalNeighbors(records, recordId) {
  const ordered = [...records].sort(compareRecordsChronological);
  const index = ordered.findIndex((record) => record.id === recordId);

  return {
    previous: index > 0 ? ordered[index - 1] : null,
    next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null,
  };
}

function validateRecordOdometer(records, candidateRecord) {
  const { previous, next } = getChronologicalNeighbors(records, candidateRecord.id);

  if (previous && candidateRecord.odometer < previous.odometer) {
    return `当前里程不能小于上一条记录（${formatDate(previous.date)}，${formatDistance(previous.odometer)}）。`;
  }

  if (next && candidateRecord.odometer > next.odometer) {
    return `当前里程不能大于下一条记录（${formatDate(next.date)}，${formatDistance(next.odometer)}）。`;
  }

  return "";
}

function getMonthKey(value) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getPreviousMonthKey(value) {
  const [yearText, monthText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(value) {
  const [yearText, monthText] = value.split("-");
  return `${yearText}年${monthText}月`;
}

function formatDate(value) {
  if (!value) {
    return "未设置";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateShort(value) {
  if (!value) {
    return "--";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value) {
  if (!value) {
    return "尚无同步";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(asNumber(value));
}

function formatMoney(value) {
  return `¥ ${formatNumber(value, 2)}`;
}

function formatLiters(value) {
  return `${formatNumber(value, 2)} L`;
}

function formatDistance(value) {
  return `${formatNumber(value, 0)} km`;
}

function formatUnitPrice(value) {
  return `¥ ${formatNumber(value, 2)}/L`;
}

function formatEfficiency(value) {
  if (!value) {
    return "--";
  }
  return `${formatNumber(value, 1)} L/100km`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setElementText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function setNotice(element, message, tone = "") {
  if (!element) {
    return;
  }
  element.hidden = !message;
  element.textContent = message;
  element.className = element.classList.contains("form-message") ? "form-message" : "notice-banner";
  if (tone) {
    element.classList.add(tone);
  }
}

function getFlashMessage() {
  const params = new URLSearchParams(window.location.search);
  const flashKey = params.get("flash");
  if (!flashKey || !FLASH_MESSAGES[flashKey]) {
    return "";
  }
  if (window.history.replaceState) {
    window.history.replaceState({}, "", window.location.pathname);
  }
  return FLASH_MESSAGES[flashKey];
}

function loadSettings() {
  const stored = safeRead(STORAGE_KEYS.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    tankCapacity: Math.max(10, Math.min(120, asNumber(stored.tankCapacity || DEFAULT_SETTINGS.tankCapacity))),
  };
}

function saveSettings(settings) {
  safeWrite(STORAGE_KEYS.settings, settings);
}

function migrateLegacyData() {
  if (localStorage.getItem(STORAGE_KEYS.records)) {
    return;
  }

  const legacyRecords = safeRead(STORAGE_KEYS.legacyHistory, []);
  const legacyLatest = safeRead(STORAGE_KEYS.legacyRecord, null);
  const sourceList = [];

  if (Array.isArray(legacyRecords)) {
    sourceList.push(...legacyRecords);
  }
  if (legacyLatest) {
    sourceList.push(legacyLatest);
  }

  if (!sourceList.length) {
    return;
  }

  const dedupe = new Set();
  const migrated = sourceList
    .map((item) =>
      normalizeRecord({
        id: item.id,
        date: item.date,
        liters: item.liters,
        unitPrice: item.unitPrice ?? item.price,
        totalCost: item.totalCost,
        odometer: item.odometer,
        fuelType: item.fuelType,
        station: item.station,
        isFullTank: item.isFullTank,
        note: item.note,
        createdAt: item.createdAt || item.savedAt,
        updatedAt: item.updatedAt || item.savedAt,
      })
    )
    .filter((record) => {
      const signature = [
        record.date,
        record.odometer,
        record.liters,
        record.unitPrice,
        record.station,
      ].join("|");
      if (dedupe.has(signature)) {
        return false;
      }
      dedupe.add(signature);
      return true;
    })
    .sort(compareRecordsDesc);

  if (migrated.length) {
    saveRecords(migrated);
  }
}

function loadRecords() {
  migrateLegacyData();
  return safeRead(STORAGE_KEYS.records, []).map(normalizeRecord).sort(compareRecordsDesc);
}

function saveRecords(records) {
  safeWrite(
    STORAGE_KEYS.records,
    records.map(normalizeRecord).sort(compareRecordsDesc)
  );
}

function createSampleRecords() {
  return [
    {
      date: getToday(-90),
      liters: 44.2,
      unitPrice: 7.52,
      odometer: 11820,
      fuelType: "95# 汽油",
      station: "中国石化 科技园站",
      isFullTank: true,
      note: "高速前补能",
    },
    {
      date: getToday(-68),
      liters: 41.8,
      unitPrice: 7.48,
      odometer: 12195,
      fuelType: "95# 汽油",
      station: "壳牌 滨江路站",
      isFullTank: false,
      note: "通勤周补油",
    },
    {
      date: getToday(-49),
      liters: 46.5,
      unitPrice: 7.55,
      odometer: 12590,
      fuelType: "95# 汽油",
      station: "中国石油 虹桥站",
      isFullTank: true,
      note: "跨城往返",
    },
    {
      date: getToday(-34),
      liters: 38.9,
      unitPrice: 7.63,
      odometer: 12940,
      fuelType: "95# 汽油",
      station: "中国石化 科技园站",
      isFullTank: false,
      note: "下班顺路",
    },
    {
      date: getToday(-22),
      liters: 45.1,
      unitPrice: 7.58,
      odometer: 13330,
      fuelType: "95# 汽油",
      station: "中国石化 科技园站",
      isFullTank: true,
      note: "月底满油",
    },
    {
      date: getToday(-13),
      liters: 42.3,
      unitPrice: 7.61,
      odometer: 13670,
      fuelType: "95# 汽油",
      station: "壳牌 滨江路站",
      isFullTank: false,
      note: "周中补给",
    },
    {
      date: getToday(-6),
      liters: 47.4,
      unitPrice: 7.66,
      odometer: 14080,
      fuelType: "95# 汽油",
      station: "中化道达尔 国际港站",
      isFullTank: true,
      note: "长途前补满",
    },
    {
      date: getToday(-2),
      liters: 39.6,
      unitPrice: 7.62,
      odometer: 14410,
      fuelType: "95# 汽油",
      station: "中国石油 虹桥站",
      isFullTank: false,
      note: "周末城市巡航",
    },
  ].map((item) => normalizeRecord(item));
}

function loadSampleData() {
  const hasExistingRecords = loadRecords().length > 0;
  if (hasExistingRecords && !window.confirm("载入示例数据会覆盖当前本地记录，是否继续？")) {
    return false;
  }

  saveRecords(createSampleRecords());
  saveSettings({
    ...loadSettings(),
    preferredFuelType: "95# 汽油",
  });
  return true;
}

function clearAllData() {
  localStorage.removeItem(STORAGE_KEYS.records);
  localStorage.removeItem(STORAGE_KEYS.settings);
  localStorage.removeItem(STORAGE_KEYS.legacyRecord);
  localStorage.removeItem(STORAGE_KEYS.legacyHistory);
}

function buildEfficiencySeries(records) {
  const ordered = [...records]
    .filter((record) => record.odometer > 0 && record.liters > 0)
    .sort(compareRecordsMileage);
  const series = [];

  let anchorFullRecord = null;
  let accumulatedLiters = 0;
  let segmentCount = 0;

  ordered.forEach((record) => {
    if (!anchorFullRecord) {
      if (record.isFullTank) {
        anchorFullRecord = record;
      }
      return;
    }

    if (record.odometer <= anchorFullRecord.odometer) {
      if (record.isFullTank) {
        anchorFullRecord = record;
        accumulatedLiters = 0;
        segmentCount = 0;
      }
      return;
    }

    accumulatedLiters += record.liters;
    segmentCount += 1;

    if (!record.isFullTank) {
      return;
    }

    const distance = record.odometer - anchorFullRecord.odometer;
    const efficiency = distance > 0 ? (accumulatedLiters * 100) / distance : 0;

    if (efficiency > 1 && efficiency < 30) {
      series.push({
        id: record.id,
        date: record.date,
        value: efficiency,
        liters: accumulatedLiters,
        distance,
        segmentCount,
        fromId: anchorFullRecord.id,
        toId: record.id,
        fullTank: true,
      });
    }

    anchorFullRecord = record;
    accumulatedLiters = 0;
    segmentCount = 0;
  });

  return series;
}

function summarizeRecords(records, efficiencySeries) {
  const totalSpend = records.reduce((sum, record) => sum + record.totalCost, 0);
  const totalLiters = records.reduce((sum, record) => sum + record.liters, 0);
  const distanceValues = records.map((record) => record.odometer).filter((value) => value > 0);
  const distanceCoverage =
    distanceValues.length > 1 ? Math.max(...distanceValues) - Math.min(...distanceValues) : 0;
  const avgPrice = totalLiters > 0 ? totalSpend / totalLiters : 0;
  const avgLiters = records.length > 0 ? totalLiters / records.length : 0;
  const avgEfficiency =
    efficiencySeries.length > 0
      ? efficiencySeries.reduce((sum, entry) => sum + entry.value, 0) / efficiencySeries.length
      : 0;

  return {
    count: records.length,
    totalSpend,
    totalLiters,
    distanceCoverage,
    avgPrice,
    avgLiters,
    avgEfficiency,
  };
}

function buildMonthTrend(records, monthsBack = 6) {
  const now = new Date();
  const result = [];
  for (let index = monthsBack - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const items = records.filter((record) => getMonthKey(record.date) === key);
    result.push({
      key,
      label: `${date.getMonth() + 1}月`,
      value: items.reduce((sum, record) => sum + record.totalCost, 0),
    });
  }
  return result;
}

function buildPriceTrend(records, count = 7) {
  return [...records]
    .slice(0, count)
    .reverse()
    .map((record) => ({
      label: formatDateShort(record.date),
      value: record.unitPrice,
      subtitle: record.fuelType,
    }));
}

function buildStationAggregates(records) {
  const map = new Map();
  records.forEach((record) => {
    const key = record.station || UNKNOWN_STATION;
    const current = map.get(key) || {
      name: key,
      visits: 0,
      totalSpend: 0,
      totalLiters: 0,
      lastDate: "",
      fuelTypes: new Set(),
      records: [],
    };

    current.visits += 1;
    current.totalSpend += record.totalCost;
    current.totalLiters += record.liters;
    current.lastDate = current.lastDate > record.date ? current.lastDate : record.date;
    current.fuelTypes.add(record.fuelType);
    current.records.push(record);
    map.set(key, current);
  });

  return [...map.values()]
    .map((entry) => ({
      ...entry,
      avgPrice: entry.totalLiters > 0 ? entry.totalSpend / entry.totalLiters : 0,
      fuelTypes: [...entry.fuelTypes],
      records: entry.records.sort(compareRecordsDesc),
    }))
    .sort((left, right) => {
      if (left.visits !== right.visits) {
        return right.visits - left.visits;
      }
      return right.totalSpend - left.totalSpend;
    });
}

function deriveData(records) {
  const currentMonthKey = getMonthKey(getToday());
  const previousMonthKey = getPreviousMonthKey(currentMonthKey);
  const efficiencySeries = buildEfficiencySeries(records);
  const monthlyRecords = records.filter((record) => getMonthKey(record.date) === currentMonthKey);
  const previousMonthlyRecords = records.filter(
    (record) => getMonthKey(record.date) === previousMonthKey
  );
  const monthlyEfficiency = efficiencySeries.filter(
    (entry) => getMonthKey(entry.date) === currentMonthKey
  );
  const previousMonthlyEfficiency = efficiencySeries.filter(
    (entry) => getMonthKey(entry.date) === previousMonthKey
  );
  const stationAggregates = buildStationAggregates(records);

  return {
    overall: summarizeRecords(records, efficiencySeries),
    monthly: summarizeRecords(monthlyRecords, monthlyEfficiency),
    previousMonthly: summarizeRecords(previousMonthlyRecords, previousMonthlyEfficiency),
    monthTrend: buildMonthTrend(records, 6),
    priceTrend: buildPriceTrend(records, 7),
    stationAggregates,
    recentRecords: records.slice(0, 5),
    highestCost: [...records].sort((left, right) => right.totalCost - left.totalCost)[0] || null,
    largestFill: [...records].sort((left, right) => right.liters - left.liters)[0] || null,
    latestFullTank: records.find((record) => record.isFullTank) || null,
    mostVisitedStation: stationAggregates[0] || null,
    cheapestStation: [...stationAggregates]
      .filter((entry) => entry.totalLiters > 0 && entry.name !== UNKNOWN_STATION)
      .sort((left, right) => left.avgPrice - right.avgPrice)[0] || null,
  };
}

function describeMonthlyDelta(currentValue, previousValue) {
  if (!currentValue || !previousValue) {
    return "至少需要两段完整满油区间，才会显示月度变化。";
  }
  const diff = ((currentValue - previousValue) / previousValue) * 100;
  if (Math.abs(diff) < 1) {
    return "与上月基本持平。";
  }
  if (diff < 0) {
    return `较上月下降 ${Math.abs(diff).toFixed(0)}%。`;
  }
  return `较上月上升 ${Math.abs(diff).toFixed(0)}%。`;
}

function renderEmptyState(title, copy) {
  return `
    <div class="empty-state">
      <p class="empty-title">${escapeHtml(title)}</p>
      <div class="inline-actions">
        <a class="button" href="./add.html">新增记录</a>
        <button class="button-secondary" type="button" data-action="load-sample">载入示例数据</button>
      </div>
    </div>
  `;
}

function renderRecordCard(record, options = {}) {
  const showDelete = Boolean(options.showDelete);
  const compact = Boolean(options.compact);
  const stationName = record.station || UNKNOWN_STATION;
  const showActions = showDelete || !compact;
  return `
    <article class="record-card${compact ? " compact" : ""}">
      <div class="record-top">
        <div>
          <p class="record-station">${escapeHtml(stationName)}</p>
          <p class="record-meta">${escapeHtml(formatDate(record.date))} · ${escapeHtml(
            record.fuelType
          )}</p>
        </div>
        <div class="record-amount">${escapeHtml(formatMoney(record.totalCost))}</div>
      </div>
      <div class="record-grid">
        <div class="record-grid-item">
          <span class="micro-label">加油量</span>
          <strong>${escapeHtml(formatLiters(record.liters))}</strong>
        </div>
        <div class="record-grid-item">
          <span class="micro-label">单价</span>
          <strong>${escapeHtml(formatUnitPrice(record.unitPrice))}</strong>
        </div>
        <div class="record-grid-item">
          <span class="micro-label">里程</span>
          <strong>${escapeHtml(formatDistance(record.odometer))}</strong>
        </div>
        <div class="record-grid-item">
          <span class="micro-label">状态</span>
          <strong>${record.isFullTank ? "已加满" : "补油"}</strong>
        </div>
      </div>
      ${showActions ? `
        <div class="record-actions">
          <a class="button-link" href="./add.html?id=${encodeURIComponent(record.id)}">编辑</a>
          ${showDelete ? `<button class="button-link danger" type="button" data-delete-id="${escapeHtml(record.id)}">删除</button>` : ""}
        </div>
      ` : ""}
    </article>
  `;
}

function renderChart(container, series, formatter, accentIndex = -1) {
  if (!container) {
    return;
  }

  if (!series.length || series.every((entry) => !entry.value)) {
    container.innerHTML = renderEmptyState("暂无图表数据", "继续录入记录后，这里会自动生成趋势图。");
    return;
  }

  const maxValue = Math.max(...series.map((entry) => entry.value), 1);
  container.innerHTML = `
    <div class="chart-grid">
      ${series
        .map((entry, index) => {
          const height = Math.max(12, (entry.value / maxValue) * 100);
          return `
            <div class="chart-column">
              <div class="chart-value">${escapeHtml(formatter(entry.value))}</div>
              <div class="chart-track">
                <div class="chart-bar${index === accentIndex ? " is-accent" : ""}" style="height: ${height}%"></div>
              </div>
              <div class="chart-label">${escapeHtml(entry.label)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function markActiveNavigation() {
  const activeGroup = document.body.dataset.navGroup || document.body.dataset.page;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const isActive = link.dataset.nav === activeGroup;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => {});
  });
}

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    refreshInstallPanel();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    refreshInstallPanel("应用已经安装到主屏幕。");
  });

  refreshInstallPanel();
}

function refreshInstallPanel(customMessage = "") {
  const installStatus = document.getElementById("installStatus");
  const installButton = document.getElementById("installButton");

  if (!installStatus || !installButton) {
    return;
  }

  if (isStandaloneMode()) {
    installStatus.textContent = "应用已经安装，可直接从主屏幕打开。";
    installButton.hidden = true;
    return;
  }

  if (customMessage) {
    installStatus.textContent = customMessage;
  } else if (deferredInstallPrompt) {
    installStatus.textContent = "浏览器已经允许安装，点下面按钮即可加入主屏幕。";
  } else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    installStatus.textContent = "请在 Safari 中点“分享”，然后选择“添加到主屏幕”。";
  } else {
    installStatus.textContent = "请在支持的浏览器中打开站点，浏览器满足条件后会给出安装入口。";
  }

  installButton.hidden = !deferredInstallPrompt;
}

async function handleInstallClick() {
  if (!deferredInstallPrompt) {
    refreshInstallPanel();
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  refreshInstallPanel("安装请求已发送给浏览器。");
}

function updateGlobalCopy() {
  markActiveNavigation();
  const flash = getFlashMessage();
  const pageFlash = document.getElementById("pageFlash");
  if (flash && pageFlash) {
    setNotice(pageFlash, flash, "success");
  }
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function toCsv(records) {
  const header = [
    "id",
    "date",
    "liters",
    "unitPrice",
    "totalCost",
    "odometer",
    "fuelType",
    "station",
    "isFullTank",
    "note",
    "createdAt",
    "updatedAt",
  ];

  const rows = records.map((record) =>
    header.map((key) => {
      const raw = record[key] ?? "";
      const text = String(raw);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
    })
  );

  return [header, ...rows].map((row) => row.join(",")).join("\r\n");
}

function initDashboardPage() {
  const records = loadRecords();
  const settings = loadSettings();
  const data = deriveData(records);

  setElementText("dashboardVehicleName", settings.vehicleName);
  setElementText("dashboardEfficiency", data.monthly.avgEfficiency ? formatNumber(data.monthly.avgEfficiency, 1) : "--");
  setElementText("dashboardEfficiencyDelta", describeMonthlyDelta(data.monthly.avgEfficiency, data.previousMonthly.avgEfficiency));
  setElementText("dashboardMonthlySpend", formatMoney(data.monthly.totalSpend));
  setElementText("dashboardMonthlyCount", `${data.monthly.count} 次`);
  setElementText("dashboardMonthlyLiters", formatLiters(data.monthly.totalLiters));
  setElementText("dashboardMonthlyDistance", formatDistance(data.monthly.distanceCoverage));

  const recentContainer = document.getElementById("dashboardRecentRecords");
  if (recentContainer) {
    recentContainer.innerHTML = data.recentRecords.length
      ? data.recentRecords.slice(0, 3).map((record) => renderRecordCard(record, { compact: true })).join("")
      : renderEmptyState("还没有加油记录", "从第一条记录开始，仪表盘会自动生成月度摘要与趋势。");
  }

  const spotlight = document.getElementById("dashboardStationSpotlight");
  if (spotlight) {
    if (!data.mostVisitedStation) {
      spotlight.innerHTML = renderEmptyState("还没有油站数据", "录入带油站名称的记录后，这里会显示最常去的油站。");
    } else {
      spotlight.innerHTML = `
        <div class="section-head">
          <div>
            <p class="section-title">油站聚焦</p>
            <h3>${escapeHtml(data.mostVisitedStation.name)}</h3>
          </div>
          <a class="text-link" href="./logs.html">查看记录</a>
        </div>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="mini-label">到访次数</span>
            <strong class="summary-value">${data.mostVisitedStation.visits} 次</strong>
          </div>
          <div class="summary-item">
            <span class="mini-label">平均单价</span>
            <strong class="summary-value">${formatUnitPrice(data.mostVisitedStation.avgPrice)}</strong>
          </div>
          <div class="summary-item">
            <span class="mini-label">最近一次</span>
            <strong class="summary-value">${formatDateShort(data.mostVisitedStation.lastDate)}</strong>
          </div>
        </div>
      `;
    }
  }
}

function initLogsPage() {
  let records = loadRecords();
  const monthFilter = document.getElementById("logsMonthFilter");
  const fuelFilter = document.getElementById("logsFuelFilter");
  const stationFilter = document.getElementById("logsStationFilter");
  const searchInput = document.getElementById("logsSearch");
  const listContainer = document.getElementById("logsList");
  const summaryHint = document.getElementById("logsFilterSummary");

  const uniqueMonths = [...new Set(records.map((record) => getMonthKey(record.date)))];
  const currentMonth = getMonthKey(getToday());
  if (monthFilter) {
    monthFilter.innerHTML = [
      `<option value="all">全部月份</option>`,
      ...uniqueMonths.map((month) => `<option value="${month}">${getMonthLabel(month)}</option>`),
    ].join("");
    monthFilter.value = uniqueMonths.includes(currentMonth) ? currentMonth : "all";
  }

  if (fuelFilter) {
    fuelFilter.innerHTML = [
      `<option value="all">全部油品</option>`,
      ...FUEL_TYPES.map((fuelType) => `<option value="${fuelType}">${fuelType}</option>`),
    ].join("");
  }

  if (stationFilter) {
    const stations = [...new Set(records.map((record) => record.station || "未填写油站"))];
    stationFilter.innerHTML = [
      `<option value="all">全部油站</option>`,
      ...stations.map((station) => `<option value="${station}">${station}</option>`),
    ].join("");
  }

  function render() {
    records = loadRecords();
    const monthValue = monthFilter ? monthFilter.value : "all";
    const fuelValue = fuelFilter ? fuelFilter.value : "all";
    const stationValue = stationFilter ? stationFilter.value : "all";
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : "";

    const filtered = records.filter((record) => {
      if (monthValue !== "all" && getMonthKey(record.date) !== monthValue) {
        return false;
      }
      if (fuelValue !== "all" && record.fuelType !== fuelValue) {
        return false;
      }
      const stationName = record.station || "未填写油站";
      if (stationValue !== "all" && stationName !== stationValue) {
        return false;
      }
      if (keyword) {
        const haystack = [record.station, record.note, record.fuelType, record.date]
          .join(" ")
          .toLowerCase();
        return haystack.includes(keyword);
      }
      return true;
    });

    const filteredSummary = summarizeRecords(filtered, buildEfficiencySeries(filtered));
    setElementText("logsFilteredSpend", formatMoney(filteredSummary.totalSpend));
    setElementText("logsFilteredCount", `${filteredSummary.count} 条`);
    setElementText("logsFilteredLiters", formatLiters(filteredSummary.totalLiters));

    if (summaryHint) {
      summaryHint.textContent = filtered.length
        ? `当前展示 ${filtered.length} 条记录。`
        : "当前筛选条件下没有匹配记录。";
    }

    if (listContainer) {
      listContainer.innerHTML = filtered.length
        ? filtered.map((record) => renderRecordCard(record, { showDelete: true })).join("")
        : renderEmptyState("没有匹配的记录", "可以调整筛选条件，或新增一条新的加油记录。");
    }
  }

  [monthFilter, fuelFilter, stationFilter, searchInput].forEach((element) => {
    if (!element) {
      return;
    }
    element.addEventListener("input", render);
    element.addEventListener("change", render);
  });

  if (listContainer) {
    listContainer.addEventListener("click", (event) => {
      const deleteTrigger = event.target.closest("[data-delete-id]");
      if (!deleteTrigger) {
        return;
      }
      const recordId = deleteTrigger.dataset.deleteId;
      const target = loadRecords().find((record) => record.id === recordId);
      if (!target) {
        return;
      }
      if (!window.confirm(`确定删除 ${target.station || "这条记录"} 吗？`)) {
        return;
      }
      saveRecords(loadRecords().filter((record) => record.id !== recordId));
      render();
    });
  }

  render();
}

function initAddPage() {
  const settings = loadSettings();
  const params = new URLSearchParams(window.location.search);
  const editingId = params.get("id");
  const editingRecord = loadRecords().find((record) => record.id === editingId) || null;
  const pageTitle = document.getElementById("addPageHeading");
  const pageHint = document.getElementById("addPageHint");
  const totalAmount = document.getElementById("addTotalAmount");
  const formMessage = document.getElementById("addFormMessage");
  const form = document.getElementById("fuelForm");
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

  const fuelTypeGroup = document.getElementById("fuelTypeGroup");
  let selectedFuelType = editingRecord?.fuelType || settings.preferredFuelType;

  function buildDraftRecord() {
    const date = fields.date.value || getToday();
    const liters = asNumber(fields.liters.value);
    const unitPrice = asNumber(fields.unitPrice.value);
    const odometer = asNumber(fields.odometer.value);
    const station = fields.station.value.trim();
    const note = fields.note.value.trim();

    return normalizeRecord({
      ...(editingRecord || {}),
      date,
      liters,
      unitPrice,
      totalCost: liters * unitPrice,
      odometer,
      station,
      note,
      fuelType: selectedFuelType,
      isFullTank: fields.isFullTank.checked,
      updatedAt: new Date().toISOString(),
    });
  }

  function validateDraft(candidateRecord, records) {
    if (!candidateRecord.date || !candidateRecord.liters || !candidateRecord.unitPrice || !candidateRecord.odometer) {
      return "请完整填写日期、加油量、单价和当前里程。";
    }

    const maxLiters = Math.max(settings.tankCapacity * 1.15, settings.tankCapacity + 8);
    if (candidateRecord.liters > maxLiters) {
      return `本次加油量已超过油箱容量设置（${formatNumber(settings.tankCapacity, 0)}L），请确认后再保存。`;
    }

    return validateRecordOdometer(records, candidateRecord);
  }

  function renderFuelType() {
    if (!fuelTypeGroup) {
      return;
    }
    fuelTypeGroup.querySelectorAll("[data-fuel-type]").forEach((button) => {
      const isActive = button.dataset.fuelType === selectedFuelType;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function updateTotal() {
    const liters = asNumber(fields.liters?.value);
    const unitPrice = asNumber(fields.unitPrice?.value);
    if (totalAmount) {
      totalAmount.textContent = formatNumber(liters * unitPrice, 2);
    }
  }

  function fillForm() {
    const record = editingRecord || {
      date: getToday(),
      liters: "",
      unitPrice: "",
      odometer: "",
      station: "",
      note: "",
      isFullTank: true,
    };

    if (pageTitle) {
      pageTitle.textContent = editingRecord ? "编辑加油记录" : "添加加油记录";
    }
    if (pageHint) {
      pageHint.textContent = editingRecord
        ? "修改后会覆盖当前这条记录，并重新校验前后里程顺序。"
        : "油耗只按满油区间计算，保存时会同步检查里程顺序。";
    }

    fields.date.value = record.date || getToday();
    fields.liters.value = record.liters || "";
    fields.unitPrice.value = record.unitPrice || "";
    fields.odometer.value = record.odometer || "";
    fields.station.value = record.station || "";
    fields.note.value = record.note || "";
    fields.isFullTank.checked = Boolean(record.isFullTank);
    renderFuelType();
    updateTotal();

    if (deleteWrap) {
      deleteWrap.hidden = !editingRecord;
    }
  }

  if (fuelTypeGroup) {
    fuelTypeGroup.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-fuel-type]");
      if (!trigger) {
        return;
      }
      selectedFuelType = trigger.dataset.fuelType;
      renderFuelType();
    });
  }

  [fields.liters, fields.unitPrice].forEach((element) => {
    if (!element) {
      return;
    }
    element.addEventListener("input", updateTotal);
    element.addEventListener("change", updateTotal);
  });

  [fields.date, fields.odometer, fields.station, fields.note, fields.isFullTank].forEach((element) => {
    if (!element) {
      return;
    }
    element.addEventListener("input", () => {
      if (!formMessage?.hidden) {
        setNotice(formMessage, "");
      }
    });
    element.addEventListener("change", () => {
      if (!formMessage?.hidden) {
        setNotice(formMessage, "");
      }
    });
  });

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const latestRecords = loadRecords();
      const nextRecord = buildDraftRecord();
      const nextRecords = editingRecord
        ? latestRecords.map((record) => (record.id === editingRecord.id ? nextRecord : record))
        : [nextRecord, ...latestRecords];

      const validationMessage = validateDraft(nextRecord, nextRecords);
      if (validationMessage) {
        setNotice(formMessage, validationMessage, "error");
        return;
      }

      saveRecords(nextRecords);
      window.location.href = editingRecord ? "./logs.html?flash=updated" : "./logs.html?flash=saved";
    });
  }

  if (deleteButton && editingRecord) {
    deleteButton.addEventListener("click", () => {
      if (!window.confirm("确定删除当前这条记录吗？")) {
        return;
      }
      saveRecords(loadRecords().filter((record) => record.id !== editingRecord.id));
      window.location.href = "./logs.html?flash=deleted";
    });
  }

  fillForm();
}

function initStatsPage() {
  const data = deriveData(loadRecords());

  setElementText("statsEfficiency", data.monthly.avgEfficiency ? formatNumber(data.monthly.avgEfficiency, 1) : "--");
  setElementText("statsTrendChip", describeMonthlyDelta(data.monthly.avgEfficiency, data.previousMonthly.avgEfficiency));
  setElementText("statsMonthlySpend", formatMoney(data.monthly.totalSpend));
  setElementText("statsMonthlyCount", `${data.monthly.count} 次`);
  setElementText("statsAveragePrice", data.monthly.avgPrice ? formatUnitPrice(data.monthly.avgPrice) : "--");
  setElementText("statsAverageLiters", data.monthly.avgLiters ? formatLiters(data.monthly.avgLiters) : "--");

  renderChart(
    document.getElementById("statsSpendChart"),
    data.monthTrend,
    (value) => `¥${formatNumber(value, 0)}`,
    data.monthTrend.length - 1
  );

  renderChart(
    document.getElementById("statsPriceChart"),
    data.priceTrend,
    (value) => `${formatNumber(value, 2)}`,
    data.priceTrend.length - 1
  );

  const insights = document.getElementById("statsInsights");
  if (insights) {
    const cards = [];
    if (data.highestCost) {
      cards.push(`
        <article class="insight-card">
          <div class="insight-head">
            <p class="insight-name">单次最高支出</p>
            <span class="pill">${formatDateShort(data.highestCost.date)}</span>
          </div>
          <div class="insight-body">
            <span class="insight-value">${formatMoney(data.highestCost.totalCost)}</span>
            <span class="muted">${escapeHtml(data.highestCost.station || "未填写油站")}</span>
          </div>
        </article>
      `);
    }
    if (data.cheapestStation) {
      cards.push(`
        <article class="insight-card">
          <div class="insight-head">
            <p class="insight-name">最低均价油站</p>
            <span class="pill">${data.cheapestStation.visits} 次</span>
          </div>
          <div class="insight-body">
            <span class="insight-value">${formatUnitPrice(data.cheapestStation.avgPrice)}</span>
            <span class="muted">${escapeHtml(data.cheapestStation.name)}</span>
          </div>
        </article>
      `);
    }
    if (data.largestFill) {
      cards.push(`
        <article class="insight-card">
          <div class="insight-head">
            <p class="insight-name">单次最大加油量</p>
            <span class="pill">${escapeHtml(data.largestFill.fuelType)}</span>
          </div>
          <div class="insight-body">
            <span class="insight-value">${formatLiters(data.largestFill.liters)}</span>
            <span class="muted">${formatDate(data.largestFill.date)}</span>
          </div>
        </article>
      `);
    }
    if (data.latestFullTank) {
      cards.push(`
        <article class="insight-card">
          <div class="insight-head">
            <p class="insight-name">最近一次加满</p>
            <span class="pill">${formatDateShort(data.latestFullTank.date)}</span>
          </div>
          <div class="insight-body">
            <span class="insight-value">${formatMoney(data.latestFullTank.totalCost)}</span>
            <span class="muted">${escapeHtml(data.latestFullTank.station || "未填写油站")}</span>
          </div>
        </article>
      `);
    }

    insights.innerHTML = cards.length
      ? cards.join("")
      : renderEmptyState("洞察尚未生成", "继续记录更多加油数据后，这里会自动出现关键洞察。");
  }
}

function initStationsPage() {
  const data = deriveData(loadRecords());
  const searchInput = document.getElementById("stationSearch");
  const list = document.getElementById("stationsList");

  setElementText("stationsUniqueCount", `${data.stationAggregates.length} 个`);
  setElementText(
    "stationsMostVisited",
    data.mostVisitedStation ? data.mostVisitedStation.name : "暂无"
  );
  setElementText(
    "stationsBestPrice",
    data.cheapestStation ? formatUnitPrice(data.cheapestStation.avgPrice) : "--"
  );

  function render() {
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : "";
    const filtered = data.stationAggregates.filter((station) =>
      station.name.toLowerCase().includes(keyword)
    );

    if (!list) {
      return;
    }

    list.innerHTML = filtered.length
      ? filtered
          .map(
            (station) => `
              <article class="station-card">
                <div class="station-head">
                  <div>
                    <p class="station-name">${escapeHtml(station.name)}</p>
                    <p class="station-meta">最近一次：${escapeHtml(formatDate(station.lastDate))}</p>
                  </div>
                  <span class="status-badge">${station.visits} 次</span>
                </div>
                <div class="tag-row">
                  ${station.fuelTypes.map((fuelType) => `<span class="tag">${escapeHtml(fuelType)}</span>`).join("")}
                </div>
                <div class="station-grid">
                  <div class="station-grid-item">
                    <span class="micro-label">累计支出</span>
                    <strong>${escapeHtml(formatMoney(station.totalSpend))}</strong>
                  </div>
                  <div class="station-grid-item">
                    <span class="micro-label">平均单价</span>
                    <strong>${escapeHtml(formatUnitPrice(station.avgPrice))}</strong>
                  </div>
                  <div class="station-grid-item">
                    <span class="micro-label">累计油量</span>
                    <strong>${escapeHtml(formatLiters(station.totalLiters))}</strong>
                  </div>
                  <div class="station-grid-item">
                    <span class="micro-label">最近记录</span>
                    <strong>${escapeHtml(formatMoney(station.records[0].totalCost))}</strong>
                  </div>
                </div>
                <div class="visit-list">
                  ${station.records
                    .slice(0, 3)
                    .map(
                      (record) => `
                        <div class="visit-item">
                          <div>
                            <strong>${escapeHtml(formatDateShort(record.date))}</strong>
                            <div class="muted">${escapeHtml(record.fuelType)} · ${escapeHtml(
                              formatLiters(record.liters)
                            )}</div>
                          </div>
                          <span class="status-badge">${escapeHtml(formatMoney(record.totalCost))}</span>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              </article>
            `
          )
          .join("")
      : renderEmptyState("没有找到匹配油站", "试试其他关键词，或者先在添加记录页里补充油站名称。");
  }

  if (searchInput) {
    searchInput.addEventListener("input", render);
  }

  render();
}

function initSettingsPage() {
  const form = document.getElementById("settingsForm");
  const vehicleName = document.getElementById("vehicleName");
  const tankCapacity = document.getElementById("tankCapacity");
  const preferredFuelType = document.getElementById("preferredFuelType");
  const message = document.getElementById("settingsMessage");
  const exportCsvButton = document.getElementById("exportCsvButton");
  const exportJsonButton = document.getElementById("exportJsonButton");
  const importJsonButton = document.getElementById("importJsonButton");
  const importJsonInput = document.getElementById("importJsonInput");
  const clearDataButton = document.getElementById("clearDataButton");
  const loadSampleButton = document.getElementById("loadSampleButton");
  const installButton = document.getElementById("installButton");

  function fillValues() {
    const settings = loadSettings();
    const records = loadRecords();
    const stationAggregates = buildStationAggregates(records);
    vehicleName.value = settings.vehicleName;
    tankCapacity.value = settings.tankCapacity;
    preferredFuelType.innerHTML = FUEL_TYPES.map(
      (fuelType) => `<option value="${fuelType}">${fuelType}</option>`
    ).join("");
    preferredFuelType.value = settings.preferredFuelType;
    setElementText("settingsRecordCount", `${records.length} 条`);
    setElementText("settingsStationCount", `${stationAggregates.length} 个`);
    setElementText(
      "settingsLatestSync",
      records[0] ? formatDateTime(records[0].updatedAt || records[0].createdAt) : "尚无本地记录"
    );
    refreshInstallPanel();
  }

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      saveSettings({
        vehicleName: vehicleName.value.trim() || DEFAULT_SETTINGS.vehicleName,
        tankCapacity: Math.max(10, Math.min(120, asNumber(tankCapacity.value) || DEFAULT_SETTINGS.tankCapacity)),
        preferredFuelType: preferredFuelType.value || DEFAULT_SETTINGS.preferredFuelType,
      });
      setNotice(message, "设置已保存。", "success");
      fillValues();
    });
  }

  if (exportCsvButton) {
    exportCsvButton.addEventListener("click", () => {
      downloadFile("kinetic-oasis-records.csv", toCsv(loadRecords()), "text/csv;charset=utf-8");
      setNotice(message, "CSV 已导出。", "success");
    });
  }

  if (exportJsonButton) {
    exportJsonButton.addEventListener("click", () => {
      const payload = {
        exportedAt: new Date().toISOString(),
        settings: loadSettings(),
        records: loadRecords(),
      };
      downloadFile(
        "kinetic-oasis-backup.json",
        JSON.stringify(payload, null, 2),
        "application/json;charset=utf-8"
      );
      setNotice(message, "JSON 备份已导出。", "success");
    });
  }

  if (importJsonButton && importJsonInput) {
    importJsonButton.addEventListener("click", () => {
      importJsonInput.click();
    });

    importJsonInput.addEventListener("change", async () => {
      const file = importJsonInput.files?.[0];
      if (!file) {
        return;
      }

      try {
        const payload = JSON.parse(await file.text());
        const nextRecords = Array.isArray(payload.records) ? payload.records.map(normalizeRecord) : [];
        const nextSettings = payload.settings ? { ...loadSettings(), ...payload.settings } : loadSettings();
        saveRecords(nextRecords);
        saveSettings({
          vehicleName: String(nextSettings.vehicleName || DEFAULT_SETTINGS.vehicleName),
          tankCapacity: Math.max(10, Math.min(120, asNumber(nextSettings.tankCapacity || DEFAULT_SETTINGS.tankCapacity))),
          preferredFuelType: String(nextSettings.preferredFuelType || DEFAULT_SETTINGS.preferredFuelType),
        });
        setNotice(message, "数据已导入。页面即将刷新。", "success");
        setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        setNotice(message, "导入失败，请确认文件是本应用导出的 JSON 备份。", "error");
      } finally {
        importJsonInput.value = "";
      }
    });
  }

  if (clearDataButton) {
    clearDataButton.addEventListener("click", () => {
      if (!window.confirm("确定清空所有本地记录和设置吗？")) {
        return;
      }
      clearAllData();
      setNotice(message, "本地数据已清空。页面即将刷新。", "success");
      setTimeout(() => window.location.reload(), 500);
    });
  }

  if (loadSampleButton) {
    loadSampleButton.addEventListener("click", () => {
      if (!loadSampleData()) {
        return;
      }
      setNotice(message, "示例数据已载入。页面即将刷新。", "success");
      setTimeout(() => window.location.reload(), 500);
    });
  }

  if (installButton) {
    installButton.addEventListener("click", handleInstallClick);
  }

  fillValues();
}

function setupGlobalEvents() {
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-action='load-sample']");
    if (!trigger) {
      return;
    }
    event.preventDefault();
    if (loadSampleData()) {
      window.location.reload();
    }
  });
}

function initPage() {
  registerServiceWorker();
  setupInstallPrompt();
  setupGlobalEvents();
  updateGlobalCopy();

  const page = document.body.dataset.page;
  switch (page) {
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
