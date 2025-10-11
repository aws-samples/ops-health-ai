## Deployment Options

### Option 1: Minimal Core (Manual Operations)
Deploy only the essential services for manual event triage:
- Stateful Storage Service
- Multi-Account Event Collection Service  
- Ops Orchestration Service
- One notification channel (Slack OR Web Chat)

### Option 2: AI-Enhanced (Headless Mode)
Add AI capabilities that run without user interfaces:
- All core services +
- AI Service (processes events automatically)
- Knowledge Base Management Service

### Option 3: Full Interactive System (Recommended)
Complete system with user interfaces:
- All previous services +
- Slack Chat Service or Web Chat Service
- Event Lake Service (for analytics)

## Prerequisites

### Required
- **AWS Accounts**: At least 1 AWS account with appropriate permissions. Supports both single-account and multi-account (admin + worker) setups
- **AWS CDK**: Installed in your development environment for infrastructure deployment
- **AWS SAM & Docker**: Required for building Lambda function packages

### Optional (Based on Deployment Choice)
- **AWS Health Organization View**: Enable if managing events across your entire AWS Organization
- **AWS Security Hub**: Enable for security findings processing (optional for single account, recommended for organizations)
- **Slack App**: With appropriate workspace permissions. Required only if choosing Slack as notification channel
- **Web Chat**: No additional setup required - good for trial use without needing Slack 

## Quick Start

### Choose User Interface
The solution comes with integration with Slack as its default user interface. For users who don't have a Slack environment with required workspace permissions, the solution also provides a web chat UI option that mimics the instant messaging experience for trial/demo usage.

There are no actions required for this step if you opt for web chat.

Steps If opt for using Slack
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
# Make sure your terminal session environment is configured to access the worker workload
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
```
### Build serverless packages
NOTE: Depending on your build environment, you might want o change the arch type to 'x86' or 'arm' in the global parameter section of `lambda/src/template.yaml` file before sam build command
```zsh
cd ops-health-ai
npm install
cd lambda/src
sam build --use-container
cd ../..
```

### Configure Environment
Create a `.env` file in the project root:
```bash
CDK_ADMIN_ACCOUNT=<your-admin-account-id>
CDK_PROCESSING_ACCOUNT=<your-worker-account-id>
CDK_PROCESSING_REGION=<worker-service-region>
EVENT_REGIONS=us-east-1,<additional-regions>
EVENT_HUB_ARN=arn:aws:events:<worker-service-region>:<worker-service-account>:event-bus/OheroStatefulStackOheroEventBus

# Opt for 'webchat' after 1st time deployment if choose to use Web Chat 
NOTIFICATION_CHANNEL=slack

# Required only if using Slack, otherwise leave as is
SLACK_CHANNEL_ID=<your admin (operations team) Slack channel ID here>
SLACK_APP_VERIFICATION_TOKEN=<your-slack-verification-token>
SLACK_ACCESS_TOKEN=<your-slack-bot-token>

# Optional for web chat, values to be obtained from CloudFormation stack output after 1st time deployment
WEB_CHAT_API_KEY=<your-api-key>
TEAM_MANAGEMENT_TABLE=<your team management table name>
WEB_SOCKET_URL=wss://<your end point url>
```

### Deploy
```bash
# In project root directory, run the following commend:
cdk deploy --all --require-approval never
```

### Configure Deployment for UI
**If you chose to use Slack** and have completed the steps required in "Choose User Interface" section, complete the following steps:

1. Get the “HandleSlackCommApiUrl” output URL from CDK command output or CloudFormation console (OheroOrchestrationStack) output.
2. Go to your [Slack app](https://api.slack.com/apps) created in previous steps, go to Event Subscriptions, Request URL Change, then update the URL value with the stack output URL and save.

**If you chose to use web chat**, complete the following steps.
1. Edit .env file and set NOTIFICATION_CHANNEL=webchat
2. Update WEB_CHAT_API_KEY in .env file with your own choice of key
3. Get the “TeamManagementTableName” from CDK command output or CloudFormation console (OheroStatefulStack) output and update the value for "TEAM_MANAGEMENT_TABLE" in .env file.
4. Get the “WebSocketApiUrl” from CDK command output or CloudFormation console (OheroStatefulStack) output and update the value for "WEB_SOCKET_URL" in .env file.
5. Run the deployment command again, this will deploy the additional components and settings needed to serve web chat client.
```bash
# In project root directory, run the following commend:
cdk deploy --all --require-approval never
```
6. Test web chat client using a modern browser by visiting the "WebsiteUrl" url from CDK command output or CloudFormation console (OheroWebFrontendStack) output

## Onboard a tenant team
Log in AWS console (worker account), find the 'TeamManagementTable' in DynamoDB console, create a record with PK = app01, a string attribute 'ChannelName' = your preferred name, and a string attribute 'SlackChannelId' = the slack channel id for the sample tenant team (or a random id if using web chat)

You can also use the following CLI command example to batch add new teams:
```shell
aws dynamodb batch-write-item \
    --request-items '{
        "<replace here with your TeamManagementTable name>": [
            {
                "PutRequest": {
                    "Item": {
                        "PK": {"S": "app01"},
                        "SlackChannelId": {"S": "AAAAAAAAAA"},
                        "ChannelName": {"S": "App Team"}
                    }
                }
            },
            {
                "PutRequest": {
                    "Item": {
                        "PK": {"S": "fin01"},
                        "SlackChannelId": {"S": "BBBBBBBBBBB"},
                        "ChannelName": {"S": "FinOps Team"}
                    }
                }
            },
            {
                "PutRequest": {
                    "Item": {
                        "PK": {"S": "inf01"},
                        "SlackChannelId": {"S": "CCCCCCCCCCC"},
                        "ChannelName": {"S": "COE Team"}
                    }
                }
            },
            {
                "PutRequest": {
                    "Item": {
                        "PK": {"S": "sec01"},
                        "SlackChannelId": {"S": "DDDDDDDDDDD"},
                        "ChannelName": {"S": "SecOps Team"}
                    }
                }
            }
        ]
    }' --region us-east-1
```

**Note**, if you are using web chat, make sure you refresh the channel list on the UI after changes to the TeamManagementTable.

## Testing the solution
### Method 1 - Using AWS CLI

```shell
aws events put-events --entries file://test-events/mockup-ops-event.json
aws events put-events --entries file://test-events/mockup-ops-event2.json
aws events put-events --entries file://test-events/mockup-sec-finding.json
```
You will receive Slack/Webchat messages notifying you about the mockup event and then followed by automatic feedbacks by the AI assistant after a few seconds. You do NOT need to click the “Accept” or “Discharge” button at the bottom of the message, they are only useful when AI assistant failed to acknowledge the event and needed a fallback mechanism for human intervention.

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