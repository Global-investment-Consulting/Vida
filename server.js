// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- health & basics -------------------------------------------------
app.get("/healthz", (_req, res) => {
  // keep this dirt-simple and FAST for CI probers
  res.type("text").send("ok");
});

// minimal root so a human can see something locally
app.get("/", (_req, res) => {
  res.type("text").send("ViDA MVP API is running");
});

// --- start server -----------------------------------------------------
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  // CI looks for this exact text in some places; don’t change casually
  console.log(`Server listening on ${HOST}:${PORT}`);
});
