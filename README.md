# Panda Tracking App

A fast, independent frontend for our internal time tracking system. Built for power users who want speed, data hygiene, and keyboard-centric navigation.

> "I got tired of the limited UI in the official app. I wanted to audit my entries, fix mistakes quickly, and track time without touching the mouse. So I built this."

## Why use this?

This app connects directly to the official Solitions REST API but offers a significantly faster interface. It allows for bulk auditing, quick keyboard navigation, and unique features like "To-Do" entries that the official app doesn't support.

## Key Features

### 🚀 Productivity & Speed

- **Vim-like Keybindings**: Navigate the calendar and entries without the mouse.
  - `h`/`j`/`k`/`l` or Arrows to navigate days.
  - `c` and `v` to **Copy and Paste** entries across days.
  - `m` to **Move** an entry to a different day.
  - `n` to create a New entry.
  - `Del` to remove entries.
- **Smart "To-Do" Hacking**: Create entries with `0ms` duration. They act as a to-do list right inside your calendar. When you are ready, just add time to them.
- **Quick Edits**: Adjust time in 30-minute chunks with one click, or edit descriptions instantly.

### 📊 Data Hygiene & Stats

- **Smart Tagging (Hashtags)**: Add hashtags (e.g., `#api`, `#meeting`) to your entry descriptions.
- **Missing Hours Notice**: Instantly see which days are under the expected working hours so you can fix them before the month ends.
- **Advanced Filtering**: 
  - Filter by **Project**.
  - Filter by **Hashtag/Label**.
  - Filter by **Missing Hours**.
- **Live Stats**: Real-time calculation of daily hours, monthly progress, and project breakdown.

### 🎨 UI & UX

- **Focus Mode (Pomodoro)**: Integrated timer (default 50m) with browser tab notifications/blinking to keep you on track.
- **Dark/Light Mode**: Toggles automatically or manually, saved to local storage.
- **Visual Feedback**:
  - Interactive Calendar with clear markers for holidays and leave days.
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

3. **Authentication**: The app requires your API token from the main time tracking system. You will be prompted to enter this on first load.

## Keyboard Shortcuts Cheat Sheet

Press `h` in the app to see the full list.