# GitHub Actions Setup for Daily Scraping

This document explains how to set up GitHub Actions to run your daily scraping cron jobs instead of using Vercel's cron functionality.

## Why GitHub Actions?

- **Longer execution time**: Up to 6 hours vs Vercel's 5-13 minutes
- **Better resource management**: Dedicated runners with more memory/CPU
- **More reliable**: Less likely to timeout on large scraping operations
- **Better monitoring**: Detailed logs and status tracking
- **Manual triggers**: Easy to run jobs manually for testing

## Setup Instructions

### 1. GitHub Repository Secrets

Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these secrets:

#### Required Secrets:

**`BASE_URL`**
- **Value**: Your Vercel app URL (e.g., `https://bay-event-map-backend.vercel.app`)
- **Description**: Base URL for your deployed API

**`CRON_SECRET`**
- **Value**: Your cron authentication secret (e.g., `86c90dd3809e981e27f00167fb212dc9c8cec8a391faf6caef7f5604b2bee760`)
- **Description**: Secret for authenticating cron job requests

### 2. Workflow Schedule

The workflow runs on this schedule:
- **Funcheap Scraper**: Daily at 12:00 AM PST (8:00 AM UTC)
- **Decentered Arts Scraper**: Daily at 12:15 AM PST (8:15 AM UTC)

### 3. Manual Execution

You can manually trigger the workflow:
1. Go to **Actions** tab in your GitHub repository
2. Select **Daily Event Scraping** workflow
3. Click **Run workflow**
4. Choose which scraper to run:
   - `both` - Run both scrapers
   - `funcheap` - Run only Funcheap scraper
   - `decentered` - Run only Decentered Arts scraper

## Workflow Features

### ✅ **Parallel Execution**
- Both scrapers can run simultaneously when triggered manually
- Scheduled runs are staggered (15 minutes apart)

### ✅ **Comprehensive Logging**
- Detailed output for each step
- Response status codes and bodies
- JSON summary parsing for easy reading

### ✅ **Error Handling**
- Fails fast if authentication fails
- Proper exit codes for monitoring
- Clear error messages

### ✅ **Timeout Protection**
- 30-minute timeout per job
- Prevents runaway processes

### ✅ **Status Notifications**
- Completion notifications for scheduled runs
- Individual job status tracking

## Monitoring

### View Workflow Runs
1. Go to **Actions** tab in your repository
2. Click on **Daily Event Scraping** workflow
3. View individual run details and logs

### Check Logs
Each job will show:
- Start time and date
- HTTP response status
- Response body (including event counts)
- Success/failure status

### Example Successful Output
```
🕛 Starting Funcheap scraper at Mon Jan 15 08:00:00 UTC 2024
📊 Response Status: 200
📋 Response Body: {"success":true,"message":"Daily Funcheap scraping completed successfully",...}
✅ Funcheap scraper completed successfully
{
  "totalEvents": 25,
  "totalSaved": 25,
  "source": "funcheap"
}
```

## Troubleshooting

### Common Issues

**Authentication Failed (401)**
- Check that `CRON_SECRET` is set correctly in GitHub secrets
- Verify the secret matches what's configured in your Vercel environment variables

**Connection Failed**
- Check that `BASE_URL` is set correctly
- Ensure your Vercel app is deployed and accessible
- Verify the URL includes `https://` protocol

**Timeout Issues**
- GitHub Actions has a 6-hour limit (much longer than Vercel)
- If still timing out, check your scraping logic for infinite loops

### Debug Mode

To debug issues:
1. Run the workflow manually
2. Check the logs in the Actions tab
3. Look for specific error messages
4. Test the endpoints directly with curl

## Migration from Vercel Cron

### What Changed:
- ❌ Removed `crons` section from `vercel.json`
- ✅ Added GitHub Actions workflow
- ✅ Moved scheduling to GitHub Actions
- ✅ Added manual trigger capability

### Benefits:
- 🚀 **6x longer execution time** (6 hours vs 1 hour)
- 🔧 **Better debugging** with detailed logs
- 🎯 **Manual control** for testing and troubleshooting
- 📊 **Better monitoring** with GitHub's interface
- 💰 **No additional cost** (GitHub Actions free tier: 2000 minutes/month)

## Security Notes

- GitHub secrets are encrypted and only accessible during workflow runs
- The `CRON_SECRET` is only sent in the Authorization header
- No sensitive data is logged in the workflow output
- Each workflow run gets a fresh, isolated environment
