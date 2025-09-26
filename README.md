# Operational Health Event Resolution Orchestrator - OHERO
**Boost productivity by using AI in cloud operational health management** - [Link to blog post](https://aws.amazon.com/blogs/machine-learning/boost-productivity-by-using-ai-in-cloud-operational-health-management/)

## Key Features
- **Autonomous Event Processing**: AI-powered virtual operator automatically acknowledges, triages, and creates tickets for AWS Health and Security Hub events following customizable policies
- **Intelligent Noise Filtering**: Filters operational events based on severity, impact, and organizational policies to reduce alert fatigue
- **Multi-Source Integration**: Processes events from AWS Health, Security Hub, and user-reported incidents with unified workflow
- **Expert Knowledge Access**: Leverages AWS and or customer documentation knowledge base and historical event data for contextual understanding
- **Auditable Actions**: All AI decisions and actions are logged to S3 with full traceability and compliance reporting
- **Modern AI Stack**: Powered by Amazon Nova and Claude 3.7 Sonnet with prompt caching for optimized performance

## Change log since post
- Auditable agent action report stored to S3 bucket
- Optimization of Agent long term memory and knowledge retrieval
- Modernized underlying LLMs to use Amazon Nova and Claud 3.7 Sonnet
- User reported operational event as a source
- Support of prompt caching
- Old version archived to 'legacy' branch

## Expecting soon (to-do list)
- Sample integration with Jira in addition to just a mockup issue ticket database
- Additional integration with other operational event sources such as Cost Anomaly Detection, CloudWatch alarms
- Event buffering

## Prerequisites
- At least 1 AWS account with appropriate permissions. The project uses a typical setup of 2 accounts whereas 1 is the organization health administration account and the other is the worker account hosting backend microservices. The worker account can be the same as the administration account if single account setup is chosen. 
- Enable AWS Health Organization view and delegate an administrator account in your AWS management account if you want to manage AWS Health events across your entire AWS Organization. This is optional if you only need to handle events from a single account.
- Enable AWS Security Hub in your AWS management account. Optionally, enable security Hub with Organizations integration  if you want to monitor security findings for the entire organization instead of just a single account.,
- Configure a Slack app and set up a channel with appropriate permissions and event subscriptions to send/receive messages to/from backend microservices.
- AWS CDK installed in your development environment for stack deployment
- AWS SAM (Serverless Application Model) and Docker installed in your development environment to build Lambda packages

## The OheroACT Framework
The OheroACT Framework is a set of customizable guidelines and rules that govern how the AI assistant operates within the context of operational health management. It consists of three main stages: Acknowledge, Consult, and Triage. Each stage has its own set of rules, permitted actions, and output formats.

### OheroACT High-level Flow
```mermaid
flowchart TD
    Start([User Query]) --> CheckState{Check: Query is asking to handle or report an operational event?}
    CheckState -->|No| Consult[Action: execute Consult]
    CheckState -->|Yes| Acknowledge[Action: execute Acknowledge]
    
    Consult --> End([End])
    Acknowledge --> CheckPhase{Check: proceed to Triage?}
    
    CheckPhase -->|Yes| Triage[Action: execute Triage]
    CheckPhase -->|No| FinalResponse[Action: Stop and Respond to user]
    
    Triage --> SynthesizeFinal[Action: synthesize final response]
    
    FinalResponse --> SynthesizeFinal
    
    SynthesizeFinal --> End
```


## Screenshots of Usage
### OHERO can run headless and autonomously without user interfaces, Slack is used to visualize the interactions.
<img src="./screenshots/screenshot1.png"
  alt="Usage scrrenshot1 by seanxw">
</p>

## Architecture
<p align="left">
<img src="./architecture.png"
  alt="Architectural diagram by seanxw">
</p>

## Deployment steps
### Create a Slack app and set up a channel
1. Create a [Slack app](https://api.slack.com/apps) from the manifest template - copy/paste the content of “slack-app-manifest.json” file included in this repository.
2. Install your app into your workspace, take note of the “Bot User OAuth Token” value to be used in next steps.
3. Take note of the “Verification Token” value under your app’s Basic Information, you will need it in next steps.
4. In your Slack desktop app, go to your workspace and add the newly created app.
5. Create a Slack channel (to be used for admin team) and add the newly created app as an integrated app to the channel, this channel will be used to watch how events arrive and get processed.
6. Create another Slack channel (to be used for a sample tenant team) and add the newly created app as an integrated app to the channel, this channel will be used to test out how ticket notifications land in different team channels.
7. Find and take note of the channel id of above channels by right-clicking on the channel name and selecting ‘Additional options’ to access the ‘More’ menu. Within the ‘More’ menu, click on ‘Open details’ to reveal the Channel details.

### Prepare your deployment environment for the worker account
This step is required only if you chose a worker account that is different from the administration account. Make sure you are not running the command under an existing AWS CDK project root directory.
```zsh
# Make sure your shell session environment is configured to access the worker workload
# account of your choice, for detailed guidance on how to configure, refer to 
# https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html  
# Note that in this step you are bootstrapping your worker account in such a way 
# that your administration account is trusted to execute CloudFormation deployment in
# your worker account, the following command uses an example execution role policy of 'AdministratorAccess',
# you can swap it for other policies of your own for least privilege best practice,
# for more information on the topic, refer to https://repost.aws/knowledge-center/cdk-customize-bootstrap-cfntoolkit
cdk bootstrap aws://<replace with your AWS account id of the worker account>/<replace with the region where your worker services is> --trust <replace with your AWS account id of the administration account> --cloudformation-execution-policies 'arn:aws:iam::aws:policy/AdministratorAccess' --trust-for-lookup <replace with your AWS account id of the administration account>
```

### Prepare your deployment environment for the administration account
Make sure you are not running the command under an existing AWS CDK project root directory.
```zsh
# Make sure your shell session environment is configured to access the administration 
# account of your choice, for detailed guidance on how to configure, refer to 
# https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html
# Note 'us-east-1' region is required for receiving AWS Health events associated with
# services that operate in AWS global region.
cdk bootstrap <replace with your AWS account id of the administration account>/us-east-1

# Optional, if you have your cloud infrastructures hosted in other AWS regions than 'us-east-1', repeat the below commands for each region
cdk bootstrap <replace with your AWS account id of the administration account>/<replace with the region name, e.g. us-west-2>
```

### Copy repo to your local directory
```zsh
git clone https://github.com/aws-samples/ops-health-ai.git
cd ops-health-ai
npm install
cd lambda/src
# Depending on your build environment, you might want o change the arch type to 'x86'
# or 'arm' in lambda/src/template.yaml file before build 
sam build --use-container
cd ../..
```
### Create an '.env' file under project root directory that contains the following
```zsh
CDK_ADMIN_ACCOUNT=<replace with your 12 digits admin AWS account id>
CDK_PROCESSING_ACCOUNT=<replace with your 12 digits worker AWS account id. This account id is the same as the admin account id if using single account setup>
EVENT_REGIONS=us-east-1,<region 1 of where your infrastructures are hosted>,<region 2 of where your infrastructures are hosted>
CDK_PROCESSING_REGION=<replace with the region where you want the worker services to be, e.g. us-east-1>
EVENT_HUB_ARN=arn:aws:events:<replace with the worker service region>:<replace with the worker service account id>:event-bus/OheroStatefulStackOheroEventBus
SLACK_CHANNEL_ID=<your admin (operations team) Slack channel ID here>
SLACK_APP_VERIFICATION_TOKEN=<replace with your Slack app verification token>
SLACK_ACCESS_TOKEN=<replace with your Slack Bot User OAuth Token value>
WEB_CHAT_API_KEY=your-secure-api-key-change-this-value
NOTIFICATION_CHANNEL=slack
```
### Deploy by CDK
Deploy processing microservice to your worker account, the worker account can be the same as your admin account.
In project root directory, run the following commend:
```zsh
cdk deploy --all --require-approval never
```
Capture the “HandleSlackCommApiUrl” stack output URL, go to your [Slack app](https://api.slack.com/apps) created in previous steps, go to Event Subscriptions, Request URL Change, then update the URL value with the stack output URL and save.

## Web Chat Interface (Alternative to Slack)

OHERO now supports a web-based chat interface as an alternative to Slack integration. This provides a simple web UI for demonstration purposes.

### Deploying with Web Chat

1. Update your `.env` file to enable web chat:
```zsh
NOTIFICATION_CHANNEL=webchat
WEB_CHAT_API_KEY=your-secure-api-key-change-this-value
```

2. Deploy with CDK (frontend is built automatically):
```zsh
cdk deploy --all --require-approval never
```

3. Access the web interface using the `WebsiteUrl` output from the CloudFront distribution.

### Web Chat Features

- Real-time WebSocket communication with the OHERO AI assistant
- Simple, responsive web interface
- Automatic reconnection with exponential backoff
- Message history and connection status indicators
- No complex framework dependencies (vanilla TypeScript + CSS)

## Onboard a tenant team
Log in AWS console (worker account), find the 'TeamManagementTable' in DynamoDB console, create a record with PK = app01, and a string attribute 'SlackChannelId' = the slack channel id for the sample tenant account

## Testing the solution
### Method 1 - Using AWS CLI
Synchronize the 'AskAwsKnowledgeBase' knowledge base data source to use the latest documentation - using the [AWS Management Console](https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/knowledge-bases) after the solution is deployed (make sure the right region is selected). This step is to make sure the knowledge base is populated with the documentation that the OpsAgent needs to answer relevant questions.
Then run below AWS CLIcommand:
```shell
aws events put-events --entries file://test-events/mockup-ops-event.json
aws events put-events --entries file://test-events/mockup-ops-event2.json
aws events put-events --entries file://test-events/mockup-sec-finding.json
```
You will receive Slack messages notifying you about the mockup event and then followed by automatic feedbacks by the AI assistant after a few seconds. You do NOT need to click the “Accept” or “Discharge” buttons included in the message, these buttons are only useful when AI assistant failed to acknowledge the event, they are used as a fallback mechanism for human user to intervene.

### Method 2 - Using AWS Console
Go to EventBridge console in your chosen admin account, ensure you are in the right region, go to 'Event buses' and fire off the below test event that mimic a real Health event. You should receive Slack messages for notification and approval request emails. Then start chatting with your assistant about the test events.
Test event 1 (a lifecycle event)
```json
{
    "eventArn": "arn:aws:health:ap-southeast-2::event/EKS/AWS_EKS_PLANNED_LIFECYCLE_EVENT/Example1",
    "service": "EKS",
    "eventTypeCode": "AWS_EKS_PLANNED_LIFECYCLE_EVENT",
    "eventTypeCategory": "plannedChange",
    "eventScopeCode": "ACCOUNT_SPECIFIC",
    "communicationId": "1234567890abcdef023456789-1",
    "startTime": "Wed, 31 Jan 2024 02:00:00 GMT",
    "endTime": "",
    "lastUpdatedTime": "Wed, 29 Nov 2023 08:20:00 GMT",
    "statusCode": "upcoming",
    "eventRegion": "ap-southeast-2",
    "eventDescription": [
        {
            "language": "en_US",
            "latestDescription": "Amazon EKS has deprecated Kubernetes version 1.2x..."
        }
    ],
    "eventMetadata": {
        "deprecated_versions": "Kubernetes 1.2x in EKS"
    },
    "affectedEntities": [
        {
            "entityValue": "arn:aws:eks:ap-southeast-2:111122223333:cluster/example1",
            "lastupdatedTime": "Wed, 29 Nov 2023 08:20:00 GMT",
            "statusCode": "RESOLVED"
        },
        {
            "entityValue": "arn:aws:eks:ap-southeast-2:111122223333:cluster/example3",
            "lastupdatedTime": "Wed, 29 Nov 2023 08:20:31 GMT",
            "statusCode": "PENDING"
        }
    ],
    "affectedAccount": "111122223333",
    "page": "1",
    "totalPages": "1"
}
```

Test event 2 (an Ops issue event)
```json
{
    "eventArn": "arn:aws:health:global::event/IAM/AWS_IAM_OPERATIONAL_ISSUE/AWS_FAKE_OPERATIONAL_ISSUE_12345_ABCDEFGHIJK",
        "service": "FAKE",
        "eventTypeCode": "AWS_FAKE_OPERATIONAL_ISSUE",
        "eventTypeCategory": "issue",
        "eventScopeCode": "PUBLIC",
        "communicationId": "a76afee0829c473703943fe5e2edd04cb91c6051-1",
        "startTime": "Thu, 22 Feb 2024 01:49:40 GMT",
        "endTime": "Thu, 22 Feb 2024 03:11:08 GMT",
        "lastUpdatedTime": "Thu, 22 Feb 2024 19:39:38 GMT",
        "statusCode": "closed",
        "eventRegion": "global",
        "eventDescription": [
            {
                "language": "en_US",
                "latestDescription": "A test operational issue that is happening to your account."
            }
        ],
        "affectedAccount": "444333222111",
        "page": "1",
        "totalPages": "1"
}
```

## Cleanup
Run the following command in the CDK project directory:
```shell
cdk destroy --all
```


