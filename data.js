// ─────────────────────────────────────────────────────────────
//  YOUR 36-WEEK RUNNING JOURNEY — edit this file to add data.
//
//  • runs:    one entry per run. `time` is "mm:ss" or "h:mm:ss" (optional).
//  • pushups: one entry per session (several a day are summed). `sets` optional.
//             Add type: "knee" for knee push-ups (anything else counts as full).
//  • weights: one entry per day, in kg.
//  • Dates are "YYYY-MM-DD". Order doesn't matter.
//
//  Tip: you can also log entries from the website (the "+" button)
//  and then press "Export data.js" to download an updated copy of
//  this file to commit.
// ─────────────────────────────────────────────────────────────

window.JOURNEY = {
  title: "36 Weeks",
  startDate: "2026-09-21", // first day of week 1 — change this to your real start date
  weeks: 36,
  goalWeight: null,        // e.g. 78 (kg) — draws a goal line on the weight chart
  weeklyGoalKm: null,      // e.g. 25 — draws a target line on the weekly distance chart
  weeklyGoalPushups: null, // e.g. 500 — draws a target line on the weekly push-up chart

  runs: [
    // { date: "2026-09-22", km: 5.2, time: "29:40", note: "Easy, legs felt good" },
  ],

  pushups: [
    // { date: "2026-09-22", reps: 60, sets: [20, 20, 20], note: "Morning" },
    // { date: "2026-09-22", reps: 30, type: "knee", sets: [15, 15] },
  ],

  weights: [
    // { date: "2026-09-22", kg: 86.4 },
  ],
};
