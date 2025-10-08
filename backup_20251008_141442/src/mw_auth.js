// src/mw_auth.js
import { API_KEY } from "./config.js";

export function authMw(req, res, next) {
  const headerKey = req.headers.authorization?.replace("Bearer ", "").trim();
  const queryKey = req.query.access_token;
  const key = headerKey || queryKey;

  if (!key || key !== API_KEY) {
    return res.status(401).json({
      error: { type: "auth_error", message: "Invalid or missing API key" },
    });
  }

  next();
}
