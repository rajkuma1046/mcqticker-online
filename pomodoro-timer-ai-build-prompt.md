# AI Build Prompt: Full-Featured Online Pomodoro Timer

Copy everything inside the box below and paste it into Claude, Claude Code, ChatGPT, Cursor, or any AI coding tool. It's written as a complete spec, so the AI shouldn't need to ask many follow-up questions.

---

```
You are a senior front-end engineer. Build a complete, production-ready, single-page online Pomodoro timer web app. Use plain HTML, CSS, and JavaScript (no framework required) unless I'm working inside an existing React/Vue project, in which case match that stack. The app must work fully client-side — no backend required for the core experience.

## 1. CORE TIMER ENGINE (must-have)
- Three phase types: Focus, Short Break, Long Break.
- Default durations: 25 / 5 / 15 minutes — all independently configurable in Settings (1–90 min range).
- Configurable "long break interval" (long break after every N focus sessions, default 4).
- Controls: Start, Pause, Resume, Skip (jump to next phase), Reset.
- Auto-start toggle for next session — separate switches for "auto-start breaks" and "auto-start next focus session."
- Timing must stay accurate even when the browser tab is backgrounded or minimized. Don't rely on naive setInterval drift — calculate remaining time from a stored end-timestamp (Date.now() diff) or use a Web Worker.
- Large digital countdown (MM:SS) plus a circular progress ring that depletes as time passes.
- Live countdown in the browser tab title, e.g. "23:45 · Focus" — updates every second even when the tab isn't active.
- Dynamic favicon that visually reflects progress (optional but nice-to-have).
- Fullscreen / "Zen mode" view that hides everything except the timer.

## 2. NOTIFICATIONS & SOUND (must-have)
- Browser desktop notification (Notification API) when a phase ends, with permission request handled gracefully.
- Audio alert at phase end, with: a choice of at least 3–4 built-in sounds, a volume slider, and a mute option.
- Alert scope setting: "Focus only," "Breaks only," "Both," or "None."
- Optional gentle ticking sound during focus sessions (off by default).
- Optional ambient background sound during focus (rain, white noise, café, forest) with its own independent volume control, separate from the alert sound.

## 3. TASK MANAGEMENT (must-have)
- A to-do list panel alongside the timer.
- Each task supports: title, optional notes, an "estimated pomodoros" count, and a running count of completed pomodoros against it.
- Ability to select which task is "active" so completed sessions log against it.
- Mark tasks complete; completed tasks move to a collapsed/done section, not deleted.
- Drag-and-drop reordering of the task list.
- Subtasks / checklist items within a task (nice-to-have).
- "Estimated finish time" — sum remaining estimated pomodoros × focus+break length and show a projected clock time for today.

## 4. STATISTICS & HISTORY (must-have)
- Track and persist: total focus minutes and completed pomodoros per day.
- A simple stats view: today / this week / this month, plus a current streak counter.
- A visual chart (bar chart or heatmap) of recent daily activity.
- Export history as CSV or JSON.

## 5. CUSTOMIZATION (must-have)
- Light mode and dark mode, plus at least 2–3 accent color themes.
- Settings should persist (see Section 6).
- Adjustable base font size for accessibility.

## 6. PERSISTENCE (must-have)
- All settings, tasks, and history saved to localStorage (or IndexedDB for larger history) automatically — the app must work fully offline with zero account/signup required.
- A "reset all data" option in settings, with a confirmation step.
- Import/export settings as a JSON file so a user can move their config between browsers manually.

## 7. KEYBOARD SHORTCUTS (should-have)
- Space = start/pause, R = reset, S = skip phase, N = add new task (or similar sensible defaults).
- Shortcuts should be listed somewhere discoverable (e.g., a "?" help modal).

## 8. PWA / INSTALLABILITY (should-have)
- Include a web app manifest and service worker so the app is installable and the core timer works offline.
- Fully responsive layout — usable from a small phone screen up to a desktop monitor.

## 9. ACCESSIBILITY (should-have)
- Proper ARIA labels on all controls.
- Full keyboard navigability (tab order, focus states).
- Phase changes announced via an ARIA live region for screen readers.
- Color contrast that passes WCAG AA in both light and dark themes.

## 10. STRETCH FEATURES (nice-to-have — implement only if straightforward, otherwise note as a known limitation)
- Webhook/integration hooks (e.g., POST to a URL on session complete) so power users can wire it into Slack/Zapier/IFTTT themselves.
- A lightweight gamification layer — e.g., a streak badge or a simple growing-plant visual tied to completed sessions — kept optional/toggleable so it doesn't clutter the core experience.
- Multi-language UI strings (i18n-ready structure, even if you only ship English content initially).
- A "stopwatch mode" alternative for open-ended focus sessions without a fixed countdown.

## DELIVERABLE FORMAT
- Clean, commented, well-structured code (separate HTML/CSS/JS files, or a single self-contained file if that's the agreed format).
- No unnecessary external dependencies — vanilla JS is preferred unless I specify otherwise.
- No analytics, ads, or third-party tracking scripts.
- Briefly summarize, at the end, any feature above that you simplified or skipped and why.
```

---

## How this list was put together

To make sure "all features available across the web" actually reflects what's live today rather than one app's opinion, I cross-checked feature sets across several widely used, independently-run Pomodoro tools rather than relying on a single source: **Pomofocus** (task estimates, templates, webhook integrations), **Focus To-Do** (sub-tasks, Gantt/trend reports, cross-device sync, white noise), **Forest** (gamified streaks, app/site blocking, group focus), **TomatoTimer/CoderTools** (keyboard shortcuts, fullscreen mode), and browser-native implementations like **Vivaldi's built-in Pomodoro clock** and **PomodoroTab** (tab-title countdown, side-panel mode). The feature list above is the common, repeated core across all of them, organized from "everyone has this" to "some premium tools have this."

## Honest caveats worth knowing before you build

A few things marketed by native/mobile apps genuinely **can't** be done in a plain client-side web app, and it's worth knowing this upfront rather than discovering it mid-build:

- **Website/app blocking** (like Forest's Deep Focus or Focus To-Do's whitelist) requires a browser-extension manifest with special permissions, or an OS-level native app — not achievable from a normal webpage.
- **Reliable alarms when the phone screen is locked** needs either a native app or specific PWA notification permissions, and behavior is inconsistent across iOS/Android/browsers.
- **True multi-device cloud sync** needs a backend and authentication — local storage alone only persists per-browser, per-device.

If you want any of those three, say so explicitly and the AI tool should build it as a browser extension or note the backend it would need, rather than quietly faking it.
