# Requirements Document

## Introduction

This feature adds a web-based chat interface to OHERO (Operational Health Event Resolution Orchestrator) as an alternative to the existing Slack-only interface. The web chat capability will provide users with a browser-based UI that mimics Slack's channel and threading functionality, allowing them to interact with the OHERO OpsAgent without requiring Slack access. This enhancement makes OHERO more accessible for quick trials and demonstrations while maintaining the same core functionality.

## Requirements

### Requirement 1

**User Story:** As a user, I want to access OHERO through a web browser interface, so that I can interact with the system without needing Slack access.

#### Acceptance Criteria

1. WHEN a user navigates to the web chat URL THEN the system SHALL display a single-page application (SPA) hosted on AWS CloudFront with S3 distribution
2. WHEN the SPA loads THEN the system SHALL display multiple chat windows on one page, each representing a channel from the TeamManagementTable DynamoDB table
3. WHEN the user interacts with the web interface THEN the system SHALL provide functionality equivalent to the existing Slack integration
4. WHEN the user closes the browser THEN the system SHALL NOT preserve any session state for the next launch

### Requirement 2

**User Story:** As a user, I want to communicate with OHERO using WebSocket connections, so that I can have real-time bidirectional communication with the backend.

#### Acceptance Criteria

1. WHEN the SPA initializes THEN the system SHALL establish a WebSocket connection to the backend
2. WHEN a user sends a message THEN the system SHALL transmit it via WebSocket to the backend
3. WHEN the backend responds THEN the system SHALL receive the response via WebSocket and display it in the appropriate channel
4. WHEN network connectivity is disrupted THEN the system SHALL handle reconnection gracefully without message loss
5. WHEN the WebSocket connection is restored THEN the system SHALL allow users to continue using the application seamlessly

### Requirement 3

**User Story:** As a user, I want to interact with channels and threads similar to Slack, so that I can have organized conversations with OHERO.

#### Acceptance Criteria

1. WHEN a user sends a new message in a channel THEN the system SHALL treat it as starting a new thread
2. WHEN the backend responds with a thread ID and channel ID THEN the system SHALL display the response as a reply under the appropriate message thread
3. WHEN a user clicks on a thread THEN the system SHALL allow them to reply within that thread context
4. WHEN a user sends a reply in a thread THEN the system SHALL maintain the thread context for backend processing
5. WHEN multiple threads exist in a channel THEN the system SHALL display them in an organized, visually distinct manner

### Requirement 4

**User Story:** As a developer, I want the frontend to be simple and lightweight, so that it doesn't introduce unnecessary complexity to the solution.

#### Acceptance Criteria

1. WHEN implementing the frontend THEN the system SHALL use only CSS and TypeScript as primary tools
2. WHEN adding dependencies THEN the system SHALL minimize the number of new dependencies introduced
3. WHEN building the UI THEN the system SHALL keep the implementation as simple as possible while meeting functional requirements
4. WHEN comparing to existing functionality THEN the system SHALL NOT exceed the complexity of the current Slack integration

### Requirement 5

**User Story:** As a developer, I want the backend to reuse existing patterns and infrastructure, so that the web chat integration is consistent with the current architecture.

#### Acceptance Criteria

1. WHEN implementing the backend THEN the system SHALL NOT modify any existing backend modules
2. WHEN creating new backend components THEN the system SHALL add a new microservice following existing patterns
3. WHEN implementing the workflow THEN the system SHALL create a new ops-notification-web.asl step function similar to existing step functions
4. WHEN handling web communication THEN the system SHALL create a new handleWebChatComm Lambda function following the handleSlackComm pattern
5. WHEN defining events THEN the system SHALL reuse existing event types where possible and minimize new event type creation

### Requirement 6

**User Story:** As a developer, I want the infrastructure to follow existing CDK patterns, so that the web chat module integrates seamlessly with the current deployment process.

#### Acceptance Criteria

1. WHEN adding AWS infrastructure THEN the system SHALL use AWS CDK following the current code structure
2. WHEN organizing infrastructure code THEN the system SHALL keep all new module infrastructure in a separate CDK stack
3. WHEN naming and structuring the stack THEN the system SHALL follow the pattern of existing stacks
4. WHEN adding dependencies THEN the system SHALL minimize new infrastructure dependencies
5. WHEN deploying THEN the system SHALL integrate with existing deployment processes without modification

### Requirement 7

**User Story:** As a user, I want the web chat to handle network disruptions gracefully, so that I can continue working even when connectivity issues occur.

#### Acceptance Criteria

1. WHEN a WebSocket connection is lost THEN the system SHALL attempt automatic reconnection
2. WHEN messages are sent during disconnection THEN the system SHALL queue them for transmission upon reconnection
3. WHEN reconnection occurs THEN the system SHALL deliver queued messages without user intervention
4. WHEN connection status changes THEN the system SHALL provide visual feedback to the user about connectivity state
5. WHEN multiple reconnection attempts fail THEN the system SHALL provide clear error messaging to the user

### Requirement 8

**User Story:** As a user, I want the web interface to load channels dynamically from the existing team configuration, so that I see the same channels available in the Slack integration.

#### Acceptance Criteria

1. WHEN the SPA initializes THEN the system SHALL query the TeamManagementTable DynamoDB table
2. WHEN team data is retrieved THEN the system SHALL create chat windows for each configured channel
3. WHEN channels are displayed THEN the system SHALL show channel names and relevant metadata
4. WHEN no channels are configured THEN the system SHALL display an appropriate message to the user
5. WHEN channel configuration changes THEN the system SHALL reflect updates in the web interface during the session