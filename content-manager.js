/**
 * Content Manager for Chatbot
 *
 * Provides endpoints for Strapi to manage the chatbot's knowledge base.
 * Handles markdown content, generates embeddings, and stores in S3.
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { LambdaClient, UpdateFunctionConfigurationCommand, GetFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');

// Initialize AWS clients
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Configuration
const FAQ_BUCKET = process.env.FAQ_BUCKET || 'vault22-faq-chatbot-dev';
const EMBEDDINGS_FILE = process.env.EMBEDDINGS_FILE || 'embeddings/faq-embeddings.json';
const EMBED_MODEL_ID = process.env.EMBED_MODEL_ID || 'amazon.titan-embed-text-v1';
const CHATBOT_FUNCTION_NAME = process.env.CHATBOT_FUNCTION_NAME || 'vault22-faq-chatbot-dev-chatbot';
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

/**
 * Main handler for content management endpoints
 */
exports.handler = async (event) => {
    console.log('Content Manager - Received event:', JSON.stringify(event, null, 2));

    // Handle OPTIONS for CORS
    if (event.httpMethod === 'OPTIONS') {
        return corsResponse(200, {});
    }

    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;

    try {
        // Route to appropriate handler
        if (path.includes('/content/upload') && method === 'POST') {
            return await handleUploadContent(event);
        } else if (path.includes('/content/delete') && method === 'POST') {
            return await handleDeleteContent(event);
        } else if (path.includes('/content/clear') && method === 'POST') {
            return await handleClearAll(event);
        } else if (path.includes('/content/process') && method === 'POST') {
            return await handleProcessEmbeddings(event);
        } else if (path.includes('/content/status') && method === 'GET') {
            return await handleGetStatus(event);
        } else {
            return corsResponse(404, { error: 'Endpoint not found' });
        }
    } catch (error) {
        console.error('Error:', error);
        return corsResponse(500, {
            error: 'Internal server error',
            message: error.message
        });
    }
};

/**
 * Handle content upload from Strapi
 * POST /content/upload
 * Body: { category: string, filename: string, content: string }
 */
async function handleUploadContent(event) {
    const body = JSON.parse(event.body || '{}');
    const { category, filename, content } = body;

    if (!category || !filename || !content) {
        return corsResponse(400, {
            error: 'Missing required fields: category, filename, content'
        });
    }

    try {
        // Upload markdown to S3
        const key = `content/${category}/${filename}`;

        await s3Client.send(new PutObjectCommand({
            Bucket: FAQ_BUCKET,
            Key: key,
            Body: content,
            ContentType: 'text/markdown',
            ServerSideEncryption: 'AES256',
            Metadata: {
                'content-type': category,
                'upload-date': new Date().toISOString(),
                'source': 'strapi-cms',
            }
        }));

        console.log(`Uploaded: s3://${FAQ_BUCKET}/${key}`);

        return corsResponse(200, {
            success: true,
            message: 'Content uploaded successfully',
            key,
            bucket: FAQ_BUCKET,
        });
    } catch (error) {
        console.error('Upload error:', error);
        return corsResponse(500, {
            error: 'Failed to upload content',
            message: error.message
        });
    }
}

/**
 * Handle content deletion
 * POST /content/delete
 * Body: { category: string, filename: string }
 */
async function handleDeleteContent(event) {
    const body = JSON.parse(event.body || '{}');
    const { category, filename } = body;

    if (!category || !filename) {
        return corsResponse(400, {
            error: 'Missing required fields: category, filename'
        });
    }

    try {
        const key = `content/${category}/${filename}`;

        await s3Client.send(new DeleteObjectCommand({
            Bucket: FAQ_BUCKET,
            Key: key,
        }));

        console.log(`Deleted: s3://${FAQ_BUCKET}/${key}`);

        return corsResponse(200, {
            success: true,
            message: 'Content deleted successfully',
            key,
        });
    } catch (error) {
        console.error('Delete error:', error);
        return corsResponse(500, {
            error: 'Failed to delete content',
            message: error.message
        });
    }
}

/**
 * Clear all content from S3
 * POST /content/clear
 */
async function handleClearAll(event) {
    try {
        console.log('Clearing all content from S3...');

        // List all objects in content/ prefix
        const listResponse = await s3Client.send(new ListObjectsV2Command({
            Bucket: FAQ_BUCKET,
            Prefix: 'content/'
        }));

        const objects = listResponse.Contents || [];
        console.log(`Found ${objects.length} objects to delete`);

        // Delete all objects
        let deleted = 0;
        for (const obj of objects) {
            await s3Client.send(new DeleteObjectCommand({
                Bucket: FAQ_BUCKET,
                Key: obj.Key
            }));
            deleted++;
        }

        // Also clear embeddings
        try {
            await s3Client.send(new DeleteObjectCommand({
                Bucket: FAQ_BUCKET,
                Key: EMBEDDINGS_FILE
            }));
            console.log('Embeddings file deleted');
        } catch (err) {
            console.log('No embeddings file to delete');
        }

        return corsResponse(200, {
            success: true,
            message: 'All content cleared successfully',
            deletedFiles: deleted,
            embeddingsCleared: true
        });
    } catch (error) {
        console.error('Clear error:', error);
        return corsResponse(500, {
            error: 'Failed to clear content',
            message: error.message
        });
    }
}

/**
 * Handle embedding processing
 * POST /content/process
 * Body: { categories?: string[] } - optional filter by categories
 */
async function handleProcessEmbeddings(event) {
    const body = JSON.parse(event.body || '{}');
    const { categories } = body;

    try {
        console.log('Starting embedding generation...');

        // List all content files
        const listResponse = await s3Client.send(new ListObjectsV2Command({
            Bucket: FAQ_BUCKET,
            Prefix: 'content/'
        }));

        const files = (listResponse.Contents || []).filter(obj => obj.Key.endsWith('.md'));
        console.log(`Found ${files.length} markdown files`);

        const allEmbeddings = [];
        let totalChunks = 0;

        // Process each file
        for (const file of files) {
            const category = file.Key.split('/')[1];

            // Skip if category filter is provided and doesn't match
            if (categories && !categories.includes(category)) {
                continue;
            }

            // Get file content
            const getResponse = await s3Client.send(new GetObjectCommand({
                Bucket: FAQ_BUCKET,
                Key: file.Key
            }));

            const content = await streamToString(getResponse.Body);
            const filename = file.Key.split('/').pop();

            // Chunk the content
            const chunks = chunkDocument(content, CHUNK_SIZE, CHUNK_OVERLAP);
            console.log(`Processing ${filename}: ${chunks.length} chunks`);

            // Generate embeddings for each chunk
            for (let i = 0; i < chunks.length; i++) {
                const embedding = await generateEmbedding(chunks[i]);

                allEmbeddings.push({
                    id: `${filename}_chunk_${i}`,
                    text: chunks[i],
                    embedding: embedding,
                    metadata: {
                        source: filename,
                        category: category,
                        chunkIndex: i,
                        totalChunks: chunks.length,
                        lastUpdated: new Date().toISOString()
                    }
                });

                totalChunks++;
            }
        }

        console.log(`Generated ${totalChunks} embeddings`);

        // Save embeddings to S3
        await s3Client.send(new PutObjectCommand({
            Bucket: FAQ_BUCKET,
            Key: EMBEDDINGS_FILE,
            Body: JSON.stringify(allEmbeddings, null, 2),
            ContentType: 'application/json',
            ServerSideEncryption: 'AES256',
            Metadata: {
                'total-embeddings': totalChunks.toString(),
                'generated-at': new Date().toISOString()
            }
        }));

        console.log('Embeddings saved successfully');

        // Clear chatbot Lambda cache
        const cacheCleared = await clearChatbotCache();

        return corsResponse(200, {
            success: true,
            message: 'Embeddings processed successfully',
            totalFiles: files.length,
            totalChunks,
            embeddingsFile: `s3://${FAQ_BUCKET}/${EMBEDDINGS_FILE}`,
            cacheCleared
        });
    } catch (error) {
        console.error('Processing error:', error);
        return corsResponse(500, {
            error: 'Failed to process embeddings',
            message: error.message
        });
    }
}

/**
 * Get knowledge base status
 * GET /content/status
 */
async function handleGetStatus(event) {
    try {
        // List content files
        const contentResponse = await s3Client.send(new ListObjectsV2Command({
            Bucket: FAQ_BUCKET,
            Prefix: 'content/'
        }));

        const files = (contentResponse.Contents || []).filter(obj => obj.Key.endsWith('.md'));

        // Group by category
        const categories = {};
        files.forEach(file => {
            const category = file.Key.split('/')[1];
            if (!categories[category]) {
                categories[category] = 0;
            }
            categories[category]++;
        });

        // Check if embeddings exist
        let embeddingsStatus = 'not_generated';
        let totalEmbeddings = 0;

        try {
            const embeddingsResponse = await s3Client.send(new GetObjectCommand({
                Bucket: FAQ_BUCKET,
                Key: EMBEDDINGS_FILE
            }));

            const embeddingsData = await streamToString(embeddingsResponse.Body);
            const embeddings = JSON.parse(embeddingsData);
            totalEmbeddings = embeddings.length;
            embeddingsStatus = 'ready';
        } catch (error) {
            embeddingsStatus = 'not_generated';
        }

        return corsResponse(200, {
            success: true,
            bucket: FAQ_BUCKET,
            totalFiles: files.length,
            categories,
            embeddings: {
                status: embeddingsStatus,
                total: totalEmbeddings,
                file: EMBEDDINGS_FILE
            }
        });
    } catch (error) {
        console.error('Status error:', error);
        return corsResponse(500, {
            error: 'Failed to get status',
            message: error.message
        });
    }
}

/**
 * Chunk document into smaller pieces
 */
function chunkDocument(content, chunkSize, overlap) {
    const sentences = content.split(/(?<=[.!?])\s+/);
    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
        const testChunk = currentChunk + ' ' + sentence;

        if (testChunk.length > chunkSize && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            const overlapText = currentChunk.slice(-overlap);
            currentChunk = overlapText + ' ' + sentence;
        } else {
            currentChunk = testChunk;
        }
    }

    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks.filter(chunk => chunk.length > 50);
}

/**
 * Generate embedding using Amazon Titan
 */
async function generateEmbedding(text) {
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
}

/**
 * Convert stream to string
 */
async function streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Clear chatbot Lambda cache by updating environment variable
 */
async function clearChatbotCache() {
    try {
        console.log(`Clearing cache for Lambda: ${CHATBOT_FUNCTION_NAME}`);

        // Get current configuration
        const getConfigCommand = new GetFunctionConfigurationCommand({
            FunctionName: CHATBOT_FUNCTION_NAME
        });
        const currentConfig = await lambdaClient.send(getConfigCommand);

        // Update environment with new cache buster
        const envVars = currentConfig.Environment?.Variables || {};
        envVars.CACHE_BUSTER = `${Date.now()}`;

        const updateCommand = new UpdateFunctionConfigurationCommand({
            FunctionName: CHATBOT_FUNCTION_NAME,
            Environment: {
                Variables: envVars
            }
        });

        await lambdaClient.send(updateCommand);
        console.log('Chatbot cache cleared successfully');

        return true;
    } catch (error) {
        console.error('Failed to clear chatbot cache:', error);
        // Don't fail the entire operation if cache clear fails
        return false;
    }
}

/**
 * Create CORS response
 */
function corsResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
        },
        body: JSON.stringify(body)
    };
}
