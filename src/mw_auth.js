import { getVidaApiKeys } from "./config.js";

const KEY_HEADERS = ["x-api-key", "x-vida-api-key", "authorization"];

const extractToken = (req) => {
  for (const header of KEY_HEADERS) {
    const raw = req.header(header);
    if (!raw) continue;
    const value = raw.trim();
    if (value.length === 0) {
      continue;
    }
    if (header === "authorization" && value.toLowerCase().startsWith("bearer ")) {
      const bearer = value.slice(7).trim();
      return bearer.length > 0 ? bearer : null;
    }
    return value;
  }
  return null;
};

export function requireApiKey(req, res, next) {
  const allowedKeys = getVidaApiKeys();
  if (allowedKeys.length === 0) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const token = extractToken(req);
  if (!token || !allowedKeys.includes(token)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  res.locals.apiKey = token;
  next();
}
