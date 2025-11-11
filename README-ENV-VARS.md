# Environment Variables Setup

This document explains how to set up the required environment variables for the Bay Event Map Backend.

## Required Environment Variables

### 1. CRON_SECRET
**Purpose**: Secures the cron job endpoints from unauthorized access.

**Value**: A secure random string (at least 16 characters)

**Example**: `86c90dd3809e981e27f00167fb212dc9c8cec8a391faf6caef7f5604b2bee760`

**How to set in Vercel**:
1. Go to your Vercel project dashboard
2. Navigate to **Settings → Environment Variables**
3. Add new variable:
   - **Name**: `CRON_SECRET`
   - **Value**: `[your-secret-here]`
   - **Environment**: Production (and Preview if needed)

### 2. BASE_URL
**Purpose**: Defines the base URL for internal API calls in cron jobs.

**Value**: Your deployed application URL (with or without protocol)

**Examples**:
- Production: `https://your-app.vercel.app` or `your-app.vercel.app`
- Preview: `https://your-app-git-branch.vercel.app` or `your-app-git-branch.vercel.app`
- Development: `http://localhost:3001` or `localhost:3001`

**Note**: If you don't include `https://` or `http://`, the system will automatically add `https://` for you.

**How to set in Vercel**:
1. Go to your Vercel project dashboard
2. Navigate to **Settings → Environment Variables**
3. Add new variable:
   - **Name**: `BASE_URL`
   - **Value**: `https://your-app.vercel.app`
   - **Environment**: Production (and Preview if needed)

## Other Environment Variables

Make sure you also have these configured:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY` (if using)

## Cron Job Schedule (GitHub Actions)

- **Funcheap Scraper**: Runs daily at 12:00 AM PST (8:00 AM UTC)
- **Decentered Arts Scraper**: Runs daily at 12:15 AM PST (8:15 AM UTC)

**Note**: Cron jobs are now handled by GitHub Actions instead of Vercel. See `README-GITHUB-ACTIONS.md` for setup instructions.

## Testing

### Test Manual Funcheap Cron Job
```bash
curl -X POST https://your-app.vercel.app/api/cron/daily-funcheap-scrap-one-week-ahead \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json"
```

### Test Manual Decentered Arts Cron Job
```bash
curl -X POST https://your-app.vercel.app/api/cron/daily-decentered-art-scrap-one-week-ahead \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json"
```

### Test Without Authentication (should fail)
```bash
curl -X POST https://your-app.vercel.app/api/cron/daily-funcheap-scrap-one-week-ahead
# Expected: 401 Unauthorized
```

## Security Notes

- Never commit `CRON_SECRET` to version control
- Use different secrets for different environments
- Rotate secrets periodically
- Keep `BASE_URL` updated when deploying to different environments
