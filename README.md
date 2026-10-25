# News Aggregator API

A Node.js and Express REST API for registering users, managing news preferences, retrieving personalized news through [NewsAPI](https://newsapi.org/), and tracking read and favorite articles. User accounts and article lists are kept in memory, so they are cleared when the server restarts.

## Requirements

- Node.js 18 or newer
- npm
- A NewsAPI API key for news endpoints

## Installation and startup

From the project directory:

```sh
npm install
```

Create a `.env` file in the project root:

```env
PORT=3000
JWT_SECRET=replace-with-a-long-random-secret
NEWS_API_KEY=your-newsapi-key
```

Keep `.env` private; it is ignored by Git. `PORT` is optional and defaults to `3000`. `JWT_SECRET` is used to sign and verify one-hour login tokens. `NEWS_API_KEY` is required by the news and search endpoints.

Start the API:

```sh
node app.js
```

The server listens at `http://localhost:3000` by default. Run the automated tests with:

```sh
npm test
```

## API

All request and response bodies use JSON. Routes marked **Protected** require this header:

```http
Authorization: Bearer <token>
```

### Authentication

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/register` | Public | Create an account. |
| `POST` | `/login` | Public | Authenticate and receive a JWT. |

#### `POST /register`

Request:

```json
{
  "name": "Alex Reader",
  "email": "alex@example.com",
  "password": "at-least-8-characters"
}
```

Returns `201 Created` with a user object (including default preferences: `technology` and `en`). Names are trimmed and emails are normalized to lowercase. Missing fields, invalid email addresses, or passwords shorter than eight characters return `400`; an already-registered email returns `409`.

#### `POST /login`

Request:

```json
{
  "email": "alex@example.com",
  "password": "at-least-8-characters"
}
```

Returns `200 OK` with a `token` and a one-hour expiration. Missing fields return `400`; invalid credentials return `401`.

### Preferences

Both endpoints are **Protected**.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/preferences` | Get the authenticated user's preferences. |
| `PUT` | `/preferences` | Update one or both preference lists. |

`PUT /preferences` accepts either or both fields:

```json
{
  "categories": ["technology", "science"],
  "languages": ["en", "fr"]
}
```

Each provided list must be a non-empty array containing only supported values. Categories: `business`, `entertainment`, `general`, `health`, `science`, `sports`, `technology`. Languages: `ar`, `de`, `en`, `es`, `fr`, `he`, `it`, `nl`, `no`, `pt`, `ru`, `sv`, `ud`, `zh`. Invalid lists return `400`. Fields omitted from the update retain their current values.

### News

Both endpoints are **Protected** and require `NEWS_API_KEY`.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/news` | Get news matching the user's preferred categories and languages. |
| `GET` | `/news/search/:keyword` | Search news for a keyword using the user's first preferred language. |

`GET /news` retrieves up to 20 articles for each preferred category and language combination. Results are de-duplicated by article URL. `GET /news/search/:keyword` returns articles and echoes the keyword; URL-encode keywords containing spaces or special characters. Both return `totalResults` and an `articles` array. Successful API responses are cached in memory for five minutes. The running server refreshes cached requests every five minutes; a failed refresh is logged and does not replace the last successful cache entry.

### Reading list and favorites

All endpoints are **Protected**. For the `POST` routes, supply the article's URL in the request body; the `:id` path segment is stored with it.

```json
{
  "url": "https://example.com/article"
}
```

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/news/:id/read` | Mark an article as read. |
| `GET` | `/news/read` | List the authenticated user's read articles. |
| `POST` | `/news/:id/favorite` | Add an article to favorites. |
| `GET` | `/news/favorites` | List the authenticated user's favorite articles. |

The `POST` routes return the updated list. Re-adding an article with the same URL does not create a duplicate. The list endpoints return `totalResults` and `articles`. Missing URLs return `400`.

### Common errors

- `401 Unauthorized`: an access token is missing, invalid, or expired.
- `404 Not Found`: the user does not exist, or the requested route is unknown.
- `502 Bad Gateway`: the upstream NewsAPI request failed.
- `503 Service Unavailable`: `NEWS_API_KEY` is not configured.

Errors return a JSON object with a `message` field. Since account, preference, cache, and article state is in memory, register and log in again after restarting the server. The legacy `/users/signup`, `/users/login`, and `/users/preferences` routes remain available alongside the routes documented above.

## Automated tests

Run `npm test` from the project directory. Tests cover registration, login, protected preferences, news fetching and cache behavior, search, read/favorite lists, upstream failure handling, and cache refresh. External NewsAPI requests are mocked, so tests do not require a live API key or network access.
