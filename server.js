import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Fast, stable health endpoint for CI
app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

// (Optional) hello
app.get("/", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
const HOST = "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`);
});

// graceful shutdown (mainly for CI)
const stop = () => {
  try {
    server.close(() => process.exit(0));
  } catch {
    process.exit(0);
  }
};

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
