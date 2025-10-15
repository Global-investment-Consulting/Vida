import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

// ✅ Health check endpoint for CI
app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

// Root route (optional)
app.get("/", (req, res) => {
  res.send("ViDA MVP API running");
});

// Start server on all interfaces for CI
app.listen("3001", "0.0.0.0", () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
});

export default app;
