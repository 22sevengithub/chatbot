# Configurable Chatbot Prompt - Architecture & Implementation

## Current State Analysis

### Chatbot Lambda (`lambda-function.js`)
- **Current Prompt**: Hardcoded at lines 220-235
- **Location**: Inside `generateAnswer()` function
- **Problem**: Cannot be modified without code deployment

### Content Manager Lambda (`content-manager.js`)
- **Already has**: `clearChatbotCache()` function (lines 427-459)
- **Capability**: Can update Lambda environment variables via AWS SDK
- **Pattern**: Updates `CACHE_BUSTER` to force Lambda refresh

### Strapi CMS
- **Current**: FAQ content type with Knowledge Base export system
- **Export Trigger**: Automatic on content create/update/publish
- **Integration**: Webhooks can trigger Lambda functions

---

## Solution Comparison

### 🏆 Option 1: Environment Variable Update (RECOMMENDED)

**How it works:**
1. Create `system-prompt` content type in Strapi (single record)
2. Admin edits the prompt in Strapi CMS
3. On publish, Strapi middleware detects special content type
4. Calls Content Manager Lambda with special action: `updatePrompt`
5. Content Manager updates chatbot Lambda's `SYSTEM_PROMPT` env var
6. Lambda automatically refreshes on next invocation (cold start)

**Architecture:**
```
┌─────────────┐         ┌──────────────────┐         ┌──────────────────┐
│   Strapi    │ Publish │  Content Manager │ Update  │  Chatbot Lambda  │
│   (Admin)   │────────▶│     Lambda       │────────▶│  Environment Var │
│             │         │                  │         │  SYSTEM_PROMPT   │
└─────────────┘         └──────────────────┘         └──────────────────┘
                                                               │
                                                               ▼
                                                      ┌─────────────────┐
                                                      │  User requests  │
                                                      │  use new prompt │
                                                      └─────────────────┘
```

**Pros:**
- ✅ **Zero runtime overhead** - env var loaded at Lambda init
- ✅ **Uses existing infrastructure** - leverages `clearChatbotCache()` pattern
- ✅ **Secure** - no public API needed
- ✅ **Simple** - minimal code changes
- ✅ **Instant updates** - next Lambda invocation uses new prompt
- ✅ **Version control** - Strapi tracks all prompt changes

**Cons:**
- ⚠️ Lambda cold start when env var changes (~1-2 seconds)
- ⚠️ 4KB environment variable size limit (plenty for prompts)
- ⚠️ Max 30 concurrent env var updates per Lambda

**Size Check:**
Current prompt: ~400 characters = 0.4KB
Maximum recommended: ~3KB (leaves room for other env vars)

**Best for:** Production use, performance-critical applications

---

### Option 2: S3 Storage with Cache

**How it works:**
1. Create `system-prompt` content type in Strapi
2. Export prompt to S3 as `config/system-prompt.txt`
3. Lambda loads from S3 with 1-hour cache (like embeddings)
4. On cache miss, fetches from S3

**Architecture:**
```
┌─────────────┐         ┌──────────────┐         ┌──────────────────┐
│   Strapi    │ Export  │      S3      │  Load   │  Chatbot Lambda  │
│   (Admin)   │────────▶│    Bucket    │◀────────│  (with cache)    │
│             │         │ config/*.txt │         │                  │
└─────────────┘         └──────────────┘         └──────────────────┘
```

**Pros:**
- ✅ No size limits (can store large prompts)
- ✅ Uses existing S3 infrastructure
- ✅ Cache reduces S3 calls (1 hour duration)
- ✅ Can store multiple prompt versions

**Cons:**
- ⚠️ First request has S3 latency (~50-100ms)
- ⚠️ More complex code (S3 client, caching logic)
- ⚠️ Cache invalidation complexity
- ⚠️ S3 API costs (minimal but present)

**Best for:** Large prompts (>3KB), multiple prompt variants

---

### Option 3: Strapi API Fetch (NOT RECOMMENDED)

**How it works:**
1. Lambda fetches prompt from Strapi API on each request
2. Uses API key for authentication
3. Optional caching in Lambda memory

**Pros:**
- ✅ Real-time updates (no Lambda restart needed)
- ✅ Simple Strapi side (just enable API)

**Cons:**
- ❌ Extra API call on every request (latency)
- ❌ Strapi API key management complexity
- ❌ CORS and network security concerns
- ❌ Strapi needs to be highly available
- ❌ Added cost (API calls, data transfer)
- ❌ Cache invalidation if using cache

**Best for:** Not recommended for production

---

## Recommended Implementation: Option 1 (Environment Variable)

### Phase 1: Strapi Content Type

Create new content type: `config/content-types/system-prompt/schema.json`

```json
{
  "kind": "singleType",
  "collectionName": "system_prompt",
  "info": {
    "singularName": "system-prompt",
    "pluralName": "system-prompts",
    "displayName": "Chatbot System Prompt",
    "description": "Configure the AI chatbot's behavior and personality"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "prompt": {
      "type": "text",
      "required": true,
      "maxLength": 3000,
      "default": "You are a helpful AI assistant for Vault22..."
    },
    "description": {
      "type": "string",
      "maxLength": 200
    },
    "maxTokens": {
      "type": "integer",
      "default": 500,
      "min": 100,
      "max": 4000
    },
    "temperature": {
      "type": "decimal",
      "default": 0.7,
      "min": 0,
      "max": 1
    },
    "lastUpdatedBy": {
      "type": "string"
    }
  }
}
```

### Phase 2: Export Middleware Enhancement

Update `website/backend/src/middlewares/knowledge-base-export.js`:

```javascript
// Detect system prompt updates
if (contentType === 'api::system-prompt.system-prompt' && event === 'entry.publish') {
  console.log('[System Prompt] Update detected, triggering Lambda update');

  // Fetch the prompt content
  const prompt = await strapi.entityService.findOne(
    'api::system-prompt.system-prompt',
    entry.id
  );

  // Call Content Manager Lambda to update environment
  await updateChatbotPrompt(prompt);
}
```

### Phase 3: Content Manager Lambda Enhancement

Add new handler to `chatbot/content-manager.js`:

```javascript
/**
 * Update chatbot system prompt
 * POST /content/update-prompt
 * Body: { prompt: string, maxTokens: number, temperature: number }
 */
async function handleUpdatePrompt(event) {
    const body = JSON.parse(event.body || '{}');
    const { prompt, maxTokens, temperature } = body;

    if (!prompt || prompt.trim().length === 0) {
        return corsResponse(400, {
            error: 'Missing required field: prompt'
        });
    }

    // Validate size (4KB AWS limit)
    if (prompt.length > 3500) {
        return corsResponse(400, {
            error: 'Prompt too large',
            message: 'Maximum prompt size is 3500 characters',
            currentSize: prompt.length
        });
    }

    try {
        console.log(`Updating system prompt for Lambda: ${CHATBOT_FUNCTION_NAME}`);

        // Get current configuration
        const getConfigCommand = new GetFunctionConfigurationCommand({
            FunctionName: CHATBOT_FUNCTION_NAME
        });
        const currentConfig = await lambdaClient.send(getConfigCommand);

        // Update environment variables
        const envVars = currentConfig.Environment?.Variables || {};
        envVars.SYSTEM_PROMPT = prompt;
        envVars.MAX_TOKENS = maxTokens?.toString() || '500';
        envVars.TEMPERATURE = temperature?.toString() || '0.7';
        envVars.PROMPT_UPDATED_AT = new Date().toISOString();

        const updateCommand = new UpdateFunctionConfigurationCommand({
            FunctionName: CHATBOT_FUNCTION_NAME,
            Environment: {
                Variables: envVars
            }
        });

        const result = await lambdaClient.send(updateCommand);
        console.log('System prompt updated successfully');

        return corsResponse(200, {
            success: true,
            message: 'System prompt updated successfully',
            promptLength: prompt.length,
            maxTokens: maxTokens || 500,
            temperature: temperature || 0.7,
            updatedAt: envVars.PROMPT_UPDATED_AT,
            functionVersion: result.Version
        });
    } catch (error) {
        console.error('Failed to update system prompt:', error);
        return corsResponse(500, {
            error: 'Failed to update system prompt',
            message: error.message
        });
    }
}
```

### Phase 4: Chatbot Lambda Enhancement

Update `chatbot/lambda-function.js`:

```javascript
// Add at top with other config
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant for Vault22, a financial management app.
Answer the user's question based on the following FAQ knowledge base context.

IMPORTANT INSTRUCTIONS:
1. Only use information from the provided context
2. If the context doesn't contain relevant information, say so clearly
3. Be concise but helpful (2-4 sentences)
4. If appropriate, mention which section of the FAQ you're referencing
5. Never make up information not in the context`;

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '500', 10);
const TEMPERATURE = parseFloat(process.env.TEMPERATURE || '0.7');

// Update generateAnswer function
async function generateAnswer(question, context) {
    try {
        const prompt = `${SYSTEM_PROMPT}

FAQ CONTEXT:
${context}

USER QUESTION: ${question}

ANSWER:`;

        const command = new InvokeModelCommand({
            modelId: MODEL_ID,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: MAX_TOKENS,
                temperature: TEMPERATURE
            })
        });

        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        return responseBody.content[0].text;

    } catch (error) {
        console.error('Error generating answer:', error);
        throw error;
    }
}
```

### Phase 5: Serverless Configuration

Update `chatbot/serverless.yml`:

```yaml
functions:
  contentManager:
    handler: content-manager.handler
    description: Manages chatbot knowledge base content from Strapi
    timeout: 300
    events:
      # ... existing events ...

      # New endpoint for prompt updates
      - http:
          path: content/update-prompt
          method: post
          cors:
            origin: '*'
      - http:
          path: content/update-prompt
          method: options
          cors:
            origin: '*'

# Add Lambda update permissions
provider:
  iam:
    role:
      statements:
        # ... existing statements ...

        # Lambda configuration update permissions
        - Effect: Allow
          Action:
            - lambda:GetFunctionConfiguration
            - lambda:UpdateFunctionConfiguration
          Resource:
            - arn:aws:lambda:${self:provider.region}:*:function:${self:service}-${self:provider.stage}-chatbot
```

---

## Implementation Steps

### Step 1: Create Strapi Content Type
```bash
cd /Users/m.milosevic/projects/vault22/website/backend
mkdir -p src/api/system-prompt/content-types/system-prompt
# Create schema.json (see Phase 1)
```

### Step 2: Update Export Middleware
```bash
# Edit src/middlewares/knowledge-base-export.js
# Add system-prompt detection and handling
```

### Step 3: Enhance Content Manager Lambda
```bash
cd /Users/m.milosevic/projects/vault22/chatbot
# Edit content-manager.js
# Add handleUpdatePrompt function
# Update handler routing
```

### Step 4: Enhance Chatbot Lambda
```bash
# Edit lambda-function.js
# Add SYSTEM_PROMPT env var support
# Update generateAnswer function
```

### Step 5: Update Serverless Config
```bash
# Edit serverless.yml
# Add new endpoint and IAM permissions
```

### Step 6: Deploy
```bash
cd /Users/m.milosevic/projects/vault22/chatbot
serverless deploy --stage dev
```

### Step 7: Test
```bash
# 1. Start Strapi
cd /Users/m.milosevic/projects/vault22/website/backend
npm run develop

# 2. Go to admin panel
# 3. Create/update System Prompt entry
# 4. Publish it
# 5. Check Lambda logs
# 6. Test chatbot with new prompt
```

---

## Alternative: Quick Hybrid Approach

If you want to implement quickly without full Strapi integration:

**Manual API Call Approach:**
```bash
# Admin updates prompt in Strapi
# Then manually triggers update via API:

curl -X POST https://your-api.amazonaws.com/dev/content/update-prompt \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "You are a friendly Vault22 assistant...",
    "maxTokens": 500,
    "temperature": 0.7
  }'
```

**Pros:** Can implement Content Manager Lambda changes first, test thoroughly, then add Strapi automation later.

---

## Security Considerations

1. **IAM Permissions**: Content Manager needs `lambda:UpdateFunctionConfiguration`
2. **API Authentication**: Add API Gateway authentication for update-prompt endpoint
3. **Rate Limiting**: Prevent rapid prompt updates (use Lambda reserved concurrency)
4. **Validation**: Validate prompt content (no code injection, reasonable length)
5. **Audit Trail**: Log all prompt updates with user info

---

## Monitoring

### CloudWatch Metrics
- Track prompt update frequency
- Monitor Lambda cold starts after updates
- Alert on failed updates

### Logging
```javascript
console.log('[Prompt Update]', {
  timestamp: new Date().toISOString(),
  promptLength: prompt.length,
  updatedBy: user.email,
  previousPromptHash: hash(previousPrompt),
  newPromptHash: hash(prompt)
});
```

---

## Cost Analysis

### Environment Variable Approach (Recommended)
- **Lambda updates**: Free (within AWS Lambda free tier)
- **Cold start**: ~1-2 seconds (infrequent)
- **Runtime overhead**: $0 (env vars loaded at init)
- **Total cost**: ~$0.01/month

### S3 Approach (Alternative)
- **S3 storage**: $0.023/GB (trivial for text file)
- **S3 GET requests**: $0.0004/1000 requests
- **Data transfer**: Free (within AWS)
- **Total cost**: ~$0.10/month

---

## Recommendation

**Implement Option 1 (Environment Variable)** because:
1. ✅ Zero runtime cost and latency
2. ✅ Leverages existing `clearChatbotCache()` pattern
3. ✅ Simple, secure, maintainable
4. ✅ Instant updates (next Lambda invocation)
5. ✅ Perfect for prompts under 3KB (typical use case)

**Consider Option 2 (S3)** if:
- You need prompts larger than 3KB
- You want to store multiple prompt versions
- You need to roll back to previous prompts quickly

**Avoid Option 3 (Strapi API)** unless:
- You absolutely need real-time updates without cold start
- You're okay with the complexity and latency trade-offs
