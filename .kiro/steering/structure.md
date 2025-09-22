# Project Structure

## Root Directory
- **`.env`**: Environment configuration for deployment accounts and regions
- **`cdk.json`**: CDK application configuration and feature flags
- **`package.json`**: Node.js dependencies and build scripts
- **`tsconfig.json`**: TypeScript compiler configuration

## Infrastructure (`/lib`)
- **`agent-ops-health-stack.ts`**: Main AI agent and Bedrock services stack
- **`ops-event-lake-stack.ts`**: Event processing and storage infrastructure
- **`ops-orchestration-stack.ts`**: Step Functions and orchestration logic
- **`org-admin-stack.ts`**: Organization-level administration resources
- **`stateful.ts`**: Persistent storage and database resources
- **`types/`**: TypeScript type definitions for stack configurations

## Lambda Functions (`/lambda/src`)
- **`template.yaml`**: SAM template defining all Lambda functions
- **`handlers/`**: Individual Lambda function implementations
  - **`opsAgent/`**: Python-based AI agent (main processing logic)
  - **`handleSlackComm/`**: TypeScript Slack integration handler
  - **`ingestOpsKb/`**: TypeScript knowledge base ingestion
  - **`slackMe/`**: Python Slack notification service
  - **`secHubReport/`**: Python Security Hub report processing
  - **`saveAccountInfo/`**: Python account information management
  - **`callbackEvent/`**: TypeScript callback event handler
- **`events/`**: Sample event payloads for testing

## State Machines (`/state-machine`)
- **`ai-chat.asl`**: Amazon States Language for chat interactions
- **`ai-integration.asl`**: Event processing workflow definition
- **`ops-notification.asl`**: Notification routing logic
- **`ops-orchestration.asl`**: Main orchestration workflow

## Documentation & Configuration
- **`lambda/docs/`**: Technical documentation and requirements
- **`screenshots/`**: Solution demonstration images
- **`test-events/`**: Mock event payloads for testing
- **`slack-app-manifest.json`**: Slack application configuration template
- **`architecture*.drawio`**: Architecture diagrams (Draw.io format)

## Development Artifacts
- **`cdk.out/`**: CDK synthesis output (generated)
- **`lambda/src/.aws-sam/`**: SAM build artifacts (generated)
- **`node_modules/`**: Node.js dependencies (generated)

## Naming Conventions
- **Stacks**: PascalCase with "Stack" suffix (e.g., `OpsHealthAgentStack`)
- **Lambda Functions**: PascalCase with "Function" suffix (e.g., `OpsAgentFunction`)
- **Resources**: PascalCase following AWS CDK patterns
- **Files**: kebab-case for configuration, camelCase for TypeScript, snake_case for Python
- **Environment Variables**: UPPER_SNAKE_CASE

## Key Patterns
- **Multi-language**: TypeScript for infrastructure, Python for AI logic, Node.js for integrations
- **Event-driven**: EventBridge patterns with domain-prefixed event sources
- **Modular**: Separate stacks for different concerns (stateful, orchestration, agent)
- **Testable**: Sample events and mock data for development and testing