/**
 * Test script for Vault22 FAQ Chatbot
 *
 * Usage:
 *   node test-chatbot.js [API_URL]
 *
 * If API_URL is not provided, it will try to read from .api-url file
 * or prompt you to enter it.
 */

const https = require('https');
const http = require('http');

// Test questions
const TEST_QUESTIONS = [
  "How do I reset my password?",
  "How do I link my bank account?",
  "What security measures does Vault22 use?",
  "How can I export my transactions?",
  "What are custom categories?",
  "How do I contact support?",
  "Tell me about future budgeting",
  "How much does Vault22 cost?"
];

// Get API URL from command line, file, or prompt
function getApiUrl() {
  // Check command line argument
  if (process.argv[2]) {
    return process.argv[2];
  }

  // Try to read from .api-url file
  const fs = require('fs');
  if (fs.existsSync('.api-url')) {
    const url = fs.readFileSync('.api-url', 'utf-8').trim();
    if (url) {
      console.log(`Using API URL from .api-url file: ${url}`);
      return url;
    }
  }

  // Prompt for URL
  console.error('\n❌ API URL not provided!\n');
  console.error('Usage:');
  console.error('  node test-chatbot.js <API_URL>');
  console.error('\nOr save API URL to .api-url file:');
  console.error('  echo "https://xxx.execute-api.us-east-1.amazonaws.com/dev/chat" > .api-url');
  console.error('');
  process.exit(1);
}

// Make HTTP request
function makeRequest(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = client.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

// Test a single question
async function testQuestion(apiUrl, question, index, total) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`📝 Test ${index + 1}/${total}: ${question}`);
  console.log('─'.repeat(80));

  const startTime = Date.now();

  try {
    const requestBody = JSON.stringify({
      question: question,
      maxResults: 3
    });

    const response = await makeRequest(apiUrl, requestBody);
    const duration = Date.now() - startTime;

    console.log('\n✅ Success!');
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log('\n📤 Answer:');
    console.log(response.answer);

    if (response.sources && response.sources.length > 0) {
      console.log('\n📚 Sources:');
      response.sources.forEach((source, i) => {
        console.log(`   ${i + 1}. ${source.category} (similarity: ${source.similarity})`);
      });
    }

    return {
      success: true,
      duration: duration,
      question: question
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    console.log(`\n❌ Failed!`);
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`🔴 Error: ${error.message}`);

    return {
      success: false,
      duration: duration,
      question: question,
      error: error.message
    };
  }
}

// Run all tests
async function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              Vault22 FAQ Chatbot - Test Suite                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  const apiUrl = getApiUrl();
  console.log(`\n🌐 API URL: ${apiUrl}`);
  console.log(`📋 Running ${TEST_QUESTIONS.length} tests...\n`);

  const results = [];

  for (let i = 0; i < TEST_QUESTIONS.length; i++) {
    const result = await testQuestion(apiUrl, TEST_QUESTIONS[i], i, TEST_QUESTIONS.length);
    results.push(result);

    // Small delay between requests
    if (i < TEST_QUESTIONS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Print summary
  console.log('\n\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              Test Summary                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = totalDuration / results.length;

  console.log(`✅ Successful: ${successful}/${TEST_QUESTIONS.length}`);
  console.log(`❌ Failed:     ${failed}/${TEST_QUESTIONS.length}`);
  console.log(`⏱️  Total time: ${totalDuration}ms`);
  console.log(`⏱️  Avg time:   ${Math.round(avgDuration)}ms`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    results.filter(r => !r.success).forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.question}`);
      console.log(`      Error: ${r.error}`);
    });
  }

  console.log('\n' + '─'.repeat(80) + '\n');

  // Exit with error code if any tests failed
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});
