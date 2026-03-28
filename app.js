const STORAGE_KEY = "kinetic-oasis:last-record";
const HISTORY_KEY = "kinetic-oasis:records";
const SERVICE_WORKER_URL = "./service-worker.js";

const form = document.querySelector("#fuelForm");
const totalAmount = document.querySelector("#totalAmount");
const latestRecord = document.querySelector("#latestRecord");
const formMessage = document.querySelector("#formMessage");
const saveState = document.querySelector("#saveState");
const clearButton = document.querySelector("#clearButton");
const fuelTypeGroup = document.querySelector("#fuelTypeGroup");
const closeButton = document.querySelector('[data-action="close-page"]');

const fields = {
  date: document.querySelector("#date"),
  liters: document.querySelector("#liters"),
  price: document.querySelector("#price"),
  odometer: document.querySelector("#odometer"),
  station: document.querySelector("#station"),
};

let selectedFuelType = "92# 汽油";

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function formatNumber(value, fractionDigits = 2) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(Number(value || 0));
}

function parsePositiveNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0;
}

function getToday() {
  const today = new Date();
  const timezoneOffset = today.getTimezoneOffset() * 60000;
  return new Date(today.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function updateTotal() {
  const liters = parsePositiveNumber(fields.liters.value);
  const price = parsePositiveNumber(fields.price.value);
  totalAmount.textContent = formatMoney(liters * price);
}

function setMessage(message, type = "") {
  formMessage.textContent = message;
  formMessage.className = "form-message";
  if (type) {
    formMessage.classList.add(`is-${type}`);
  }
}

function setSelectedFuelType(fuelType) {
  selectedFuelType = fuelType;
  const chips = fuelTypeGroup.querySelectorAll(".fuel-chip");
  chips.forEach((chip) => {
    const isActive = chip.dataset.fuelType === fuelType;
    chip.classList.toggle("is-active", isActive);
    chip.setAttribute("aria-checked", String(isActive));
  });
}

function fillForm(record) {
  fields.date.value = record.date || getToday();
  fields.liters.value = record.liters ?? "";
  fields.price.value = record.price ?? "";
  fields.odometer.value = record.odometer ?? "";
  fields.station.value = record.station ?? "";
  setSelectedFuelType(record.fuelType || "92# 汽油");
  updateTotal();
}

function renderLatestRecord(record) {
  if (!record) {
    latestRecord.innerHTML = '<p class="latest-empty">还没有本地记录，填写后点击“确认并保存”。</p>';
    saveState.textContent = "未保存";
    return;
  }

  latestRecord.innerHTML = `
    <div class="latest-grid">
      <div class="latest-topline">
        <div>
          <p class="summary-label">最近保存金额</p>
          <p class="latest-cost">¥ ${formatMoney(record.totalCost)}</p>
        </div>
        <p class="panel-badge">${record.savedAtLabel}</p>
      </div>
      <div class="latest-meta">
        <div class="meta-item">
          <span class="meta-label">日期</span>
          <span class="meta-value">${record.date}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">燃油</span>
          <span class="meta-value">${record.fuelType}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">油量</span>
          <span class="meta-value">${formatNumber(record.liters)} L</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">里程</span>
          <span class="meta-value">${formatNumber(record.odometer, 0)} km</span>
        </div>
      </div>
      <div class="meta-item">
        <span class="meta-label">加油站</span>
        <span class="meta-value">${record.station || "未填写"}</span>
      </div>
    </div>
  `;

  saveState.textContent = "已同步到本地";
}

function loadLatestRecord() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    setMessage("本地记录读取失败，请检查浏览器隐私设置。", "error");
    return null;
  }
}

function saveRecord(record) {
  const nextRecord = {
    ...record,
    savedAt: new Date().toISOString(),
    savedAtLabel: new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date()),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecord));

  const history = (() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch (error) {
      return [];
    }
  })();

  history.unshift(nextRecord);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
  return nextRecord;
}

function resetFormToDefault() {
  fillForm({
    date: getToday(),
    liters: "",
    price: "",
    odometer: "",
    station: "",
    fuelType: "92# 汽油",
  });
  setMessage("");
}

function handleSubmit(event) {
  event.preventDefault();

  const liters = parsePositiveNumber(fields.liters.value);
  const price = parsePositiveNumber(fields.price.value);
  const odometer = parsePositiveNumber(fields.odometer.value);
  const station = fields.station.value.trim();
  const date = fields.date.value || getToday();

  if (!liters || !price || !odometer) {
    setMessage("请完整填写日期、加油量、单价和当前里程。", "error");
    return;
  }

  const savedRecord = saveRecord({
    date,
    liters,
    price,
    odometer,
    station,
    fuelType: selectedFuelType,
    totalCost: Number((liters * price).toFixed(2)),
  });

  renderLatestRecord(savedRecord);
  setMessage("记录已保存到当前浏览器。下次打开页面会自动回填。", "success");
}

function clearLocalRecords() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(HISTORY_KEY);
  resetFormToDefault();
  renderLatestRecord(null);
  setMessage("本地记录已清空。", "success");
}

function initializeEvents() {
  ["input", "change"].forEach((eventName) => {
    fields.liters.addEventListener(eventName, updateTotal);
    fields.price.addEventListener(eventName, updateTotal);
  });

  fuelTypeGroup.addEventListener("click", (event) => {
    const chip = event.target.closest(".fuel-chip");
    if (!chip) {
      return;
    }
    setSelectedFuelType(chip.dataset.fuelType);
  });

  form.addEventListener("submit", handleSubmit);
  clearButton.addEventListener("click", clearLocalRecords);

  closeButton.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setMessage("当前页面没有可返回的上一页。", "error");
  });
}

function initializePage() {
  initializeEvents();
  registerServiceWorker();

  const latest = loadLatestRecord();
  if (latest) {
    fillForm(latest);
    renderLatestRecord(latest);
    setMessage("已加载上次保存的本地记录。", "success");
    return;
  }

  resetFormToDefault();
  renderLatestRecord(null);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch((error) => {
      console.warn("Service worker registration failed.", error);
    });
  });
}

initializePage();
