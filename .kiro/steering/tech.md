# Technology Stack

## Infrastructure & Deployment

- **AWS CDK**: Infrastructure as Code using TypeScript
- **AWS SAM**: Serverless Application Model for Lambda function packaging
- **Docker**: Container support for SAM builds

## Backend Services

- **AWS Lambda**: Serverless compute (Python 3.12, Node.js 20.x)
- **AWS Step Functions**: State machine orchestration for AI workflows
- **Amazon EventBridge**: Event-driven architecture and routing
- **Amazon DynamoDB**: NoSQL database for sessions, tickets, and team management
- **Amazon S3**: Object storage for knowledge bases and audit logs
- **Amazon Bedrock**: AI/ML services with Nova and Claude models

## AI & Knowledge Management

- **Amazon Bedrock Knowledge Bases**: Vector databases for operational knowledge
- **Amazon Bedrock Guardrails**: AI safety and content filtering
- **Embedding Models**: Titan Embed Text v2 for vector search
- **LLM Models**: Amazon Nova and Claude 3.7 Sonnet with prompt caching

## Integration & Communication

- **Slack API**: Primary user interface and notification system
- **AWS Health API**: Operational event ingestion
- **AWS Security Hub**: Security findings processing

## Development Tools

- **TypeScript**: CDK infrastructure and Node.js Lambda functions
- **Python**: AI agent and processing functions
- **esbuild**: JavaScript/TypeScript bundling and minification

## Common Commands

### Build and Deploy

**IMPORTANT**: When using CDK to deploy, make sure you use AWS profile = corerepo

```bash
# Install dependencies
npm install

# Build Lambda functions
cd lambda/src
sam build --use-container
cd ../..

# Deploy infrastructure
cdk deploy --all --require-approval never --profile corerepo
```

### Development

```bash
# TypeScript compilation
npm run build
npm run watch

# CDK operations
npm run cdk -- diff
npm run cdk -- synth
```

### Testing

**IMPORTANT**: When using AWS CLI to interact with AWS resources, make sure you use AWS profile = sandpit to interact with the worker account, and profile = default to interact with admin account, make sure you also specify the AWS region in your commands.

```bash
# Run tests
npm test

# Test with sample events sent to worker account
aws events put-events --entries file://test-events/mockup-ops-event1.json --profile sandpit
```

## Architecture Patterns

- **Event-driven**: EventBridge for loose coupling between services
- **Serverless**: Lambda functions with ARM64 architecture for cost optimization
- **State machines**: Step Functions for complex AI workflow orchestration
- **Knowledge bases**: Vector search for contextual AI responses
- **Multi-account**: Separate admin and worker account deployment pattern
