# Smart Splitter
Upload a photo of any bill and split it with friends. No manual math, no spreadsheets after group dinners.
🔗 [smart-splitter-psi.vercel.app](https://smart-splitter-psi.vercel.app)
## What it does
Take a photo of a receipt. 
The app reads the items and prices, figures out the tax, and gives you a link to share. 
Your friends open it, tap the items they had, and everyone sees their share update live.

It handles the annoying parts such as shared items get split evenly, and tax is worked out correctly whether it's added into the prices or added at the bottom. 
Works with any language receipts, Translates into english.

## Tech stack
- React + Vite
- Supabase (database + realtime)
- Google Gemini (reads the bills)
- Vercel (hosting)
- 
## How the tax logic works
The AI only pulls out raw numbers — items, prices, grand total. 
The actual tax math happens in code: if the items add up to the total, tax is already included. 
If they don't, the difference is the tax and it gets split across items proportionally. 
This way the app doesn't rely on the AI to do arithmetic, which it's bad at.

## Where it's going
Right now it's just splits. 
The plan is to grow it into a fuller finance app:
 - an expenses tab that pulls in your spending automatically (from emails, messages) so you just confirm instead of typing everything
 - a wallet tab for accounts, cards, and tracking who owes who. 

 Splitwise tracks splits but not your actual spending and budgeting apps do the opposite. The idea is to do both.
 
## Running locally
```bash
git clone https://github.com/yogeshwaranbaskaran/smart-splitter.git
cd smart-splitter/frontend
npm install
```
Add a `.env` file: VITE_GEMINI_API_KEY=your_key
Add your Supabase URL and anon key in `src/supabase.js`, then:

```bash
npm run dev
```

## Status

v2 is currently live in production with full bill upload, AI parsing, smart tax handling, real-time selection, and live summary.

Active development continues on the dev branch for v3 features (Google login, groups, finalization, GPay integration).

---

## About this project

Built solo as a learning project to explore full-stack development from AI integration and real-time databases to deployment pipelines and OAuth flows. 
Every architectural decision was made deliberately and documented through iteration. 


Feedback and contributions welcome.



