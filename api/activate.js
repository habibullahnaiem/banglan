// বাংলান প্রিমিয়াম অ্যাক্টিভেশন — কোড → স্বাক্ষরিত টোকেন (৩০ দিন)
// env: PREMIUM_SECRET (HMAC চাবি), PREMIUM_CODE_HASHES (কমা-দেওয়া SHA-256 হ্যাশের তালিকা)
var crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  var secret = process.env.PREMIUM_SECRET;
  var hashes = (process.env.PREMIUM_CODE_HASHES || "").split(",").map(function (h) { return h.trim(); }).filter(Boolean);
  if (!secret || !hashes.length) return res.status(200).json({ ok: false, configured: false });

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  var code = String(body.code || "").trim().toUpperCase();
  if (!code) return res.status(200).json({ ok: false, error: "empty" });

  var digest = crypto.createHash("sha256").update(code).digest("hex");
  var match = hashes.some(function (h) {
    try { return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(digest)); } catch (e) { return false; }
  });
  if (!match) return res.status(200).json({ ok: false, error: "invalid_code" });

  var exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  var payload = Buffer.from(JSON.stringify({ v: 1, exp: exp })).toString("base64url");
  var sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return res.status(200).json({ ok: true, token: payload + "." + sig, exp: exp });
};
