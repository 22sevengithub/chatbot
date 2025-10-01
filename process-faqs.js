/**
 * FAQ Document Processor
 *
 * This script processes FAQ markdown files from S3, generates embeddings,
 * and stores them for use by the chatbot Lambda function.
 *
 * Usage:
 *   node process-faqs.js [--upload] [--process]
 *   --upload: Upload FAQ files from local directory to S3
 *   --process: Process uploaded files and generate embeddings
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// Configuration
const FAQ_BUCKET = process.env.FAQ_BUCKET || 'vault22-faq-chatbot';
const FAQ_PREFIX = 'faq-documents/';
const EMBEDDINGS_KEY = 'embeddings/faq-embeddings.json';
const LOCAL_FAQ_DIR = process.env.LOCAL_FAQ_DIR || '../FAQ';
const EMBED_MODEL_ID = 'amazon.titan-embed-text-v1';
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

// Initialize AWS clients
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);
    const shouldUpload = args.includes('--upload');
    const shouldProcess = args.includes('--process');

    // Default: do both if no args specified
    const doUpload = shouldUpload || (!shouldUpload && !shouldProcess);
    const doProcess = shouldProcess || (!shouldUpload && !shouldProcess);

    console.log('=== Vault22 FAQ Document Processor ===\n');
    console.log(`FAQ Bucket: ${FAQ_BUCKET}`);
    console.log(`Local FAQ Directory: ${LOCAL_FAQ_DIR}`);
    console.log(`Upload: ${doUpload}`);
    console.log(`Process: ${doProcess}\n`);

    try {
        if (doUpload) {
            await uploadFaqDocuments();
        }

        if (doProcess) {
            await processFaqDocuments();
        }

        console.log('\n✅ All operations completed successfully!');

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

/**
 * Upload FAQ documents from local directory to S3
 */
async function uploadFaqDocuments() {
    console.log('\n📤 Uploading FAQ documents to S3...');

    const faqDir = path.resolve(__dirname, LOCAL_FAQ_DIR);

    if (!fs.existsSync(faqDir)) {
        throw new Error(`FAQ directory not found: ${faqDir}`);
    }

    const files = fs.readdirSync(faqDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    console.log(`Found ${mdFiles.length} markdown files in ${faqDir}`);

    let uploaded = 0;

    for (const file of mdFiles) {
        const filePath = path.join(faqDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        const command = new PutObjectCommand({
            Bucket: FAQ_BUCKET,
            Key: `${FAQ_PREFIX}${file}`,
            Body: content,
            ContentType: 'text/markdown',
            ServerSideEncryption: 'AES256',
            Metadata: {
                'original-filename': file,
                'upload-date': new Date().toISOString(),
                'processed': 'false'
            }
        });

        try {
            await s3Client.send(command);
            console.log(`  ✓ Uploaded: ${file}`);
            uploaded++;
        } catch (error) {
            console.error(`  ✗ Failed to upload ${file}:`, error.message);
        }
    }

    console.log(`\n📊 Upload complete: ${uploaded}/${mdFiles.length} files uploaded`);
}

/**
 * Process FAQ documents and generate embeddings
 */
async function processFaqDocuments() {
    console.log('\n🔄 Processing FAQ documents...');

    // List all FAQ documents in S3
    const listCommand = new ListObjectsV2Command({
        Bucket: FAQ_BUCKET,
        Prefix: FAQ_PREFIX
    });

    const listResponse = await s3Client.send(listCommand);
    const documents = (listResponse.Contents || []).filter(obj => obj.Key.endsWith('.md'));

    console.log(`Found ${documents.length} FAQ documents to process`);

    const allEmbeddings = [];
    let totalChunks = 0;

    for (const doc of documents) {
        console.log(`\n  Processing: ${doc.Key}`);

        // Get document content
        const getCommand = new GetObjectCommand({
            Bucket: FAQ_BUCKET,
            Key: doc.Key
        });

        const response = await s3Client.send(getCommand);
        const content = await streamToString(response.Body);

        // Extract metadata from filename
        const filename = path.basename(doc.Key);
        const category = filename.replace('.md', '').replace(/_/g, ' ');

        // Chunk the document
        const chunks = chunkDocument(content, CHUNK_SIZE, CHUNK_OVERLAP);
        console.log(`    Created ${chunks.length} chunks`);

        // Generate embeddings for each chunk
        for (let i = 0; i < chunks.length; i++) {
            try {
                const embedding = await generateEmbedding(chunks[i]);

                allEmbeddings.push({
                    id: `${filename}_chunk_${i}`,
                    text: chunks[i],
                    embedding: embedding,
                    metadata: {
                        source: filename,
                        category: category,
                        chunkIndex: i,
                        totalChunks: chunks.length
                    }
                });

                totalChunks++;
                process.stdout.write(`\r    Generated embeddings: ${i + 1}/${chunks.length}`);

            } catch (error) {
                console.error(`\n    ✗ Failed to generate embedding for chunk ${i}:`, error.message);
            }
        }

        console.log(''); // New line after progress
    }

    console.log(`\n📊 Total embeddings generated: ${totalChunks}`);

    // Save embeddings to S3
    console.log('\n💾 Saving embeddings to S3...');

    const putCommand = new PutObjectCommand({
        Bucket: FAQ_BUCKET,
        Key: EMBEDDINGS_KEY,
        Body: JSON.stringify(allEmbeddings, null, 2),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
        Metadata: {
            'total-embeddings': totalChunks.toString(),
            'generated-at': new Date().toISOString()
        }
    });

    await s3Client.send(putCommand);

    console.log(`✓ Embeddings saved to s3://${FAQ_BUCKET}/${EMBEDDINGS_KEY}`);
    console.log(`✓ Total size: ${(JSON.stringify(allEmbeddings).length / 1024 / 1024).toFixed(2)} MB`);
}

/**
 * Chunk document into smaller pieces with overlap
 */
function chunkDocument(content, chunkSize, overlap) {
    // Split by sentences (naive approach)
    const sentences = content.split(/(?<=[.!?])\s+/);

    const chunks = [];
    let currentChunk = '';
    let previousChunk = '';

    for (const sentence of sentences) {
        const testChunk = currentChunk + ' ' + sentence;

        if (testChunk.length > chunkSize && currentChunk.length > 0) {
            // Save current chunk
            chunks.push(currentChunk.trim());

            // Start new chunk with overlap from previous
            const overlapText = currentChunk.slice(-overlap);
            currentChunk = overlapText + ' ' + sentence;
        } else {
            currentChunk = testChunk;
        }
    }

    // Add final chunk
    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks.filter(chunk => chunk.length > 50); // Filter out very small chunks
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
 * Convert readable stream to string
 */
async function streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = {
    uploadFaqDocuments,
    processFaqDocuments,
    chunkDocument
};
