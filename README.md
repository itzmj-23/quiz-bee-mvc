# Quiz Bee MVP

Simple, real-time Quiz Bee game with an Admin/Game Master page and participant pages for teams.

## Requirements

- Node.js 18+ (or 20+ recommended)
- npm

## Setup

```bash
cd D:\Code\quiz-bee-mvp
npm install
```

## Run

```bash
# PowerShell
$env:ADMIN_PASSWORD="your_admin_password"
npm start
```

Open the admin UI:

```
http://localhost:3001/admin
```

## How to Use

1. Set your admin password at the top of the Admin page (must match `ADMIN_PASSWORD`).
2. Create questions and teams.
3. Each team gets a QR code or join URL (one device per team).
4. Select the current question and click **Open Question**.
5. Teams submit answers on their devices.
6. Click **Close Question** to auto-grade and score.
7. Use manual overrides to adjust points or reset submissions.

## Notes

- Admin password is required for all admin APIs.
- Participants bind to a team per device using a cookie.
- Database auto-creates in `quizbee.db`.
- Audio files are not included. Add MP3 files to `public/audio` using these filenames:
  - `mario.mp3` (background music)
  - `submitted.mp3`
  - `open.mp3`
  - `close.mp3`
  - `reveal.mp3`
  - `setcurrent.mp3`

## File Tree

```
quiz-bee-mvp/
  package.json
  server.js
  quizbee.db (auto-created)
  public/
    admin.html
    admin.js
    participant.html
    participant.js
    styles.css
```
