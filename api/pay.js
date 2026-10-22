// বাংলান প্রিমিয়াম — অটো-পেমেন্ট যাচাই (SMS-রিলে)
// ফ্লো: ক্রেতা অর্ডার করে → 01601599355-তে টাকা পাঠায় → TrxID জমা দেয়।
// মালিকের ফোনের SMS-ফরওয়ার্ডার বিকাশ/নগদ/রকেটের পেমেন্ট SMS এই endpoint-এ
// পাঠায় → অঙ্ক + TrxID মিললে সাথে সাথে অ্যাক্টিভেশন কোড তৈরি হয়ে ক্রেতা পায়।
// কোডের হ্যাশ KV-তে নিবন্ধিত থাকে (bnlp:minted:<sha256>) — activate.js সেটা চেনে।
// env: UPSTASH_REDIS_REST_URL/TOKEN (বা STORAGE_*), SMS_WEBHOOK_SECRET
var crypto = require("crypto");

var KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.STORAGE_KV_REST_API_URL || process.env.STORAGE_REDIS_REST_URL || "";
var KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN || process.env.STORAGE_REDIS_REST_TOKEN || "";
var PAY_NUMBER = "01601599355";
var PLANS = {
  "30": { days: 30, price: 30 },
  "120": { days: 120, price: 99 },
  "365": { days: 365, price: 199 }
};
var ORDER_TTL_MS = 24 * 3600 * 1000;

async function kvCmd(args) {
  var r = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  var j = await r.json();
  return j ? j.result : null;
}
async function kvGet(key) {
  var v = await kvCmd(["GET", key]);
  if (v == null) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
async function kvSet(key, value) { await kvCmd(["SET", key, JSON.stringify(value)]); }

var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randStr(n) {
  var b = crypto.randomBytes(n), s = "";
  for (var i = 0; i < n; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}
function newOrderId() { return "BN" + randStr(10); }
function newCode() { return "BNLP-" + randStr(6) + "-" + randStr(6); }

// ---------- SMS পার্সিং ----------
// বিকাশ: "You have received Tk 30.00 from 01XXXXXXXXX ... TrxID 9HX2XXXXXX ..."
// নগদ:   "Money Received ... Amount Tk 30.00 ... TrxID: XXXX ..."
// রকেট:  "You have received Tk.30.00 from 01... TxnID: ..."
function parseSms(text) {
  if (!text) return null;
  var t = String(text);
  var trxM = t.match(/(?:trx|txn|transaction)[\s.:#-]*id[:\s]*([A-Za-z0-9]{8,14})/i) || t.match(/\btrx(?:id)?[:\s]+([A-Za-z0-9]{8,14})/i);
  if (!trxM) return null;
  var trxid = trxM[1].toUpperCase();
  // প্রথম টাকার অঙ্কটাই প্রাপ্ত পরিমাণ (ব্যালেন্স পরে আসে)
  var amtM = t.match(/(?:tk\.?|taka|৳)\s*([\d,]+(?:\.\d{1,2})?)/i) || t.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:tk|taka)/i);
  if (!amtM) return null;
  var amount = Math.round(parseFloat(amtM[1].replace(/,/g, "")));
  if (!amount || amount <= 0) return null;
  var fromM = t.match(/(?:from|sender)[:\s]*(01\d{9})/i);
  return { trxid: trxid, amount: amount, from: fromM ? fromM[1] : "" };
}

// পেন্ডিং অর্ডার + SMS জোড়া মিললে পেমেন্ট সম্পূর্ণ করো
async function tryComplete(order, sms) {
  if (order.status !== "pending") return order;
  if (Date.now() - order.created > ORDER_TTL_MS) { order.status = "expired"; await kvSet("bnlp:order:" + order.id, order); return order; }
  if (!sms || sms.usedBy) return order;
  if (sms.amount !== order.price) return order;
  // কোড মিন্ট
  var code = newCode();
  var digest = crypto.createHash("sha256").update(code).digest("hex");
  await kvSet("bnlp:minted:" + digest, { days: order.days, order: order.id, soldAt: Math.floor(Date.now() / 1000) });
  order.status = "paid"; order.code = code; order.paidAt = Date.now(); order.trxid = sms.trxid;
  await kvSet("bnlp:order:" + order.id, order);
  sms.usedBy = order.id;
  await kvSet("bnlp:sms:" + sms.trxid, sms);
  return order;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if (!KV_URL || !KV_TOKEN) return res.status(200).json({ ok: false, configured: false });
  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  var action = String(body.action || "");

  try {
    if (action === "create") {
      var plan = PLANS[String(body.plan || "")];
      if (!plan) return res.status(200).json({ ok: false, error: "bad_plan" });
      var order = {
        id: newOrderId(), plan: String(body.plan), days: plan.days, price: plan.price,
        status: "pending", trxid: "", code: "", created: Date.now(), paidAt: 0
      };
      await kvSet("bnlp:order:" + order.id, order);
      return res.status(200).json({ ok: true, order: order.id, price: order.price, days: order.days, number: PAY_NUMBER });
    }

    if (action === "status") {
      var o = await kvGet("bnlp:order:" + String(body.order || "").trim().toUpperCase());
      if (!o) return res.status(200).json({ ok: false, error: "no_order" });
      if (o.status === "pending" && Date.now() - o.created > ORDER_TTL_MS) { o.status = "expired"; await kvSet("bnlp:order:" + o.id, o); }
      var out = { ok: true, status: o.status, price: o.price, days: o.days };
      if (o.status === "paid") out.code = o.code;
      return res.status(200).json(out);
    }

    if (action === "submit") {
      var ord = await kvGet("bnlp:order:" + String(body.order || "").trim().toUpperCase());
      if (!ord) return res.status(200).json({ ok: false, error: "no_order" });
      var trxid = String(body.trxid || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!/^[A-Z0-9]{8,14}$/.test(trxid)) return res.status(200).json({ ok: false, error: "bad_trxid" });
      if (ord.status === "paid") return res.status(200).json({ ok: true, status: "paid", code: ord.code });
      ord.trxid = trxid;
      await kvSet("bnlp:order:" + ord.id, ord);
      await kvSet("bnlp:trxorder:" + trxid, { order: ord.id });
      var sms = await kvGet("bnlp:sms:" + trxid);
      if (sms) ord = await tryComplete(ord, sms);
      if (ord.status === "paid") return res.status(200).json({ ok: true, status: "paid", code: ord.code });
      if (sms && sms.usedBy && sms.usedBy !== ord.id) return res.status(200).json({ ok: true, status: "trxid_used" });
      if (sms && sms.amount !== ord.price) return res.status(200).json({ ok: true, status: "amount_mismatch", smsAmount: sms.amount });
      return res.status(200).json({ ok: true, status: "waiting_sms" });
    }

    if (action === "sms") {
      var secret = process.env.SMS_WEBHOOK_SECRET || "";
      var given = String(req.headers["x-sms-secret"] || body.secret || "");
      if (!secret || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      var parsed = parseSms(body.text || body.message || "");
      if (!parsed) return res.status(200).json({ ok: false, error: "unparsed" });
      var sender = String(body.sender || body.from || "").slice(0, 40);
      var key = "bnlp:sms:" + parsed.trxid;
      var existing = await kvGet(key);
      if (existing) return res.status(200).json({ ok: true, duplicate: true });
      var rec = { trxid: parsed.trxid, amount: parsed.amount, from: parsed.from, sender: sender, ts: Date.now(), usedBy: "" };
      await kvSet(key, rec);
      // আগে থেকে TrxID জমা পড়ে থাকলে এখনই সম্পূর্ণ করো
      var link = await kvGet("bnlp:trxorder:" + parsed.trxid);
      if (link && link.order) {
        var ord2 = await kvGet("bnlp:order:" + link.order);
        if (ord2 && ord2.status === "pending") await tryComplete(ord2, rec);
      }
      return res.status(200).json({ ok: true, trxid: parsed.trxid, amount: parsed.amount });
    }

    return res.status(200).json({ ok: false, error: "bad_action" });
  } catch (e) {
    return res.status(200).json({ ok: false, error: "server" });
  }
};

module.exports.parseSms = parseSms;
