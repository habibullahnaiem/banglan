# দায়িত্ব ভাগ — ইঞ্জিন বনাম UI (মালিকের সিদ্ধান্ত, 2026-10-22)

এই রিপো থেকে একাধিক সাইট লাইভ হয় এবং মালিক চান এক জায়গায় চেঞ্জ হলে সব সাইটে
একসাথে চেঞ্জ হোক। তাই আলাদা fork/কপি নয় — সবাই এই একই রিপোতে কাজ করবে।

দুই পক্ষের দায়িত্ব আলাদা:

## ১) ইঞ্জিন — Ostaad (Muse)-এর দায়িত্ব
বানান/ব্যাকরণ যাচাইয়ের লজিক ও সব ডেটা:
- `index.html`-এর সব `<script>` লজিক: `runCheck`, `tokenise`, `lookupOk`,
  `punctScan`, `indexGrammar`, `suggest`, `dictSearch`, `loadAsset`,
  `loadDictChunk`, `canonBn`/`normalise` (য়-নরমালাইজেশন) প্রভৃতি
- ৫টা এমবেডেড base64 ডেটা (`loadAsset("data:...")`): শব্দভান্ডার, সূত্র TSV,
  ব্যাকরণ-নিয়ম JSON (asset 3), সাধারণ-ভুল ফিক্স TSV
- inline `GRAMMAR_RULES` (নিয়ম বদলালে asset 3-তেও বদলাতে হয়)
- `assets/dict/*.json` (৪৯টা ফাইল — অভিধানের এন্ট্রি, অর্থ, IPA, সূত্র)

## ২) UI — অন্য AI-এর দায়িত্ব
সাইটের চেহারা:
- `<style>`-এর CSS: রং, ফন্ট, লেআউট, spacing, responsive আচরণ
- HTML সেকশনের সাজানো, নাম/লোগো/টাইটেল, পরিচিতি-লেখা ও কপি

## ⚠️ UI-পক্ষের জন্য বাধ্যতামূলক নিয়ম
1. **কোনো `<script>` ব্লক, এমবেডেড ডেটা-লাইন বা `assets/dict/` ফাইলে হাত দেওয়া যাবে না।**
   এগুলো কাটা/বদলালে ইঞ্জিন ভেঙে যাবে।
2. **সব element-এর `id="..."` হুবহু একই রাখতে হবে** — ইঞ্জিন এই id ধরে কাজ করে।
   যেমন: `input`, `homeInput`, `checkBtn`, `homeCheckBtn`, `clearBtn`, `copyBtn`,
   `downloadBtn`, `fileBtn`, `fileInput`, `resultText`, `errList`, `fixAllBtn`,
   `ignoreAllBtn`, `scorePanel`, `ringFg`, `ringPct`, `stErr`, `stFlag`, `stPct`,
   `stTotal`, `stPro`, `stats`, `dictInput`, `dictResult`, `dictSuggest`, `dictBtn`,
   `dictCount`, `browseBox`, `letterBar`, `ruleGrid`, `ruleSearch`, `ruleFilter`,
   `grammarCount`, `mistakeSearch`, `mistakePreview`, `view-home`, `view-check`,
   `view-dict`, `view-rules`, `view-mistakes`, `view-about`, `themeToggle`,
   `wordCount`, `charCount`, `sumErr`, `sumFlag`, `sumTotal`, `sumPro`, `sumNote`,
   `perfectNote`, `staleNote`, `refTable`, `previewDictInput`, `previewDictBtn`,
   `homeInput` — কোনোটা মুছা/বদলানো/নাম পাল্টানো যাবে না; নতুন id যোগ করা যাবে।
3. **মোবাইল বটম ন্যাভ মূল স্ক্রিপ্টগুলোর আগে থাকতে হবে** — জায়গা বদলালে ন্যাভ ভাঙে।
4. **ফাইলটা ~৬ MB — পুরোটা একবারে rewrite করা যাবে না** (truncate হয়ে ডেটা হারাবে)।
   অংশ ধরে ধরে এডিট করতে হবে; push-এর আগে ফাইলের সাইজ হঠাৎ কমেছে কিনা দেখে নিতে হবে।
5. কাজ শুরুর আগে সর্বশেষ `main` pull করে নিতে হবে; commit মেসেজে `ui:` prefix দিতে হবে
   (ইঞ্জিনের commit-এ `engine:`/checker: prefix থাকে)।
6. push-এর পর ইঞ্জিন-পক্ষ লাইভ সাইটে চেকার যাচাই করবে (সময়ঃ → সময়: সাজেশন,
   অভিধান-খোঁজ) — ভাঙা কিছু ধরা পড়লে UI-পক্ষ ঠিক করবে।

## ডিপ্লয়
এই রিপোর `main`-এ push হলেই এর সঙ্গে connect করা সব Vercel সাইট একসাথে আপডেট হয়।
