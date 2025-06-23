#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as dotenv from "dotenv";
import * as path from "path";

import { StatefulStack } from '../lib/stateful';
import { OrgAdminOrgStack } from '../lib/org-admin-stack';
import { OpsHealthAgentStack } from '../lib/agent-ops-health-stack';
import { OpsOrchestrationStack } from '../lib/ops-orchestration-stack';
import { OpsEventLakeStack } from '../lib/ops-event-lake-stack';

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = new cdk.App();

const healthEventDomains = [
  'aws.health',
  'ohero.health', //custom prefixed event source for mockup test events
]

const sechubEventDomains = [
  'aws.securityhub',
  'ohero.securityhub', //custom prefixed event source for mockup test events
]

const sourceEventDomains = [
  ...healthEventDomains,
  // ...sechubEventDomains,
  //...taEventDomains,
]

const eventRegions = (process.env.EVENT_REGIONS as string).split(',')

const appEventDomainPrefix = 'com.app.ohero'

const scopedAccountIds = process.env.CDK_PROCESSING_ACCOUNT as string === process.env.CDK_ADMIN_ACCOUNT as string? [process.env.CDK_PROCESSING_ACCOUNT as string] : [process.env.CDK_PROCESSING_ACCOUNT as string, process.env.CDK_ADMIN_ACCOUNT as string]

const statefulStack = new StatefulStack(app, 'OheroStatefulStack', {
  stackName: `OheroStatefulStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'OheroStatefulStack',
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
  new OrgAdminOrgStack(app, `OheroOrgAdminStack-${region}`, {
    stackName: `OheroOrgAdminStack-${region}`,
    tags: {
      env: 'prod',
      "ManagedBy": `OheroOrgAdminStack-${region}`,
      "auto-delete": "no"
    },
    env: {
      account: process.env.CDK_ADMIN_ACCOUNT,
      region: region,
    },
    oheroEventBusArn: process.env.EVENT_HUB_ARN as string,
    sourceEventDomains: sourceEventDomains,
    secHubBucketName: `aws-sec-findings-${statefulStack.account}-${statefulStack.region}`
  });
}
/********************************************************************** */

const opsOrchestrationStack = new OpsOrchestrationStack(app, 'OheroOrchestrationStack', {
  stackName: `OheroOrchestrationStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'OheroOrchestrationStack',
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
  oheroEventBus: statefulStack.oheroEventBus,
  healthEventDomains: healthEventDomains,
  sechubEventDomains: sechubEventDomains,
  appEventDomainPrefix: appEventDomainPrefix
});

const opsEventLakeStack = new OpsEventLakeStack(app, 'OheroEventLakeStack', {
  stackName: `OheroEventLakeStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'OheroEventLakeStack',
    "auto-delete": "no"
  },
  env: {
    account: process.env.CDK_PROCESSING_ACCOUNT,
    region: process.env.CDK_PROCESSING_REGION,
  },
  opsEventBucketArn: statefulStack.opsEventLakeBucket.bucketArn,
  oheroEventBus: statefulStack.oheroEventBus,
  healthEventDomains: healthEventDomains,
  sechubEventDomains: sechubEventDomains
});

const opsHealthAgentStack = new OpsHealthAgentStack(app, 'OheroHealthAgentStack', {
  stackName: `OheroHealthAgentStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'OheroHealthAgentStack',
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
  oheroEventBus: statefulStack.oheroEventBus,
  sourceEventDomains: sourceEventDomains,
  appEventDomainPrefix: appEventDomainPrefix,
  slackMeFunction: opsOrchestrationStack.slackMeFunction,
  guardrailArn: statefulStack.bedrockGuardrail.attrGuardrailArn,
  teamManagementTableName: statefulStack.teamManagementTable.tableName,
});

