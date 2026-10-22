// বাংলান AI স্তর — সার্ভার প্রক্সি (Vercel serverless function)
// GEMINI_API_KEY (+ _2.._10) শুধু সার্ভারেই থাকে — ব্রাউজারে যায় না।
// মোড ১ (ডিফল্ট): ইঞ্জিন অনিশ্চিত হলেই ক্লায়েন্ট doubts পাঠায়।
// মোড ২ (review): প্রিমিয়াম — পুরো লেখা AI রিভিউ; স্বাক্ষরিত প্রিমিয়াম টোকেন লাগে (PREMIUM_SECRET)।
var crypto = require("crypto");

function getKeys() {
  var keys = [];
  for (var n = 1; n <= 10; n++) {
    var kv = n === 1 ? process.env.GEMINI_API_KEY : process.env["GEMINI_API_KEY_" + n];
    if (kv) keys.push(kv);
  }
  return keys;
}

function verifyPremium(token) {
  var secret = process.env.PREMIUM_SECRET;
  if (!secret || !token || typeof token !== "string") return false;
  var parts = token.split(".");
  if (parts.length !== 2) return false;
  var expect = crypto.createHmac("sha256", secret).update(parts[0]).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(parts[1]))) return false;
  } catch (e) { return false; }
  try {
    var payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf-8"));
    return payload && payload.exp && payload.exp > Math.floor(Date.now() / 1000);
  } catch (e) { return false; }
}

async function callGemini(prompt) {
  var keys = getKeys();
  var models = ["gemini-3.5-flash", "gemini-3-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
  var attempts = [];
  models.forEach(function (mdl) { keys.forEach(function (k) { attempts.push({ k: k, m: mdl }); }); });
  var lastErr = null, t0 = Date.now();
  for (var i = 0; i < attempts.length; i++) {
    var elapsed = Date.now() - t0;
    if (elapsed > 45000) break;
    try {
      var r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + attempts[i].m + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": attempts[i].k },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(Math.min(15000, 45000 - elapsed))
      });
      if (!r.ok) { lastErr = "HTTP " + r.status; continue; }
      var data = await r.json();
      var raw = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (raw) return { raw: raw };
    } catch (e) { lastErr = String(e && e.message || e); }
  }
  return { error: lastErr || "no response" };
}

function parseProof(raw) {
  raw = String(raw).replace(/\\n/g, "\n");
  var li = raw.lastIndexOf("শুদ্ধ লেখা:");
  if (li > 0) raw = raw.slice(li);
  var corrected = "";
  var m = raw.match(/শুদ্ধ লেখা:\s*([\s\S]*?)(?:পরিবর্তনসমূহ:|$)/);
  if (m) corrected = m[1].trim();
  var changes = [];
  var m2 = raw.match(/পরিবর্তনসমূহ:\s*([\s\S]*)$/);
  if (m2) {
    m2[1].split("\n").forEach(function (line) {
      var mm = line.replace(/^[-•*]\s*/, "").match(/^(.*?)\s*→\s*(.*?)\s*[:：]\s*(.*)$/);
      if (mm) changes.push({ wrong: mm[1].trim(), right: mm[2].trim(), reason: mm[3].trim() });
    });
  }
  return { corrected: corrected, changes: changes };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if (!getKeys().length) return res.status(200).json({ ok: false, configured: false });

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  var text = String(body.text || "").slice(0, 4000);
  if (!text) return res.status(200).json({ ok: false });

  var prompt;
  if (body.mode === "review") {
    if (!verifyPremium(body.token)) return res.status(200).json({ ok: false, premium_required: true });
    prompt = "তুমি বাংলা বানান ও ব্যাকরণের বিশেষজ্ঞ প্রুফরিডার। নিচের পুরো লেখাটা মনোযোগ দিয়ে পড়ে সব বানান ও ব্যাকরণের ভুল ঠিক করো। অর্থ ও লেখার ধাঁচ বদলাবে না। গান/কবিতার প্রচলিত রূপ বদলাবে না। কোনো ভাবনা বা আলোচনা লিখবে না — শুধু এই ফরম্যাটে উত্তর দাও:\n\nশুদ্ধ লেখা:\n<পুরো লেখাটা, সব সংশোধনসহ>\n\nপরিবর্তনসমূহ:\n- ভুল → শুদ্ধ : সংক্ষিপ্ত কারণ\n(কিছু বদলাতে না হলে লিখবে \"কোনো ভুল পাওয়া যায়নি\")\n\nলেখা:\n" + text;
  } else {
    var doubts = Array.isArray(body.doubts) ? body.doubts.slice(0, 12) : [];
    if (!doubts.length) return res.status(200).json({ ok: false });
    var doubtStr = doubts.map(function (d) {
      return '"' + String(d.word || "") + '"' + (d.type === "context" ? " (প্রসঙ্গ-নির্ভর: কি/কী)" : " (অভিধানে পাইনি)");
    }).join(", ");
    prompt = "তুমি বাংলা বানান ও ব্যাকরণের বিশেষজ্ঞ। নিচের লেখাটা আগেই নিয়ম-ইঞ্জিন দিয়ে যাচাই হয়েছে। ইঞ্জিন এই জায়গাগুলোয় অনিশ্চিত: " + doubtStr + "। শুধু এই অনিশ্চিত জায়গাগুলো প্রসঙ্গ দেখে বিচার করো — শব্দটা ঠিক থাকলে ঠিকই বলবে, ভুল থাকলে শুদ্ধ রূপ দেবে। বাকি লেখা যেমন আছে তেমন রাখবে। গান/কবিতার প্রচলিত রূপ বদলাবে না। কোনো ভাবনা বা আলোচনা লিখবে না — শুধু এই ফরম্যাটে উত্তর দাও:\n\nশুদ্ধ লেখা:\n<পুরো লেখাটা, দরকারি সংশোধনসহ>\n\nপরিবর্তনসমূহ:\n- ভুল → শুদ্ধ : সংক্ষিপ্ত কারণ\n(কিছু বদলাতে না হলে লিখবে \"কোনো ভুল পাওয়া যায়নি\")\n\nলেখা:\n" + text;
  }

  var out = await callGemini(prompt);
  if (!out.raw) return res.status(200).json({ ok: false, error: out.error });
  var parsed = parseProof(out.raw);
  return res.status(200).json({ ok: true, corrected: parsed.corrected, changes: parsed.changes });
};
