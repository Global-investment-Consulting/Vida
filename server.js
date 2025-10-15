import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = "0.0.0.0";

app.use(cors());
app.use(express.json());

// ---- HEALTH ENDPOINT ----
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// ---- SAMPLE ROOT ----
app.get("/", (req, res) => {
  res.send("✅ ViDA MVP running");
});

// ---- START SERVER ----
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server listening on http://${HOST}:${PORT}`);
});
