# Google Cloud Storage Event Export Setup

This document explains how to set up the daily Google Cloud Storage (GCS) event export feature that automatically exports events from today to 7 days ahead to a GCS bucket.

## Overview

The GCS export feature:
- Runs daily at 12:30 AM PST (8:30 AM UTC) via GitHub Actions
- Exports events from the current day to 7 days ahead (in California timezone)
- Uploads the data as a JSON file to your Google Cloud Storage bucket
- Can be manually triggered via GitHub Actions or API endpoint

## Required Environment Variables

Add these environment variables to your deployment (Vercel, etc.) and GitHub Actions secrets:

### Google Cloud Storage Configuration

```
GCS_PROJECT_ID=your-project-id              # Your Google Cloud project ID
GCS_BUCKET_NAME=your-bucket-name            # Name of your GCS bucket
GCS_CREDENTIALS={"type":"service_account"...}  # Service account JSON as string (recommended)
# OR
GCS_KEY_FILE=/path/to/keyfile.json         # Path to service account key file (alternative)
GCS_FILE_NAME=events/weekly-events.json    # Optional: File path in bucket (defaults to events/weekly-events.json)
```

### Existing Required Variables

```
CRON_SECRET=your_cron_secret               # Already set up for existing cron jobs
BASE_URL=https://your-backend-url.com      # Your backend URL
```

## Google Cloud Storage Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your Project ID (you'll need this for `GCS_PROJECT_ID`)

### 2. Create a Storage Bucket

1. Go to [Cloud Storage](https://console.cloud.google.com/storage)
2. Click "Create Bucket"
3. Choose a unique bucket name (e.g., `my-app-events-export`)
4. Select a location type:
   - **Multi-region**: Best for global access (e.g., `us`, `eu`, `asia`)
   - **Region**: Best for specific location (e.g., `us-west1`, `us-central1`)
5. Choose storage class:
   - **Standard**: Best for frequently accessed data (recommended)
6. Access control:
   - Choose "Uniform" for bucket-level permissions
7. Click "Create"

### 3. Configure Bucket for Public Access (Optional)

If you want your friend to access the JSON file publicly:

**Option A: Make entire bucket public (simple)**
1. Go to your bucket → Permissions tab
2. Click "Grant Access"
3. Add principal: `allUsers`
4. Role: "Storage Object Viewer"
5. Click "Save"

**Option B: Make specific folder public (recommended)**
1. Go to your bucket → Permissions tab
2. Click "Grant Access"
3. Add principal: `allUsers`
4. Role: "Storage Object Viewer"
5. Add condition:
   ```
   resource.name.startsWith("projects/_/buckets/YOUR-BUCKET-NAME/objects/events/")
   ```
6. Click "Save"

### 4. Create a Service Account

1. Go to [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Click "Create Service Account"
3. Enter details:
   - Name: `events-export-service`
   - Description: "Service account for exporting events to Cloud Storage"
4. Click "Create and Continue"
5. Grant this service account access:
   - Role: "Storage Object Admin" (or "Storage Object Creator" for minimal permissions)
   - Click on your bucket specifically to limit scope
6. Click "Continue" → "Done"

### 5. Create Service Account Key

1. Click on the service account you just created
2. Go to "Keys" tab
3. Click "Add Key" → "Create new key"
4. Select "JSON" format
5. Click "Create"
6. **Important**: A JSON file will be downloaded - keep this secure!

The JSON file looks like this:
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "events-export-service@your-project.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

## Setup Instructions

### 1. Add Environment Variables to Vercel/Your Hosting

**For Vercel (recommended approach):**

1. Go to your Vercel project settings
2. Navigate to "Environment Variables"
3. Add the following:

```
GCS_PROJECT_ID=your-project-id
GCS_BUCKET_NAME=your-bucket-name
GCS_CREDENTIALS=<paste entire JSON content as a single line/string>
GCS_FILE_NAME=events/weekly-events.json
```

**Important for `GCS_CREDENTIALS`**: Copy the entire JSON file content and paste it as a single string. Vercel will handle it correctly.

4. Redeploy your application

### 2. Add Secrets to GitHub Actions

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Add the following secrets:
   - `GCS_PROJECT_ID`: Your project ID
   - `GCS_BUCKET_NAME`: Your bucket name
   - `GCS_CREDENTIALS`: **Paste the entire JSON content**
   - Optionally: `GCS_FILE_NAME`

Note: `CRON_SECRET` and `BASE_URL` should already be set up.

## Usage

### Automatic Daily Export

The GCS export runs automatically every day at 12:30 AM PST (8:30 AM UTC) via GitHub Actions.

### Manual Trigger via GitHub Actions

1. Go to your GitHub repository
2. Click on "Actions" tab
3. Select "Daily Event Scraping" workflow
4. Click "Run workflow"
5. Select "gcs-export" from the dropdown
6. Click "Run workflow"

### Manual Trigger via API

```bash
curl -X POST "https://your-backend-url.com/api/cron/daily-gcs-export" \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json"
```

### Response Format

Successful response:

```json
{
  "success": true,
  "message": "GCS export completed successfully",
  "timestamp": "2025-11-26T08:30:00.000Z",
  "executionTimeSeconds": 5,
  "result": {
    "exported": 150,
    "s3Url": "https://storage.googleapis.com/your-bucket-name/events/weekly-events.json",
    "s3Bucket": "your-bucket-name",
    "s3Key": "events/weekly-events.json",
    "dateRange": {
      "start": "2025-11-26",
      "end": "2025-12-03"
    }
  },
  "summary": {
    "totalEvents": 150,
    "s3Location": "https://storage.googleapis.com/your-bucket-name/events/weekly-events.json"
  }
}
```

## JSON File Format

The exported JSON file contains:

```json
{
  "export_info": {
    "timestamp": "2025-11-26T00:30:00-08:00",
    "date_range": {
      "start": "2025-11-26",
      "end": "2025-12-03"
    },
    "total_events": 150,
    "export_source": "supabase_events_table",
    "description": "Events from today to 7 days ahead (California time)"
  },
  "events": [
    {
      "id": 1,
      "title": "Event Title",
      "description": "Event description",
      "start_time": "2025-11-26T19:00:00-08:00",
      "end_time": "2025-11-26T22:00:00-08:00",
      "venue": "Venue Name",
      "address": "123 Main St, San Francisco, CA",
      "latitude": 37.7749,
      "longitude": -122.4194,
      "cost": "Free",
      "categories": ["music", "outdoor"],
      "image": "https://example.com/image.jpg",
      "url": "https://example.com/event",
      "emoji": "🎵"
      // ... more fields
    }
    // ... more events
  ]
}
```

## Accessing the File

### Public URL (if bucket is configured for public access)

```
https://storage.googleapis.com/your-bucket-name/events/weekly-events.json
```

Example:
```
https://storage.googleapis.com/my-events/events/weekly-events.json
```

Your friend can directly fetch this URL to get the events data.

### Using Load Balancer with Custom Domain (Optional)

For custom domain:

1. Set up a Load Balancer pointing to your GCS bucket
2. Configure a custom domain (e.g., `events.yourdomain.com`)
3. Share the custom URL: `https://events.yourdomain.com/events/weekly-events.json`

### Using Cloud CDN (Optional, Recommended for Production)

Enable Cloud CDN for better performance:

1. Go to your bucket → Configuration
2. Enable Cloud CDN
3. This will cache your files at edge locations worldwide

## Workflow Schedule

The complete workflow runs in this order:

1. **12:00 AM PST** - Funcheap scraper (scrapes events 6 days ahead)
2. **12:15 AM PST** - Decentered Arts scraper (scrapes events 6 days ahead)
3. **12:30 AM PST** - GCS export (exports current day to +7 days)

This ensures the export includes freshly scraped data.

## Troubleshooting

### "Google Cloud Storage client not configured" error

- Verify all GCS environment variables are set correctly
- Check that `GCS_CREDENTIALS` contains valid JSON
- Make sure the JSON isn't corrupted (check for line breaks)
- Redeploy after adding environment variables

### "Permission denied" error

- Verify service account has "Storage Object Admin" or "Storage Object Creator" role
- Check that the service account has access to the specific bucket
- Ensure the service account key is valid and not expired

### "Bucket not found" error

- Verify the bucket name is correct (no typos)
- Ensure the bucket exists in the specified project
- Check that `GCS_PROJECT_ID` matches the bucket's project

### "Invalid JSON" in GCS_CREDENTIALS

- Make sure you're pasting the entire JSON file content
- Don't modify the JSON structure
- Ensure no extra characters or line breaks were added
- The JSON should be one continuous string

### Empty export

- Check that events exist in the database for the date range
- Verify the scraping jobs ran successfully before the export
- Check the database connection

## Cost Considerations

Google Cloud Storage costs are very low:

- **Storage**: $0.020 per GB/month (Standard, us-multi-region)
- **Operations**: Class A (writes): $0.05 per 10,000 operations
- **Bandwidth**: First 1 GB egress is free per month
- **Typical cost**: One JSON file updated daily will cost **less than $0.01/month**

### Free Tier

Google Cloud offers:
- 5 GB/month of Regional Storage (US regions only)
- 5,000 Class A operations per month
- 50,000 Class B operations per month
- 100 GB egress to China and Australia

Your use case will likely stay within the free tier!

## Security Best Practices

1. **Use Service Account with Minimal Permissions**
   - Only grant "Storage Object Creator" if you only need to upload
   - Use "Storage Object Admin" only for the specific bucket

2. **Protect Service Account Keys**
   - Never commit keys to Git
   - Store as environment variables/secrets
   - Rotate keys regularly (every 90 days recommended)

3. **Enable Uniform Bucket-Level Access**
   - Simplifies permission management
   - Prevents accidental object-level permissions

4. **Use Signed URLs for Temporary Access** (optional)
   - Generate time-limited URLs instead of making bucket public
   - Better for sensitive data

5. **Enable Audit Logs**
   - Track who accesses your bucket
   - Monitor for unusual activity

6. **Use Cloud CDN + Load Balancer for Production**
   - Better performance
   - DDoS protection
   - Custom domain support

## Comparison: GCS vs AWS S3

| Feature | Google Cloud Storage | AWS S3 |
|---------|---------------------|---------|
| **Pricing (Storage)** | $0.020/GB/month | $0.023/GB/month |
| **Free Tier** | 5 GB/month (regional) | First 12 months only |
| **URL Format** | `storage.googleapis.com/bucket/file` | `bucket.s3.region.amazonaws.com/file` |
| **Authentication** | Service Account JSON | Access Key + Secret |
| **Ease of Setup** | Slightly more steps | Quick setup |
| **Global CDN** | Cloud CDN (extra setup) | CloudFront (extra setup) |
| **Integration** | Better with Google services | Better with AWS services |

Both are excellent choices! GCS is slightly cheaper and has a permanent free tier for storage.

## Support

For issues or questions:
- Check the GitHub Actions logs for error details
- Review the Vercel/deployment logs for runtime errors
- Verify all environment variables are set correctly
- Check [GCS Documentation](https://cloud.google.com/storage/docs)
- View [Service Account Documentation](https://cloud.google.com/iam/docs/service-accounts)

