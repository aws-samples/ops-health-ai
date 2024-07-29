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
import { OpsEventLakeStack } from '../lib/ops-event-lake-stack';

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
  ...sechubEventDomains,
  //...taEventDomains,
]

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
/* ------  in the example 3 regions are monitored hence 3 times the stack deployment ------------- */
new OrgAdminOrgStack(app, 'OrgAdminOrgStackUsEast1', {
  stackName: `OrgAdminOrgStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'OrgAdminOrgStack',
    "auto-delete": "no"
  },
  env: {
    account: process.env.CDK_ADMIN_ACCOUNT,
    region: 'us-east-1',
  },
  aiOpsEventBusArn: process.env.EVENT_HUB_ARN as string,
  sourceEventDomains: sourceEventDomains
});

new OrgAdminOrgStack(app, 'OrgAdminOrgStackUsWest2', {
  stackName: `OrgAdminOrgStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'OrgAdminOrgStack',
    "auto-delete": "no"
  },
  env: {
    account: process.env.CDK_ADMIN_ACCOUNT,
    region: 'us-west-2',
  },
  aiOpsEventBusArn: process.env.EVENT_HUB_ARN as string,
  sourceEventDomains: sourceEventDomains
});

new OrgAdminOrgStack(app, 'OrgAdminOrgStackApSoutheast2', {
  stackName: `OrgAdminOrgStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'OrgAdminOrgStack',
    "auto-delete": "no"
  },
  env: {
    account: process.env.CDK_ADMIN_ACCOUNT,
    region: 'ap-southeast-2',
  },
  aiOpsEventBusArn: process.env.EVENT_HUB_ARN as string,
  sourceEventDomains: sourceEventDomains
});
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

const opsOrchestrationStack = new OpsOrchestrationStack(app, 'OpsOrchestrationStack', {
  stackName: `OpsOrchestrationStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'HealthProcessingStack',
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
  aiOpsEventBus: statefulStack.aiOpsEventBus,
  healthEventDomains: healthEventDomains,
  sechubEventDomains: sechubEventDomains,
  appEventDomainPrefix: appEventDomainPrefix
});

const opsEventLakeStack = new OpsEventLakeStack(app, 'OpsEventLakeStack', {
  stackName: `OpsEventLakeStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'HealthProcessingStack',
    "auto-delete": "no"
  },
  env: {
    account: process.env.CDK_PROCESSING_ACCOUNT,
    region: process.env.CDK_PROCESSING_REGION,
  },
  opsEventBucketArn: statefulStack.opsEventLakeBucket.bucketArn,
  aiOpsEventBus: statefulStack.aiOpsEventBus,
  healthEventDomains: healthEventDomains,
  sechubEventDomains: sechubEventDomains
});

const opsHealthAgentStack = new OpsHealthAgentStack(app, 'OpsHealthAgentStack', {
  stackName: `OpsHealthAgentStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'OpsHealthAgentStack',
    "auto-delete": "no"

  },
  env: {
    account: process.env.CDK_PROCESSING_ACCOUNT,
    region: process.env.CDK_PROCESSING_REGION,
  },
  opsHealthBucketName: statefulStack.opsHealthBucket.bucketName,
  opsSecHubBucketName: statefulStack.secFindingsBucket.bucketName,
  slackChannelId: process.env.SLACK_CHANNEL_ID as string,
  slackAccessToken: process.env.SLACK_ACCESS_TOKEN as string,
  eventManagementTableName: statefulStack.eventManagementTable.tableName,
  ticketManagementTableName: statefulStack.ticketManagementTable.tableName,
  aiOpsEventBus: statefulStack.aiOpsEventBus,
  sourceEventDomains: sourceEventDomains,
  appEventDomainPrefix: appEventDomainPrefix,
  slackMeFunction: opsOrchestrationStack.slackMeFunction
});

