const tap = require("tap");
const supertest = require("supertest");
const axios = require("axios");
const app = require("../app");

const server = supertest(app);
const originalAxiosGet = axios.get;
const originalNewsApiKey = process.env.NEWS_API_KEY;
let apiCalls = 0;
let failSearch = false;

process.env.NEWS_API_KEY = "test-news-api-key";
axios.get = async (url, config) => {
  apiCalls += 1;
  if (failSearch && config.params.q) {
    throw new Error("simulated upstream failure");
  }
  return {
    data: {
      status: "ok",
      articles: [{
        source: { id: null, name: "Test Source" },
        title: config.params.q ? `Search: ${config.params.q}` : "Test news",
        description: "Test article",
        url: config.params.q
          ? `https://example.test/${encodeURIComponent(config.params.q)}`
          : `https://example.test/${config.params.category}-${config.params.language}`,
        publishedAt: "2026-10-25T00:00:00Z"
      }]
    }
  };
};

tap.test("registration, authentication, preferences, and news workflows", async (t) => {
  const malformedJson = await server.post("/register")
    .set("Content-Type", "application/json")
    .send('{"name":');
  t.equal(malformedJson.status, 400, "malformed JSON receives a JSON validation error");

  const unknownRoute = await server.get("/not-an-api-route");
  t.equal(unknownRoute.status, 404, "unknown routes return a JSON not-found response");

  const user = {
    name: "Alex Reader",
    email: "alex.reader@example.com",
    password: "secure-pass-123"
  };

  const badEmail = await server.post("/register").send({
    ...user,
    email: "not-an-email"
  });
  t.equal(badEmail.status, 400, "registration validates email format");

  const shortPassword = await server.post("/register").send({
    ...user,
    password: "short"
  });
  t.equal(shortPassword.status, 400, "registration validates password length");

  const registered = await server.post("/register").send(user);
  t.equal(registered.status, 201, "register endpoint creates a user");
  t.same(registered.body.user.preferences, {
    categories: ["technology"],
    languages: ["en"]
  }, "new users receive default preferences");

  const duplicate = await server.post("/register").send(user);
  t.equal(duplicate.status, 409, "duplicate email is rejected");

  const wrongPassword = await server.post("/login").send({
    email: user.email,
    password: "wrong-password"
  });
  t.equal(wrongPassword.status, 401, "invalid credentials are rejected");

  const login = await server.post("/login").send({
    email: user.email,
    password: user.password
  });
  t.equal(login.status, 200, "login endpoint authenticates the user");
  t.ok(login.body.token, "login returns a JWT");
  const authorization = `Bearer ${login.body.token}`;

  const unauthorized = await server.get("/preferences");
  t.equal(unauthorized.status, 401, "protected routes require a token");

  const preferences = await server.get("/preferences").set("Authorization", authorization);
  t.equal(preferences.status, 200, "preferences can be retrieved");
  t.same(preferences.body, {
    categories: ["technology"],
    languages: ["en"]
  });

  const updated = await server.put("/preferences")
    .set("Authorization", authorization)
    .send({ categories: ["science", "technology"], languages: ["en", "fr"] });
  t.equal(updated.status, 200, "preferences can be updated");
  t.same(updated.body.categories, ["science", "technology"]);
  t.same(updated.body.languages, ["en", "fr"]);

  const invalidPreferences = await server.put("/preferences")
    .set("Authorization", authorization)
    .send({ categories: ["not-a-category"] });
  t.equal(invalidPreferences.status, 400, "unsupported preference values are rejected");

  const newsCallCount = apiCalls;
  const news = await server.get("/news").set("Authorization", authorization);
  t.equal(news.status, 200, "personalized news can be fetched");
  t.equal(news.body.articles.length, 4, "news is fetched for each category-language pair");
  t.ok(apiCalls > newsCallCount, "news endpoint calls the external API");

  const cachedNewsCallCount = apiCalls;
  await server.get("/news").set("Authorization", authorization);
  t.equal(apiCalls, cachedNewsCallCount, "news responses are cached");

  const search = await server.get("/news/search/space%20flight")
    .set("Authorization", authorization);
  t.equal(search.status, 200, "authenticated news search works");
  t.equal(search.body.keyword, "space flight");

  const article = {
    id: "article-1",
    url: "https://example.test/article-1"
  };
  const markedRead = await server.post(`/news/${article.id}/read`)
    .set("Authorization", authorization)
    .send({ url: article.url });
  t.equal(markedRead.status, 200, "an article can be marked as read");
  const readList = await server.get("/news/read").set("Authorization", authorization);
  t.equal(readList.body.totalResults, 1, "read articles can be retrieved");
  const markedReadAgain = await server.post(`/news/${article.id}/read`)
    .set("Authorization", authorization)
    .send({ url: article.url });
  t.equal(markedReadAgain.body.totalResults, 1, "read articles are not duplicated");

  const markedFavorite = await server.post(`/news/${article.id}/favorite`)
    .set("Authorization", authorization)
    .send({ url: article.url });
  t.equal(markedFavorite.status, 200, "an article can be favorited");
  const favorites = await server.get("/news/favorites").set("Authorization", authorization);
  t.equal(favorites.body.totalResults, 1, "favorite articles can be retrieved");

  const invalidArticle = await server.post("/news/article-2/read")
    .set("Authorization", authorization)
    .send({ url: "not-a-url" });
  t.equal(invalidArticle.status, 400, "article URL is validated");

  failSearch = true;
  const upstreamFailure = await server.get("/news/search/upstream-failure")
    .set("Authorization", authorization);
  t.equal(upstreamFailure.status, 502, "news API failures return a gateway error");
  failSearch = false;

  const refreshCallCount = apiCalls;
  await app.locals.refreshNewsCache();
  t.ok(apiCalls > refreshCallCount, "background cache refresh fetches updated news");

  const legacyRegistration = await server.post("/users/signup").send({
    name: "Legacy User",
    email: "legacy@example.com",
    password: "secure-pass-456",
    preferences: ["movies", "comics"]
  });
  t.equal(legacyRegistration.status, 201, "legacy signup route remains supported");

});

tap.teardown(() => {
  axios.get = originalAxiosGet;
  if (originalNewsApiKey === undefined) {
    delete process.env.NEWS_API_KEY;
  } else {
    process.env.NEWS_API_KEY = originalNewsApiKey;
  }
});
