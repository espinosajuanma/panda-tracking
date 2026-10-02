# Panda Tracking App

A fast, independent frontend for our internal time tracking system. Built for power users who want speed, data hygiene, and keyboard-centric navigation.

> "I got tired of the limited UI in the official app. I wanted to audit my entries, fix mistakes quickly, and track time without touching the mouse. So I built this."

## Why use this?

This app connects directly to the official Solitions REST API but offers a significantly faster interface. It allows for bulk auditing, quick keyboard navigation, and unique features like "To-Do" entries that the official app doesn't support.

## Key Features

### 🚀 Productivity & Speed

- **Keyboard Shortcuts**: Navigate the calendar and entries without the mouse.
  - `j`/`k` or Up/Down arrows to move between days and entries; `g`/`G` jumps to the first/last item.
  - `a` creates an entry, `t` creates a To-Do, and `T` jumps to today.
  - In Entry Mode, `e` edits and `r` removes the selected entry.
  - `Ctrl+C` copies, `Ctrl+X` cuts/moves, and `Ctrl+V` pastes an entry across days.
  - For today's selected entry in Entry Mode, `s` toggles its timer, `x` stops and logs it, and `d` discards it. Use the entry's More actions menu for previous days.
- **Smart "To-Do" Hacking**: Create entries with `0ms` duration. They act as a to-do list right inside your calendar. When you are ready, just add time to them.
- **Entry Timers**: Run timers on multiple logged entries or To-Dos at once. Pause/resume, stop to add elapsed time rounded to the nearest 30 minutes (minimum 30 minutes), or discard a timer without logging its time.
- **Quick Edits**: Adjust time in 30-minute chunks with one click, or edit descriptions instantly.

### 📊 Data Hygiene & Stats

- **Smart Tagging (Hashtags)**: Add hashtags (e.g., `#api`, `#meeting`) to your entry descriptions.
- **Missing Hours Notice**: See the hours below your expected-to-date target and jump directly to days that need attention.
- **Advanced Filtering**: 
  - Filter by **Project**.
  - Filter by **Hashtag/Label**.
  - Filter by **Missing Hours**.
- **Live Stats**: Real-time calculation of daily hours, monthly progress, and project breakdown.

### 🎨 UI & UX

- **Focus Mode (Pomodoro)**: Integrated timer (default 50m) with browser tab notifications/blinking to keep you on track.
- **Dark/Light Mode**: Follows your system theme until you choose a theme manually; your choice is saved in this browser.
- **Visual Feedback**:
  - Interactive Calendar with clear markers for holidays and leave days.
  - Optionally enable Argentina public holidays in Settings; they are loaded from the [ArgentinaDatos API](https://api.argentinadatos.com/).
  - Charts for viewing time distribution by Scope and Project.

## Tech Stack

- **Core**: JavaScript (ES6+), HTML5, CSS3
- **Architecture**: Knockout.js (MVVM pattern)
- **UI Framework**: Bootstrap 5
- **Visualization**: Chart.js
- **Components**: Vanilla-Calendar-Pro, Select2

## Getting Started

### Prerequisites

- Git
- Node.js (for running the local dev server)

### Installation

1. Clone the repository:

```bash
git clone git@github.com:espinosajuanma/panda-tracking.git
cd panda-tracking
npm install
```

2. Run the application:

```bash
npm run start
```

3. **Authentication**: Sign in with your Solutions email and password. The password is sent to Solutions for authentication and is not saved by this app; the session token and preferences are kept in your browser's local storage.

## Keyboard Shortcuts Cheat Sheet

Enable the keyboard switch in the header, then press `h` to see the full list. While typing in a field, shortcuts are suspended.
