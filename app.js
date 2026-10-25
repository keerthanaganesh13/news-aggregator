require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const NEWS_API_BASE_URL = process.env.NEWS_API_BASE_URL || "https://newsapi.org/v2";
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;
const NEWS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const supportedCategories = new Set([
  "business",
  "entertainment",
  "general",
  "health",
  "science",
  "sports",
  "technology"
]);
const supportedLanguages = new Set([
  "ar",
  "de",
  "en",
  "es",
  "fr",
  "he",
  "it",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "ud",
  "zh"
]);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// The assignment uses in-memory storage; replace these collections with a database for persistence.
const users = [];
const newsCache = new Map();
const pendingNewsRequests = new Map();

function getCurrentUser(req) {
  return users.find((user) => user.id === req.userId);
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Access token is required" });
  }

  try {
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
    if (!decoded || typeof decoded.userId !== "string") {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    req.userId = decoded.userId;
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function isStringList(value, allowedValues) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && allowedValues.has(item))
  );
}

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePreferences(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "A JSON object is required";
  }
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((key) => !["categories", "languages"].includes(key))) {
    return "Provide categories, languages, or both";
  }
  if (
    Object.prototype.hasOwnProperty.call(body, "categories") &&
    !isStringList(body.categories, supportedCategories)
  ) {
    return "Categories must be a non-empty array of supported category names";
  }
  if (
    Object.prototype.hasOwnProperty.call(body, "languages") &&
    !isStringList(body.languages, supportedLanguages)
  ) {
    return "Languages must be a non-empty array of supported language codes";
  }
  return null;
}

function register(req, res) {
  const { name, email, password } = req.body || {};
  const legacyRoute = req.path === "/users/signup";

  if (
    typeof name !== "string" ||
    !name.trim() ||
    !isValidEmail(email) ||
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH
  ) {
    return res.status(400).json({
      message: "A name, valid email, and password of at least 8 characters are required"
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (users.some((user) => user.email === normalizedEmail)) {
    return res.status(409).json({ message: "Email is already registered" });
  }

  const categories = req.body.categories === undefined
    ? ["technology"]
    : req.body.categories;
  const languages = req.body.languages === undefined ? ["en"] : req.body.languages;
  const preferenceError = validatePreferences({ categories, languages });
  if (preferenceError) {
    return res.status(400).json({ message: preferenceError });
  }

  const legacyPreferences = req.body.preferences;
  if (
    legacyPreferences !== undefined &&
    (!legacyRoute ||
      !Array.isArray(legacyPreferences) ||
      !legacyPreferences.every((item) => typeof item === "string"))
  ) {
    return res.status(400).json({ message: "Preferences must be an array of strings" });
  }

  return bcrypt.hash(password, 10)
    .then((hashedPassword) => {
      if (users.some((user) => user.email === normalizedEmail)) {
        return res.status(409).json({ message: "Email is already registered" });
      }

      const user = {
        id: crypto.randomUUID(),
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        categories: [...categories],
        languages: [...languages],
        preferences: legacyPreferences ? [...legacyPreferences] : [...categories],
        readArticles: [],
        favoriteArticles: []
      };

      users.push(user);
      return res.status(201).json({
        message: "User registered successfully",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          preferences: {
            categories: user.categories,
            languages: user.languages
          }
        }
      });
    })
    .catch((error) => {
      console.error("Registration error:", error.message);
      return res.status(500).json({ message: "Unable to register user" });
    });
}

app.post(["/register", "/users/signup"], register);

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || typeof password !== "string" || !password) {
      return res.status(400).json({ message: "A valid email and password are required" });
    }

    const user = users.find((item) => item.email === email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "1h" });
    return res.status(200).json({ token, expiresIn: "1h" });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ message: "Unable to log in" });
  }
}

app.post(["/login", "/users/login"], login);

function getPreferences(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  if (req.path === "/users/preferences") {
    return res.status(200).json({ preferences: user.preferences });
  }
  return res.status(200).json({
    categories: user.categories,
    languages: user.languages
  });
}

function updatePreferences(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  if (req.path === "/users/preferences") {
    const { preferences } = req.body || {};
    if (!Array.isArray(preferences) || !preferences.every((item) => typeof item === "string")) {
      return res.status(400).json({ message: "Preferences must be an array of strings" });
    }
    user.preferences = [...preferences];
    return res.status(200).json({
      message: "Preferences updated successfully",
      preferences: user.preferences
    });
  }

  const error = validatePreferences(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }

  if (req.body.categories) {
    user.categories = [...req.body.categories];
    user.preferences = [...req.body.categories];
  }
  if (req.body.languages) {
    user.languages = [...req.body.languages];
  }
  return res.status(200).json({
    message: "Preferences updated successfully",
    categories: user.categories,
    languages: user.languages
  });
}

app.get(["/preferences", "/users/preferences"], authenticateToken, getPreferences);
app.put(["/preferences", "/users/preferences"], authenticateToken, updatePreferences);

async function requestNews(descriptor) {
  if (!process.env.NEWS_API_KEY) {
    const error = new Error("NEWS_API_KEY is not configured");
    error.code = "NEWS_API_KEY_MISSING";
    throw error;
  }

  if (descriptor.type === "search") {
    const response = await axios.get(`${NEWS_API_BASE_URL}/everything`, {
      params: {
        q: descriptor.keyword,
        language: descriptor.language,
        pageSize: 20,
        apiKey: process.env.NEWS_API_KEY
      },
      timeout: 10000
    });
    if (response.data.status !== "ok" || !Array.isArray(response.data.articles)) {
      throw new Error("News service returned an invalid response");
    }
    return {
      keyword: descriptor.keyword,
      totalResults: response.data.articles.length,
      articles: response.data.articles
    };
  }

  const requests = [];
  for (const category of descriptor.categories) {
    for (const language of descriptor.languages) {
      requests.push(axios.get(`${NEWS_API_BASE_URL}/top-headlines`, {
        params: {
          category,
          language,
          pageSize: 20,
          apiKey: process.env.NEWS_API_KEY
        },
        timeout: 10000
      }));
    }
  }

  const responses = await Promise.all(requests);
  const articlesByUrl = new Map();
  for (const response of responses) {
    if (response.data.status !== "ok" || !Array.isArray(response.data.articles)) {
      throw new Error("News service returned an invalid response");
    }
    for (const article of response.data.articles) {
      if (article.url) {
        articlesByUrl.set(article.url, article);
      }
    }
  }
  const articles = [...articlesByUrl.values()];
  return { totalResults: articles.length, articles };
}

async function getCachedNews(descriptor) {
  const key = JSON.stringify(descriptor);
  const cached = newsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  if (pendingNewsRequests.has(key)) {
    return pendingNewsRequests.get(key);
  }

  const request = requestNews(descriptor)
    .then((data) => {
      newsCache.set(key, {
        descriptor,
        data,
        expiresAt: Date.now() + NEWS_CACHE_TTL_MS
      });
      return data;
    })
    .finally(() => pendingNewsRequests.delete(key));
  pendingNewsRequests.set(key, request);
  return request;
}

function sendNewsError(res, error) {
  if (error.code === "NEWS_API_KEY_MISSING") {
    return res.status(503).json({ message: "News service is not configured" });
  }
  console.error("News API request failed:", error.message);
  return res.status(502).json({ message: "Unable to retrieve news from the news service" });
}

async function getPersonalizedNews(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  try {
    const news = await getCachedNews({
      type: "personalized",
      categories: user.categories,
      languages: user.languages
    });
    return res.status(200).json(news);
  } catch (error) {
    return sendNewsError(res, error);
  }
}

async function searchNews(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  const keyword = req.params.keyword.trim();
  if (!keyword || keyword.length > 200) {
    return res.status(400).json({ message: "Keyword must contain 1 to 200 characters" });
  }
  try {
    const news = await getCachedNews({
      type: "search",
      keyword,
      language: user.languages[0]
    });
    return res.status(200).json(news);
  } catch (error) {
    return sendNewsError(res, error);
  }
}

app.get("/news", authenticateToken, getPersonalizedNews);
app.get("/news/search/:keyword", authenticateToken, searchNews);

function validateArticleRequest(req, res) {
  const articleId = req.params.id.trim();
  const url = req.body && req.body.url;
  if (
    !articleId ||
    typeof url !== "string" ||
    !/^https?:\/\/\S+$/i.test(url.trim())
  ) {
    res.status(400).json({ message: "A valid article ID and HTTP(S) URL are required" });
    return null;
  }
  return { id: articleId, url: url.trim() };
}

function markArticleAs(listName) {
  return (req, res) => {
    const user = getCurrentUser(req);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const article = validateArticleRequest(req, res);
    if (!article) {
      return;
    }

    const list = user[listName];
    if (!list.some((item) => item.id === article.id || item.url === article.url)) {
      list.push({ ...article, markedAt: new Date().toISOString() });
    }
    return res.status(200).json({
      totalResults: list.length,
      articles: list
    });
  };
}

function listArticles(listName) {
  return (req, res) => {
    const user = getCurrentUser(req);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const articles = user[listName];
    return res.status(200).json({ totalResults: articles.length, articles });
  };
}

app.post("/news/:id/read", authenticateToken, markArticleAs("readArticles"));
app.get("/news/read", authenticateToken, listArticles("readArticles"));
app.post("/news/:id/favorite", authenticateToken, markArticleAs("favoriteArticles"));
app.get("/news/favorites", authenticateToken, listArticles("favoriteArticles"));

app.use((req, res) => {
  return res.status(404).json({ message: "Route not found" });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }
  if (error.status === 400 && error instanceof SyntaxError) {
    return res.status(400).json({ message: "Request body must contain valid JSON" });
  }
  console.error("Unhandled request error:", error.message);
  return res.status(500).json({ message: "Internal server error" });
});

async function refreshNewsCache() {
  const entries = [...newsCache.entries()];
  await Promise.all(entries.map(async ([key, entry]) => {
    try {
      const data = await requestNews(entry.descriptor);
      newsCache.set(key, {
        descriptor: entry.descriptor,
        data,
        expiresAt: Date.now() + NEWS_CACHE_TTL_MS
      });
    } catch (error) {
      console.error("News cache refresh failed:", error.message);
    }
  }));
}

app.locals.refreshNewsCache = refreshNewsCache;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`News Aggregator server running on port ${PORT}`);
    const refreshTimer = setInterval(refreshNewsCache, NEWS_REFRESH_INTERVAL_MS);
    refreshTimer.unref();
  });
}

module.exports = app;
