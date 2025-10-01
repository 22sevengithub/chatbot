#!/bin/bash

###############################################################################
# Vault22 FAQ Chatbot Deployment Script
#
# This script automates the deployment of the FAQ chatbot to AWS Lambda
#
# Usage:
#   ./deploy.sh [OPTIONS]
#
# Options:
#   --stage <dev|prod>    Deployment stage (default: dev)
#   --region <region>     AWS region (default: us-east-1)
#   --skip-install        Skip npm install
#   --skip-faqs           Skip FAQ upload/processing
#   --help                Show this help message
#
###############################################################################

set -e  # Exit on error

# Default values
STAGE="${STAGE:-dev}"
REGION="${REGION:-us-east-1}"
SKIP_INSTALL=false
SKIP_FAQS=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --stage)
      STAGE="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=true
      shift
      ;;
    --skip-faqs)
      SKIP_FAQS=true
      shift
      ;;
    --help)
      head -n 20 "$0" | tail -n 16
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Print header
echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    Vault22 FAQ Chatbot Deployment Script      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Stage:${NC}   $STAGE"
echo -e "${YELLOW}Region:${NC}  $REGION"
echo ""

# Function to print step
print_step() {
  echo ""
  echo -e "${GREEN}▶ $1${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Function to print error and exit
error_exit() {
  echo ""
  echo -e "${RED}✗ Error: $1${NC}"
  exit 1
}

# Function to print success
print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

# Check prerequisites
print_step "Checking Prerequisites"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
  error_exit "AWS CLI is not installed. Please install it first."
fi
print_success "AWS CLI found"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  error_exit "Node.js is not installed. Please install Node.js 20+."
fi
NODE_VERSION=$(node --version)
print_success "Node.js found: $NODE_VERSION"

# Check if Serverless Framework is installed
if ! command -v serverless &> /dev/null; then
  error_exit "Serverless Framework is not installed. Run: npm install -g serverless"
fi
SERVERLESS_VERSION=$(serverless --version | head -n 1)
print_success "Serverless Framework found: $SERVERLESS_VERSION"

# Verify AWS credentials
print_step "Verifying AWS Credentials"
if ! aws sts get-caller-identity &> /dev/null; then
  error_exit "AWS credentials are not configured. Run: aws configure"
fi
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_USER=$(aws sts get-caller-identity --query Arn --output text)
print_success "AWS Account: $AWS_ACCOUNT"
print_success "AWS User: $AWS_USER"

# Check Bedrock access
print_step "Checking AWS Bedrock Access"
if aws bedrock list-foundation-models --region $REGION &> /dev/null; then
  print_success "Bedrock access verified in $REGION"
else
  error_exit "Cannot access Bedrock in $REGION. Please enable Bedrock access in your AWS account."
fi

# Install dependencies
if [ "$SKIP_INSTALL" = false ]; then
  print_step "Installing Dependencies"
  npm install
  print_success "Dependencies installed"
else
  echo -e "${YELLOW}⊘ Skipping dependency installation${NC}"
fi

# Deploy serverless stack
print_step "Deploying Serverless Stack"
echo "This may take a few minutes..."
echo ""

export AWS_REGION=$REGION

if serverless deploy --stage $STAGE --region $REGION; then
  print_success "Serverless stack deployed"
else
  error_exit "Serverless deployment failed"
fi

# Get API endpoint
print_step "Retrieving API Endpoint"
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name vault22-faq-chatbot-$STAGE \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`ServiceEndpoint`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [ -n "$API_ENDPOINT" ]; then
  API_URL="${API_ENDPOINT}chat"
  print_success "API Endpoint: $API_URL"
else
  echo -e "${YELLOW}⚠ Could not retrieve API endpoint automatically${NC}"
fi

# Get S3 bucket name
BUCKET_NAME="vault22-faq-chatbot-$STAGE"
print_step "Verifying S3 Bucket"
if aws s3 ls "s3://$BUCKET_NAME" --region $REGION &> /dev/null; then
  print_success "S3 Bucket verified: $BUCKET_NAME"
else
  error_exit "S3 Bucket not found: $BUCKET_NAME"
fi

# Upload and process FAQs
if [ "$SKIP_FAQS" = false ]; then
  print_step "Processing FAQ Documents"

  # Check if FAQ directory exists
  FAQ_DIR="../FAQ"
  if [ ! -d "$FAQ_DIR" ]; then
    echo -e "${YELLOW}⚠ FAQ directory not found: $FAQ_DIR${NC}"
    echo -e "${YELLOW}  Skipping FAQ upload${NC}"
  else
    FAQ_COUNT=$(find "$FAQ_DIR" -name "*.md" | wc -l | xargs)
    echo "Found $FAQ_COUNT FAQ documents"

    if [ "$FAQ_COUNT" -gt 0 ]; then
      echo ""
      echo "Uploading FAQs to S3..."
      export FAQ_BUCKET=$BUCKET_NAME
      export LOCAL_FAQ_DIR=$FAQ_DIR

      if node process-faqs.js --upload --process; then
        print_success "FAQ documents uploaded and processed"
      else
        echo -e "${YELLOW}⚠ FAQ processing failed (non-fatal)${NC}"
      fi
    else
      echo -e "${YELLOW}⚠ No FAQ documents found to upload${NC}"
    fi
  fi
else
  echo -e "${YELLOW}⊘ Skipping FAQ upload and processing${NC}"
fi

# Print summary
print_step "Deployment Summary"
echo ""
echo -e "${GREEN}✓ Deployment completed successfully!${NC}"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}Deployment Information:${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Stage:${NC}           $STAGE"
echo -e "${YELLOW}Region:${NC}          $REGION"
echo -e "${YELLOW}S3 Bucket:${NC}       $BUCKET_NAME"
if [ -n "$API_URL" ]; then
  echo -e "${YELLOW}API Endpoint:${NC}    $API_URL"
fi
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}Next Steps:${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo ""

if [ -n "$API_URL" ]; then
  echo "1. Test the chatbot:"
  echo ""
  echo "   curl -X POST '$API_URL' \\"
  echo "     -H 'Content-Type: application/json' \\"
  echo "     -d '{\"question\": \"How do I reset my password?\"}'"
  echo ""
fi

echo "2. View logs:"
echo ""
echo "   serverless logs -f chatbot --tail --stage $STAGE"
echo ""

echo "3. Update FAQ content:"
echo ""
echo "   node process-faqs.js --upload --process"
echo ""

echo "4. Monitor in AWS Console:"
echo ""
echo "   - Lambda: https://console.aws.amazon.com/lambda/home?region=$REGION"
echo "   - S3: https://s3.console.aws.amazon.com/s3/buckets/$BUCKET_NAME?region=$REGION"
echo "   - CloudWatch: https://console.aws.amazon.com/cloudwatch/home?region=$REGION"
echo ""

if [ -n "$API_URL" ]; then
  # Save API URL to file
  echo "$API_URL" > .api-url
  print_success "API URL saved to .api-url"
  echo ""
fi

echo -e "${GREEN}🎉 Deployment complete!${NC}"
echo ""
