/* =========================================================
   My Clock
   script.js
   ========================================================= */

"use strict";

/* =========================================================
   設定
   ========================================================= */

const SETTINGS_KEY = "my-clock-settings";
const TODO_KEY = "my-clock-todos";

const HOLIDAY_API_URL =
  "https://holidays-jp.github.io/api/v1/date.json";

const WEATHER_GEOCODING_URL =
  "https://geocoding-api.open-meteo.com/v1/search";

const WEATHER_FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast";


/* =========================================================
   アプリ状態
   ========================================================= */

const state = {
  currentMonth: new Date(),

  holidays: {},

  monthEvents: [],

  upcomingEvents: [],

  todos: [],

  weather: null,

  settings: {
    theme: "midnight",

    font: "system",

    weatherLocation: null,

    wakeLock: true,
  },

  wakeLock: null,

  googleConnected: false,
};


/* =========================================================
   DOM
   ========================================================= */

const $ = (selector) =>
  document.querySelector(selector);

const $$ = (selector) =>
  document.querySelectorAll(selector);


/* =========================================================
   初期化
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {

  loadSettings();

  loadTodos();

  applySettings();

  setupClock();

  setupCalendarNavigation();

  setupSettings();

  setupThemes();

  setupFonts();

  setupTodos();

  setupWeatherSearch();

  setupEventModal();

  setupGoogleConnection();

  setupWakeLock();

  await loadHolidays();

  renderCalendar();

  await checkGoogleStatus();

  await loadWeather();

  if (state.googleConnected) {
    await refreshGoogleData();
  }

  handleOAuthResult();

  /*
   * 定期更新
   *
   * Google APIを毎分叩かないよう、
   * 5分ごとに更新する。
   */
  setInterval(async () => {

    await checkGoogleStatus();

    if (state.googleConnected) {
      await refreshGoogleData();
    }

  }, 5 * 60 * 1000);


  /*
   * 日付が変わった場合にもカレンダーを更新
   */
  setInterval(() => {

    renderCalendar();

  }, 60 * 1000);

});


/* =========================================================
   時計
   ========================================================= */

function setupClock() {

  updateClock();

  setInterval(updateClock, 1000);
}


function updateClock() {

  const now = new Date();

  const hours =
    String(now.getHours()).padStart(2, "0");

  const minutes =
    String(now.getMinutes()).padStart(2, "0");

  const seconds =
    String(now.getSeconds()).padStart(2, "0");

  $("#clock-hour-minute").textContent =
    `${hours}:${minutes}`;

  $("#clock-seconds").textContent =
    seconds;

  updateDate(now);

  /*
   * 予定のカウントダウンも更新
   */
  renderUpcomingEvents();
}


function updateDate(date) {

  const weekdays = [
    "日",
    "月",
    "火",
    "水",
    "木",
    "金",
    "土",
  ];

  const text =
    `${date.getFullYear()}年` +
    `${date.getMonth() + 1}月` +
    `${date.getDate()}日` +
    `（${weekdays[date.getDay()]}）`;

  $("#date").textContent = text;
}


/* =========================================================
   設定
   ========================================================= */

function loadSettings() {

  try {

    const saved =
      localStorage.getItem(SETTINGS_KEY);

    if (!saved) {
      return;
    }

    const parsed = JSON.parse(saved);

    state.settings = {
      ...state.settings,
      ...parsed,
    };

  } catch (error) {

    console.error(
      "設定の読み込みに失敗:",
      error
    );

  }
}


function saveSettings() {

  try {

    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify(state.settings)
    );

  } catch (error) {

    console.error(
      "設定の保存に失敗:",
      error
    );

  }
}


/* =========================================================
   設定適用
   ========================================================= */

function applySettings() {

  document.body.dataset.theme =
    state.settings.theme;

  document.body.dataset.font =
    state.settings.font;

  updateThemeButtons();

  updateFontButtons();

  updateSelectedWeatherLocation();

  $("#wake-lock-toggle").checked =
    state.settings.wakeLock;

  if (state.settings.wakeLock) {
    requestWakeLock();
  }
}


/* =========================================================
   テーマ
   ========================================================= */

function setupThemes() {

  $$(".theme-option").forEach((button) => {

    button.addEventListener("click", () => {

      const theme =
        button.dataset.theme;

      state.settings.theme = theme;

      document.body.dataset.theme =
        theme;

      saveSettings();

      updateThemeButtons();

    });

  });
}


function updateThemeButtons() {

  $$(".theme-option").forEach((button) => {

    button.classList.toggle(
      "active",
      button.dataset.theme ===
        state.settings.theme
    );

  });
}


/* =========================================================
   フォント
   ========================================================= */

function setupFonts() {

  $$(".font-option").forEach((button) => {

    button.addEventListener("click", () => {

      const font =
        button.dataset.font;

      state.settings.font = font;

      document.body.dataset.font =
        font;

      saveSettings();

      updateFontButtons();

    });

  });
}


function updateFontButtons() {

  $$(".font-option").forEach((button) => {

    button.classList.toggle(
      "active",
      button.dataset.font ===
        state.settings.font
    );

  });
}


/* =========================================================
   カレンダー操作
   ========================================================= */

function setupCalendarNavigation() {

  $("#prev-month").addEventListener(
    "click",
    async () => {

      state.currentMonth.setMonth(
        state.currentMonth.getMonth() - 1
      );

      renderCalendar();

      if (state.googleConnected) {
        await loadMonthEvents();
      }

    }
  );


  $("#next-month").addEventListener(
    "click",
    async () => {

      state.currentMonth.setMonth(
        state.currentMonth.getMonth() + 1
      );

      renderCalendar();

      if (state.googleConnected) {
        await loadMonthEvents();
      }

    }
  );
}


/* =========================================================
   月間カレンダー
   ========================================================= */

function renderCalendar() {

  const year =
    state.currentMonth.getFullYear();

  const month =
    state.currentMonth.getMonth();

  $("#month-title").textContent =
    `${year}年${month + 1}月`;

  const grid =
    $("#calendar-grid");

  grid.innerHTML = "";

  const firstDay =
    new Date(year, month, 1).getDay();

  const daysInMonth =
    new Date(year, month + 1, 0).getDate();

  /*
   * 月初までの空白
   */
  for (let i = 0; i < firstDay; i++) {

    const empty =
      document.createElement("div");

    empty.className =
      "calendar-day empty";

    grid.appendChild(empty);
  }


  const today = new Date();


  for (let day = 1; day <= daysInMonth; day++) {

    const date =
      new Date(year, month, day);

    const dayOfWeek =
      date.getDay();

    const cell =
      document.createElement("div");

    cell.className =
      "calendar-day";


    if (dayOfWeek === 0) {
      cell.classList.add("sunday");
    }

    if (dayOfWeek === 6) {
      cell.classList.add("saturday");
    }


    /*
     * 今日
     */
    if (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    ) {
      cell.classList.add("today");
    }


    /*
     * 祝日
     */
    const dateKey =
      formatDateKey(date);

    if (state.holidays[dateKey]) {
      cell.classList.add("holiday");
      cell.title =
        state.holidays[dateKey];
    }


    /*
     * Google Calendar予定
     */
    if (hasEventOnDate(date)) {
      cell.classList.add("has-event");
    }


    const number =
      document.createElement("span");

    number.className =
      "calendar-day-number";

    number.textContent = day;

    cell.appendChild(number);

    grid.appendChild(cell);
  }
}


/* =========================================================
   日付キー
   ========================================================= */

function formatDateKey(date) {

  const year =
    date.getFullYear();

  const month =
    String(date.getMonth() + 1)
      .padStart(2, "0");

  const day =
    String(date.getDate())
      .padStart(2, "0");

  return `${year}-${month}-${day}`;
}


/* =========================================================
   祝日
   ========================================================= */

async function loadHolidays() {

  try {

    const response =
      await fetch(HOLIDAY_API_URL);

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    state.holidays =
      await response.json();

  } catch (error) {

    console.warn(
      "祝日データを取得できませんでした:",
      error
    );

    /*
     * 祝日APIが使えなくても、
     * カレンダーそのものは表示する。
     */
    state.holidays = {};
  }
}


/* =========================================================
   Google接続状態
   ========================================================= */

async function checkGoogleStatus() {

  try {

    const response =
      await fetch("/api/auth/status");

    const data =
      await response.json();

    state.googleConnected =
      Boolean(data.connected);

    updateGoogleStatus();

  } catch (error) {

    console.error(
      "Google接続状態の確認に失敗:",
      error
    );

    state.googleConnected = false;

    updateGoogleStatus();
  }
}


function updateGoogleStatus() {

  const dot =
    $("#google-status-dot");

  const text =
    $("#google-status");

  const settingsStatus =
    $("#settings-google-status");

  if (state.googleConnected) {

    dot.classList.add("connected");

    text.textContent =
      "Google接続済み";

    settingsStatus.textContent =
      "接続済み";

  } else {

    dot.classList.remove("connected");

    text.textContent =
      "Google未接続";

    settingsStatus.textContent =
      "未接続";
  }
}


/* =========================================================
   Google OAuth
   ========================================================= */

function setupGoogleConnection() {

  $("#google-disconnect-button")
    .addEventListener(
      "click",
      disconnectGoogle
    );
}


async function disconnectGoogle() {

  const confirmed =
    window.confirm(
      "Googleとの接続を解除しますか？"
    );

  if (!confirmed) {
    return;
  }

  try {

    const response =
      await fetch(
        "/auth/logout",
        {
          method: "POST",
        }
      );

    const data =
      await response.json();

    if (!data.success) {
      throw new Error(
        data.message ||
        "接続解除に失敗しました"
      );
    }

    state.googleConnected =
      false;

    state.upcomingEvents = [];

    state.monthEvents = [];

    updateGoogleStatus();

    renderCalendar();

    renderUpcomingEvents();

    renderGmail([]);

    showToast(
      "Googleとの接続を解除しました"
    );

  } catch (error) {

    console.error(error);

    showToast(
      "Googleとの接続解除に失敗しました"
    );
  }
}


/* =========================================================
   OAuth結果
   ========================================================= */

function handleOAuthResult() {

  const params =
    new URLSearchParams(
      window.location.search
    );

  const result =
    params.get("google");

  if (result === "connected") {

    showToast(
      "Googleと接続しました"
    );

    window.history.replaceState(
      {},
      "",
      window.location.pathname
    );

    return;
  }

  if (result === "error") {

    showToast(
      "Google接続に失敗しました"
    );

    window.history.replaceState(
      {},
      "",
      window.location.pathname
    );
  }
}


/* =========================================================
   Googleデータ更新
   ========================================================= */

async function refreshGoogleData() {

  await Promise.all([
    loadUpcomingEvents(),
    loadMonthEvents(),
    loadGmail(),
  ]);
}


/* =========================================================
   Calendar：次の予定
   ========================================================= */

async function loadUpcomingEvents() {

  try {

    const response =
      await fetch(
        "/api/calendar/upcoming?limit=3"
      );

    if (response.status === 401) {

      state.googleConnected = false;

      updateGoogleStatus();

      return;
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    state.upcomingEvents =
      data.events || [];

    renderUpcomingEvents();

  } catch (error) {

    console.error(
      "予定取得エラー:",
      error
    );

    $("#calendar").innerHTML =
      `<div class="empty-state">
        予定の取得に失敗しました
      </div>`;
  }
}


/* =========================================================
   Calendar：月間予定
   ========================================================= */

async function loadMonthEvents() {

  const year =
    state.currentMonth.getFullYear();

  const month =
    state.currentMonth.getMonth() + 1;

  try {

    const response =
      await fetch(
        `/api/calendar/month?year=${year}&month=${month}`
      );

    if (response.status === 401) {

      state.googleConnected = false;

      updateGoogleStatus();

      return;
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    state.monthEvents =
      data.events || [];

    renderCalendar();

  } catch (error) {

    console.error(
      "月間予定取得エラー:",
      error
    );
  }
}


/* =========================================================
   予定が特定の日に存在するか
   ========================================================= */

function hasEventOnDate(date) {

  if (!state.monthEvents.length) {
    return false;
  }

  const target =
    formatDateKey(date);

  return state.monthEvents.some(
    (event) => {

      const start =
        getEventStartDate(event);

      const end =
        getEventEndDate(event);

      if (!start) {
        return false;
      }

      /*
       * 終日イベントのend.dateは
       * 「終了日の翌日」なので、
       * endを含めない。
       */
      let current =
        new Date(start);

      const last =
        end
          ? new Date(end)
          : new Date(start);

      while (
        current <= last
      ) {

        const key =
          formatDateKey(current);

        if (key === target) {
          return true;
        }

        current.setDate(
          current.getDate() + 1
        );

        /*
         * 念のため無限ループ防止
         */
        if (
          current.getTime() -
            new Date(start).getTime() >
          1000 * 60 * 60 * 24 * 370
        ) {
          break;
        }
      }

      return false;
    }
  );
}


/* =========================================================
   イベント開始日時
   ========================================================= */

function getEventStartDate(event) {

  if (!event.start) {
    return null;
  }

  if (event.start.date) {

    const [y, m, d] =
      event.start.date
        .split("-")
        .map(Number);

    return new Date(
      y,
      m - 1,
      d
    );
  }

  if (event.start.dateTime) {
    return new Date(
      event.start.dateTime
    );
  }

  return null;
}


/* =========================================================
   イベント終了日時
   ========================================================= */

function getEventEndDate(event) {

  if (!event.end) {
    return null;
  }

  if (event.end.date) {

    const [y, m, d] =
      event.end.date
        .split("-")
        .map(Number);

    /*
     * Google Calendarの終日イベントのend.dateは
     * 終了日の翌日。
     */
    const date =
      new Date(
        y,
        m - 1,
        d
      );

    date.setDate(
      date.getDate() - 1
    );

    return date;
  }

  if (event.end.dateTime) {
    return new Date(
      event.end.dateTime
    );
  }

  return null;
}


/* =========================================================
   NEXT予定表示
   ========================================================= */

function renderUpcomingEvents() {

  const container =
    $("#calendar");

  if (!state.googleConnected) {

    container.innerHTML =
      `<div class="empty-state">
        Googleカレンダーと接続すると
        予定が表示されます
      </div>`;

    return;
  }


  if (!state.upcomingEvents.length) {

    container.innerHTML =
      `<div class="empty-state">
        今後の予定はありません
      </div>`;

    return;
  }


  container.innerHTML = "";


  state.upcomingEvents.forEach(
    (event) => {

      const card =
        document.createElement("div");

      card.className =
        "event-card";


      const top =
        document.createElement("div");

      top.className =
        "event-top";


      const time =
        document.createElement("div");

      time.className =
        "event-time";

      time.textContent =
        formatEventTime(event);


      const countdown =
        document.createElement("div");

      countdown.className =
        "event-countdown";

      countdown.textContent =
        getCountdownText(event);


      top.appendChild(time);

      top.appendChild(countdown);


      const title =
        document.createElement("div");

      title.className =
        "event-title";

      title.textContent =
        event.summary ||
        "(タイトルなし)";


      card.appendChild(top);

      card.appendChild(title);


      if (event.location) {

        const location =
          document.createElement("div");

        location.className =
          "event-location";

        location.textContent =
          `📍 ${event.location}`;

        card.appendChild(location);
      }


      if (event.description) {

        const description =
          document.createElement("div");

        description.className =
          "event-description-preview";

        description.textContent =
          removeHtml(
            event.description
          );

        card.appendChild(description);
      }


      card.addEventListener(
        "click",
        () => {
          openEventModal(event);
        }
      );


      container.appendChild(card);
    }
  );
}


/* =========================================================
   予定時刻
   ========================================================= */

function formatEventTime(event) {

  if (event.allDay) {
    return "終日";
  }

  const date =
    getEventStartDate(event);

  if (!date) {
    return "";
  }

  const month =
    date.getMonth() + 1;

  const day =
    date.getDate();

  const hours =
    String(date.getHours())
      .padStart(2, "0");

  const minutes =
    String(date.getMinutes())
      .padStart(2, "0");

  return `${month}/${day} ${hours}:${minutes}`;
}


/* =========================================================
   カウントダウン
   ========================================================= */

function getCountdownText(event) {

  if (event.allDay) {
    return "";
  }

  const start =
    getEventStartDate(event);

  if (!start) {
    return "";
  }

  const now =
    new Date();

  const diff =
    start.getTime() -
    now.getTime();

  if (diff < 0) {
    return "開始済み";
  }


  const minutes =
    Math.floor(
      diff / 1000 / 60
    );


  if (minutes < 1) {
    return "まもなく";
  }

  if (minutes < 60) {
    return `あと${minutes}分`;
  }


  const hours =
    Math.floor(
      minutes / 60
    );


  if (hours < 24) {

    const remainingMinutes =
      minutes % 60;

    if (remainingMinutes === 0) {
      return `あと${hours}時間`;
    }

    return `あと${hours}時間${remainingMinutes}分`;
  }


  const days =
    Math.floor(
      hours / 24
    );

  return `あと${days}日`;
}


/* =========================================================
   Gmail
   ========================================================= */

async function loadGmail() {

  try {

    const response =
      await fetch(
        "/api/gmail/unread?limit=5"
      );

    if (response.status === 401) {

      state.googleConnected = false;

      updateGoogleStatus();

      return;
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    renderGmail(
      data.messages || []
    );

  } catch (error) {

    console.error(
      "Gmail取得エラー:",
      error
    );

    $("#gmail").innerHTML =
      `<div class="empty-state">
        Gmailの取得に失敗しました
      </div>`;

    $("#gmail-count").textContent =
      "－";
  }
}


/* =========================================================
   Gmail表示
   ========================================================= */

function renderGmail(messages) {

  const container =
    $("#gmail");

  $("#gmail-count").textContent =
    messages.length;


  if (!messages.length) {

    container.innerHTML =
      `<div class="empty-state">
        未読メールはありません
      </div>`;

    return;
  }


  container.innerHTML = "";


  messages.forEach(
    (message) => {

      const item =
        document.createElement("div");

      item.className =
        "mail-item";


      const from =
        document.createElement("div");

      from.className =
        "mail-from";

      from.textContent =
        cleanSender(
          message.from
        );


      const subject =
        document.createElement("div");

      subject.className =
        "mail-subject";

      subject.textContent =
        message.subject ||
        "(件名なし)";


      const date =
        document.createElement("div");

      date.className =
        "mail-date";

      date.textContent =
        formatMailDate(
          message.date
        );


      item.appendChild(from);

      item.appendChild(subject);

      item.appendChild(date);


      item.addEventListener(
        "click",
        () => {

          const url =
            `https://mail.google.com/mail/u/0/#all/${message.id}`;

          window.open(
            url,
            "_blank",
            "noopener,noreferrer"
          );
        }
      );


      container.appendChild(item);
    }
  );
}


/* =========================================================
   Gmail送信者
   ========================================================= */

function cleanSender(value) {

  if (!value) {
    return "";
  }

  /*
   * 例:
   * "Google <noreply@example.com>"
   *
   * 表示を短くするため、
   * メールアドレス部分を除く。
   */
  const match =
    value.match(/^"?([^"<]+)"?\s*</);

  if (match) {
    return match[1].trim();
  }

  return value;
}


/* =========================================================
   Gmail日付
   ========================================================= */

function formatMailDate(value) {

  if (!value) {
    return "";
  }

  const date =
    new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now =
    new Date();

  if (
    date.getFullYear() ===
      now.getFullYear() &&
    date.getMonth() ===
      now.getMonth() &&
    date.getDate() ===
      now.getDate()
  ) {

    return date.toLocaleTimeString(
      "ja-JP",
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  }

  return date.toLocaleDateString(
    "ja-JP",
    {
      month: "numeric",
      day: "numeric",
    }
  );
}


/* =========================================================
   天気
   ========================================================= */

async function loadWeather() {

  const location =
    state.settings.weatherLocation;

  if (!location) {

    $("#weather").innerHTML =
      `<span class="weather-icon">－</span>
       <span class="weather-text">
         天気を設定
       </span>`;

    return;
  }


  try {

    const url =
      new URL(
        WEATHER_FORECAST_URL
      );

    url.searchParams.set(
      "latitude",
      location.latitude
    );

    url.searchParams.set(
      "longitude",
      location.longitude
    );

    url.searchParams.set(
      "current",
      "temperature_2m,weather_code"
    );

    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min"
    );

    url.searchParams.set(
      "timezone",
      "auto"
    );

    url.searchParams.set(
      "forecast_days",
      "1"
    );


    const response =
      await fetch(url);

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }


    const data =
      await response.json();


    state.weather = data;


    renderWeather(data);

  } catch (error) {

    console.error(
      "天気取得エラー:",
      error
    );

    $("#weather").innerHTML =
      `<span class="weather-icon">－</span>
       <span class="weather-text">
         天気取得失敗
       </span>`;
  }
}


/* =========================================================
   天気表示
   ========================================================= */

function renderWeather(data) {

  const current =
    data.current;

  const daily =
    data.daily;


  if (!current) {
    return;
  }


  const weather =
    weatherCodeInfo(
      current.weather_code
    );


  const temperature =
    Math.round(
      current.temperature_2m
    );


  let text =
    `${weather.icon} ${temperature}℃`;


  if (
    daily &&
    daily.temperature_2m_max &&
    daily.temperature_2m_min
  ) {

    const max =
      Math.round(
        daily.temperature_2m_max[0]
      );

    const min =
      Math.round(
        daily.temperature_2m_min[0]
      );

    text +=
      `  ${min}〜${max}℃`;
  }


  $("#weather").innerHTML =
    `<span class="weather-icon">
       ${weather.icon}
     </span>
     <span class="weather-text">
       ${escapeHtml(text)}
     </span>`;

}


/* =========================================================
   天気コード
   ========================================================= */

function weatherCodeInfo(code) {

  const map = {

    0: {
      icon: "☀",
      text: "快晴",
    },

    1: {
      icon: "🌤",
      text: "晴れ",
    },

    2: {
      icon: "⛅",
      text: "晴れ時々曇り",
    },

    3: {
      icon: "☁",
      text: "曇り",
    },

    45: {
      icon: "🌫",
      text: "霧",
    },

    48: {
      icon: "🌫",
      text: "霧",
    },

    51: {
      icon: "🌦",
      text: "霧雨",
    },

    53: {
      icon: "🌦",
      text: "霧雨",
    },

    55: {
      icon: "🌧",
      text: "霧雨",
    },

    61: {
      icon: "🌧",
      text: "雨",
    },

    63: {
      icon: "🌧",
      text: "雨",
    },

    65: {
      icon: "🌧",
      text: "強い雨",
    },

    71: {
      icon: "🌨",
      text: "雪",
    },

    73: {
      icon: "🌨",
      text: "雪",
    },

    75: {
      icon: "❄",
      text: "大雪",
    },

    80: {
      icon: "🌦",
      text: "にわか雨",
    },

    81: {
      icon: "🌦",
      text: "にわか雨",
    },

    82: {
      icon: "🌧",
      text: "激しいにわか雨",
    },

    95: {
      icon: "⛈",
      text: "雷雨",
    },

    96: {
      icon: "⛈",
      text: "雷雨",
    },

    99: {
      icon: "⛈",
      text: "雷雨",
    },

  };


  return (
    map[code] || {
      icon: "🌤",
      text: "天気",
    }
  );
}


/* =========================================================
   天気検索
   ========================================================= */

function setupWeatherSearch() {

  $("#weather-search-button")
    .addEventListener(
      "click",
      searchWeatherLocation
    );


  $("#weather-search-input")
    .addEventListener(
      "keydown",
      (event) => {

        if (event.key === "Enter") {

          event.preventDefault();

          searchWeatherLocation();
        }
      }
    );
}


async function searchWeatherLocation() {

  const input =
    $("#weather-search-input");

  const keyword =
    input.value.trim();


  if (!keyword) {

    $("#weather-search-status")
      .textContent =
        "都市名を入力してください。";

    return;
  }


  const status =
    $("#weather-search-status");

  const results =
    $("#weather-search-results");


  status.textContent =
    "検索しています…";

  results.innerHTML = "";


  try {

    const url =
      new URL(
        WEATHER_GEOCODING_URL
      );

    url.searchParams.set(
      "name",
      keyword
    );

    url.searchParams.set(
      "count",
      "8"
    );

    url.searchParams.set(
      "language",
      "ja"
    );

    url.searchParams.set(
      "format",
      "json"
    );


    const response =
      await fetch(url);

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }


    const data =
      await response.json();


    if (
      !data.results ||
      data.results.length === 0
    ) {

      status.textContent =
        "該当する場所が見つかりませんでした。";

      return;
    }


    status.textContent =
      "表示する場所を選択してください。";


    data.results.forEach(
      (location) => {

        const button =
          document.createElement("button");

        button.type =
          "button";

        button.className =
          "weather-result";


        const name =
          document.createElement("div");

        name.className =
          "weather-result-name";

        name.textContent =
          location.name;


        const detail =
          document.createElement("div");

        detail.className =
          "weather-result-detail";

        const parts = [];

        if (location.admin1) {
          parts.push(
            location.admin1
          );
        }

        if (location.country) {
          parts.push(
            location.country
          );
        }

        detail.textContent =
          parts.join(" / ");


        button.appendChild(name);

        button.appendChild(detail);


        button.addEventListener(
          "click",
          async () => {

            await selectWeatherLocation(
              location
            );
          }
        );


        results.appendChild(button);
      }
    );

  } catch (error) {

    console.error(
      "天気場所検索エラー:",
      error
    );

    status.textContent =
      "場所の検索に失敗しました。";
  }
}


/* =========================================================
   天気場所選択
   ========================================================= */

async function selectWeatherLocation(
  location
) {

  state.settings.weatherLocation = {

    name:
      location.name,

    latitude:
      location.latitude,

    longitude:
      location.longitude,

    country:
      location.country || "",

    admin1:
      location.admin1 || "",
  };


  saveSettings();

  updateSelectedWeatherLocation();

  $("#weather-search-results")
    .innerHTML = "";

  $("#weather-search-status")
    .textContent =
      "場所を設定しました。";


  await loadWeather();

  showToast(
    `${location.name}の天気を表示します`
  );
}


function updateSelectedWeatherLocation() {

  const element =
    $("#selected-weather-location");

  const location =
    state.settings.weatherLocation;


  if (!location) {

    element.textContent =
      "未設定";

    return;
  }


  const parts = [
    location.name,
  ];


  if (
    location.admin1 &&
    location.admin1 !== location.name
  ) {
    parts.push(
      location.admin1
    );
  }


  element.textContent =
    parts.join(" / ");
}


/* =========================================================
   TODO
   ========================================================= */

function loadTodos() {

  try {

    const saved =
      localStorage.getItem(TODO_KEY);

    if (!saved) {

      state.todos = [];

      renderTodos();

      return;
    }


    const parsed =
      JSON.parse(saved);

    if (Array.isArray(parsed)) {

      state.todos = parsed;

    } else {

      state.todos = [];
    }

  } catch (error) {

    console.error(
      "TODO読み込みエラー:",
      error
    );

    state.todos = [];
  }


  renderTodos();
}


function saveTodos() {

  try {

    localStorage.setItem(
      TODO_KEY,
      JSON.stringify(
        state.todos
      )
    );

  } catch (error) {

    console.error(
      "TODO保存エラー:",
      error
    );
  }
}


function setupTodos() {

  $("#todo-form")
    .addEventListener(
      "submit",
      (event) => {

        event.preventDefault();

        addTodo();
      }
    );
}


function addTodo() {

  const input =
    $("#todo-input");

  const text =
    input.value.trim();


  if (!text) {
    return;
  }


  const todo = {

    id:
      Date.now().toString(36) +
      Math.random()
        .toString(36)
        .slice(2),

    text,

    completed: false,

    createdAt:
      new Date().toISOString(),
  };


  state.todos.unshift(todo);


  /*
   * 多すぎないよう100件まで
   */
  state.todos =
    state.todos.slice(0, 100);


  saveTodos();

  renderTodos();


  input.value = "";

  input.focus();
}


function toggleTodo(id) {

  const todo =
    state.todos.find(
      (item) =>
        item.id === id
    );


  if (!todo) {
    return;
  }


  todo.completed =
    !todo.completed;


  saveTodos();

  renderTodos();
}


function deleteTodo(id) {

  state.todos =
    state.todos.filter(
      (item) =>
        item.id !== id
    );


  saveTodos();

  renderTodos();
}


function renderTodos() {

  const container =
    $("#todo-list");

  const count =
    $("#todo-count");


  const incompleteCount =
    state.todos.filter(
      (todo) =>
        !todo.completed
    ).length;


  count.textContent =
    incompleteCount;


  container.innerHTML = "";


  if (!state.todos.length) {

    const empty =
      document.createElement("div");

    empty.className =
      "empty-state";

    empty.textContent =
      "やることはありません";

    container.appendChild(empty);

    return;
  }


  state.todos.forEach(
    (todo) => {

      const item =
        document.createElement("div");

      item.className =
        "todo-item";


      if (todo.completed) {
        item.classList.add(
          "completed"
        );
      }


      const checkbox =
        document.createElement("input");

      checkbox.type =
        "checkbox";

      checkbox.className =
        "todo-check";

      checkbox.checked =
        todo.completed;


      checkbox.addEventListener(
        "change",
        () => {
          toggleTodo(todo.id);
        }
      );


      const text =
        document.createElement("div");

      text.className =
        "todo-text";

      text.textContent =
        todo.text;

      text.title =
        todo.text;


      const deleteButton =
        document.createElement("button");

      deleteButton.type =
        "button";

      deleteButton.className =
        "todo-delete";

      deleteButton.textContent =
        "×";

      deleteButton.title =
        "削除";


      deleteButton.addEventListener(
        "click",
        () => {
          deleteTodo(todo.id);
        }
      );


      item.appendChild(
        checkbox
      );

      item.appendChild(
        text
      );

      item.appendChild(
        deleteButton
      );


      container.appendChild(item);
    }
  );
}


/* =========================================================
   Wake Lock
   ========================================================= */

function setupWakeLock() {

  $("#wake-lock-toggle")
    .addEventListener(
      "change",
      async (event) => {

        const enabled =
          event.target.checked;

        state.settings.wakeLock =
          enabled;

        saveSettings();


        if (enabled) {

          await requestWakeLock();

        } else {

          releaseWakeLock();
        }

        updateWakeLockStatus();
      }
    );


  updateWakeLockStatus();


  document.addEventListener(
    "visibilitychange",
    async () => {

      if (
        document.visibilityState ===
          "visible" &&
        state.settings.wakeLock
      ) {

        await requestWakeLock();
      }
    }
  );
}


async function requestWakeLock() {

  if (
    !state.settings.wakeLock
  ) {
    return;
  }


  if (
    !("wakeLock" in navigator)
  ) {

    updateWakeLockStatus(
      "このブラウザではスリープ防止に対応していません。"
    );

    return;
  }


  try {

    state.wakeLock =
      await navigator.wakeLock.request(
        "screen"
      );


    state.wakeLock.addEventListener(
      "release",
      () => {

        state.wakeLock = null;

        updateWakeLockStatus();
      }
    );


    updateWakeLockStatus(
      "画面スリープ防止中"
    );

  } catch (error) {

    console.warn(
      "Wake Lockを取得できませんでした:",
      error
    );

    updateWakeLockStatus(
      "スリープ防止を開始できませんでした。"
    );
  }
}


function releaseWakeLock() {

  if (!state.wakeLock) {
    return;
  }


  state.wakeLock.release();

  state.wakeLock = null;

  updateWakeLockStatus();
}


function updateWakeLockStatus(
  customText = null
) {

  const element =
    $("#wake-lock-status");


  if (customText) {

    element.textContent =
      customText;

    return;
  }


  if (
    !("wakeLock" in navigator)
  ) {

    element.textContent =
      "このブラウザでは対応していません。";

    return;
  }


  if (
    state.settings.wakeLock
  ) {

    element.textContent =
      "画面を表示している間、スリープを防止します。";

  } else {

    element.textContent =
      "画面スリープ防止はオフです。";
  }
}


/* =========================================================
   設定画面
   ========================================================= */

function setupSettings() {

  const overlay =
    $("#settings-overlay");


  $("#settings-button")
    .addEventListener(
      "click",
      () => {

        updateSelectedWeatherLocation();

        updateGoogleStatus();

        overlay.classList.remove(
          "hidden"
        );
      }
    );


  $("#settings-close")
    .addEventListener(
      "click",
      closeSettings
    );


  $("#settings-done")
    .addEventListener(
      "click",
      closeSettings
    );


  overlay.addEventListener(
    "click",
    (event) => {

      if (
        event.target === overlay
      ) {

        closeSettings();
      }
    }
  );


  document.addEventListener(
    "keydown",
    (event) => {

      if (
        event.key === "Escape"
      ) {

        if (
          !$("#settings-overlay")
            .classList.contains(
              "hidden"
            )
        ) {

          closeSettings();

        } else if (
          !$("#event-overlay")
            .classList.contains(
              "hidden"
            )
        ) {

          closeEventModal();
        }
      }
    }
  );
}


function closeSettings() {

  $("#settings-overlay")
    .classList.add(
      "hidden"
    );
}


/* =========================================================
   カレンダー予定詳細
   ========================================================= */

function setupEventModal() {

  const overlay =
    $("#event-overlay");


  $("#event-modal-close")
    .addEventListener(
      "click",
      closeEventModal
    );


  overlay.addEventListener(
    "click",
    (event) => {

      if (
        event.target === overlay
      ) {

        closeEventModal();
      }
    }
  );
}


function openEventModal(event) {

  const overlay =
    $("#event-overlay");


  $("#event-modal-title")
    .textContent =
      event.summary ||
      "(タイトルなし)";


  const body =
    $("#event-modal-body");


  body.innerHTML = "";


  /*
   * 日時
   */
  addDetailRow(
    body,
    "日時",
    formatEventDateTime(
      event
    )
  );


  /*
   * 場所
   */
  if (event.location) {

    addDetailRow(
      body,
      "場所",
      event.location
    );
  }


  /*
   * 説明
   */
  if (event.description) {

    addDetailRow(
      body,
      "説明",
      removeHtml(
        event.description
      )
    );
  }


  /*
   * 主催者
   */
  if (event.organizer) {

    addDetailRow(
      body,
      "主催者",
      event.organizer
    );
  }


  /*
   * Googleカレンダー
   */
  if (event.htmlLink) {

    const row =
      document.createElement("div");

    row.className =
      "detail-row";


    const label =
      document.createElement("div");

    label.className =
      "detail-label";

    label.textContent =
      "Googleカレンダー";


    const link =
      document.createElement("a");

    link.className =
      "detail-link";

    link.href =
      event.htmlLink;

    link.target =
      "_blank";

    link.rel =
      "noopener noreferrer";

    link.textContent =
      "カレンダーで開く →";


    row.appendChild(label);

    row.appendChild(link);

    body.appendChild(row);
  }


  overlay.classList.remove(
    "hidden"
  );
}


function closeEventModal() {

  $("#event-overlay")
    .classList.add(
      "hidden"
    );
}


function addDetailRow(
  container,
  labelText,
  valueText
) {

  const row =
    document.createElement("div");

  row.className =
    "detail-row";


  const label =
    document.createElement("div");

  label.className =
    "detail-label";

  label.textContent =
    labelText;


  const value =
    document.createElement("div");

  value.className =
    "detail-value";

  value.textContent =
    valueText;


  row.appendChild(label);

  row.appendChild(value);

  container.appendChild(row);
}


/* =========================================================
   イベント日時詳細
   ========================================================= */

function formatEventDateTime(event) {

  const start =
    getEventStartDate(event);

  const end =
    getEventEndDate(event);


  if (!start) {
    return "";
  }


  if (event.allDay) {

    if (
      end &&
      start.getTime() !==
        end.getTime()
    ) {

      return (
        `${formatDateJapanese(start)} ～ ` +
        `${formatDateJapanese(end)}`
      );
    }

    return formatDateJapanese(
      start
    );
  }


  const startText =
    formatDateTimeJapanese(
      start
    );


  if (!end) {
    return startText;
  }


  const endText =
    formatDateTimeJapanese(
      end
    );


  return `${startText} ～ ${endText}`;
}


function formatDateJapanese(date) {

  return (
    `${date.getFullYear()}年` +
    `${date.getMonth() + 1}月` +
    `${date.getDate()}日`
  );
}


function formatDateTimeJapanese(date) {

  return (
    `${formatDateJapanese(date)} ` +
    `${String(date.getHours()).padStart(2, "0")}:` +
    `${String(date.getMinutes()).padStart(2, "0")}`
  );
}


/* =========================================================
   ユーティリティ
   ========================================================= */

function removeHtml(value) {

  if (!value) {
    return "";
  }

  const temp =
    document.createElement("div");

  temp.innerHTML =
    value;

  return (
    temp.textContent ||
    temp.innerText ||
    ""
  );
}


function escapeHtml(value) {

  if (value === null ||
      value === undefined) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================================
   Toast
   ========================================================= */

let toastTimer = null;


function showToast(message) {

  const toast =
    $("#toast");

  toast.textContent =
    message;

  toast.classList.remove(
    "hidden"
  );


  if (toastTimer) {
    clearTimeout(
      toastTimer
    );
  }


  toastTimer =
    setTimeout(
      () => {

        toast.classList.add(
          "hidden"
        );

      },
      3000
    );
}

/* =========================================================
   毎時5分前の控えめな色変化
   ========================================================= */

function updateHourSoonMode() {

  const now = new Date();

  const minute = now.getMinutes();

  /*
   * 毎時55分〜59分
   */
  const enabled = minute >= 55;

  document.body.classList.toggle(
    "hour-soon",
    enabled
  );
}


updateHourSoonMode();

setInterval(
  updateHourSoonMode,
  10 * 1000
);