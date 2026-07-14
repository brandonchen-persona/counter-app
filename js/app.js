(function () {
  "use strict";

  /* ---------------- Storage ---------------- */

  var KEYS = {
    settings: "tally_settings",
    spend: "tally_spend",
    calories: "tally_calories"
  };

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getSettings() {
    return loadJSON(KEYS.settings, { monthlyBudget: 0, calorieGoal: 0 });
  }

  function setSettings(patch) {
    var s = getSettings();
    Object.assign(s, patch);
    saveJSON(KEYS.settings, s);
    return s;
  }

  function getSpend() {
    return loadJSON(KEYS.spend, []);
  }

  function addSpend(amount, desc) {
    var list = getSpend();
    var now = new Date();
    list.push({
      id: uid(),
      dateISO: isoDate(now),
      ts: now.getTime(),
      amount: amount,
      desc: desc
    });
    saveJSON(KEYS.spend, list);
  }

  function deleteSpend(id) {
    saveJSON(KEYS.spend, getSpend().filter(function (e) { return e.id !== id; }));
  }

  function getCalories() {
    return loadJSON(KEYS.calories, []);
  }

  function addCalorie(kcal, desc) {
    var list = getCalories();
    var now = new Date();
    list.push({
      id: uid(),
      dateISO: isoDate(now),
      ts: now.getTime(),
      calories: kcal,
      desc: desc
    });
    saveJSON(KEYS.calories, list);
  }

  function deleteCalorie(id) {
    saveJSON(KEYS.calories, getCalories().filter(function (e) { return e.id !== id; }));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------------- Date helpers ---------------- */

  var DAY_MS = 24 * 60 * 60 * 1000;

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function isoDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function parseISO(iso) {
    var parts = iso.split("-");
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function startOfWeek(d) {
    var s = startOfDay(d);
    var dow = (s.getDay() + 6) % 7; // Monday = 0
    return new Date(s.getTime() - dow * DAY_MS);
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function addDays(d, n) { return new Date(d.getTime() + n * DAY_MS); }

  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

  function daysInMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }

  function daysBetweenInclusive(start, end) {
    return Math.floor((startOfDay(end) - startOfDay(start)) / DAY_MS) + 1;
  }

  function fmtShortDate(d) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function fmtMonth(d) {
    return d.toLocaleDateString(undefined, { month: "short" });
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function fmtTime24(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function money(n) {
    var sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toFixed(2);
  }

  function compactMoney(n) {
    return "$" + Math.round(n);
  }

  /* ---------------- Aggregation ---------------- */

  function sumInRange(entries, valueKey, start, end) {
    var s = startOfDay(start).getTime();
    var e = startOfDay(end).getTime() + DAY_MS - 1;
    var total = 0;
    entries.forEach(function (entry) {
      var t = parseISO(entry.dateISO).getTime();
      if (t >= s && t <= e) total += entry[valueKey];
    });
    return total;
  }

  function earliestDate(entries) {
    if (!entries.length) return null;
    var min = entries[0].dateISO;
    entries.forEach(function (e) { if (e.dateISO < min) min = e.dateISO; });
    return parseISO(min);
  }

  function periodStat(entries, valueKey, start, today) {
    var total = sumInRange(entries, valueKey, start, today);
    var days = daysBetweenInclusive(start, today);
    return { total: total, avg: days > 0 ? total / days : 0 };
  }

  function weeklySeries(entries, valueKey, weeks, today) {
    var out = [];
    for (var i = weeks - 1; i >= 0; i--) {
      var wStart = addDays(startOfWeek(today), -7 * i);
      var wEnd = addDays(wStart, 6);
      var effectiveEnd = wEnd > today ? today : wEnd;
      var total = sumInRange(entries, valueKey, wStart, effectiveEnd);
      out.push({ label: fmtShortDate(wStart), value: total });
    }
    return out;
  }

  function monthlySeries(entries, valueKey, months, today) {
    var out = [];
    for (var i = months - 1; i >= 0; i--) {
      var mStart = addMonths(startOfMonth(today), -i);
      var mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);
      var effectiveEnd = mEnd > today ? today : mEnd;
      var total = sumInRange(entries, valueKey, mStart, effectiveEnd);
      out.push({ label: fmtMonth(mStart), value: total });
    }
    return out;
  }

  /* ---------------- Router / render ---------------- */

  var appEl = document.getElementById("app");
  var currentScreen = "home";
  var analyticsTab = "spend";

  var routes = {
    home: "tpl-home",
    spend: "tpl-spend",
    calories: "tpl-calories",
    analytics: "tpl-analytics"
  };

  function showScreen(name) {
    currentScreen = name;
    var tplId = routes[name];
    var tpl = document.getElementById(tplId);
    appEl.innerHTML = "";
    appEl.appendChild(tpl.content.cloneNode(true));
    afterRender(name);
    window.scrollTo(0, 0);
  }

  function afterRender(name) {
    if (name === "spend") { initSpendForm(); renderSpend(); }
    if (name === "calories") { initCaloriesForm(); renderCalories(); }
    if (name === "analytics") renderAnalytics();
  }

  /* ---------------- Spend screen ---------------- */

  function initSpendForm() {
    document.getElementById("spend-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var amountEl = document.getElementById("spend-amount");
      var descEl = document.getElementById("spend-desc");
      var amount = parseFloat(amountEl.value);
      var desc = descEl.value.trim();
      if (!isFinite(amount) || amount < 0 || !desc) return;
      addSpend(amount, desc);
      amountEl.value = "";
      descEl.value = "";
      renderSpend();
      amountEl.focus();
    });
  }

  function renderSpend() {
    var settings = getSettings();
    var entries = getSpend();
    var today = new Date();

    var todaySpent = sumInRange(entries, "amount", today, today);
    var monthSpent = sumInRange(entries, "amount", startOfMonth(today), today);

    var dim = daysInMonth(today.getFullYear(), today.getMonth());
    var dailyBudget = settings.monthlyBudget / dim;
    var monthlyBudget = settings.monthlyBudget;

    var todayRemaining = dailyBudget - todaySpent;
    var monthRemaining = monthlyBudget - monthSpent;

    setText("spend-today-remaining", money(todayRemaining));
    setText("spend-today-sub", "of " + money(dailyBudget) + " daily");
    setBar("spend-today-bar", todaySpent, dailyBudget);

    setText("spend-month-remaining", money(monthRemaining));
    setText("spend-month-sub", "of " + money(monthlyBudget) + " monthly");
    setBar("spend-month-bar", monthSpent, monthlyBudget);

    var todayEntries = entries
      .filter(function (e) { return e.dateISO === isoDate(today); })
      .sort(function (a, b) { return b.ts - a.ts; });

    var listEl = document.getElementById("spend-list");
    listEl.innerHTML = "";
    if (!todayEntries.length) {
      listEl.innerHTML = '<li class="empty-state">No transactions yet today</li>';
    } else {
      todayEntries.forEach(function (e) {
        listEl.appendChild(buildEntryRow({
          desc: e.desc,
          time: fmtTime(e.ts),
          amountText: money(e.amount),
          onDelete: function () { deleteSpend(e.id); renderSpend(); }
        }));
      });
    }
  }

  /* ---------------- Calories screen ---------------- */

  function initCaloriesForm() {
    document.getElementById("cal-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var amountEl = document.getElementById("cal-amount");
      var descEl = document.getElementById("cal-desc");
      var kcal = parseFloat(amountEl.value);
      var desc = descEl.value.trim();
      if (!isFinite(kcal) || kcal < 0 || !desc) return;
      addCalorie(kcal, desc);
      amountEl.value = "";
      descEl.value = "";
      renderCalories();
      amountEl.focus();
    });
  }

  function renderCalories() {
    var settings = getSettings();
    var entries = getCalories();
    var today = new Date();

    var todayEaten = sumInRange(entries, "calories", today, today);
    var goal = settings.calorieGoal;
    var remaining = goal - todayEaten;

    setText("cal-today-remaining", Math.round(remaining) + " kcal");
    setText("cal-today-sub", "of " + Math.round(goal) + " kcal goal");
    setBar("cal-today-bar", todayEaten, goal);

    var todayEntries = entries
      .filter(function (e) { return e.dateISO === isoDate(today); })
      .sort(function (a, b) { return b.ts - a.ts; });

    var listEl = document.getElementById("cal-list");
    listEl.innerHTML = "";
    if (!todayEntries.length) {
      listEl.innerHTML = '<li class="empty-state">No food logged yet today</li>';
    } else {
      todayEntries.forEach(function (e) {
        listEl.appendChild(buildEntryRow({
          desc: e.desc,
          time: fmtTime(e.ts),
          amountText: Math.round(e.calories) + " kcal",
          onDelete: function () { deleteCalorie(e.id); renderCalories(); }
        }));
      });
    }
  }

  /* ---------------- Shared row builder ---------------- */

  function buildEntryRow(opts) {
    var li = document.createElement("li");
    li.className = "entry-row";
    li.innerHTML =
      '<div class="entry-row-main">' +
        '<div class="entry-row-desc"></div>' +
        '<div class="entry-row-time"></div>' +
      '</div>' +
      '<div class="entry-row-right">' +
        '<div class="entry-row-amount"></div>' +
        '<button class="entry-row-del" aria-label="Delete">×</button>' +
      '</div>';
    li.querySelector(".entry-row-desc").textContent = opts.desc;
    li.querySelector(".entry-row-time").textContent = opts.time;
    li.querySelector(".entry-row-amount").textContent = opts.amountText;
    li.querySelector(".entry-row-del").addEventListener("click", function () {
      if (confirm("Delete this entry?")) opts.onDelete();
    });
    return li;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setBar(id, value, max) {
    var el = document.getElementById(id);
    if (!el) return;
    var pct = max > 0 ? (value / max) * 100 : 0;
    el.style.width = Math.min(100, Math.max(0, pct)) + "%";
    el.classList.toggle("over", value > max && max > 0);
  }

  /* ---------------- Analytics screen ---------------- */

  function renderAnalytics() {
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === analyticsTab);
    });

    var today = new Date();
    var isSpend = analyticsTab === "spend";
    var entries = isSpend ? getSpend() : getCalories();
    var valueKey = isSpend ? "amount" : "calories";
    var unitFmt = isSpend ? money : function (n) { return Math.round(n) + " kcal"; };
    var compactFmt = isSpend ? compactMoney : function (n) { return Math.round(n); };

    var weekStat = periodStat(entries, valueKey, startOfWeek(today), today);
    var monthStat = periodStat(entries, valueKey, startOfMonth(today), today);
    var threeMoStat = periodStat(entries, valueKey, addMonths(startOfMonth(today), -2), today);
    var earliest = earliestDate(entries) || today;
    var allTimeStat = periodStat(entries, valueKey, earliest, today);

    var summaryEl = document.getElementById("analytics-summary");
    summaryEl.innerHTML = "";
    [
      { label: "This Week / Day", stat: weekStat },
      { label: "This Month / Day", stat: monthStat },
      { label: "Last 3 Months / Day", stat: threeMoStat },
      { label: "All-Time / Day", stat: allTimeStat }
    ].forEach(function (item) {
      var card = document.createElement("div");
      card.className = "summary-card";
      card.innerHTML =
        '<div class="stat-label">' + item.label + '</div>' +
        '<div class="stat-value">' + unitFmt(item.stat.avg) + '</div>';
      summaryEl.appendChild(card);
    });

    renderBarChart("chart-weekly", weeklySeries(entries, valueKey, 8, today), compactFmt, isSpend);
    renderBarChart("chart-monthly", monthlySeries(entries, valueKey, 6, today), compactFmt, isSpend);
  }

  function renderBarChart(containerId, data, compactFmt, isSpend) {
    var el = document.getElementById(containerId);
    el.className = "bar-chart" + (isSpend ? "" : " bar-chart--pink");
    el.innerHTML = "";
    var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
    data.forEach(function (d) {
      var col = document.createElement("div");
      col.className = "bar-col";
      var pct = max > 0 ? (d.value / max) * 100 : 0;
      col.innerHTML =
        '<div class="bar-value">' + compactFmt(d.value) + '</div>' +
        '<div class="bar-fill" style="height:' + Math.max(2, pct) + '%"></div>' +
        '<div class="bar-label">' + d.label + '</div>';
      el.appendChild(col);
    });
  }

  /* ---------------- CSV backup ---------------- */

  function csvEscape(val) {
    var s = String(val);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(rows) {
    return rows.map(function (r) { return r.map(csvEscape).join(","); }).join("\r\n");
  }

  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n") {
        row.push(field); rows.push(row); row = []; field = "";
      } else if (c !== "\r") {
        field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0] === ""); });
  }

  function downloadFile(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportCSV() {
    var isSpend = analyticsTab === "spend";
    var entries = (isSpend ? getSpend() : getCalories()).slice().sort(function (a, b) { return a.ts - b.ts; });
    var header = isSpend ? ["Date", "Time", "Amount", "Description"] : ["Date", "Time", "Calories", "Description"];
    var rows = [header];
    entries.forEach(function (e) {
      rows.push([e.dateISO, fmtTime24(e.ts), isSpend ? e.amount : e.calories, e.desc]);
    });
    downloadFile(toCSV(rows), (isSpend ? "spend" : "calories") + "-export.csv", "text/csv");
  }

  function importCSVFile(file) {
    if (!file) return;
    var isSpend = analyticsTab === "spend";
    var valueKey = isSpend ? "amount" : "calories";
    var reader = new FileReader();
    reader.onload = function () {
      var rows = parseCSV(String(reader.result));
      var body = rows.slice(1);
      var parsed = [];
      body.forEach(function (r) {
        if (r.length < 4) return;
        var dateISO = r[0].trim();
        var time = r[1].trim();
        var value = parseFloat(r[2]);
        var desc = r[3];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !isFinite(value) || value < 0) return;
        var ts = parseISO(dateISO).getTime();
        var timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
        if (timeMatch) {
          ts += (parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseInt(timeMatch[3] || "0", 10)) * 1000;
        }
        var entry = { id: uid(), dateISO: dateISO, ts: ts, desc: desc };
        entry[valueKey] = value;
        parsed.push(entry);
      });
      if (!parsed.length) { alert("No valid rows found in that CSV."); return; }
      var label = isSpend ? "Spend" : "Calories";
      if (!confirm("Import " + parsed.length + " " + label + " record(s)? This will replace all existing " + label + " records.")) return;
      saveJSON(isSpend ? KEYS.spend : KEYS.calories, parsed);
      renderAnalytics();
    };
    reader.readAsText(file);
  }

  /* ---------------- Settings modal ---------------- */

  var overlayEl = document.getElementById("modal-overlay");
  var modalInputEl = document.getElementById("modal-input");
  var modalLabelEl = document.getElementById("modal-label");
  var modalTitleEl = document.getElementById("modal-title");
  var modalSaveBtn = document.getElementById("modal-save");
  var modalOnSave = null;

  function openModal(title, label, currentValue, onSave) {
    modalTitleEl.textContent = title;
    modalLabelEl.textContent = label;
    modalInputEl.value = currentValue || "";
    modalOnSave = onSave;
    overlayEl.classList.add("open");
    setTimeout(function () { modalInputEl.focus(); }, 50);
  }

  function closeModal() {
    overlayEl.classList.remove("open");
    modalOnSave = null;
  }

  modalSaveBtn.addEventListener("click", function () {
    var val = parseFloat(modalInputEl.value);
    if (!isFinite(val) || val < 0) return;
    if (modalOnSave) modalOnSave(val);
    closeModal();
  });

  overlayEl.addEventListener("click", function (ev) {
    if (ev.target === overlayEl) closeModal();
  });

  /* ---------------- Event delegation ---------------- */

  document.addEventListener("click", function (ev) {
    var target = ev.target.closest("[data-action]");
    if (!target) return;
    var action = target.dataset.action;

    if (action === "go-home") showScreen("home");
    else if (action === "go-spend") showScreen("spend");
    else if (action === "go-calories") showScreen("calories");
    else if (action === "go-analytics") { analyticsTab = "spend"; showScreen("analytics"); }
    else if (action === "close-modal") closeModal();
    else if (action === "open-settings-spend") {
      var s = getSettings();
      openModal("Monthly Budget", "Monthly Budget ($)", s.monthlyBudget || "", function (val) {
        setSettings({ monthlyBudget: val });
        renderSpend();
      });
    }
    else if (action === "open-settings-calories") {
      var s2 = getSettings();
      openModal("Daily Calorie Goal", "Calorie Goal (kcal)", s2.calorieGoal || "", function (val) {
        setSettings({ calorieGoal: val });
        renderCalories();
      });
    }
    else if (action === "analytics-tab") {
      analyticsTab = target.dataset.tab;
      renderAnalytics();
    }
    else if (action === "export-csv") {
      exportCSV();
    }
    else if (action === "import-csv") {
      document.getElementById("import-file-input").click();
    }
  });

  document.addEventListener("change", function (ev) {
    if (ev.target.id === "import-file-input") {
      importCSVFile(ev.target.files[0]);
      ev.target.value = "";
    }
  });

  /* ---------------- Init ---------------- */

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
  }

  showScreen("home");
})();
