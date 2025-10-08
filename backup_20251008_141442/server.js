// server.js
import express from "express";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import v1 from "./src/routes_v1.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(morgan("dev"));

// --- API v1 ---
app.use("/v1", v1);

// --- Demo config for the front-end (UI reads this once at load) ---
app.get("/demo-config", (_req, res) => {
  // You can change the base if you ever mount the API elsewhere
  res.json({ base: "/v1" });
});

// --- Serve the demo UI from /public ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// Root = demo page
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- 404 fallthrough ---
app.use((req, res) => {
  res.status(404).json({ error: { type: "not_found", message: "Route not found" } });
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`\n\nAPI running on http://localhost:${PORT}`);
  console.log("- New Stripe-like API at /v1");
});
