# EventBridge Flow Documentation Design

## Overview

This design document outlines the structure and approach for creating comprehensive documentation of AWS EventBridge event flows in the OHERO solution. The documentation will serve as a definitive guide for understanding how events propagate through the system, which services respond to specific events, and how different execution paths are triggered.

## Architecture

The documentation will be organized into several key sections that provide both high-level architectural understanding and detailed technical specifications:

### 1. Event Source Mapping
- **AWS Health Events**: Events from `aws.health` and custom `ohero.health` sources
- **Security Hub Events**: Events from `aws.securityhub` and custom `ohero.securityhub` sources  
- **Application Events**: Internal events with `com.app.ohero` prefix
- **Slack Integration Events**: User-initiated chat and interaction events
- **S3 Events**: Knowledge base file arrival notifications

### 2. Event Bus Architecture
- **Primary Event Bus**: `oheroEventBus` - central hub for all application events
- **Default Event Bus**: Used for AWS service events (S3, Health, Security Hub)
- **Cross-Account Event Routing**: Admin account to processing account event forwarding

### 3. Service Subscription Matrix
- **Step Functions**: Which state machines subscribe to which event patterns
- **Lambda Functions**: Direct event triggers and SQS-based processing
- **Kinesis Firehose**: Event archival and data lake ingestion
- **Knowledge Base Sync**: S3 event-driven knowledge base updates

## Components and Interfaces

### Event Flow Components

#### 1. Main Orchestration Flow (`ops-orchestration.asl`)
**Triggered by**: 
- AWS Health events (`aws.health`, `ohero.health`)
- Security Hub findings (`aws.securityhub`, `ohero.securityhub`) with HIGH severity and NEW workflow state

**Key Decision Points**:
- Event type classification (Health vs Security Hub)
- Event existence check (new vs update)
- Human operator approval workflow with callback tokens

**Execution Branches**:
- **Health Event Path**: `DefineHealthEventPK` → `GetHealthEventItem` → `PutHealthEventItem`/`UpdateHealthEventItem` → `EmitHealthEventAdded`/`EmitHealthEventUpdated`
- **Security Hub Path**: `DefineSecHubEventPK` → `GetSecHubEventItem` → `PutSecHubEventItem` → `EmitSecHubEventAdded`
- **Approval Workflow**: `waitForTaskToken` → `UpdateEventItemActioned`/`UpdateEventItemDischarged`

#### 2. AI Integration Flow (`ai-integration.asl`)
**Triggered by**: 
- `com.app.ohero.ops-orchestration` events with detail-types:
  - `Health.EventAdded`
  - `Health.EventUpdated` 
  - `SecHub.EventAdded`

**Execution Path**:
- Event type routing to appropriate AI agent invocation
- Lambda function call with structured prompt including callback tokens
- Event metadata retrieval from DynamoDB
- Slack notification with AI reasoning

#### 3. Notification Flow (`ops-notification.asl`)
**Triggered by**:
- `com.app.ohero.ops-orchestration` events (all detail-types)

**Execution Branches**:
- **New Event Notifications**: Rich Slack blocks with approval buttons
- **Event Updates**: Thread-based update notifications  
- **Acknowledgment Handling**: Success/failure callback processing
- **Metadata Updates**: Slack thread timestamp storage in DynamoDB

#### 4. Chat Integration Flow (`ai-chat.asl`)
**Triggered by**:
- `com.app.ohero.ops-orchestration` events with detail-types:
  - `Chat.SlackMessageReceived`
  - `Chat.SendSlackRequested`

**Session Management**:
- User session lookup in DynamoDB using Slack user ID and timestamp
- Bedrock agent session continuity
- Session expiration handling

### 5. Slack Integration Patterns
**Outbound Slack Messages** (System → Slack):
- **Event Notifications**: Rich block messages with approval buttons triggered by notification flow
- **AI Agent Responses**: Text responses from Bedrock agent in chat threads
- **Status Updates**: Thread replies for event acknowledgments and updates
- **Error Messages**: Fallback messages when AI agent cannot respond

**Inbound Slack Messages** (Slack → System):
- **User Chat Messages**: Direct messages and thread replies processed by chat integration
- **Button Interactions**: Approval/discharge button clicks via API Gateway callbacks
- **Slash Commands**: Custom Slack commands triggering specific workflows

### Event Routing Rules

#### Rule 1: Main Orchestration Subscription
```typescript
// Rule: OpsOrchestrationSubscription1
eventPattern: {
  source: ['aws.health', 'ohero.health']
}
target: OheroOpsOrchestration StateMachine

// Rule: OpsOrchestrationSubscription2  
eventPattern: {
  source: ['aws.securityhub', 'ohero.securityhub'],
  detail: {
    findings: {
      WorkflowState: "NEW",
      Severity: { Original: ["HIGH"] }
    }
  }
}
target: OheroOpsOrchestration StateMachine
```

#### Rule 2: AI Integration Subscription
```typescript
// Rule: OpsIntegrationWithAiRule
eventPattern: {
  source: ['com.app.ohero.ops-orchestration'],
  detailType: ['Health.EventAdded', 'Health.EventUpdated', 'SecHub.EventAdded']
}
target: OheroAiIntegration StateMachine
```

#### Rule 3: Notification Subscription
```typescript
// Rule: OheroNotificationRule
eventPattern: {
  source: ['com.app.ohero.ops-orchestration']
}
target: OheroNotification StateMachine
```

#### Rule 4: Chat Integration Subscription
```typescript
// Rule: OheroChatRule
eventPattern: {
  source: ['com.app.ohero.ops-orchestration'],
  detailType: ['Chat.SlackMessageReceived', 'Chat.SendSlackRequested']
}
target: OheroChatIntegration StateMachine
```

#### Rule 5: Event Lake Archival
```typescript
// Rule: OpsEventLakeRule
eventPattern: {
  source: ['aws.health', 'ohero.health', 'aws.securityhub', 'ohero.securityhub']
}
target: Kinesis Firehose (OpsEventLakeFirehose)
```

#### Rule 6: Knowledge Base Sync
```typescript
// Rule: OpsKbFileArrivalRule (Default Event Bus)
eventPattern: {
  source: ['aws.s3'],
  detailType: ['Object Created'],
  detail: {
    bucket: { name: [opsHealthBucketName, opsSecHubBucketName] }
  }
}
targets: [healthBufferKbSyncSqs, sechubBufferKbSyncSqs]
```

## Data Models

### Event Structure Templates

#### AWS Health Event
```json
{
  "source": "aws.health",
  "detail-type": "AWS Health Event", 
  "detail": {
    "eventArn": "string",
    "affectedAccount": "string",
    "eventRegion": "string",
    "eventTypeCode": "string",
    "statusCode": "string",
    "startTime": "ISO-8601",
    "lastUpdatedTime": "ISO-8601",
    "eventDescription": [{"latestDescription": "string"}]
  }
}
```

#### Security Hub Finding Event
```json
{
  "source": "aws.securityhub",
  "detail-type": "Security Hub Findings - Imported",
  "detail": {
    "findings": [{
      "ProductFields": {"aws/securityhub/FindingId": "string"},
      "AwsAccountId": "string",
      "Compliance": {"SecurityControlId": "string"},
      "Workflow": {"Status": "NEW"},
      "FirstObservedAt": "ISO-8601",
      "LastObservedAt": "ISO-8601", 
      "Severity": {"Label": "HIGH"},
      "Title": "string",
      "Description": "string",
      "Resources": [{"Id": "string"}]
    }]
  }
}
```

#### Application Internal Events
```json
{
  "source": "com.app.ohero.ops-orchestration",
  "detail-type": "Health.EventAdded|Health.EventUpdated|SecHub.EventAdded|Health.EventAddedAcknowledged",
  "detail": {
    "TaskToken": "string", // for waitForTaskToken patterns
    "CarryingPayload": {} // original event data
  }
}
```

### DynamoDB Data Models

#### Event Management Table
```json
{
  "PK": "eventArn~affectedAccount~eventRegion", // or FindingId for SecHub
  "AffectedAccount": "string",
  "EventTypeCode": "string", 
  "EventStatusCode": "string",
  "StartTime": "ISO-8601",
  "LastUpdatedTime": "ISO-8601",
  "StatusCode": "string",
  "EventDescription": "string",
  "SlackThread": "string", // Slack thread timestamp
  "EventActionedAt": "ISO-8601",
  "EvenActionStatus": "Triaged|Discharged"
}
```

#### Chat User Sessions Table
```json
{
  "PK": "slackUserId",
  "SK": "slackMessageTimestamp", 
  "AgentSessionID": "string",
  "AgentSessionStart": "ISO-8601",
  "expiresAt": "number" // TTL
}
```

## Error Handling

### Retry Configurations
- **Lambda Invocations**: Exponential backoff with 2-99 attempts depending on error type
- **DynamoDB Operations**: Built-in AWS SDK retries
- **Slack API Calls**: 5 attempts with exponential backoff
- **Bedrock Agent Calls**: 5 attempts for AiAgentError, 99 attempts for service errors

### Timeout Handling
- **Human Approval Workflow**: 3000 seconds (50 minutes) timeout with automatic retry
- **State Machine Execution**: 5 minutes total timeout
- **Lambda Functions**: 5-900 seconds depending on function complexity

### Error Recovery Patterns
- **Task Token Failures**: Automatic event discharge and notification
- **Timeout Scenarios**: Retry with same parameters or fallback to default processing
- **Service Unavailability**: Circuit breaker patterns with exponential backoff

## Documentation Structure

### Primary Documentation Sections
1. **Event Flow Overview**: High-level architectural diagrams showing event propagation
2. **Event Source Catalog**: Detailed listing of all event sources and their structures
3. **Service Subscription Matrix**: Which services subscribe to which events
4. **Step Function Execution Paths**: Detailed workflow diagrams for each state machine
5. **Slack Integration Mapping**: Comprehensive documentation of when and how Slack messages are triggered
6. **Scenario Walkthroughs**: Step-by-step event traces for common scenarios
7. **Event Routing Reference**: Complete EventBridge rule configurations and patterns

### Slack Integration Documentation Scope
**Outbound Message Triggers**:
- Which Step Function states invoke the SlackMe Lambda function
- Message content and formatting for each trigger scenario
- Thread management and message targeting logic
- Rich block message structures for different event types

**Inbound Message Processing**:
- How Slack events are converted to EventBridge events
- API Gateway endpoints and their event transformation logic
- User session management and conversation continuity
- Callback token handling for human approval workflows

**Message Flow Scenarios**:
- New event notification → approval workflow → acknowledgment
- User chat initiation → AI agent response → conversation continuation
- Event updates → thread notifications → status tracking
- Error scenarios → fallback messages → user guidance

### Visual Documentation Elements
- **Mermaid Sequence Diagrams**: Event flow sequences between components including Slack interactions
- **Flowcharts**: Decision logic and branching paths in state machines with Slack trigger points
- **Architecture Diagrams**: Service relationships and event bus topology including Slack integration
- **Event Structure Examples**: JSON samples for each event type with annotations
- **Slack Message Templates**: Visual examples of all Slack message formats and their triggers