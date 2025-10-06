# Automated Knowledge Base Update Workflow

## Overview

The chatbot knowledge base now automatically updates when content is changed in Strapi CMS. No manual intervention is required.

## Automated Flow

```
Strapi CMS Update → Auto Export (30s debounce) → S3 Upload → Embedding Generation → Cache Clear → Chatbot Updated
```

### Step-by-Step Process

1. **Content Update in Strapi**
   - User creates/updates/publishes FAQ in Strapi admin
   - Middleware detects the change

2. **Debounced Export (30 seconds)**
   - Multiple changes are batched together
   - Waits 30 seconds to collect all changes
   - Exports all updated content to S3 as markdown

3. **Automatic Embedding Processing**
   - Strapi calls `/content/process` endpoint
   - Content Manager Lambda:
     - Reads all markdown files from S3
     - Generates embeddings using Amazon Titan
     - Saves embeddings to S3
     - **Automatically clears chatbot Lambda cache**

4. **Chatbot Cache Clear**
   - Content Manager updates chatbot Lambda's environment variable
   - Forces Lambda to reload embeddings from S3 on next request
   - No manual intervention needed

5. **Chatbot Ready**
   - Next chat request loads fresh embeddings
   - Chatbot has updated knowledge immediately

## Configuration

### Strapi Environment Variables

Located in `/website/backend/.env`:

```bash
# Auto-export enabled
KNOWLEDGE_BASE_AUTO_EXPORT=true
KNOWLEDGE_BASE_DEBOUNCE_MS=30000

# Chatbot API endpoint
CHATBOT_API_URL=https://9twtox1bii.execute-api.us-east-1.amazonaws.com/dev

# Auto-process embeddings after export
EMBEDDING_AUTO_PROCESS=true
```

### Lambda Configuration

**Content Manager Lambda** (`vault22-faq-chatbot-dev-contentManager`):
- Has permission to update chatbot Lambda configuration
- Automatically clears cache after embedding generation
- Environment: `CHATBOT_FUNCTION_NAME=vault22-faq-chatbot-dev-chatbot`

**Chatbot Lambda** (`vault22-faq-chatbot-dev-chatbot`):
- Caches embeddings for 1 hour
- Cache is automatically cleared when embeddings update
- Environment: `CACHE_BUSTER` (auto-updated timestamp)

## IAM Permissions

The Lambda role (`vault22-faq-chatbot-dev-us-east-1-lambdaRole`) has:

```json
{
  "Action": [
    "lambda:GetFunctionConfiguration",
    "lambda:UpdateFunctionConfiguration"
  ],
  "Resource": [
    "arn:aws:lambda:us-east-1:077890164880:function:vault22-faq-chatbot-dev-chatbot"
  ],
  "Effect": "Allow"
}
```

## Testing the Automation

### 1. Update Content in Strapi

1. Go to Strapi Admin: http://localhost:1337/admin
2. Navigate to Content Manager → FAQs
3. Update or create an FAQ entry
4. Click "Publish"

### 2. Wait for Debounce Period

- System waits 30 seconds to batch multiple changes
- Check Strapi logs for: `[Export] Debounced export triggered for api::faq.faq`

### 3. Verify Automatic Processing

Watch the logs for:
```
[Export] Completed for api::faq.faq - X files
[Export] Triggering embedding processing...
[Export] Embedding processing triggered successfully
```

### 4. Test Chatbot

After ~1-2 minutes, test the chatbot:

```bash
curl -X POST https://9twtox1bii.execute-api.us-east-1.amazonaws.com/dev/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "Your updated FAQ question"}'
```

The chatbot should respond with the updated content.

## Manual Triggers (Optional)

If you need to manually trigger the process:

### Trigger Export Only
```bash
curl -X POST http://localhost:1337/api/knowledge-base/export
```

### Trigger Embedding Processing
```bash
curl -X POST https://9twtox1bii.execute-api.us-east-1.amazonaws.com/dev/content/process
```

This will automatically clear the cache as well.

## Monitoring

### Check Processing Status

```bash
curl https://9twtox1bii.execute-api.us-east-1.amazonaws.com/dev/content/status
```

### Check Latest Embeddings

```bash
aws s3api head-object \
  --bucket vault22-faq-chatbot-dev \
  --key embeddings/faq-embeddings.json \
  --region us-east-1 \
  | jq '{LastModified, Metadata}'
```

### Check Cache Buster Value

```bash
aws lambda get-function-configuration \
  --function-name vault22-faq-chatbot-dev-chatbot \
  --region us-east-1 \
  | jq '.Environment.Variables.CACHE_BUSTER'
```

## Troubleshooting

### Content Not Updating

1. **Check Strapi logs** - Is export triggered?
2. **Check S3** - Are markdown files updated?
   ```bash
   aws s3 ls s3://vault22-faq-chatbot-dev/content/faq/ --region us-east-1
   ```
3. **Check embeddings** - Are they regenerated?
   ```bash
   aws s3api head-object --bucket vault22-faq-chatbot-dev --key embeddings/faq-embeddings.json --region us-east-1
   ```
4. **Check cache** - Is CACHE_BUSTER updated?

### Lambda Errors

Check CloudWatch logs:
```bash
aws logs tail /aws/lambda/vault22-faq-chatbot-dev-contentManager --follow
aws logs tail /aws/lambda/vault22-faq-chatbot-dev-chatbot --follow
```

### Permission Errors

Verify IAM role has:
- `s3:GetObject`, `s3:PutObject` on S3 bucket
- `bedrock:InvokeModel` on Bedrock models
- `lambda:GetFunctionConfiguration`, `lambda:UpdateFunctionConfiguration` on chatbot Lambda

## Benefits

✅ **Fully Automated** - No manual steps required
✅ **Fast Updates** - Content available within 1-2 minutes
✅ **No Downtime** - Chatbot remains available during updates
✅ **Batch Processing** - Multiple changes processed together
✅ **Cache Management** - Automatic cache invalidation
✅ **Logging** - Full audit trail in CloudWatch

## Architecture

```
┌─────────────┐
│ Strapi CMS  │
│   (Local)   │
└──────┬──────┘
       │ 1. Content Update
       ↓
┌─────────────────────┐
│ Export Orchestrator │
│   (30s debounce)    │
└──────┬──────────────┘
       │ 2. Export to S3
       ↓
┌──────────────────────┐
│ Content Manager      │
│ Lambda               │
│ - Generate embeddings│
│ - Save to S3         │
│ - Clear chatbot cache│
└──────┬───────────────┘
       │ 3. Update config
       ↓
┌──────────────────────┐
│ Chatbot Lambda       │
│ - Reload embeddings  │
│ - Serve fresh answers│
└──────────────────────┘
```

## Summary

The entire workflow is now **fully automated**:
- ✅ Content changes in Strapi → Auto-export
- ✅ Export complete → Auto-process embeddings
- ✅ Embeddings saved → Auto-clear cache
- ✅ Cache cleared → Fresh content available

No manual intervention required!
