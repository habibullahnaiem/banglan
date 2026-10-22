// বাংলান প্রিমিয়াম অ্যাক্টিভেশন — কোড → স্বাক্ষরিত টোকেন
// মেয়াদের ঘড়ি শুরু হয় কোডের FIRST অ্যাক্টিভেশনের মুহূর্তে। প্রথম অ্যাক্টিভেশনের
// exp Vercel KV (Upstash)-তে সংরক্ষিত থাকে: একই কোড আবার বসালে আগের exp-ই ফেরত
// আসে (ঘড়ি রিস্টার্ট হয় না); মেয়াদ শেষ হলে কোড চিরতরে মৃত (code_expired)।
// KV env না থাকলে আগের stateless আচরণে ফলব্যাক (কিছু ভাঙে না)।
// env: PREMIUM_SECRET, PREMIUM_CODE_HASHES (৩০দিন), PREMIUM_CODE_HASHES_120,
//      PREMIUM_CODE_HASHES_365, PREMIUM_CODE_HASHES_LIFETIME,
//      UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (KV)
var crypto = require("crypto");

var KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
var KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return undefined; // KV নেই → stateless
  try {
    var r = await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(["GET", key])
    });
    var j = await r.json();
    if (!j || j.result == null) return null;
    return JSON.parse(j.result);
  } catch (e) { return undefined; } // KV ত্রুটি → stateless ফলব্যাক
}

async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", key, JSON.stringify(value)])
    });
  } catch (e) { /* ফলব্যাক: রেকর্ড ছাড়াই চলবে */ }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  var secret = process.env.PREMIUM_SECRET;
  var hashes30 = (process.env.PREMIUM_CODE_HASHES || "").split(",").map(function (h) { return h.trim(); }).filter(Boolean);
  var hashes120 = (process.env.PREMIUM_CODE_HASHES_120 || "").split(",").map(function (h) { return h.trim(); }).filter(Boolean);
  var hashes365 = (process.env.PREMIUM_CODE_HASHES_365 || "").split(",").map(function (h) { return h.trim(); }).filter(Boolean);
  var hashesLife = (process.env.PREMIUM_CODE_HASHES_LIFETIME || "").split(",").map(function (h) { return h.trim(); }).filter(Boolean);
  if (!secret || (!hashes30.length && !hashes120.length && !hashes365.length && !hashesLife.length)) return res.status(200).json({ ok: false, configured: false });

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  var code = String(body.code || "").trim().toUpperCase();
  if (!code) return res.status(200).json({ ok: false, error: "empty" });

  var digest = crypto.createHash("sha256").update(code).digest("hex");
  function inList(list) {
    return list.some(function (h) {
      try { return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(digest)); } catch (e) { return false; }
    });
  }
  var lifetime = inList(hashesLife);
  var days = lifetime ? 36500 : (inList(hashes30) ? 30 : (inList(hashes120) ? 120 : (inList(hashes365) ? 365 : 0)));
  if (!days) return res.status(200).json({ ok: false, error: "invalid_code" });

  function issue(exp, returning) {
    var payload = Buffer.from(JSON.stringify({ v: 1, exp: exp })).toString("base64url");
    var sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return res.status(200).json({ ok: true, token: payload + "." + sig, exp: exp, days: days, lifetime: lifetime, returning: !!returning });
  }

  var now = Math.floor(Date.now() / 1000);
  var key = "bnlp:code:" + digest;
  var rec = await kvGet(key);
  if (rec && typeof rec.exp === "number") {
    // আগেই অ্যাক্টিভ হয়েছে — ঘড়ি প্রথম অ্যাক্টিভেশন থেকেই চলছে
    if (rec.exp > now) return issue(rec.exp, true);
    return res.status(200).json({ ok: false, error: "code_expired" });
  }

  var exp = now + days * 24 * 3600;
  if (rec !== undefined) {
    // KV আছে (rec === null মানে প্রথমবার) → প্রথম অ্যাক্টিভেশন রেকর্ড করো
    await kvSet(key, { exp: exp, days: days, lifetime: lifetime, first: now });
  }
  return issue(exp, false);
};
