/**
 * Vault22 FAQ Chatbot Lambda Function
 *
 * This Lambda function provides an AI-powered chatbot that answers questions
 * based on FAQ documents stored in S3. It uses AWS Bedrock for:
 * 1. Generating embeddings from FAQ documents
 * 2. Finding relevant context using vector similarity
 * 3. Generating responses using Claude
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// Initialize AWS clients
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// Configuration
const FAQ_BUCKET = process.env.FAQ_BUCKET || 'vault22-faq-chatbot';
const EMBEDDINGS_FILE = process.env.EMBEDDINGS_FILE || 'embeddings/faq-embeddings.json';
const MODEL_ID = process.env.MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const EMBED_MODEL_ID = process.env.EMBED_MODEL_ID || 'amazon.titan-embed-text-v1';

// Cache for FAQ embeddings (persists across warm Lambda invocations)
let embeddingsCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

/**
 * Main Lambda handler
 */
exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    // Handle OPTIONS request for CORS
    if (event.httpMethod === 'OPTIONS') {
        return corsResponse(200, {});
    }

    try {
        // Parse request body
        const body = JSON.parse(event.body || '{}');
        const { question } = body;

        if (!question || question.trim().length === 0) {
            return corsResponse(400, {
                error: 'Missing required parameter: question'
            });
        }

        // Step 1: Load FAQ embeddings from S3
        const faqEmbeddings = await loadFaqEmbeddings();

        if (!faqEmbeddings || faqEmbeddings.length === 0) {
            return corsResponse(503, {
                error: 'FAQ knowledge base not initialized. Please run document processor first.'
            });
        }

        // Step 2: Generate embedding for user question
        const questionEmbedding = await generateEmbedding(question);

        // Step 3: Find most relevant FAQ chunks using cosine similarity
        const relevantChunks = findRelevantChunks(
            questionEmbedding,
            faqEmbeddings,
            3
        );

        // Step 4: Build context from relevant chunks
        const context = buildContext(relevantChunks);

        // Step 5: Generate response using Claude
        const answer = await generateAnswer(question, context);

        // Return simplified response - just the answer
        return corsResponse(200, {
            answer: answer
        });

    } catch (error) {
        console.error('Error processing request:', error);
        return corsResponse(500, {
            error: 'Internal server error',
            message: error.message
        });
    }
};

/**
 * Load FAQ embeddings from S3 (with caching)
 */
async function loadFaqEmbeddings() {
    const now = Date.now();

    // Return cached embeddings if still valid
    if (embeddingsCache && (now - cacheTimestamp) < CACHE_DURATION) {
        console.log('Using cached embeddings');
        return embeddingsCache;
    }

    try {
        console.log(`Loading embeddings from s3://${FAQ_BUCKET}/${EMBEDDINGS_FILE}`);

        const command = new GetObjectCommand({
            Bucket: FAQ_BUCKET,
            Key: EMBEDDINGS_FILE
        });

        const response = await s3Client.send(command);
        const bodyContents = await streamToString(response.Body);

        embeddingsCache = JSON.parse(bodyContents);
        cacheTimestamp = now;

        console.log(`Loaded ${embeddingsCache.length} FAQ embeddings`);
        return embeddingsCache;

    } catch (error) {
        console.error('Error loading embeddings:', error);

        if (error.name === 'NoSuchKey') {
            console.error(`Embeddings file not found: ${EMBEDDINGS_FILE}`);
            console.error('Please run the document processor to generate embeddings');
        }

        throw error;
    }
}

/**
 * Generate embedding for a text using Amazon Titan
 */
async function generateEmbedding(text) {
    try {
        const command = new InvokeModelCommand({
            modelId: EMBED_MODEL_ID,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                inputText: text.trim()
            })
        });

        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        return responseBody.embedding;

    } catch (error) {
        console.error('Error generating embedding:', error);
        throw error;
    }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
        throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);

    if (denominator === 0) {
        return 0;
    }

    return dotProduct / denominator;
}

/**
 * Find most relevant FAQ chunks for the question
 */
function findRelevantChunks(questionEmbedding, faqEmbeddings, topK) {
    console.log(`Finding top ${topK} relevant chunks from ${faqEmbeddings.length} total chunks`);

    // Calculate similarity for each chunk
    const similarities = faqEmbeddings.map(item => ({
        ...item,
        similarity: cosineSimilarity(questionEmbedding, item.embedding)
    }));

    // Sort by similarity (highest first)
    similarities.sort((a, b) => b.similarity - a.similarity);

    // Return top K chunks
    const topChunks = similarities.slice(0, topK);

    console.log('Top chunk similarities:', topChunks.map(c => c.similarity.toFixed(3)));

    return topChunks;
}

/**
 * Build context string from relevant chunks
 */
function buildContext(chunks) {
    return chunks.map((chunk, index) => {
        return `[Source ${index + 1}: ${chunk.metadata.category}]\n${chunk.text}\n`;
    }).join('\n');
}

/**
 * Generate answer using Claude with RAG context
 */
async function generateAnswer(question, context) {
    try {
        const prompt = `You are a helpful AI assistant for Vault22, a financial management app.
Answer the user's question based on the following FAQ knowledge base context.

IMPORTANT INSTRUCTIONS:
1. Only use information from the provided context
2. If the context doesn't contain relevant information, say so clearly
3. Be concise but helpful (2-4 sentences)
4. If appropriate, mention which section of the FAQ you're referencing
5. Never make up information not in the context

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
                max_tokens: 500,
                temperature: 0.7
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

/**
 * Convert readable stream to string
 */
async function streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Create CORS-enabled response
 */
function corsResponse(statusCode, body) {
    return {
        statusCode: statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'OPTIONS,POST'
        },
        body: JSON.stringify(body, null, 2)
    };
}
