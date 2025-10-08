import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import v1 from "./src/routes_v1.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(morgan("dev"));

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/demo-config", (_, res) => {
  res.status(200).send("ok");
});

// OpenAPI (minimal)
import openapi from "./openapi.js";
app.get("/openapi.json", (_, res) => res.json(openapi));

// API v1
app.use("/v1", v1());

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log("");
  console.log(`API running on http://localhost:${PORT}`);
  console.log("- New Stripe-like API at /v1");
});
