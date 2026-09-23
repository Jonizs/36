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

There are two ways:

- **In `data.js`** (permanent): add lines like
  ```js
  runs:    [{ date: "2026-09-22", km: 5.2, time: "29:40", note: "easy" }],
  pushups: [{ date: "2026-09-22", reps: 60, sets: [20, 20, 20] }],
  weights: [{ date: "2026-09-22", kg: 86.4 }],
  ```
  You can edit it straight from the GitHub app or website.
- **With the ＋ button on the site** (quick): entries are saved in that browser right away. To make them permanent, tap **Export data.js**, then replace `data.js` in the repo with the downloaded file. The site offers to clear its local copy once you've done that.

## iPhone

Open the site in Safari, then **Share → Add to Home Screen**. It then opens full-screen like an app. The layout adapts to the notch and home indicator, the ＋ form opens as a bottom sheet, and charts respond to tapping.

## Local preview

`python3 -m http.server`, then open http://localhost:8000 (or use `bundle exec jekyll serve`).
