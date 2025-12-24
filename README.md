# Quiz Bee MVP

Simple, real-time Quiz Bee game with an Admin/Game Master page and participant pages for teams.

## Requirements

- Node.js 18+ (or 20+ recommended)
- npm
- PM2 (for production deployment)

## Setup

```bash
cd D:\Code\quiz-bee-mvp
npm install
```

## Local Development

```bash
# PowerShell
$env:ADMIN_PASSWORD="your_admin_password"
npm run dev
```

Open the admin UI:

```
http://localhost:3001/admin
```

## Deploy to Laravel Forge with PM2

### Prerequisites

1. **Server Setup** - Ensure you have a server provisioned on Laravel Forge
2. **Node.js** - Make sure Node.js 18+ is installed on your server
3. **PM2** - Install PM2 globally on your server

### Deployment Steps

#### 1. Server Preparation

SSH into your server and install PM2 globally:

```bash
npm install -g pm2
```

#### 2. Clone Repository

On your server, navigate to your site directory and clone the repository:

```bash
cd /home/forge/your-site-domain.com
git clone https://github.com/yourusername/quiz-bee-mvp.git .
```

#### 3. Install Dependencies

```bash
npm install --production
```

#### 4. Environment Configuration

Create a `.env` file with your production settings:

```bash
nano .env
```

Add the following:

```env
NODE_ENV=production
PORT=3001
ADMIN_PASSWORD=your_secure_admin_password
DB_PATH=/home/forge/your-site-domain.com/quizbee.db
```

#### 5. Setup Nginx Reverse Proxy

In Laravel Forge, go to your site's Nginx configuration and add:

```nginx
location / {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

#### 6. Start with PM2

```bash
npm run pm2:start
```

Or directly:

```bash
pm2 start ecosystem.config.js --env production
```

#### 7. Enable PM2 Startup Script

Save PM2 process list and configure it to restart on system reboot:

```bash
pm2 save
pm2 startup
```

Follow the instructions from the `pm2 startup` command.

### PM2 Management Commands

```bash
# Start the application
npm run pm2:start

# Stop the application
npm run pm2:stop

# Restart the application
npm run pm2:restart

# Reload without downtime
npm run pm2:reload

# View logs
npm run pm2:logs

# Monitor processes
npm run pm2:monitor

# Delete from PM2
npm run pm2:delete
```

### Deployment Script for Laravel Forge

Add this to your Forge deployment script:

```bash
cd /home/forge/your-site-domain.com

# Pull latest changes
git pull origin main

# Install dependencies
npm install --production

# Reload PM2 application
pm2 reload quiz-bee-mvp

# Or restart if reload doesn't work
# pm2 restart quiz-bee-mvp
```

### SSL Configuration

In Laravel Forge:
1. Go to your site's SSL tab
2. Enable LetsEncrypt SSL certificate
3. The reverse proxy will automatically handle HTTPS

### Monitoring

Check application status:

```bash
pm2 status
pm2 logs quiz-bee-mvp
pm2 monit
```

View detailed info:

```bash
pm2 info quiz-bee-mvp
```

## How to Use

1. Set your admin password at the top of the Admin page (must match `ADMIN_PASSWORD`).
2. Create questions and teams.
3. Each team gets a QR code or join URL (one device per team).
4. Select the current question and click **Open Question**.
5. Teams submit answers on their devices.
6. Click **Close Question** to auto-grade and score.
7. Use manual overrides to adjust points or reset submissions.

## Configuration

Environment variables (set in `.env` file):

- `PORT` - Server port (default: 3001)
- `ADMIN_PASSWORD` - Admin authentication password (required)
- `DB_PATH` - SQLite database path (default: ./quizbee.db)
- `NODE_ENV` - Environment (development/production)

## Database Backup

Since SQLite is file-based, backup your database regularly:

```bash
# Backup database
cp quizbee.db quizbee.db.backup

# Or with timestamp
cp quizbee.db quizbee-$(date +%Y%m%d-%H%M%S).db
```

Consider setting up a cron job for automated backups.

## Notes

- Admin password is required for all admin APIs.
- Participants bind to a team per device using a cookie.
- Database auto-creates in `quizbee.db`.
- Audio files are not included. Add MP3 files to `public/audio` using these filenames:
  - `mario.mp3` (background music)
  - `submitted.mp3`
  - `open.mp3`
  - `close.mp3`

## Tech Stack

- **Backend**: Node.js, Express
- **Real-time**: Socket.IO
- **Database**: SQLite (better-sqlite3)
- **Frontend**: Vanilla JavaScript
- **Process Manager**: PM2
- **Deployment**: Laravel Forge

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 3001
lsof -i :3001
# Kill the process
kill -9 <PID>
```

### PM2 Not Restarting

```bash
pm2 delete quiz-bee-mvp
pm2 start ecosystem.config.js --env production
pm2 save
```

### Check Logs

```bash
pm2 logs quiz-bee-mvp --lines 100
```

## License

MIT

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
