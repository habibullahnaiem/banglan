// বাংলান AI স্তর — সার্ভার প্রক্সি (Vercel serverless function)
// GEMINI_API_KEY শুধু সার্ভারেই থাকে (Vercel Environment Variables) — ব্রাউজারে যায় না।
// ডাকা হয় শুধু তখনই, যখন নিয়ম-ইঞ্জিন অনিশ্চিত (ক্লায়েন্ট পাঠায় doubts)।

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  var keys = [];
  for (var n = 1; n <= 5; n++) {
    var kv = n === 1 ? process.env.GEMINI_API_KEY : process.env["GEMINI_API_KEY_" + n];
    if (kv) keys.push(kv);
  }
  if (!keys.length) return res.status(200).json({ ok: false, configured: false });

  var body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  var text = String(body.text || "").slice(0, 4000);
  var doubts = Array.isArray(body.doubts) ? body.doubts.slice(0, 12) : [];
  if (!text || !doubts.length) return res.status(200).json({ ok: false });

  var doubtStr = doubts.map(function (d) {
    return '"' + String(d.word || "") + '"' + (d.type === "context" ? " (প্রসঙ্গ-নির্ভর: কি/কী)" : " (অভিধানে পাইনি)");
  }).join(", ");

  var prompt = "তুমি বাংলা বানান ও ব্যাকরণের বিশেষজ্ঞ। নিচের লেখাটা আগেই নিয়ম-ইঞ্জিন দিয়ে যাচাই হয়েছে। ইঞ্জিন এই জায়গাগুলোয় অনিশ্চিত: " + doubtStr + "। শুধু এই অনিশ্চিত জায়গাগুলো প্রসঙ্গ দেখে বিচার করো — শব্দটা ঠিক থাকলে ঠিকই বলবে, ভুল থাকলে শুদ্ধ রূপ দেবে। বাকি লেখা যেমন আছে তেমন রাখবে। গান/কবিতার প্রচলিত রূপ বদলাবে না। কোনো ভাবনা বা আলোচনা লিখবে না — শুধু এই ফরম্যাটে উত্তর দাও:\n\nশুদ্ধ লেখা:\n<পুরো লেখাটা, দরকারি সংশোধনসহ>\n\nপরিবর্তনসমূহ:\n- ভুল → শুদ্ধ : সংক্ষিপ্ত কারণ\n(কিছু বদলাতে না হলে লিখবে \"কোনো ভুল পাওয়া যায়নি\")\n\nলেখা:\n" + text;

  var models = ["gemini-3.5-flash", "gemini-3-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
  // চেষ্টার ক্রম: আগে প্রধান মডেল সব key দিয়ে (এক key-এর কোটা শেষ হলে পরের key),
  // তারপর বিকল্প মডেলগুলো। মোট সময়-বাজেট ~৪৫ সেকেন্ড।
  var attempts = [];
  models.forEach(function (mdl) { keys.forEach(function (k) { attempts.push({ k: k, m: mdl }); }); });
  var raw = null, lastErr = null, t0 = Date.now();
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
      raw = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (raw) break;
    } catch (e) { lastErr = String(e && e.message || e); }
  }
  if (!raw) return res.status(200).json({ ok: false, error: lastErr || "no response" });

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
  return res.status(200).json({ ok: true, corrected: corrected, changes: changes });
};
