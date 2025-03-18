#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as dotenv from "dotenv";
import * as path from "path";

import { StatefulStack } from '../lib/stateful';
import { OrgAdminOrgStack } from '../lib/org-admin-stack';
import { OpsHealthAgentStack } from '../lib/agent-ops-health-stack';
import { DataSourcingStack } from '../lib/data-sourcing-stack';
import { OpsOrchestrationStack } from '../lib/ops-orchestration-stack';

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = new cdk.App();

const healthEventDomains = [
  'aws.health',
  'aiops.health', //custom prefixed event source for mockup test events
]

const sechubEventDomains = [
  'aws.securityhub',
  'aiops.securityhub', //custom prefixed event source for mockup test events
]
const taEventDomains = [
  'aws.trustedadvisor',
  'aiops.trustedadvisor', //custom prefixed event source for mockup test events
]

const sourceEventDomains = [
  ...healthEventDomains,
  // ...sechubEventDomains, //uncomment if Security Hub is enabled
  //...taEventDomains, //uncomment if Trusted Advisor is implemented
]

const eventRegions = (process.env.EVENT_REGIONS as string).split(',')

const appEventDomainPrefix = 'com.app.aiops'

const scopedAccountIds = process.env.CDK_PROCESSING_ACCOUNT as string === process.env.CDK_ADMIN_ACCOUNT as string? [process.env.CDK_PROCESSING_ACCOUNT as string] : [process.env.CDK_PROCESSING_ACCOUNT as string, process.env.CDK_ADMIN_ACCOUNT as string]

const statefulStack = new StatefulStack(app, 'AiOpsStatefulStack', {
  stackName: `AiOpsStatefulStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'AiOpsStatefulStack',
    "auto-delete": "no"
  },
  env: {
    account: process.env.CDK_PROCESSING_ACCOUNT,
    region: process.env.CDK_PROCESSING_REGION,
  },
  scopedAccountIds: scopedAccountIds,
});

/* ------  Admin account setup, make sure you cover all regions your organization has footprint in */
for (const region of eventRegions) {
  new OrgAdminOrgStack(app, `AiOpsOrgAdminStack-${region}`, {
    stackName: `AiOpsOrgAdminStack-${region}`,
    tags: {
      env: 'prod',
      "ManagedBy": `AiOpsOrgAdminStack-${region}`,
      "auto-delete": "no"
    },
    env: {
      account: process.env.CDK_ADMIN_ACCOUNT,
      region: region,
    },
    aiOpsEventBusArn: process.env.EVENT_HUB_ARN as string,
    sourceEventDomains: sourceEventDomains,
    secHubBucketName: `aws-sec-findings-${statefulStack.account}-${statefulStack.region}`
  });
}
/********************************************************************** */

const dataSourcingStack = new DataSourcingStack(app, 'AiOpsDataSourcingStack', {
  stackName: `AiOpsDataSourcingStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'AiOpsDataSourcingStack',
    "auto-delete": "no"
  },
  env: {
    account: process.env.CDK_PROCESSING_ACCOUNT,
    region: process.env.CDK_PROCESSING_REGION,
  },
  opsHealthBucketName: statefulStack.opsHealthBucket.bucketName,
  taFindingsBucketName: statefulStack.taFindingsBucket.bucketName,
  secFindingsBucketName: statefulStack.secFindingsBucket.bucketName,
  healthEventDomains: healthEventDomains,
  sechubEventDomains: sechubEventDomains,
  targetS3Region: cdk.Stack.of(statefulStack).region,
  aiOpsEventBus: statefulStack.aiOpsEventBus
});

const opsOrchestrationStack = new OpsOrchestrationStack(app, 'AiOpsOrchestrationStack', {
  stackName: `AiOpsOrchestrationStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'AiOpsOrchestrationStack',
    "auto-delete": "no"
  },
  env: {
    account: process.env.CDK_PROCESSING_ACCOUNT,
    region: process.env.CDK_PROCESSING_REGION,
  },
  slackChannelId: process.env.SLACK_CHANNEL_ID as string,
  slackAppVerificationToken: process.env.SLACK_APP_VERIFICATION_TOKEN as string,
  slackAccessToken: process.env.SLACK_ACCESS_TOKEN as string,
  eventManagementTableName: statefulStack.eventManagementTable.tableName,
  transientPayloadsBucketName: statefulStack.transientPayloadsBucket.bucketName,
  aiOpsEventBus: statefulStack.aiOpsEventBus,
  healthEventDomains: healthEventDomains,
  sechubEventDomains: sechubEventDomains,
  appEventDomainPrefix: appEventDomainPrefix
});

const opsHealthAgentStack = new OpsHealthAgentStack(app, 'AiOpsHealthAgentStack', {
  stackName: `AiOpsHealthAgentStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'AiOpsHealthAgentStack',
    "auto-delete": "no"

  },
  env: {
    account: process.env.CDK_PROCESSING_ACCOUNT,
    region: process.env.CDK_PROCESSING_REGION,
  },
  opsHealthBucketName: statefulStack.opsHealthBucket.bucketName,
  opsSecHubBucketName: statefulStack.secFindingsBucket.bucketName,
  transientPayloadsBucketName: statefulStack.transientPayloadsBucket.bucketName,
  slackChannelId: process.env.SLACK_CHANNEL_ID as string,
  slackAccessToken: process.env.SLACK_ACCESS_TOKEN as string,
  eventManagementTableName: statefulStack.eventManagementTable.tableName,
  ticketManagementTableName: statefulStack.ticketManagementTable.tableName,
  aiOpsEventBus: statefulStack.aiOpsEventBus,
  sourceEventDomains: sourceEventDomains,
  appEventDomainPrefix: appEventDomainPrefix,
  slackMeFunction: opsOrchestrationStack.slackMeFunction,
  guardrailArn: statefulStack.bedrockGuardrail.attrGuardrailArn,
  mockupSlackChannelId: process.env.MOCKUP_SLACK_CHANNEL_ID as string
});

