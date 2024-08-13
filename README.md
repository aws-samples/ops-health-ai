# Managing cloud operational events at scale by AI

- The solution uses AWS Health and AWS Security Hub findings as sources of operational events to demonstrate the workflow. It can be extended to incorporate additional types of operational events, whether from AWS or non-AWS sources, by following an event-driven architecture (EDA) approach.
- The solution is designed to be fully serverless on AWS and can be deployed using AWS CDK (Cloud Development Kit) as an Infrastructure as Code (IaC).
- Slack is used as the primary user interface but can be implemented in similar fashion by other messaging tools such as Mcrosoft TEAMS.
- Cost of running/hosting the solution depends on the actual consumption of queries and the size of vector store, Kendra document libraries, please consult [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/), [AWS OpenSearch pricing](https://aws.amazon.com/opensearch-service/pricing/#Amazon_OpenSearch_Serverless) and [Amazon Kendra pricing](https://aws.amazon.com/kendra/pricing/) for pricing details. 

## Highlights of what is contained
- Event processing layer - This microservice manages notifications, acknowledgments, and triage of actions. Its main logic is controlled by two key workflows implemented using AWS Step Functions.
- AI Layer - The microservice that handles the interactions between AWS Bedrock agents, knowledge bases, and user interface (Slack chat).
- Archive and reporting layer - This microservice handles streaming, storing, and ETL (extracting, transforming, and loading) operational event data. It also prepares a data lake for business intelligence dashboards and reporting analysis. This repo does not include an actual dashboard implementation but lays the groundwork by preparing an operational event data lake for further development.

## Prerequisites
- At least 1 AWS account with appropriate permissions. The project uses a typical setup of 2 accounts whereas 1 is the organization health administration account and the other is the worker account hosting backend microservices. The worker account can be the same as the administration account if single account setup is chosen. 
- Enable AWS Health Organization view and delegate an administrator account in your AWS management account if you want to manage AWS Health events across your entire AWS Organization. This is optional if you only need to handle events from a single account.
- Enable AWS Security Hub in your AWS management account. Optionally, enable security Hub with Organizations integration  if you want to monitor security findings for the entire organization instead of just a single account.,
- Configure a Slack app and set up a channel with appropriate permissions and event subscriptions to send/receive messages to/from backend microservices.
- AWS CDK installed in your development environment for stack deployment
- AWS SAM (Serverless Application Model) and Docker installed in your development environment to build Lambda packages
  
## Screenshots of Usage
### Automated event notification, autonomous event acknowledgement and action triage by a virtual supervisor/operator that follows MyCompany policies. The virtual operator is equipped with multiple AI capabilities, each of which is specialized in a knowledge domain to assist, such as generating recommended actions, taking actions to create issue tickets in ITSM tools.
<img src="./screenshots/screenshot1.png"
  alt="Usage scrrenshot1 by seanxw">
</p>

### The virtual event supervisor/operator filters out 'noise' based on MyCompany's policies.
<img src="./screenshots/screenshot2.png"
  alt="Usage screenshot2 by seanxw">
</p>

### AI can identify the issue tickets related to an AWS Health event and provide the latest status updates on those tickets.
<img src="./screenshots/screenshot3.png"
  alt="Usage screenshot3 by seanxw">
</p>

### An illustration of how the assistant can provide valuable insights from complex thread of operational events.
<img src="./screenshots/screenshot4.png"
  alt="Usage screenshot4 by seanxw">
</p>

### A more sophisticated use case
<img src="./screenshots/screenshot5.png"
  alt="Usage screenshot5 by seanxw">
</p>

## Architecture
<p align="left">
<img src="./architecture.png"
  alt="Archetectural diagram by seanxw">
</p>

## Deployment steps
### Create a Slack app and set up a channel
1. Create a [Slack app](https://api.slack.com/apps) from the manifest template - copy/paste the content of “slack-app-manifest.json” file included in this repository.
2. Install your app into your workspace, take note of the “Bot User OAuth Token” value to be used in next steps.
3. Take note of the “Verification Token” value under your app’s Basic Information, you will need it in next steps.
4. In your Slack desktop app, go to your workspace and add the newly created app.
5. Create a Slack channel and add the newly created app as an integrated app to the channel.
6. Find and take note of the channel id by right-clicking on the channel name and selecting ‘Additional options’ to access the ‘More’ menu. Within the ‘More’ menu, click on ‘Open details’ to reveal the Channel details.

### Copy repo to your local directory
```zsh
git clone https://github.com/aws-samples/ops-health-ai.git
cd ops-health-ai
npm install
cdk bootstrap aws://<your admin AWS account id>/<region where you Organization is> aws://<your worker AWS account id>/<region where your worker services to be>
cd lambda/src
# Depending on your build environment, you might want o change the arch type to x84 or arm in lambda/src/template.yaml file before build 
sam build --use-container
cd ../..
```
### Create an '.env' file under project root directory that contains the following
```zsh
CDK_ADMIN_ACCOUNT=<replace with your 12 digits admin AWS account id>
CDK_PROCESSING_ACCOUNT=<replace with your 12 digits worker AWS account id. This account id is the same as the admin account id if using single account setup>
CDK_ADMIN_REGION=<replace with the region where your Organization is, e.g. us-east-1>
CDK_PROCESSING_REGION=<replace with the region where you want the worker services to be, e.g. us-east-1>
EVENT_HUB_ARN=arn:aws:events:<replace with your region>:<replace with the worker service region>:event-bus/AiOpsStatefulStackAiOpsEventBus
SLACK_CHANNEL_ID=<your Slack channel ID here>
SLACK_APP_VERIFICATION_TOKEN=<replace with your Slack app verification token>
SLACK_ACCESS_TOKEN=<replace with your Slack Bot User OAuth Token value>
```
### Deploy by CDK
Deploy processing microservice to your worker account, the worker account can be the same as your admin account.
In project root directory, run the following commend:
```zsh
cdk deploy --all --require-approval never
```
Capture the “HandleSlackCommApiUrl” stack output URL, go to your [Slack app](https://api.slack.com/apps) created in previous steps, go to Event Subscriptions, Request URL Change, then update the URL value with the stack output URL and save.

## Testing the solution
### Method 1 - Using AWS CLI
Run below AWS CLIcommand:
```shell
aws events put-events --entries file://test-events/mockup-events.json
```
You will receive Slack messages notifying you about the mockup event and then followed by automatic feedbacks by the AI assistant. You do NOT need to click the “Accept” or “Discharge” buttons.

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
Empty all 3 S3 buckets created by the solution stack, and then run in the project directory the following command:
```shell
cdk destroy --all
```


