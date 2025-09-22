# Product Overview

OHERO (Operational Health Event Resolution Orchestrator) is an AI-powered virtual operator that autonomously manages AWS operational health events and security findings. The system processes events from AWS Health, Security Hub, and user-reported incidents through an intelligent workflow that acknowledges, triages, and creates tickets following customizable organizational policies.

## Key Capabilities

- **Autonomous Event Processing**: AI agent automatically handles AWS Health and Security Hub events
- **Intelligent Noise Filtering**: Reduces alert fatigue by filtering events based on severity and impact
- **Multi-Source Integration**: Unified workflow for AWS Health, Security Hub, and user-reported incidents
- **Expert Knowledge Access**: Leverages AWS documentation and historical event data for contextual understanding
- **Auditable Actions**: All AI decisions logged to S3 with full traceability
- **Modern AI Stack**: Powered by Amazon Nova and Claude 3.7 Sonnet with prompt caching

## OheroACT Framework

The system follows a three-stage framework:
1. **Acknowledge**: Initial event recognition and validation
2. **Consult**: Knowledge base consultation for context and recommendations
3. **Triage**: Decision making and action execution (ticket creation, updates, notifications)

## Integration Points

- **Slack**: Primary user interface for notifications and chat interactions
- **AWS Health**: Operational events and lifecycle notifications
- **AWS Security Hub**: Security findings and compliance events
- **Knowledge Bases**: AWS documentation and historical event data
- **Ticket System**: Issue tracking and management (with planned Jira integration)