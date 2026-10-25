
require("dotenv").config();

const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "airtribe-assignment-secret";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Temporary in-memory storage for assignment tests
const users = [];

// Sample news so the API works without an external API key
const sampleNews = [
  {
    id: 1,
    title: "New superhero movies announced",
    category: "movies",
    description: "Discover upcoming movie releases and entertainment updates."
  },
  {
    id: 2,
    title: "Exciting new comic book stories",
    category: "comics",
    description: "Explore new comic book releases and superhero adventures."
  },
  {
    id: 3,
    title: "Latest gaming updates",
    category: "games",
    description: "Read about new games and gaming industry updates."
  }
];

// Find a user by the ID stored in the JWT
function getCurrentUser(req) {
  return users.find((user) => user.id === req.userId);
}

// Verify the JWT sent in the Authorization header
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Access token is required"
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }
}

// 1. Sign up
app.post("/users/signup", async (req, res) => {
  try {
    const { name, email, password, preferences } = req.body;

    if (
      !name ||
      !email ||
      !password ||
      !Array.isArray(preferences)
    ) {
      return res.status(400).json({
        message: "Name, email, password, and preferences are required"
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        message: "Please provide a valid email address"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = users.find(
      (user) => user.email === normalizedEmail
    );

    if (existingUser) {
      return res.status(409).json({
        message: "Email is already registered"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = {
      id: String(Date.now()) + String(users.length),
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      preferences: [...preferences]
    };

    users.push(user);

    return res.status(200).json({
      message: "User registered successfully"
    });
  } catch (error) {
    console.error("Signup error:", error.message);

    return res.status(500).json({
      message: "Unable to register user"
    });
  }
});

// 2. Log in
app.post("/users/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = users.find(
      (item) => item.email === normalizedEmail
    );

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.status(200).json({ token });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      message: "Unable to log in"
    });
  }
});

// 3. Get preferences
app.get("/users/preferences", authenticateToken, (req, res) => {
  const user = getCurrentUser(req);

  if (!user) {
    return res.status(404).json({
      message: "User not found"
    });
  }

  return res.status(200).json({
    preferences: user.preferences
  });
});

// 4. Update preferences
app.put("/users/preferences", authenticateToken, (req, res) => {
  const user = getCurrentUser(req);

  if (!user) {
    return res.status(404).json({
      message: "User not found"
    });
  }

  const { preferences } = req.body;

  if (
    !Array.isArray(preferences) ||
    !preferences.every((item) => typeof item === "string")
  ) {
    return res.status(400).json({
      message: "Preferences must be an array of strings"
    });
  }

  user.preferences = [...preferences];

  return res.status(200).json({
    message: "Preferences updated successfully",
    preferences: user.preferences
  });
});

// 5. Get personalized news
app.get("/news", authenticateToken, (req, res) => {
  const user = getCurrentUser(req);

  if (!user) {
    return res.status(404).json({
      message: "User not found"
    });
  }

  const news = sampleNews.filter((article) =>
    user.preferences.includes(article.category)
  );

  return res.status(200).json({ news });
});

// Start server only when running app.js directly
// Importing app.js in tests will not start a separate server.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`News Aggregator server running on port ${PORT}`);
  });
}

module.exports = app;
