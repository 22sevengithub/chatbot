# Vault22 FAQ Chatbot - Deployment Guide

This guide provides step-by-step instructions for deploying the FAQ chatbot to AWS.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [Quick Deployment](#quick-deployment)
4. [Manual Deployment](#manual-deployment)
5. [FAQ Setup](#faq-setup)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)
8. [Maintenance](#maintenance)

## Prerequisites

### Required Software

1. **Node.js 20+**
   ```bash
   node --version  # Should be v20.0.0 or higher
   ```

2. **AWS CLI**
   ```bash
   aws --version
   aws configure  # Set up credentials
   ```

3. **Serverless Framework**
   ```bash
   npm install -g serverless
   serverless --version
   ```

### AWS Account Setup

1. **Enable AWS Bedrock**
   - Go to AWS Console → Bedrock
   - Enable model access for:
     - Claude 3.5 Haiku
     - Amazon Titan Embeddings
   - Region: `us-east-1`

2. **Verify Bedrock Access**
   ```bash
   aws bedrock list-foundation-models --region us-east-1
   ```

3. **IAM Permissions**
   - Your AWS user/role needs permissions from `iam-policy.json`
   - Key permissions: Lambda, S3, Bedrock, CloudWatch Logs

## Project Structure

```
chatbot/
├── lambda-function.js        # Main Lambda function (chatbot)
├── process-faqs.js           # FAQ processor (uploads & generates embeddings)
├── serverless.yml            # Infrastructure as Code
├── package.json              # Dependencies
├── deploy.sh                 # Automated deployment script
├── test-chatbot.js           # Test script
├── iam-policy.json           # IAM policy template
├── .gitignore                # Git ignore rules
├── README.md                 # Comprehensive documentation
└── DEPLOYMENT_GUIDE.md       # This file
```

## Quick Deployment

### Option 1: Automated Deployment (Recommended)

```bash
# 1. Navigate to chatbot directory
cd /path/to/vault22/chatbot

# 2. Make deploy script executable (first time only)
chmod +x deploy.sh

# 3. Run deployment
./deploy.sh
```

This will:
- ✅ Check prerequisites
- ✅ Install dependencies
- ✅ Deploy Lambda function
- ✅ Create S3 bucket
- ✅ Upload FAQ documents (if available)
- ✅ Generate embeddings
- ✅ Display API endpoint

### Option 2: Production Deployment

```bash
./deploy.sh --stage prod
```

## Manual Deployment

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Deploy Serverless Stack

```bash
# Development
serverless deploy --stage dev

# Production
serverless deploy --stage prod
```

### Step 3: Note the API Endpoint

After deployment, you'll see output like:
```
endpoints:
  POST - https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/dev/chat
```

Save this URL - you'll need it for testing.

### Step 4: Set Up FAQs

```bash
# Set environment variables
export FAQ_BUCKET="vault22-faq-chatbot-dev"
export LOCAL_FAQ_DIR="../FAQ"

# Upload and process FAQs
node process-faqs.js --upload --process
```

## FAQ Setup

### Prepare FAQ Documents

1. **Create FAQ Directory**
   ```bash
   mkdir -p ../FAQ
   ```

2. **Add Markdown Files**

   Create `.md` files with your FAQs:

   ```markdown
   # Account Management

   ## How do I reset my password?
   Step-by-step instructions...

   ## How do I link my bank account?
   Step-by-step instructions...
   ```

3. **Upload to S3**
   ```bash
   node process-faqs.js --upload
   ```

4. **Generate Embeddings**
   ```bash
   node process-faqs.js --process
   ```

5. **Or Do Both at Once**
   ```bash
   node process-faqs.js --upload --process
   ```

### FAQ Document Guidelines

- Use clear, descriptive section headers
- Keep answers concise but complete
- Use markdown formatting for readability
- Include step-by-step instructions where applicable
- Group related questions in same file

## Testing

### Test with curl

```bash
# Get API URL from deployment output or .api-url file
API_URL=$(cat .api-url)

# Test a question
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{"question": "How do I reset my password?"}'
```

### Run Test Suite

```bash
# Run all test questions
node test-chatbot.js

# Or specify API URL directly
node test-chatbot.js "https://xxx.execute-api.us-east-1.amazonaws.com/dev/chat"
```

### View Logs

```bash
# Real-time logs
serverless logs -f chatbot --tail --stage dev

# Last 5 minutes
serverless logs -f chatbot --startTime 5m --stage dev
```

## Troubleshooting

### Issue: Deployment Fails

**Check:**
1. AWS credentials configured: `aws sts get-caller-identity`
2. Bedrock access enabled: `aws bedrock list-foundation-models --region us-east-1`
3. Node.js version: `node --version` (should be 20+)

**Solution:**
```bash
# Re-run with verbose output
serverless deploy --stage dev --verbose
```

### Issue: "FAQ knowledge base not initialized"

**Solution:**
```bash
# Verify S3 bucket exists
aws s3 ls s3://vault22-faq-chatbot-dev

# Re-process FAQs
node process-faqs.js --process

# Check if embeddings file exists
aws s3 ls s3://vault22-faq-chatbot-dev/embeddings/
```

### Issue: Lambda Timeout

**Solution:**
1. Check if embeddings file is too large
2. Increase timeout in `serverless.yml`:
   ```yaml
   provider:
     timeout: 60  # Increase from 30 to 60 seconds
   ```
3. Redeploy: `serverless deploy`

### Issue: Poor Answer Quality

**Solution:**
1. Review FAQ document structure
2. Increase context in API request:
   ```json
   {
     "question": "...",
     "maxResults": 5,
     "includeContext": true
   }
   ```
3. Check embeddings quality:
   ```bash
   aws s3 cp s3://vault22-faq-chatbot-dev/embeddings/faq-embeddings.json - | jq '.[] | {category: .metadata.category}'
   ```

### Issue: High Costs

**Solution:**
1. Enable caching (already enabled by default - 1 hour)
2. Reduce concurrent executions in `serverless.yml`:
   ```yaml
   functions:
     chatbot:
       reservedConcurrency: 5  # Lower from 10
   ```
3. Monitor CloudWatch metrics
4. Consider using API Gateway caching

## Maintenance

### Update FAQ Content

```bash
# 1. Edit FAQ markdown files in ../FAQ directory

# 2. Re-upload and process
node process-faqs.js --upload --process

# 3. Test immediately (cache will refresh within 1 hour)
node test-chatbot.js
```

### Update Lambda Code

```bash
# Quick update (function code only)
serverless deploy function -f chatbot --stage dev

# Full update (infrastructure + code)
serverless deploy --stage dev
```

### Update Dependencies

```bash
# Update packages
npm update

# Redeploy
serverless deploy --stage dev
```

### Monitor Performance

```bash
# View CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=vault22-faq-chatbot-dev-chatbot \
  --start-time 2025-10-01T00:00:00Z \
  --end-time 2025-10-01T23:59:59Z \
  --period 3600 \
  --statistics Average,Maximum \
  --region us-east-1
```

### Backup

```bash
# Backup S3 bucket
aws s3 sync s3://vault22-faq-chatbot-dev ./backup-$(date +%Y%m%d)

# Backup serverless configuration
cp serverless.yml serverless.yml.backup
```

## Cleanup

### Remove Deployment

```bash
# Remove all AWS resources
serverless remove --stage dev

# Manually delete S3 bucket contents (if needed)
aws s3 rm s3://vault22-faq-chatbot-dev --recursive
```

## Environment Variables

### Required (set in serverless.yml)

- `FAQ_BUCKET`: S3 bucket name for FAQ storage
- `EMBEDDINGS_FILE`: Path to embeddings JSON file
- `MODEL_ID`: Bedrock model ID (Claude 3.5 Haiku)
- `EMBED_MODEL_ID`: Embedding model ID (Titan)
- `AWS_REGION`: AWS region (us-east-1)

### Optional (for process-faqs.js)

- `FAQ_BUCKET`: Override S3 bucket name
- `LOCAL_FAQ_DIR`: Path to local FAQ directory
- `AWS_REGION`: Override AWS region

## Next Steps

After successful deployment:

1. **Test Thoroughly**
   - Run test suite: `node test-chatbot.js`
   - Test with real user questions
   - Verify answer quality

2. **Integrate with App**
   - Use API endpoint in Flutter app
   - See README.md for integration examples

3. **Monitor Usage**
   - Set up CloudWatch alarms
   - Monitor costs in AWS Cost Explorer
   - Track performance metrics

4. **Iterate on FAQs**
   - Gather user feedback
   - Improve FAQ content
   - Add missing topics

## Support

For issues or questions:
1. Check CloudWatch Logs: `serverless logs -f chatbot --tail`
2. Review README.md for detailed documentation
3. Check AWS Console for resource status
4. Contact Vault22 development team

## Additional Resources

- [README.md](README.md) - Full documentation
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Serverless Framework Documentation](https://www.serverless.com/framework/docs)
- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
