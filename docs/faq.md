# Frequently Asked Questions

## Table of Contents

### General Questions
- [What is OHERO and what does it do?](#what-is-ohero-and-what-does-it-do)
- [Can OHERO run without any user interface?](#can-ohero-run-without-any-user-interface)
- [Can OHERO run with other chat clients like TEAMS?](#can-ohero-run-with-other-chat-clients-like-teams)
- [Can I customize the OHERO's behavior?](#can-i-customize-the-oheros-behavior)
- [What AI models does OHERO use?](#what-ai-models-does-ohero-use)
- [Can I add more operational event sources to OHERO?](#can-i-add-more-operational-event-sources-to-ohero)
- [How does OHERO ensure consistent and deterministic decisions?](#how-does-ohero-ensure-consistent-and-deterministic-decisions)

### Deployment & Configuration
- [What are the minimum requirements to deploy OHERO?](#what-are-the-minimum-requirements-to-deploy-ohero)
- [Can I use a single AWS account or do I need multiple accounts?](#can-i-use-a-single-aws-account-or-do-i-need-multiple-accounts)
- [How do I choose between Slack and Web Chat?](#how-do-i-choose-between-slack-and-web-chat)
- [Can I change the notification channel after deployment?](#can-i-change-the-notification-channel-after-deployment)
- [How do I add new teams to receive notifications?](#how-do-i-add-new-teams-to-receive-notifications)

### Architecture & Design
- [Why is OHERO built with microservices?](#why-is-ohero-built-with-microservices)
- [How does the event-driven architecture work?](#how-does-the-event-driven-architecture-work)

### User Interfaces
- [How do I access the web chat interface?](#how-do-i-access-the-web-chat-interface)
- [Why isn't my Slack app receiving events?](#why-isnt-my-slack-app-receiving-events)
- [Can I use both Slack and Web Chat simultaneously?](#can-i-use-both-slack-and-web-chat-simultaneously)

### Troubleshooting
- [My deployment failed. What should I check?](#my-deployment-failed-what-should-i-check)
- [Events aren't being processed. How do I debug?](#events-arent-being-processed-how-do-i-debug)
- [The web chat isn't loading. What's wrong?](#the-web-chat-isnt-loading-whats-wrong)
- [How do I monitor OHERO's performance?](#how-do-i-monitor-oheros-performance)
- [Lambda functions are timing out. How do I fix this?](#lambda-functions-are-timing-out-how-do-i-fix-this)
- [Why doesn't my test event show up in chat when I send it again?](#why-doesnt-my-test-event-show-up-in-chat-when-i-send-it-again)
- [Why do my test events keep getting rejected/discharged by the OHERO AI agent?](#why-do-my-test-events-keep-getting-rejecteddischarged-by-the-ohero-ai-agent)

### Security & Compliance
- [How does OHERO handle sensitive data?](#how-does-ohero-handle-sensitive-data)
- [What data does OHERO store?](#what-data-does-ohero-store)
- [How long is data retained?](#how-long-is-data-retained)
- [Can I deploy OHERO in a private network?](#can-i-deploy-ohero-in-a-private-network)
- [How do I ensure compliance with my organization's policies?](#how-do-i-ensure-compliance-with-my-organizations-policies)
- [What happens to data when I delete OHERO?](#what-happens-to-data-when-i-delete-ohero)

## General Questions

### What is OHERO and what does it do?

OHERO (Operational Health Event Resolution Orchestrator) is an AI-powered virtual operator that automatically reacts on operational events. It can acknowledge, triage, and create tickets following customizable organizational policies, reducing manual operational overhead.

### Can OHERO run without any user interface?

Yes! OHERO can operate in "headless mode" where the AI processes events automatically without requiring Slack or other chat interfaces. This is perfect for fully automated operations where human intervention is minimal.

### Can OHERO run with other chat clients like TEAMS?

Not out-of-the-box, but using the same pattern of integration OHERO has with Slack, user can further build similar integrations with other collaboration tools like TEAMS.

### Can I customize the OHERO's behavior?

Yes, through customization of Acknowledge, Consult, and Triage phases in the OheroACT framework, you can reflect your organization's runbooks and policies in OHERO's practice

### What AI models does OHERO use?

- **Primary**: Amazon Nova and Claude 3.7 Sonnet with prompt caching
- **Embeddings**: Titan Embed Text v2 for knowledge base search

### Can I add more operational event sources to OHERO?

Yes! OHERO is designed to be extensible and can integrate with additional AWS services and custom event sources. Here's how:

**Currently Supported Sources:**

- AWS Health Dashboard events
- AWS Security Hub findings
- Custom/test events (user reported)

**Potential Additional Sources:**

- AWS Cost Anomaly Detection
- CloudWatch Alarms
- AWS Trusted Advisor
- AWS Config compliance events
- AWS Systems Manager incidents
- Custom application events

**Custom Operational Event Sources:**
You can also integrate custom applications by:

1. **Publishing events** to the OHERO EventBridge bus
2. **Following the event schema** used by AWS services
3. **Adding appropriate processing logic** in the state machines

**Best Practices for New Sources:**

- **Event filtering**: Use EventBridge patterns to filter relevant events only
- **Rate limiting**: Consider event volume and processing capacity
- **OheroACT**: Add relevant documentation for AI decision-making

### How does OHERO ensure consistent and deterministic decisions?

OHERO's thinking is grounded by the OheroACT Framework (Acknowledge, Consult, Triage) with:

- **Structured workflows**: Step Functions ensure consistent processing paths
- **Knowledge base consultation**: AI decisions are based on documented best practices
- **Audit trails**: All decisions are logged to S3 with full traceability
- **Deterministic routing**: EventBridge rules ensure events follow predictable paths

## Deployment & Configuration

### What are the minimum requirements to deploy OHERO?

**Required:**

- 1 AWS account with appropriate permissions
- AWS CDK installed locally
- AWS SAM and Docker for building Lambda packages

**Optional (based on chosen features):**

- Slack workspace and app (for Slack integration)
- AWS Health Organization view (for multi-account monitoring)
- AWS Security Hub (for security findings processing)

### Can I use a single AWS account or do I need multiple accounts?

OHERO supports both:

- **Single Account**: Deploy everything in one account (simpler setup)
- **Multi-Account**: Separate admin account (for collection of organization level operational events) and worker account (for processing services)

The multi-account setup is recommended for organizations with existing account separation patterns.

### How do I choose between Slack and Web Chat?

**Choose Slack if:**

- Your team already uses Slack
- You want rich collaboration features
- You need mobile notifications
- You have Slack workspace admin permissions

**Choose Web Chat if:**

- You don't have Slack or lack workspace permissions
- You want a quick trial/demo setup
- You prefer a self-contained solution
- You're evaluating the system before committing to Slack integration

### Can I change the notification channel after deployment?

Yes! Update the `NOTIFICATION_CHANNEL` in your `.env` file and redeploy:

```bash
# Change from slack to webchat
NOTIFICATION_CHANNEL=webchat
cdk deploy --all --require-approval never
```

### How do I add new teams to receive notifications?

Add entries to the TeamManagementTable in DynamoDB:

1. Go to DynamoDB console → TeamManagementTable
2. Create item with:
   - `PK`: team identifier (e.g., "app01")
   - `SlackChannelId`: Slack channel ID or random ID for web chat
   - `ChannelName`: Human-readable team name

## Architecture & Design

### Why is OHERO built with microservices?

The microservices architecture provides:

- **Independent deployment**: Deploy only the services you need
- **Fault isolation**: One service failure doesn't affect others
- **Scalability**: Scale services independently based on load
- **Technology flexibility**: Different services can use optimal technologies
- **Incremental adoption**: Start small and add features over time

### How does the event-driven architecture work?

OHERO uses Amazon EventBridge as the central nervous system:

1. **External events** (AWS Health, Security Hub) are collected
2. **Internal events** are generated as services process data
3. **Services subscribe** to relevant event types
4. **Loose coupling** allows services to operate independently

## User Interfaces

### How do I access the web chat interface?

After deploying with `NOTIFICATION_CHANNEL=webchat`:

1. Find the "WebsiteUrl" in the CloudFormation outputs
2. Open the URL in a modern web browser
3. Select your team from the dropdown

### Why isn't my Slack app receiving events?

Common issues:

1. **Webhook URL not configured**: Update Event Subscriptions in your Slack app with the HandleSlackCommApiUrl
2. **Wrong tokens**: Verify SLACK_ACCESS_TOKEN and SLACK_APP_VERIFICATION_TOKEN
3. **Channel permissions**: Ensure the bot is added to your Slack channels
4. **Event subscriptions**: Check that your Slack app is subscribed to message events

### Can I use both Slack and Web Chat simultaneously?

Currently, only one notification method can be active at a time. However, the AI service and core functionality work regardless of the interface choice.

## Troubleshooting

### My deployment failed. What should I check?

1. **CDK Bootstrap**: Ensure accounts are properly bootstrapped
2. **Permissions**: Verify AWS credentials have sufficient permissions
3. **Dependencies**: Check that SAM build completed successfully
4. **Environment**: Validate all required environment variables in `.env`
5. **Regions**: Ensure EVENT_REGIONS includes us-east-1

### Events aren't being processed. How do I debug?

1. **Check EventBridge**: Verify events are reaching the custom event bus
2. **State Machine logs**: Review Step Function execution logs
3. **Lambda logs**: Check CloudWatch logs for processing functions
4. **DynamoDB**: Verify events are being stored in EventManagementTable

### The web chat isn't loading. What's wrong?

1. **CloudFront**: Check if the distribution is deployed and accessible
2. **S3 deployment**: Verify frontend files are uploaded to S3
3. **API Gateway**: Ensure WebSocket API is properly configured
4. **CORS**: Check browser console for CORS errors

### How do I monitor OHERO's performance?

- **CloudWatch Logs**: Monitor Lambda function execution
- **Step Functions**: Track state machine executions and failures
- **EventBridge Metrics**: Monitor event processing rates
- **S3 Audit Logs**: Review AI decision logs for accuracy

### Lambda functions are timing out. How do I fix this?

1. **Bedrock quotas**: Ensure your account has sufficient Bedrock API quotas
2. **Knowledge base size**: Large knowledge bases may slow AI responses

### Why doesn't my test event show up in chat when I send it again?

This is expected behavior! OHERO implements **event deduplication** to prevent processing the same operational event multiple times. Here's what happens:

**First Event (New Event):**

1. Event arrives and OHERO creates a unique Primary Key (PK) based on:
   - **Health Events**: `eventArn~affectedAccount~eventRegion`
   - **Security Hub Events**: `FindingId` from the event
2. OHERO checks DynamoDB - event doesn't exist
3. Creates new event record and emits `Health.EventAdded` or `SecHub.EventAdded`
4. AI processes the event and sends notifications
5. You see the message in chat

**Second Event (Duplicate Event):**

1. Same event arrives with identical PK
2. OHERO checks DynamoDB - event already exists
3. Updates the existing record with any new information
4. Emits `Health.EventUpdated` instead of `Health.EventAdded`
5. **No new chat message** because it's an update, not a new event

**Why This Design Makes Sense:**

- **Prevents spam**: Real AWS events can be sent multiple times
- **Avoids duplicate tickets**: Prevents creating multiple tickets for the same issue
- **Maintains state**: Tracks event lifecycle (new → updated → resolved)
- **Reduces noise**: Operations teams don't get flooded with duplicate alerts

**How to Test with "New" Events:**

1. **Modify the event data** to create a unique event:

   ```json
   {
     "eventArn": "arn:aws:health:ap-southeast-2::event/EKS/AWS_EKS_PLANNED_LIFECYCLE_EVENT/Example2"
     // Change Example1 to Example2 to make it unique
   }
   ```

2. **Use different test event files**:

   ```bash
   aws events put-events --entries file://test-events/mockup-ops-event.json
   aws events put-events --entries file://test-events/mockup-ops-event2.json  # Different event
   ```

3. **Check for updates** - if you want to see update processing:
   - Modify the `lastUpdatedTime` or `statusCode` in the same event
   - This will trigger `Health.EventUpdated` processing
   - Updates may generate different notifications depending on the change

**Debugging Event Processing:**

- **Check DynamoDB**: Look at the EventManagementTable to see stored events
- **Step Function logs**: Review execution history to see which path was taken
- **Event types**: Look for `Health.EventAdded` vs `Health.EventUpdated` in logs

**Real-World Scenario:**
In production, AWS Health events naturally have unique ARNs for different incidents, so this deduplication only affects:

- Testing with the same mock events
- Actual AWS event updates (status changes, additional information)
- Retransmissions of the same event from AWS

### Why do my test events keep getting rejected/discharged by the OHERO AI agent?

The AI agent makes intelligent accept/discharge decisions based on several factors. If your events are being discharged, here are the most common reasons and solutions:

**Common Reasons for Event Discharge:**

1. **Event content not meeting acceptance criterion**
**Check**: Go to `lambda/src/handlers/oheroAct/rules/acknowledge.md` to verify current acceptance criterion, e.g. affected accounts is production account, and/or has potential cost impact.

2. **Incorrect organization reference**
**Check**: Go to `lambda/src/handlers/oheroAct/rules/organization_data.md` to verify organization attributes are reflecting your own test data, e.g. account ID matching that of the test events, owner team id matching your onboarded teams in the TeamManagementTable.

## Security & Compliance

### How does OHERO handle sensitive data?

- **Encryption**: All data encrypted in transit and at rest
- **IAM roles**: Least privilege access patterns
- **Audit trails**: All AI decisions logged to S3 with timestamps

### What data does OHERO store?

- **Event metadata**: AWS Health and Security Hub event details
- **AI decisions**: Reasoning and actions taken by the AI
- **Chat sessions**: User interactions with the AI (with TTL)
- **Team mappings**: Team to channel associations

### How long is data retained?

- **DynamoDB**: Point-in-time recovery for 35 days
- **S3 audit logs**: Configurable lifecycle policies (default: varies by bucket)
- **CloudWatch logs**: 1 week retention (configurable)
- **Chat sessions**: TTL-based cleanup for expired sessions

### What happens to data when I delete OHERO?

Running `cdk destroy --all` will:

- Delete all AWS resources created by OHERO
- Remove DynamoDB tables and their data
- Delete S3 buckets and their contents (if auto-delete is enabled)
- Clean up CloudWatch logs and metrics
- Remove IAM roles and policies created by the stacks
