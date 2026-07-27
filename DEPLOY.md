# Deploy DecisionIQ live for free

This puts your app on a real public web address (an `https://...onrender.com`
link you can share) using **Render**, at no cost.

## Steps (about 5 minutes, all clicking — no commands)

1. Go to **https://render.com** and sign up with your **GitHub** account (the
   one that owns this repository). It's free.
2. On the Render dashboard, click **New +** → **Blueprint**.
3. When asked, **connect / select this repository**
   (`kartikpolekar4518-hash/Business-Data-Analyst`).
4. Render finds the `render.yaml` file in this repo automatically and shows a
   plan: one **web service** and one **database**. Click **Apply**.
5. Wait for the build to finish (the first build takes ~5–10 minutes). When the
   web service shows **Live**, click the URL at the top of its page.
6. Log in with the demo account:
   - **Email:** `admin@decisioniq.dev`
   - **Password:** `password123`

That's it — your site is live.

## Good to know (the honest limits of "free")

- **It sleeps when idle.** On the free plan the site goes to sleep after ~15
  minutes with no visitors. The next visit wakes it up, which takes ~30–60
  seconds to load — then it's fast again. Normal for free hosting.
- **Free database lasts 30 days.** Render's free database expires after 30 days.
  Before then you can create a fresh free one, or upgrade the database to a paid
  plan (a few dollars/month) to keep it permanently.
- **Every deploy refreshes the demo data.** The three demo logins and the sample
  retail dataset are re-created on each deploy, so the demo always works.

## Updating the live site later

Whenever changes are pushed to this repository's main branch, Render
automatically rebuilds and redeploys. You don't have to do anything.
