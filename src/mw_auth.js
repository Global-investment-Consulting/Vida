// Bearer header OR ?access_token=... must match API_KEY
export function authMw(req, res, next) {
  const want = process.env.API_KEY || "key_test_12345";

  const header = req.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  const bearer = m ? m[1] : null;

  const token = bearer || req.query.access_token;

  if (token === want) return next();

  return res.status(401).json({
    error: { type: "auth_error", message: "Invalid or missing API key" }
  });
}
