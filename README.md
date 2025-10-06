# Vault22 FAQ Chatbot

A serverless AI-powered chatbot that answers questions based on FAQ documents using AWS Lambda, Bedrock, and S3 vector storage.

## 🎯 Features

- **Semantic Search**: Uses vector embeddings for intelligent FAQ matching
- **AI-Powered Responses**: Powered by Claude 3.5 Haiku via AWS Bedrock
- **Serverless Architecture**: Fully managed with AWS Lambda + API Gateway
- **Cost-Effective**: Smart caching and optimized vector storage
- **Easy Deployment**: One-command deployment with Serverless Framework

## 📁 Project Structure

```
chatbot/
├── lambda-function.js        # Main chatbot Lambda function
├── process-faqs.js           # FAQ document processor and embedding generator
├── serverless.yml            # Serverless Framework configuration
├── package.json              # Node.js dependencies
├── deploy.sh                 # Deployment automation script
├── iam-policy.json           # IAM policy template
└── README.md                 # This file
```

## 🏗️ Architecture

```
┌─────────────┐
│ User Query  │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│   API Gateway       │
│   POST /chat        │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Lambda Function                   │
│   ├─ Load FAQ embeddings from S3    │
│   ├─ Generate query embedding       │
│   ├─ Find relevant FAQ chunks       │
│   └─ Generate AI response           │
└──────┬──────────────────────────────┘
       │
       ├────────────────┐
       │                │
       ▼                ▼
┌──────────────┐  ┌────────────────┐
│ S3 Bucket    │  │  AWS Bedrock   │
│ FAQ Vectors  │  │  Claude Model  │
└──────────────┘  └────────────────┘
```

## 🚀 Quick Start

### Prerequisites

1. **AWS Account** with Bedrock access enabled in `us-east-1`
2. **AWS CLI** configured with appropriate credentials
3. **Node.js 20+** installed
4. **Serverless Framework** CLI:
   ```bash
   npm install -g serverless
   ```

### Installation

```bash
# 1. Navigate to chatbot directory
cd /path/to/vault22/chatbot

# 2. Install dependencies
npm install

# 3. Configure AWS credentials (if not already done)
aws configure

# 4. Verify Bedrock access
aws bedrock list-foundation-models --region us-east-1
```

## 📦 Deployment

### Option 1: Automated Deployment (Recommended)

```bash
# Make deploy script executable
chmod +x deploy.sh

# Run full deployment
./deploy.sh
```

This will:
1. Install dependencies
2. Deploy Lambda function and API Gateway
3. Create S3 bucket for FAQ storage
4. Display API endpoint URL

### Option 2: Manual Deployment

```bash
# Deploy serverless stack
serverless deploy --stage dev

# Note the API endpoint URL from output
```

### Option 3: Production Deployment

```bash
# Deploy to production
serverless deploy --stage prod
```

## 📝 FAQ Setup

### Step 1: Upload FAQ Documents

Place your FAQ markdown files in the `../FAQ` directory (relative to chatbot folder), then run:

```bash
# Upload and process FAQs
node process-faqs.js --upload --process
```

Or upload manually:

```bash
# Set environment variables
export FAQ_BUCKET="vault22-faq-chatbot-dev"
export AWS_REGION="us-east-1"

# Upload FAQs from local directory
node process-faqs.js --upload
```

### Step 2: Generate Embeddings

```bash
# Process uploaded FAQs and generate embeddings
node process-faqs.js --process
```

This will:
1. Read all `.md` files from S3 bucket's `faq-documents/` folder
2. Chunk documents into smaller pieces (1000 chars with 200 char overlap)
3. Generate embeddings using Amazon Titan
4. Store embeddings in `embeddings/faq-embeddings.json`

### FAQ Document Format

Store FAQ files as markdown (`.md`) in your local FAQ directory:

```markdown
# Account Management

## How do I reset my password?
1. Go to Settings > Security
2. Click "Change Password"
3. Enter your current password
4. Enter new password twice
5. Click "Update Password"

## How do I link my bank account?
1. Navigate to Accounts section
2. Click "Add Account"
3. Select your bank
4. Follow OAuth flow
5. Confirm account linking
```

## 🔧 Configuration

### Environment Variables

Edit `serverless.yml` to customize:

```yaml
environment:
  FAQ_BUCKET: vault22-faq-chatbot-${self:provider.stage}
  EMBEDDINGS_FILE: embeddings/faq-embeddings.json
  MODEL_ID: anthropic.claude-3-5-haiku-20241022-v1:0
  EMBED_MODEL_ID: amazon.titan-embed-text-v1
```

### Local Configuration (for process-faqs.js)

Create a `.env` file or set environment variables:

```bash
export FAQ_BUCKET="vault22-faq-chatbot-dev"
export LOCAL_FAQ_DIR="../FAQ"
export AWS_REGION="us-east-1"
```

## 🧪 Testing

### Test the Chatbot API

```bash
# Get the API URL from deployment output
export API_URL="https://xxx.execute-api.us-east-1.amazonaws.com/dev/chat"

# Test with a question
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{"question": "How do I reset my password?"}'
```

### Expected Response

```json
{
  "answer": "To reset your password in Vault22, follow these steps: 1) Go to Settings > Security, 2) Click 'Change Password', 3) Enter your current password, 4) Enter your new password twice, 5) Click 'Update Password'. Make sure your new password meets the security requirements."
}
```

### Test Document Processing

```bash
# Test FAQ upload
node process-faqs.js --upload

# Test embedding generation
node process-faqs.js --process

# View logs
serverless logs -f chatbot --tail
```

## 📊 API Reference

### POST /chat

**Request Body:**
```json
{
  "question": "string (required) - User's question"
}
```

**Response (Success - 200):**
```json
{
  "answer": "AI-generated response based on FAQ context"
}
```

**Response (Error - 400):**
```json
{
  "error": "Missing required parameter: question"
}
```

**Response (Error - 503):**
```json
{
  "error": "FAQ knowledge base not initialized. Please run document processor first."
}
```

## 🔐 IAM Permissions

The Lambda function requires these AWS permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-haiku-20241022-v1:0",
        "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v1"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::vault22-faq-chatbot-*",
        "arn:aws:s3:::vault22-faq-chatbot-*/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:*:log-group:/aws/lambda/*"
    }
  ]
}
```

See `iam-policy.json` for the complete policy template.

## 💰 Cost Estimates

### Monthly Costs (Estimated for 10,000 queries)

| Service | Usage | Cost |
|---------|-------|------|
| Lambda Execution | 10,000 invocations × 3 sec @ 512MB | ~$0.10 |
| API Gateway | 10,000 requests | ~$0.04 |
| S3 Storage | 100MB embeddings | ~$0.002 |
| S3 Requests | 10,000 GET requests | ~$0.004 |
| Bedrock - Titan Embeddings | 500K tokens | ~$0.01 |
| Bedrock - Claude Haiku | 5M input + 500K output tokens | ~$1.25 |
| **Total** | | **~$1.40/month** |

### Cost Optimization Tips

1. **Caching**: Embeddings cached in Lambda memory (1 hour TTL)
2. **Efficient Models**: Using Claude 3.5 Haiku (cheapest Claude model)
3. **Smart Chunking**: Optimized chunk size reduces token usage
4. **Reserved Concurrency**: Limits max concurrent executions to control costs

## 🔍 Monitoring

### CloudWatch Logs

```bash
# View real-time logs
serverless logs -f chatbot --tail

# View logs for specific time period
serverless logs -f chatbot --startTime 1h
```

### CloudWatch Metrics

Monitor these key metrics:
- **Invocations**: Number of API calls
- **Duration**: Response time
- **Errors**: Failed requests
- **Throttles**: Rate limit hits

### S3 Monitoring

```bash
# Check bucket size
aws s3 ls s3://vault22-faq-chatbot-dev --recursive --summarize

# View embeddings file
aws s3 cp s3://vault22-faq-chatbot-dev/embeddings/faq-embeddings.json - | jq '.[] | {id, category: .metadata.category}'
```

## 🛠️ Troubleshooting

### Issue: "FAQ knowledge base not initialized"

**Solution:**
```bash
# Verify bucket exists
aws s3 ls s3://vault22-faq-chatbot-dev

# Re-run document processor
node process-faqs.js --process
```

### Issue: "Access Denied" errors

**Solution:**
```bash
# Verify AWS credentials
aws sts get-caller-identity

# Check Bedrock access
aws bedrock list-foundation-models --region us-east-1

# Verify S3 bucket permissions
aws s3 ls s3://vault22-faq-chatbot-dev
```

### Issue: Lambda timeout

**Solution:**
- Increase timeout in `serverless.yml` (default: 30s)
- Check if embeddings file is too large
- Verify Bedrock model availability

### Issue: Poor answer quality

**Solution:**
1. Check if FAQ documents are well-structured
2. Increase `maxResults` parameter (default: 3)
3. Review embeddings by enabling `includeContext: true`
4. Consider re-processing FAQs with better chunking

## 🔄 Updates and Maintenance

### Update FAQ Content

```bash
# 1. Update/add FAQ markdown files in ../FAQ directory
# 2. Re-upload and process
node process-faqs.js --upload --process

# 3. Embeddings will be refreshed automatically
```

### Update Lambda Code

```bash
# Deploy code changes
serverless deploy function -f chatbot

# Or full redeploy
serverless deploy
```

### Update Dependencies

```bash
npm update
serverless deploy
```

## 🗑️ Cleanup

### Remove Deployment

```bash
# Remove all AWS resources
serverless remove --stage dev

# Manually delete S3 bucket contents if needed
aws s3 rm s3://vault22-faq-chatbot-dev --recursive
```

## 🔗 Integration

### Flutter App Integration

```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

class ChatbotService {
  static const String apiUrl = 'https://xxx.execute-api.us-east-1.amazonaws.com/dev/chat';

  static Future<String> askQuestion(String question) async {
    final response = await http.post(
      Uri.parse(apiUrl),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'question': question}),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return data['answer'];
    } else {
      throw Exception('Failed to get answer');
    }
  }
}
```

### Web Integration

```javascript
async function askChatbot(question) {
  const response = await fetch('https://xxx.execute-api.us-east-1.amazonaws.com/dev/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question })
  });

  const data = await response.json();
  return data.answer;
}

// Usage
const answer = await askChatbot('How do I reset my password?');
console.log(answer);
```

## 📚 Related Documentation

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Serverless Framework Documentation](https://www.serverless.com/framework/docs)
- [Amazon Titan Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html)
- [Claude Models](https://docs.anthropic.com/claude/docs/models-overview)

## 🤝 Contributing

To contribute to this chatbot:

1. Test changes locally using `serverless invoke local`
2. Update documentation as needed
3. Follow existing code style and patterns
4. Test thoroughly before deploying to production

## 📄 License

Part of the Vault22 project. All rights reserved.

## 🆘 Support

For issues or questions:
1. Check CloudWatch Logs
2. Review this README
3. Contact the Vault22 development team
