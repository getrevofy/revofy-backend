const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Root endpoint
app.get("/", (req, res) => {
  res.send("🚀 Revofy backend is running!");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
