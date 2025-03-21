# Demo runbook
- Deployment and environment setup
- Trigger test event 1 - a triaged example, explain what is in the event.
    1. my admin channel will receive a notification about the event
    2. explain traditionally how the event will be processed by a human admin
    3. explain how the work is now handled by an AI agent.
    4. check in the other channel how the team is informed about a ticket created.
    5. show the system prompt how 'company escalation runbook' played the role
- Trigger event 2 and explain it is an updated event on the same thread as event 1
    1. explain traditionally how such update is triaged
    2. look at how the AI agent triaged the update instead
- Trigger test event 3 - a discharged example, explain how this is different from event 1 and 2
    1. explain how agent has triaged this time
- Trigger test event 4 and explain the logic of triage
    1. check in the other channel how a ticket is assigned to the team
- use @history to ask a followup question regarding why the ticket was created?
- use the past example to show a long thread of events and explain how the updates were triaged. 
- show agent report in S3 for auditing purpose
- summarize demo by asking 'who are you'
- explain how the same concept can be applied to beyond just AWS Health events.

# Solution diagram    
```mermaid
%% Title and Description
%% AWS Ops Health AI Solution Architecture
%% # Operation event handling flow
%% 1. An operational event happens
%% 2. the event gets delivered to OpsAgent
%% 3. OpsAgent analyzes the event content by connecting to the history event knowledge base and ticket system
%% 4. OpsAgent takes actions such as create, update ticket based on the analyses and it consults AskExpert knowledge base for remediation guidelines
%% 5. OpsAgent send report of actions and results via Slack

%% # User chat handling flow
%% 1. User sends query to OpsAgent via Slack
%% 2. OpsAgent generated response to user query by connecting to history event knowledge base, AskExpert knowledge base, and ticket tools
%% 3. OpsAgent sends synthesized response back to user via Slack

erDiagram
    OperationalEvents ||--o{ OpsAgent : "delivered to"
    OpsAgent ||--o{ OpsEventKnowledgeBases : "analyzes using"
    OpsAgent ||--o{ TicketSystem : "create,read,update"
    OpsAgent ||--o{ AskExpertKnowledgeBase : "consults for recommended actions"
    OpsAgent ||--o{ Slack : "sends reports via"
    User ||--o{ Slack : "sends query via"
    Slack ||--o{ OpsAgent : "delivers user query to"
    OpsAgent ||--o{ OpsEventKnowledgeBases : "retrieves knowledge from"
    OpsAgent ||--o{ AskExpertKnowledgeBase : "retrieves advice from"
    OpsAgent ||--o{ TicketSystem : "generates knowledge from"
    OpsAgent ||--o{ Slack : "sends notifications via"
    Slack ||--o{ User : "delivers notifications to"

    OperationalEvents {
        service_deprecation operational_issues
        account_change maintenance
        security_findings cost_anomalies
        on-prem_events user_reported_events
    }

    OpsAgent {
        acknowledge_event search_ticket
        create_ticket update_ticket
        search_related_events ask_aws_expert
    }

    OpsEventKnowledgeBases {
        aws_health security_findings
        event_start_time last_updated_time
        affected_account event_description
    }

    TicketSystem {
        associated_event issue_title
        assigned_to issue_status
        issue_description recommended_actions
    }

    AskExpertKnowledgeBase {
        aws_knowledge_base proprietary_documentations
    }

    Slack {
        admin_channel team_1_channel
        team_2_channel team_3_channel
    }

    User {
        centralized_admin tenant_teams
        self_managed_teams functional_teams
    }

    %% Styling classes for each entity type
    classDef opsAgentStyle stroke:#FF9999

    %% Apply styling to entities
    class OpsAgent opsAgentStyle
```

