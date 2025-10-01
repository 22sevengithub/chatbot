# 🚀 START HERE - Vault22 FAQ Chatbot

## What Is This?

A **complete, production-ready serverless chatbot** that answers Vault22 FAQ questions using:
- AWS Lambda (serverless compute)
- AWS Bedrock (Claude AI)
- S3 Vector Storage (FAQ embeddings)
- API Gateway (HTTP endpoint)

**Cost:** ~$1.40/month for 10,000 queries
**Deployment Time:** ~5 minutes

---

## 📦 What's Included

```
chatbot/
├── lambda-function.js        # Main chatbot (answers questions)
├── process-faqs.js           # Processes FAQ files & creates embeddings
├── serverless.yml            # AWS infrastructure definition
├── deploy.sh                 # One-command deployment script
├── test-chatbot.js           # Test the deployed chatbot
├── package.json              # Node.js dependencies
├── iam-policy.json           # AWS permissions needed
├── .gitignore                # Git ignore rules
├── README.md                 # Complete documentation (13KB)
├── DEPLOYMENT_GUIDE.md       # Step-by-step deployment (8.7KB)
├── PROJECT_SUMMARY.md        # Technical overview (9.1KB)
└── START_HERE.md             # This file
```

**Total:** 10 files, fully self-contained, ready to deploy

---

## ⚡ Quick Start (3 Commands)

```bash
cd /Users/m.milosevic/projects/vault22/chatbot
chmod +x deploy.sh
./deploy.sh
```

That's it! The script handles everything:
- ✅ Checks AWS credentials
- ✅ Installs dependencies
- ✅ Deploys to AWS
- ✅ Creates S3 bucket
- ✅ Processes FAQs
- ✅ Shows API endpoint

---

## 🎯 How It Works

### Simple Flow:
```
User asks question → API → Lambda → Bedrock AI → Response
                              ↓
                          S3 (FAQs)
```

### Detailed Process:
1. User sends question to API endpoint
2. Lambda loads FAQ embeddings from S3 (cached 1 hour)
3. Question is converted to vector embedding
4. Find top 3 most similar FAQ chunks (cosine similarity)
5. Send FAQ context + question to Claude
6. Return AI-generated answer with sources

---

## 📖 Documentation

### Quick Reference:
- **START_HERE.md** (this file) - Get started in 5 minutes
- **DEPLOYMENT_GUIDE.md** - Step-by-step deployment instructions
- **README.md** - Complete technical documentation

### When to Read What:

| You want to... | Read this |
|----------------|-----------|
| Deploy quickly | START_HERE.md → Run `./deploy.sh` |
| Understand deployment steps | DEPLOYMENT_GUIDE.md |
| Full technical details | README.md |
| API integration examples | README.md (Integration section) |
| Troubleshoot issues | README.md (Troubleshooting section) |

---

## 🔑 Prerequisites

Before deploying, you need:

1. **AWS Account** with Bedrock enabled (us-east-1 region)
2. **AWS CLI** configured (`aws configure`)
3. **Node.js 20+** installed
4. **Serverless Framework** installed (`npm install -g serverless`)

### Quick Check:
```bash
aws sts get-caller-identity              # Check AWS credentials
aws bedrock list-foundation-models --region us-east-1  # Check Bedrock
node --version                           # Check Node.js (should be v20+)
serverless --version                     # Check Serverless Framework
```

---

## 🚀 Deployment Options

### Option 1: Automated (Recommended)
```bash
./deploy.sh
```
→ Deploys to `dev` stage

### Option 2: Production
```bash
./deploy.sh --stage prod
```
→ Deploys to `prod` stage

### Option 3: Manual
```bash
npm install
serverless deploy --stage dev
node process-faqs.js --upload --process
```

---

## 🧪 Testing

### After Deployment:

```bash
# Run test suite (8 questions)
node test-chatbot.js

# Or test with curl
curl -X POST https://xxx.execute-api.us-east-1.amazonaws.com/dev/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "How do I reset my password?"}'
```

### Expected Response:
```json
{
  "answer": "To reset your password...",
  "sources": [
    {
      "source": "account_management.md",
      "category": "Account Management",
      "similarity": "0.876"
    }
  ]
}
```

---

## 📝 FAQ Management

### Initial Setup:
FAQs should be in markdown files in `../FAQ` directory:

```
vault22/
├── FAQ/                    # Your FAQ markdown files
│   ├── account_management.md
│   ├── security.md
│   └── getting_started.md
└── chatbot/               # This chatbot folder
```

### Update FAQs:
```bash
# 1. Edit FAQ markdown files
# 2. Re-process
node process-faqs.js --upload --process

# 3. Cache refreshes within 1 hour (or restart Lambda)
```

---

## 💰 Costs

### Estimated Monthly Cost (10,000 queries):

| Service | Cost |
|---------|------|
| Lambda | $0.10 |
| API Gateway | $0.04 |
| S3 Storage | $0.002 |
| S3 Requests | $0.004 |
| Bedrock (Titan) | $0.01 |
| Bedrock (Claude) | $1.25 |
| **TOTAL** | **~$1.40** |

**Free Tier:** First year includes 1M Lambda requests and 1M API Gateway requests free!

---

## 🔗 Integration Examples

### Flutter/Dart:
```dart
class ChatbotService {
  static const apiUrl = 'https://xxx.execute-api.us-east-1.amazonaws.com/dev/chat';
  
  static Future<String> ask(String question) async {
    final response = await http.post(Uri.parse(apiUrl),
      body: jsonEncode({'question': question}));
    return jsonDecode(response.body)['answer'];
  }
}
```

### JavaScript:
```javascript
async function askChatbot(question) {
  const response = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ question })
  });
  return (await response.json()).answer;
}
```

---

## 🛠️ Common Tasks

### View Logs:
```bash
serverless logs -f chatbot --tail
```

### Update Lambda Code:
```bash
serverless deploy function -f chatbot
```

### Remove Deployment:
```bash
serverless remove --stage dev
```

### Check S3 Bucket:
```bash
aws s3 ls s3://vault22-faq-chatbot-dev --recursive
```

---

## ❓ Troubleshooting

### "FAQ knowledge base not initialized"
→ Run: `node process-faqs.js --process`

### "Access Denied"
→ Check AWS credentials: `aws sts get-caller-identity`
→ Verify Bedrock access: `aws bedrock list-foundation-models --region us-east-1`

### Poor Answer Quality
→ Check FAQ document structure
→ Increase `maxResults` in API request
→ Review embeddings: Enable `includeContext: true`

### More Help
→ See README.md Troubleshooting section
→ Check CloudWatch logs: `serverless logs -f chatbot --tail`

---

## 📊 Monitoring

### CloudWatch Logs:
```bash
serverless logs -f chatbot --tail
```

### AWS Console:
- Lambda: https://console.aws.amazon.com/lambda/
- S3: https://s3.console.aws.amazon.com/
- CloudWatch: https://console.aws.amazon.com/cloudwatch/

---

## 🎉 Success Checklist

After deployment:
- [ ] API endpoint received
- [ ] Test passed: `node test-chatbot.js`
- [ ] FAQ embeddings in S3: `aws s3 ls s3://vault22-faq-chatbot-dev/embeddings/`
- [ ] Lambda logs working: `serverless logs -f chatbot --tail`
- [ ] API returns valid responses

---

## 🚀 Next Steps

1. **Deploy:** Run `./deploy.sh`
2. **Test:** Run `node test-chatbot.js`
3. **Integrate:** Add API endpoint to your app
4. **Monitor:** Set up CloudWatch alarms (optional)
5. **Iterate:** Update FAQs based on user feedback

---

## 📞 Support

- **Documentation:** README.md, DEPLOYMENT_GUIDE.md
- **Logs:** `serverless logs -f chatbot --tail`
- **AWS Console:** Check Lambda, S3, CloudWatch
- **Team:** Contact Vault22 development team

---

## ✨ Key Features

✅ Semantic search (vector embeddings)
✅ AI responses (Claude 3.5 Haiku)
✅ Source attribution
✅ Auto-scaling (0 to 10,000+ requests)
✅ Smart caching (1-hour TTL)
✅ One-command deployment
✅ Cost-effective (~$1.40/month)
✅ Production-ready

---

**Ready to deploy? Run `./deploy.sh` now!** 🚀
