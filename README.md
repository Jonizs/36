# 36 Weeks 🏃💪

A progress site for a 36-week running + push-up journey, with a daily weight log.
It's plain HTML/CSS/JS, has no build step, and runs on GitHub Pages with Jekyll.

**What it shows:** the current week out of 36 and overall progress · totals (distance, runs, average pace, push-ups, push-up streak, weight change) · a day-by-day view of this week · weekly distance and weekly push-up charts with personal records · a weight chart with a 7-day average and optional goal line · a 36-week "journey map" heat grid · a full activity log.

Add `?demo` to the URL to see it filled with sample data.

## Setup

1. Open `data.js` and set `startDate` to the first day of week 1. You can also set `goalWeight`, `weeklyGoalKm` and `weeklyGoalPushups`.
2. On GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/pages.yml` builds the site with Jekyll and publishes it to `https://<user>.github.io/<repo>/`.

## Logging your data

Tap **＋** on the site and pick **Run**, **Push-ups** (full or knee) or **Weight**.

**Autosave (recommended):** tap **Autosave** at the top right and connect a GitHub token. The dialog walks you through it: a fine-grained token for just this repo, with *Contents: Read and write*. From then on, every entry you add or delete is committed straight to `data.js`. The site redeploys itself, and every connected device loads the latest data. Connect each device (phone, laptop) once. Entries made while you're offline are kept and saved when you're back online.

If autosave isn't set up, entries are still saved in that browser. The autosave dialog also has a **download data.js** link if you'd rather commit the file yourself.

You can also edit `data.js` by hand:
```js
runs:    [{ date: "2026-09-22", km: 5.2, time: "29:40", note: "easy" }],
pushups: [{ date: "2026-09-22", reps: 60, sets: [20, 20, 20] },
          { date: "2026-09-22", reps: 30, type: "knee" }],   // knee push-ups
weights: [{ date: "2026-09-22", kg: 86.4 }],
```

Only entries dated inside the 36 weeks count toward stats and charts. Anything before `startDate` still shows in the activity log, labelled "before week 1".

## iPhone

Open the site in Safari, then **Share → Add to Home Screen**. It then opens full-screen like an app. The layout adapts to the notch and home indicator, the ＋ form opens as a bottom sheet, and charts respond to tapping.

## Local preview

`python3 -m http.server`, then open http://localhost:8000 (or use `bundle exec jekyll serve`).
