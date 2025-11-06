# Event-Driven Architecture and Microservices Flow

## Table of Contents

- [Overview](#overview)
- [Architecture Benefits](#architecture-benefits)
- [Event Types and Flow](#event-types-and-flow)
- [Microservices Architecture](#microservices-architecture)
  - [Service 1: Stateful Storage Service](#service-1-stateful-storage-service)
  - [Service 2: Multi-Account Event Collection Service](#service-2-multi-account-event-collection-service)
  - [Service 3: Ops Orchestration & Notification Service](#service-3-ops-orchestration--notification-service)
  - [Service 4: AI Service](#service-4-ai-service)
  - [Service 5: Slack Chat Service](#service-5-slack-chat-service)
  - [Service 6: Web Chat Service](#service-6-web-chat-service)
  - [Service 7: Event Lake Service](#service-7-event-lake-service)
  - [Service 8: Knowledge Base Management Service](#service-8-knowledge-base-management-service)
- [Layered Deployment Strategy](#layered-deployment-strategy)
- [Event Flow Diagrams](#event-flow-diagrams)

## Overview

OHERO (Operational Health Event Resolution Orchestrator) is built using a highly decoupled, event-driven microservices architecture. This design enables each service to operate independently while communicating through well-defined event contracts via Amazon EventBridge. The architecture supports plug-and-play deployment, allowing you to start with core functionality and progressively add advanced features.

## Architecture Benefits

### Loose Coupling

- **Independent Deployment**: Each service can be deployed, updated, or scaled independently
- **Fault Isolation**: Failure in one service doesn't cascade to others
- **Technology Flexibility**: Services can use different programming languages and frameworks

### Event-Driven Communication

- **Asynchronous Processing**: Services don't block waiting for responses
- **Scalability**: Natural load distribution across services
- **Extensibility**: New services can subscribe to existing events without modifying producers

### Plug-and-Play Architecture

- **Minimal Core**: Start with essential services for manual event handling
- **Progressive Enhancement**: Add AI, chat interfaces, and analytics incrementally
- **Service Independence**: Each service provides value even when others are unavailable

## Event Types and Flow

The system uses a structured event taxonomy with three main categories:

```mermaid
graph LR
    subgraph "External Events (Input)"
        A1[aws.health<br/>AWS Health Events]
        A2[aws.securityhub<br/>AWS Security Hub Findings]
        A3[aws.s3<br/>S3 Object Creation<br/>Knowledge Base Sync]
    end

    subgraph "Internal Application Events"
        B1[com.app.ohero.ops-orchestration<br/>Main Orchestration]
        B2[com.app.ohero.ai-integration<br/>AI Processing]
        B3[com.app.ohero.ai-chat<br/>Chat Interactions]
        B4[com.app.ohero.ops-notification<br/>Notifications]
    end

    subgraph "Knowledge Base Management"
        KB[IngestOpsKbFunction<br/>via SQS Queues]
    end

    subgraph "Event Detail Types"
        C1[Health.EventAdded]
        C2[Health.EventUpdated]
        C3[SecHub.EventAdded]
        C4[OpsAgent.Responded]
        C5[Chat.SlackMessageReceived]
        C6[Chat.SendSlackRequested]
    end

    %% External to Internal Event Flow
    A1 --> B1
    A2 --> B1
    A3 --> KB
    
    %% Internal Event Production
    B1 --> C1
    B1 --> C2
    B1 --> C3
    B1 --> C5
    B2 --> C4
    B3 --> C6
    
    %% Internal Event Consumption
    C1 --> B2
    C2 --> B2
    C3 --> B2
    C4 --> B4
    C5 --> B3
    C6 --> B3
    
    %% Notification Service Consumption
    C1 --> B4
    C2 --> B4
    C3 --> B4

    style A1 fill:#e1f5fe
    style A2 fill:#e1f5fe
    style A3 fill:#e1f5fe
    style B1 fill:#f3e5f5
    style B2 fill:#e8f5e8
    style B3 fill:#e8f5e8
    style B4 fill:#fff3e0
    style C1 fill:#f0f0f0
    style C2 fill:#f0f0f0
    style C3 fill:#f0f0f0
    style C4 fill:#f0f0f0
    style C5 fill:#f0f0f0
    style C6 fill:#f0f0f0
    style KB fill:#ffecb3
```

## Microservices Architecture

```mermaid
graph TB
    subgraph "Layer 1: Core Services (Required)"
        S1[Stateful Storage<br/>Service]
        S2[Multi-Account Event<br/>Collection Service]
        S3[Ops Orchestration<br/>Service]
    end

    subgraph "Layer 2: AI Enhancement (Optional)"
        S4[AI Service<br/>Can run headlessly]
        S8[Knowledge Base<br/>Management Service]
    end

    subgraph "Layer 3: Chat Integration (Optional - Choose One or Both)"
        S5[Slack Chat Service<br/>NOTIFICATION_CHANNEL=slack]
        S6[Web Chat Service<br/>NOTIFICATION_CHANNEL=webchat]
    end

    subgraph "Layer 4: Analytics (Optional)"
        S7[Event Lake Service]
    end

    subgraph "External Systems"
        AWS[AWS Health/<br/>Security Hub]
        SLACK[Slack]
        WEB[Web Browser]
    end

    AWS --> S2
    S2 --> S3
    S3 --> S4
    S4 --> S3
    S3 -.-> S5
    S3 -.-> S6
    S5 -.-> SLACK
    S6 -.-> WEB
    S3 --> S7
    S4 --> S8
    S8 --> S4

    S1 -.-> S2
    S1 -.-> S3
    S1 -.-> S4
    S1 -.-> S5
    S1 -.-> S6
    S1 -.-> S7
    S1 -.-> S8

    style S1 fill:#ffecb3
    style S2 fill:#e1f5fe
    style S3 fill:#f3e5f5
    style S4 fill:#e8f5e8
    style S5 fill:#fff3e0
    style S6 fill:#fff3e0
    style S7 fill:#fce4ec
    style S8 fill:#e8f5e8
```

### Service 1: Stateful Storage Service

**Implementation**: `StatefulStack`
**Purpose**: Provides shared storage and messaging infrastructure for all other services

#### Components:

- **DynamoDB Tables**:

  - `EventManagementTable` - Tracks event processing status
  - `TicketManagementTable` - Manages issue tickets
  - `TeamManagementTable` - Team and channel mappings
  - `WebSocketConnectionsTable` - Active WebSocket connections
  - `ChatUserSessionsTable` - AI chat session state (created in AI Service stack)

- **S3 Buckets**:

  - `OpsHealthBucket` - Operational health knowledge base
  - `SecFindingsBucket` - Security findings knowledge base
  - `OpsEventLakeBucket` - Event data warehouse
  - `TransientPayloadsBucket` - Large event payloads

- **EventBridge Custom Bus**: Central event routing hub (`OheroEventBus`)

#### Event Interactions:

- **Produces**: S3 object creation events
- **Consumes**: None (foundational service)
- **Dependencies**: None

---

### Service 2: Multi-Account Event Collection Service

**Implementation**: `OrgAdminOrgStack`
**Purpose**: Collects operational events from multiple AWS accounts in an organization

#### Components:

- **EventBridge Rules**: Cross-account event forwarding (`OheroEventHubForwardingRule`)
- **Lambda Functions**:
  - `SecHubReportFunction` - Scheduled Security Hub findings export (Python 3.11, only deployed in ap-southeast-2 region)
- **IAM Roles**: Cross-account access permissions
- **EventBridge Schedule**: Cron-based scheduling for Security Hub reports (daily at 15:00 UTC)

#### Event Interactions:

- **Produces**: Forwards `aws.health` and `aws.securityhub` events to central bus
- **Consumes**: Native AWS service events
- **Dependencies**: Stateful Storage Service (for event bus)

#### Deployment Pattern:

Deployed in each AWS account/region where you want to collect events. Can operate independently - if this service is unavailable, other services continue processing manually submitted events.

---

### Service 3: Ops Orchestration & Notification Service

**Implementation**: `OpsOrchestrationStack`
**Purpose**: Core event processing workflow with manual triage capabilities

#### Components:

- **Step Functions**:

  - `OheroOpsOrchestration` - Main event processing state machine
  - `OheroNotification` - Slack notification workflow (conditional deployment based on `NOTIFICATION_CHANNEL=slack`)
  - `OheroWebChatNotification` - Web chat notification workflow (conditional deployment based on `NOTIFICATION_CHANNEL=webchat`)

- **Lambda Functions**:

  - `HandleSlackComm` - Processes Slack interactions (Node.js 20.x, ARM64)
  - `HandleWebChatComm` - Processes WebSocket messages (Node.js 20.x, ARM64)
  - `SlackMe` - Sends Slack messages (Python 3.11, ARM64)
  - `WebChatMe` - Sends WebSocket messages (Python 3.12, ARM64)
  - `EventCallback` - Handles manual triage decisions (Node.js 20.x, ARM64)

- **API Gateway**: REST endpoints for callbacks (`OheroRestEndpoints`) and WebSocket API (`OheroWebSocketApi`)

#### Event Interactions:

- **Produces**:
  - `Health.EventAdded`, `Health.EventUpdated`, `SecHub.EventAdded`
  - `Health.EventAddedAcknowledged`, `Chat.SlackMessageReceived`
- **Consumes**:
  - `aws.health`, `aws.securityhub` (from collection service)
  - `OpsAgent.Responded` (from AI service)
- **Dependencies**: Stateful Storage Service

#### State Machine Workflows:

```mermaid
sequenceDiagram
    participant AWS as AWS Services
    participant EB as EventBridge
    participant OSM as OheroOpsOrchestration
    participant DB as DynamoDB
    participant NSM as OheroNotification
    participant USER as User Interface

    AWS->>EB: Health/SecHub Event
    EB->>OSM: Trigger Orchestration
    OSM->>DB: Store Event
    OSM->>EB: Emit Health.EventAdded (with task token)
    EB->>NSM: Notification Trigger
    NSM->>USER: Send Interactive Message
    USER->>OSM: Accept/Discharge Decision
    OSM->>DB: Update Event Status
    OSM->>EB: Emit Acknowledgment
    EB->>NSM: Status Update
    NSM->>USER: Confirmation Message
```

---

### Service 4: AI Service

**Implementation**: `OpsHealthAgentStack`
**Purpose**: AI-powered automatic reaction to operational events

#### Components:

- **Bedrock Knowledge Bases**:

  - `OpsHealthKnowledgeBase` - Health event knowledge (Titan Embed Text v2, no chunking)
  - `OpsSecHubKnowledgeBase` - Security findings knowledge (Titan Embed Text v2, fixed size chunking)

- **Lambda Functions**:

  - `OheroActFunction` - Main AI agent processing (Python 3.11, ARM64, 900s timeout, 1 concurrent execution)
  - `IngestOpsKbFunction` - Knowledge base synchronization (Node.js 20.x, ARM64)

- **Step Functions**:

  - `OheroAiIntegration` - Event processing with AI
  - `OheroChatIntegration` - Interactive chat with AI

- **SQS Queues**: Buffer knowledge base sync operations (`BufferHealthKbSyncSqs`, `BufferSechubKbSyncSqs`)
- **DynamoDB Table**: `ChatUserSessionsTable` - AI chat session state with TTL

#### Event Interactions:

- **Produces**: `OpsAgent.Responded`
- **Consumes**:
  - `Health.EventAdded`, `Health.EventUpdated`, `SecHub.EventAdded`
  - `Chat.SlackMessageReceived`, `Chat.SendSlackRequested`
  - S3 object creation events (for knowledge sync)
- **Dependencies**: Stateful Storage Service

#### AI Processing Flow:

```mermaid
flowchart TD
    A[Event from Orchestration] --> B[OheroAiIntegration]
    B --> C[Invoke OheroActFunction]
    C --> D{Event Type?}
    D -->|Health Event| E[Consult Health KB]
    D -->|Security Event| F[Consult SecHub KB]
    E --> G[Generate AI Response]
    F --> G
    G --> H[Create Tickets if Needed]
    H --> I[Emit OpsAgent.Responded]
    I --> J[Back to Notification Service]

    style A fill:#e1f5fe
    style G fill:#e8f5e8
    style I fill:#f3e5f5
```

#### Chat Processing Flow:

```mermaid
flowchart TD
    A[User Chat Message] --> B{Session Exists?}
    B -->|Yes| C[Load Session Context]
    B -->|No| D[Create New Session]
    C --> E[OheroChatIntegration]
    D --> E
    E --> F[Invoke OheroActFunction]
    F --> G[Consult Knowledge Bases]
    G --> H[Generate Response]
    H --> I[Update Session]
    I --> J[Send Response to User]

    style A fill:#fff3e0
    style E fill:#e8f5e8
    style J fill:#f3e5f5
```

---

### Service 5: Slack Chat Service

**Implementation**: Part of `OpsOrchestrationStack`
**Purpose**: Slack integration for user interaction

#### Components:

- **Lambda Functions**:

  - `HandleSlackComm` - Processes Slack events and interactions
  - `SlackMe` - Sends messages to Slack channels

- **Step Functions**:
  - `OheroNotification` - Slack-specific notification workflow

#### Event Interactions:

- **Produces**: `Chat.SlackMessageReceived`
- **Consumes**: `OpsAgent.Responded`, orchestration events
- **Dependencies**: Ops Orchestration Service

#### Integration Features:

- Interactive message blocks with action buttons
- Threaded conversations for event tracking
- Slash command support for AI chat
- Real-time event notifications

---

### Service 6: Web Chat Service

**Implementation**: `WebFrontendStack` + `OpsOrchestrationStack`
**Purpose**: Web-based chat interface as Slack alternative

#### Components:

- **WebSocket API Gateway**: Real-time communication (`OheroWebSocketApi` with routes: `$connect`, `$disconnect`, `$default`, `message`)
- **Lambda Functions**:

  - `HandleWebChatComm` - WebSocket message handling (Node.js 20.x, ARM64)
  - `WebChatMe` - Sends messages to web clients (Python 3.12, ARM64)

- **CloudFront + S3**: Static web frontend with Origin Access Identity
- **Step Functions**: `OheroWebChatNotification` - Web-specific notifications
- **Build Process**: TypeScript compilation and asset deployment during CDK synthesis

#### Event Interactions:

- **Produces**: Web chat message events
- **Consumes**: `OpsAgent.Responded`, orchestration events
- **Dependencies**: Ops Orchestration Service

#### Features:

- Real-time WebSocket communication
- Interactive UI for event triage
- Team-based access control
- Responsive web interface

---

### Service 7: Event Lake Service

**Implementation**: `OpsEventLakeStack`
**Purpose**: Data warehousing for operational events and analytics

#### Components:

- **Kinesis Data Firehose**: Streaming data ingestion (`OpsEventLakeFirehose`) with dynamic partitioning
- **S3 Bucket**: Partitioned event storage (uses `OpsEventLakeBucket` from Stateful Stack)
- **EventBridge Rules**: Event capture rules (`OpsEventLakeRule`)
- **IAM Role**: `FirehoseDeliveryRole` for S3 access permissions

#### Event Interactions:

- **Produces**: None (data sink)
- **Consumes**: All health and security hub events
- **Dependencies**: Stateful Storage Service

#### Data Organization:

- Dynamic partitioning by event source and type
- Compressed storage with lifecycle policies
- Ready for analytics with Athena/QuickSight
- Error handling with separate error prefixes

---

### Service 8: Knowledge Base Management Service

**Implementation**: Distributed across multiple stacks
**Purpose**: Manages ingestion and synchronization of operational knowledge

#### Components:

- **Lambda Functions**: `IngestOpsKbFunction` (in AI Service, Node.js 20.x, ARM64)
- **S3 Event Triggers**: Automatic sync on file changes (`OpsKbFileArrivalRule`)
- **Bedrock Data Sources**: 
  - `OpsHealthDataSource` (S3-based, no chunking)
  - `OpsSecHubDataSource` (S3-based, fixed size chunking)
- **SQS Queues**: Buffered sync operations (`BufferHealthKbSyncSqs`, `BufferSechubKbSyncSqs`)

#### Event Interactions:

- **Produces**: Knowledge base sync events
- **Consumes**: S3 object creation events
- **Dependencies**: Stateful Storage Service, AI Service

#### Sync Process:

1. S3 object creation triggers event
2. SQS buffers sync requests
3. Lambda processes batched sync operations
4. Bedrock knowledge bases updated
5. AI agents get fresh knowledge

## Layered Deployment Strategy

The architecture supports incremental deployment in layers:

```mermaid
graph TD
    subgraph "Layer 1: Core Operations (Required)"
        L1A[Stateful Storage Service]
        L1B[Multi-Account Event Collection]
        L1C[Ops Orchestration Service]

        L1A --> L1B
        L1B --> L1C
    end

    subgraph "Layer 2: AI Enhancement (Optional - Headless Mode)"
        L2A[AI Service<br/>Runs independently]
        L2B[Knowledge Base Management]

        L2A --> L2B
    end

    subgraph "Layer 3: Chat Integration (Optional - Choose One or Both)"
        L3A[Slack Chat Service<br/>NOTIFICATION_CHANNEL=slack]
        L3B[Web Chat Service<br/>NOTIFICATION_CHANNEL=webchat]
    end

    subgraph "Layer 4: Analytics (Optional)"
        L4A[Event Lake Service]
    end

    L1C -.-> L2A
    L2A -.-> L1C
    L1C -.-> L3A
    L1C -.-> L3B
    L1C -.-> L4A

    L1A -.-> L2A
    L1A -.-> L3A
    L1A -.-> L3B
    L1A -.-> L4A

    style L1A fill:#ffecb3
    style L1B fill:#e1f5fe
    style L1C fill:#f3e5f5
    style L2A fill:#e8f5e8
    style L2B fill:#e8f5e8
    style L3A fill:#fff3e0
    style L3B fill:#fff3e0
    style L4A fill:#fce4ec
```

**Layer 1: Core Operations (Required)**

- **Services**: Stateful Storage, Multi-Account Event Collection, Ops Orchestration
- **Capabilities**: Manual event triage, basic workflow, event routing
- **Value**: Immediate operational event management

**Layer 2: AI Enhancement (Optional - Headless Mode)**

- **Services**: AI Service, Knowledge Base Management
- **Capabilities**: Automated event analysis, AI recommendations, ticket creation
- **Value**: Reduced manual effort, expert knowledge assistance
- **Note**: AI runs headlessly - no user interface required

**Layer 3: Chat Integration (Optional - Choose One)**

- **Services**: Slack Chat Service OR Web Chat Service (mutually exclusive)
- **Capabilities**: Interactive user interfaces, chat-based AI interaction
- **Value**: User-friendly interfaces for monitoring and interaction
- **Configuration**: Set `NOTIFICATION_CHANNEL=slack` or `webchat` 
- **Conditional Deployment**: Web Frontend Stack (`OheroWebFrontendStack`) only deploys when `NOTIFICATION_CHANNEL=webchat`

**Layer 4: Analytics (Optional)**

- **Services**: Event Lake Service
- **Capabilities**: Historical analysis, reporting, compliance tracking
- **Value**: Data-driven insights and audit trails

## Event Flow Diagrams

### Primary Event Flow

```mermaid
sequenceDiagram
    participant AWS as AWS Services
    participant CS as Collection Service
    participant EB as EventBridge
    participant OS as OheroOpsOrchestration
    participant DB as DynamoDB
    participant NS as OheroNotification
    participant UI as User Interface

    AWS->>CS: Health/SecHub Events
    CS->>EB: Forward Events
    EB->>OS: Trigger Processing
    OS->>DB: Store Event Data
    OS->>EB: Emit Internal Events
    EB->>NS: Notification Trigger
    NS->>UI: Send Notifications
    UI->>OS: User Actions
    OS->>DB: Update Status
```

### AI-Enhanced Flow

```mermaid
sequenceDiagram
    participant OS as OheroOpsOrchestration
    participant EB as EventBridge
    participant AI as OheroAiIntegration
    participant KB as Knowledge Bases
    participant NS as OheroNotification
    participant UI as User Interface

    OS->>EB: Health.EventAdded
    EB->>AI: Trigger AI Processing
    AI->>KB: Query Knowledge
    KB->>AI: Return Context
    AI->>AI: Generate Response
    AI->>EB: OpsAgent.Responded
    EB->>NS: Forward Response
    NS->>UI: Display AI Analysis
```

### Chat Interaction Flow

```mermaid
sequenceDiagram
    participant USER as User
    participant CS as HandleSlackComm/HandleWebChatComm
    participant DB as ChatUserSessionsTable
    participant AI as OheroChatIntegration
    participant KB as Knowledge Bases
    participant UI as SlackMe/WebChatMe

    USER->>CS: Send Message
    CS->>DB: Check/Create Session
    DB->>CS: Session Context
    CS->>AI: Process with Context
    AI->>KB: Query Knowledge
    KB->>AI: Return Information
    AI->>CS: Generate Response
    CS->>DB: Update Session
    CS->>UI: Send Response
    UI->>USER: Display Answer
```

### Complete System Integration

```mermaid
graph TB
    subgraph "External Sources"
        AWS[AWS Health/<br/>Security Hub]
        USER[Users]
    end

    subgraph "Event Processing Layer"
        CS[Collection<br/>Service]
        EB[EventBridge<br/>Hub]
        OS[Orchestration<br/>Service]
    end

    subgraph "AI Processing Layer"
        AI[AI Service]
        KB[Knowledge<br/>Bases]
        KBM[KB Management<br/>Service]
    end

    subgraph "Storage Layer"
        DB[(DynamoDB<br/>Tables)]
        S3[(S3 Buckets)]
        EL[Event Lake<br/>Service]
    end

    subgraph "Interface Layer"
        SLACK[Slack<br/>Service]
        WEB[Web Chat<br/>Service]
    end

    AWS --> CS
    CS --> EB
    EB --> OS
    OS --> DB
    OS --> EB
    EB --> AI
    AI --> KB
    AI --> EB
    EB --> SLACK
    EB --> WEB
    EB --> EL
    EL --> S3
    USER --> SLACK
    USER --> WEB
    S3 --> KBM
    KBM --> KB

    style AWS fill:#e1f5fe
    style CS fill:#e1f5fe
    style EB fill:#f3e5f5
    style OS fill:#f3e5f5
    style AI fill:#e8f5e8
    style KB fill:#e8f5e8
    style KBM fill:#e8f5e8
    style DB fill:#ffecb3
    style S3 fill:#ffecb3
    style EL fill:#fce4ec
    style SLACK fill:#fff3e0
    style WEB fill:#fff3e0
```

This event-driven architecture ensures that OHERO can scale from a simple manual triage system to a sophisticated AI-powered operational platform, with each service providing independent value while contributing to the overall solution capability.
