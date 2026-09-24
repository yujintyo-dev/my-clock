const express = require("express");
const session = require("express-session");
const { google } = require("googleapis");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 3000;

const TOKEN_PATH = path.join(__dirname, "data", "google-token.json");
const PUBLIC_PATH = path.join(__dirname, "public");

// Google OAuthで利用する権限
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
];

// --------------------------------------------------
// 基本設定
// --------------------------------------------------

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

// publicフォルダの中だけをWeb公開する
app.use(express.static(PUBLIC_PATH));

// --------------------------------------------------
// Google OAuth
// --------------------------------------------------

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// トークンを読み込む
async function loadTokens() {
  try {
    const text = await fs.readFile(TOKEN_PATH, "utf8");
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

// トークンを保存する
async function saveTokens(tokens) {
  await fs.mkdir(path.dirname(TOKEN_PATH), {
    recursive: true,
  });

  await fs.writeFile(
    TOKEN_PATH,
    JSON.stringify(tokens, null, 2),
    "utf8"
  );
}

// トークンを削除する
async function deleteTokens() {
  try {
    await fs.unlink(TOKEN_PATH);
  } catch (error) {
    // ファイルが存在しなくても問題なし
  }
}

// Google APIを利用できる状態か確認
async function getGoogleClient() {
  const tokens = await loadTokens();

  if (!tokens) {
    return null;
  }

  const client = createOAuthClient();

  client.setCredentials(tokens);

  // アクセストークンが更新されたとき、
  // 新しいトークンをサーバー側に保存する
  client.on("tokens", async (newTokens) => {
    try {
      const currentTokens = await loadTokens();

      const mergedTokens = {
        ...(currentTokens || {}),
        ...newTokens,
      };

      await saveTokens(mergedTokens);
    } catch (error) {
      console.error("トークン保存エラー:", error);
    }
  });

  return client;
}

// --------------------------------------------------
// Google OAuth開始
// --------------------------------------------------

app.get("/auth/google", (req, res) => {
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET ||
    !process.env.GOOGLE_REDIRECT_URI
  ) {
    return res.status(500).send(`
      <h1>Google OAuthの設定がありません</h1>
      <p>.env ファイルを確認してください。</p>
    `);
  }

  // CSRF対策用のランダムなstate
  const state = crypto.randomBytes(32).toString("hex");

  req.session.oauthState = state;

  const oauth2Client = createOAuthClient();

  const authorizationUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    include_granted_scopes: true,
    state,
    prompt: "consent",
  });

  res.redirect(authorizationUrl);
});

// --------------------------------------------------
// Google OAuthコールバック
// --------------------------------------------------

app.get("/oauth2callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error("Google OAuthエラー:", error);
      return res.redirect("/?google=error");
    }

    // stateを確認
    if (!state || state !== req.session.oauthState) {
      return res.status(400).send("OAuth stateが一致しません。");
    }

    // 一度使ったstateは削除
    delete req.session.oauthState;

    if (!code) {
      return res.status(400).send("認証コードがありません。");
    }

    const oauth2Client = createOAuthClient();

    // 認証コードをトークンに交換
    const { tokens } = await oauth2Client.getToken(code);

    // 既存トークンがあれば、
    // refresh_tokenなどを失わないように統合
    const oldTokens = await loadTokens();

    const mergedTokens = {
      ...(oldTokens || {}),
      ...tokens,
    };

    await saveTokens(mergedTokens);

    console.log("Google OAuth認証成功");

    res.redirect("/?google=connected");
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.redirect("/?google=error");
  }
});

// --------------------------------------------------
// Google接続状態
// --------------------------------------------------

app.get("/api/auth/status", async (req, res) => {
  const tokens = await loadTokens();

  res.json({
    connected: !!tokens,
  });
});

// --------------------------------------------------
// Google接続解除
// --------------------------------------------------

app.post("/auth/logout", async (req, res) => {
  try {
    await deleteTokens();

    res.json({
      success: true,
    });
  } catch (error) {
    console.error("ログアウトエラー:", error);

    res.status(500).json({
      success: false,
      message: "接続解除に失敗しました。",
    });
  }
});

// --------------------------------------------------
// Google Calendar
// --------------------------------------------------

function normalizeCalendarEvent(event) {
  const allDay = !!event.start?.date;

  return {
    id: event.id,
    summary: event.summary || "(タイトルなし)",
    description: event.description || "",
    location: event.location || "",
    htmlLink: event.htmlLink || "",

    start: event.start || {},
    end: event.end || {},

    allDay,

    creator: event.creator?.email || "",
    organizer: event.organizer?.email || "",

    status: event.status || "",
  };
}

// 次の予定を取得
app.get("/api/calendar/upcoming", async (req, res) => {
  try {
    const auth = await getGoogleClient();

    if (!auth) {
      return res.status(401).json({
        connected: false,
        message: "Googleと接続してください。",
      });
    }

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 3, 1),
      10
    );

    const calendar = google.calendar({
      version: "v3",
      auth,
    });

    const result = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults: limit,
      singleEvents: true,
      orderBy: "startTime",
      showDeleted: false,
      timeZone: "Asia/Tokyo",
    });

    const events = (result.data.items || []).map(
      normalizeCalendarEvent
    );

    res.json({
      connected: true,
      events,
    });
  } catch (error) {
    console.error("Calendar取得エラー:", error);

    if (error.code === 401) {
      await deleteTokens();

      return res.status(401).json({
        connected: false,
        message: "Googleの認証が無効になっています。",
      });
    }

    res.status(500).json({
      message: "カレンダーの取得に失敗しました。",
    });
  }
});

// 月間カレンダー用の予定を取得
app.get("/api/calendar/month", async (req, res) => {
  try {
    const auth = await getGoogleClient();

    if (!auth) {
      return res.status(401).json({
        connected: false,
        message: "Googleと接続してください。",
      });
    }

    const year = Number(req.query.year);
    const month = Number(req.query.month);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      return res.status(400).json({
        message: "年月が正しくありません。",
      });
    }

    const monthString = String(month).padStart(2, "0");

    const nextYear =
      month === 12 ? year + 1 : year;

    const nextMonth =
      month === 12 ? 1 : month + 1;

    const nextMonthString =
      String(nextMonth).padStart(2, "0");

    // 日本時間で月初～翌月月初
    const timeMin =
      `${year}-${monthString}-01T00:00:00+09:00`;

    const timeMax =
      `${nextYear}-${nextMonthString}-01T00:00:00+09:00`;

    const calendar = google.calendar({
      version: "v3",
      auth,
    });

    const result = await calendar.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      maxResults: 2500,
      singleEvents: true,
      orderBy: "startTime",
      showDeleted: false,
      timeZone: "Asia/Tokyo",
    });

    const events = (result.data.items || []).map(
      normalizeCalendarEvent
    );

    res.json({
      connected: true,
      events,
    });
  } catch (error) {
    console.error("月間Calendar取得エラー:", error);

    if (error.code === 401) {
      await deleteTokens();

      return res.status(401).json({
        connected: false,
        message: "Googleの認証が無効になっています。",
      });
    }

    res.status(500).json({
      message: "月間カレンダーの取得に失敗しました。",
    });
  }
});

// --------------------------------------------------
// Gmail
// --------------------------------------------------

function getHeader(message, name) {
  const headers =
    message.payload?.headers || [];

  const header = headers.find(
    (item) =>
      item.name.toLowerCase() === name.toLowerCase()
  );

  return header?.value || "";
}

app.get("/api/gmail/unread", async (req, res) => {
  try {
    const auth = await getGoogleClient();

    if (!auth) {
      return res.status(401).json({
        connected: false,
        message: "Googleと接続してください。",
      });
    }

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 5, 1),
      10
    );

    const gmail = google.gmail({
      version: "v1",
      auth,
    });

    const listResult =
      await gmail.users.messages.list({
        userId: "me",
        q: "is:unread",
        maxResults: limit,
      });

    const messages =
      listResult.data.messages || [];

    const results = [];

    for (const item of messages) {
      try {
        const detail =
          await gmail.users.messages.get({
            userId: "me",
            id: item.id,
            format: "metadata",
            metadataHeaders: [
              "From",
              "Subject",
              "Date",
            ],
          });

        results.push({
          id: detail.data.id,
          threadId: detail.data.threadId,
          from: getHeader(detail.data, "From"),
          subject:
            getHeader(detail.data, "Subject") ||
            "(件名なし)",
          date: getHeader(detail.data, "Date"),
        });
      } catch (messageError) {
        console.error(
          "Gmailメッセージ取得エラー:",
          messageError
        );
      }
    }

    res.json({
      connected: true,
      messages: results,
    });
  } catch (error) {
    console.error("Gmail取得エラー:", error);

    if (error.code === 401) {
      await deleteTokens();

      return res.status(401).json({
        connected: false,
        message: "Googleの認証が無効になっています。",
      });
    }

    res.status(500).json({
      message: "Gmailの取得に失敗しました。",
    });
  }
});

// --------------------------------------------------
// 404
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).send("ページが見つかりません。");
});

// --------------------------------------------------
// サーバー起動
// --------------------------------------------------

app.listen(PORT, () => {
  console.log("");
  console.log("=================================");
  console.log(" My Clock Server");
  console.log("=================================");
  console.log(`http://localhost:${PORT}`);
  console.log("");
});