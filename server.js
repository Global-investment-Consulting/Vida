// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

const app = express();

// middleware
app.use(cors());
app.use(bodyParser.json());

// --- healthz: used by CI wait script ---
app.get("/healthz", (_req, res) => {
  // keep this ultra fast and deterministic
  res.status(200).type("text/plain").send("ok");
});

// (Optional) simple root page
app.get("/", (_req, res) => {
  res.status(200).json({ status: "ViDA MVP API up" });
});

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`); // CI logs look for this
});
