# Panda Tracking App

A personal time tracking application built to simplify logging work hours, with a focus on speed and usability.

> I got tired of having to go to the ~HQ~ solutions app to track my time at work. So I built my own.

## Features

- **Dashboard Overview**: At-a-glance view of your monthly progress with
  interactive charts for time spent per scope (Global, Task, Ticket) and per project.
- **Interactive Calendar**: Easily navigate through months and years. Holidays
  and leave days are clearly marked.
- **Detailed Time Entries**: Log time against projects, tasks, or support
  tickets.
- **Quick Edits**: Add or subtract 30-minute chunks from entries with a single
  click, or edit all details in a modal.
- **Leave Day Management**: Mark days as 'leave' to exclude them from work hour
  calculations.
- **Focus Mode (Pomodoro)**: A built-in configurable Pomodoro timer (defaults to
  50 minutes) to help you stay focused. The browser tab blinks and shows the countdown to keep you aware.
- **Vim-like Keybindings**: Navigate through days and entries, and perform
  actions without touching your mouse. Press `h` for a help modal.
- **Customizable Filters**:
    - Show/hide weekends.
    - Filter by days with missing hours.
    - Show only today's or this week's entries.
    - Hide leave days.
- **Dark/Light Theme**: Switch between themes to suit your preference. The
  setting is saved locally.
- **Responsive Design**: Works on different screen sizes.

## Getting Started

### Prerequisites

You'll need `git` to clone the repository. To run a simple local server, you can use Node.js.

- Git
- Node.js

### Installation & Running

1. Clone and install dependencies

```bash
git clone git@github.com:espinosajuanma/panda-tracking.git
cd panda-tracking
npm install
```

2. Run the application

```bash
npm run start
```

This will automatically open the application in your default browser.

## Tech Stack

- HTML5, CSS3, JavaScript (ES6+)
- Bootstrap 5 for styling and components.
- Knockout.js for the MVVM architecture.
- Chart.js for data visualization.
- Vanilla-Calendar-Pro for the interactive calendar.
- Select2 for enhanced select boxes.



