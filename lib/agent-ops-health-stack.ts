import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as evtTargets from "aws-cdk-lib/aws-events-targets";
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from "aws-cdk-lib/aws-events";
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { Construct } from 'constructs';
import * as fs from 'fs';

import * as path from "path";

export interface OpsHealthAgentProps extends cdk.StackProps {
  opsHealthBucketName: string,
  opsSecHubBucketName: string,
  transientPayloadsBucketName: string,
  slackChannelId: string
  slackAccessToken: string
  eventManagementTableName: string
  ticketManagementTableName: string
  aiOpsEventBus: events.IEventBus
  sourceEventDomains: string[]
  appEventDomainPrefix: string
  slackMeFunction: lambda.IFunction
  guardrailArn: string
  mockupSlackChannelId: string
}

export class OpsHealthAgentStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: OpsHealthAgentProps) {
    super(scope, id, props);

    /******************* DynamoDB Table to manage user chat sessions with the agent *****************/
    const chatUserSessionsTable = new dynamodb.Table(this, 'ChatUserSessionsTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
        recoveryPeriodInDays: 35
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: "SK",
        type: dynamodb.AttributeType.STRING
      },
      timeToLiveAttribute: "expiresAt"
    });
    new cdk.CfnOutput(this, "ChatUserSessionsTableName", { value: chatUserSessionsTable.tableName })
    /*************************************************************************************** */

    const opsHealthBucket = s3.Bucket.fromBucketName(this, 'OpsHealthBucket', props.opsHealthBucketName);
    const opsSecHubBucket = s3.Bucket.fromBucketName(this, 'OpsSecHubBucket', props.opsSecHubBucketName);

    const opsHealthKnowledgeBase = new bedrock.VectorKnowledgeBase(this, 'OpsHealthKnowledgeBase', {
      name: 'OpsHealthKnowledgeBase',
      embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
      instruction: `Use this knowledge base for details about operational health events, issues, and lifecycle notifications.`,
    });

    const opsHealthDataSource = new bedrock.S3DataSource(this, 'OpsHealthDataSource', {
      bucket: opsHealthBucket,
      knowledgeBase: opsHealthKnowledgeBase,
      dataSourceName: 'ops-health',
      chunkingStrategy: bedrock.ChunkingStrategy.NONE,
      // chunkingStrategy: bedrock.ChunkingStrategy.fixedSize({
      //   maxTokens: 1000,
      //   overlapPercentage: 10,
      // })
    });

    const opsSecHubKnowledgeBase = new bedrock.VectorKnowledgeBase(this, 'OpsSecHubKnowledgeBase', {
      name: 'OpsSecHubKnowledgeBase',
      embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
      instruction: `Use this knowledge base for details about security findings, issues, risks, events.`,
    });

    const opsSecHubDataSource = new bedrock.S3DataSource(this, 'OpsSecHubDataSource', {
      bucket: opsSecHubBucket,
      knowledgeBase: opsSecHubKnowledgeBase,
      dataSourceName: 'ops-sechub',
      chunkingStrategy: bedrock.ChunkingStrategy.fixedSize({
        maxTokens: 1000,
        overlapPercentage: 10,
      })
    });

    const askAwsKnowledgeBase = new bedrock.VectorKnowledgeBase(this, 'AskAwsKnowledgeBase', {
      name: 'AskAwsKnowledgeBase',
      embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
      instruction: `Use this knowledge base for guidance and best practices from AWS.`,
    });

    const askAwsDataSource = new bedrock.WebCrawlerDataSource(this, 'AskAwsDataSource', {
      knowledgeBase: askAwsKnowledgeBase,
      dataSourceName: 'ask-aws',
      sourceUrls: ['https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html','https://docs.aws.amazon.com/securityhub/latest/userguide/what-is-securityhub.html','https://docs.aws.amazon.com/systems-manager/latest/userguide/what-is-systems-manager.html','https://docs.aws.amazon.com/systems-manager-automation-runbooks/latest/userguide/automation-runbook-reference.html','https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html'],
      crawlingScope: bedrock.CrawlingScope.DEFAULT,
      crawlingRate: 100,
      chunkingStrategy: bedrock.ChunkingStrategy.fixedSize({
        maxTokens: 1000,
        overlapPercentage: 10,
      })
    });

    const importedGuardrail = bedrock.Guardrail.fromGuardrailAttributes(this, 'TestGuardrail', {
      guardrailArn: props.guardrailArn
    });

    const healthBufferKbSyncSqs = new sqs.Queue(this, 'BufferHealthKbSyncSqs', {
      visibilityTimeout: cdk.Duration.seconds(300), //6 times the function timeout, plus the value of MaximumBatchingWindowInSeconds
    })
    const sechubBufferKbSyncSqs = new sqs.Queue(this, 'BufferSechubKbSyncSqs', {
      visibilityTimeout: cdk.Duration.seconds(300), //6 times the function timeout, plus the value of MaximumBatchingWindowInSeconds
    })

    const ingestKbFunction = new lambda.Function(this, 'IngestOpsKbFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/IngestOpsKbFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      environment: {
        HEALTH_KNOWLEDGE_BASE_ID: opsHealthKnowledgeBase.knowledgeBaseId,
        SECHUB_KNOWLEDGE_BASE_ID: opsSecHubKnowledgeBase.knowledgeBaseId,
        HEALTH_KB_DATA_SOURCE_ID: opsHealthDataSource.dataSourceId,
        SECHUB_KB_DATA_SOURCE_ID: opsSecHubDataSource.dataSourceId
      },
    });

    ingestKbFunction.addEventSource(new SqsEventSource(healthBufferKbSyncSqs, {
      batchSize: 100,
      maxBatchingWindow: cdk.Duration.minutes(3),
      reportBatchItemFailures: true
    }));
    ingestKbFunction.addEventSource(new SqsEventSource(sechubBufferKbSyncSqs, {
      batchSize: 1,
      maxBatchingWindow: cdk.Duration.minutes(3),
      reportBatchItemFailures: true
    }));

    const ingestKbLogGroup = new logs.LogGroup(this, 'IngestOpsKbLogGroup', {
      logGroupName: `/aws/lambda/${ingestKbFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ingestKbPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:StartIngestionJob"
      ],
      resources: [opsHealthKnowledgeBase.knowledgeBaseArn, opsSecHubKnowledgeBase.knowledgeBaseArn],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    ingestKbFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'ingest-ops-health-knowledge-base-policy', {
        statements: [ingestKbPolicy],
      }),
    );

    new events.Rule(this, `OpsKbFileArrivalRule`, {
      // from default event bus
      eventPattern: {
        source: [
          "aws.s3"
        ],
        detailType: [
          "Object Created",
          // "Object Deleted"
        ],
        detail: {
          bucket: {
            name: [
              props.opsHealthBucketName, props.opsSecHubBucketName
            ]
          }
        }
      },
      targets: [new evtTargets.SqsQueue(healthBufferKbSyncSqs), new evtTargets.SqsQueue(sechubBufferKbSyncSqs)]
    });

    // ===== Full agent functionalities =====
    const invokeAgentFunction = new lambda.Function(this, 'OpsAgentFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/OpsAgentFunction'),
      handler: 'app.lambda_handler',
      timeout: cdk.Duration.seconds(900), // long duration to accommodate throttling retries, make sure your AWS account and region has the appropriate quota for used LLMs
      memorySize: 256,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1, // Allowed concurrency set to 1 to accommodate LLM API throttling retries, make sure your AWS account and region has the appropriate API quota for used LLMs if faster processing speed needed.
      environment: {
        MEM_BUCKET: props.transientPayloadsBucketName,
        OPS_KNOWLEDGE_BASE_ID: opsHealthKnowledgeBase.knowledgeBaseId,
        SECHUB_KNOWLEDGE_BASE_ID: opsSecHubKnowledgeBase.knowledgeBaseId,
        AWS_KB_ID: askAwsKnowledgeBase.knowledgeBaseId,
        TICKET_TABLE: props.ticketManagementTableName,
        EVENT_SOURCE_NAME: `${props.appEventDomainPrefix}.ops-orchestration`,
        EVENT_BUS_NAME: props.aiOpsEventBus.eventBusName,
        MOCKUP_SLACK_CHANNEL_ID: props.mockupSlackChannelId,
        BEDROCK_GUARDRAIL_ID: importedGuardrail.guardrailId,
        BEDROCK_GUARDRAIL_VER: importedGuardrail.guardrailVersion
      },
    });
    // ============================

    const invokeAgentLogGroup = new logs.LogGroup(this, 'InvokeAgentLogGroup', {
      logGroupName: `/aws/lambda/${invokeAgentFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const invokeAgentPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeAgent",
        "bedrock:invokeModel",
        "bedrock:GetInferenceProfile",
        "bedrock:ListInferenceProfiles",
        "bedrock:Retrieve",
        "bedrock:RetrieveAndGenerate",
        "dynamodb:*",
        "states:SendTaskFailure",
        "states:SendTaskSuccess",
        "events:PutEvents",
        "s3:ListBucket",
        "s3:GetObject",
        "s3:GetBucketLocation",
        "s3:ListMultipartUploadParts",
        "s3:PutObject",
      ],
      resources: ['*'],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    invokeAgentFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'invoke-agent-policy', {
        statements: [invokeAgentPolicy],
      }),
    );

    /*** Role to be used by event processing and integration state machines ************/
    const eventAiProcessingRole = new iam.Role(this, 'EventAiProcessingRole', {
      roleName: 'EventAiProcessingRole',
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: 'IAM role to be assumed by AI agent for event processing state machines',
    });
    eventAiProcessingRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'));
    eventAiProcessingRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess'));
    eventAiProcessingRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'));
    //without KMS permissions, startInstance call would not work if instance volume is encrypted by key
    eventAiProcessingRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "kms:CreateGrant",
        "states:InvokeHTTPEndpoint",
        "events:RetrieveConnectionCredentials",
        "events:PutEvents",
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      resources: ['*']
    }));
    /******************************************************************************* */

    /*** State machine for AI agent integration microservices *****/
    const aiIntegrationSfnLogGroup = new logs.LogGroup(this, 'AiIntegrationSfnLogs', {
      logGroupName: `/aws/vendedlogs/states/AiIntegrationSfnLogs`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const aiIntegrationSfn = new sfn.StateMachine(this, 'AiAgentIntegration', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/ai-integration.asl')).toString().trim()),
      definitionSubstitutions: {
        "InvokeBedRockAgentFunctionNamePlaceholder": invokeAgentFunction.functionName,
        "EventManagementTablePlaceHolder": props.eventManagementTableName,
        "SlackMeFunctionNamePlaceholder": props.slackMeFunction.functionName
      },
      tracingEnabled: false,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      role: eventAiProcessingRole,
      logs: {
        destination: aiIntegrationSfnLogGroup,
        level: sfn.LogLevel.ERROR,
        includeExecutionData: true,
      }
    });

    const integrationRule = new events.Rule(this, 'OpsIntegrationWithAiRule', {
      eventBus: props.aiOpsEventBus,
      eventPattern: {
        source: [`${props.appEventDomainPrefix}.ops-orchestration`],
        detailType: [`Health.EventAdded`, `Health.EventUpdated`, `SecHub.EventAdded`]
      },
      ruleName: 'OpsIntegrationWithAiRule',
      description: 'Ops event processing integration with AI services.',
      targets: [new evtTargets.SfnStateMachine(aiIntegrationSfn)]
    });
    /******************************************************************************* */

    /*** Role to be used by Bedrock chat integration state machines ************/
    const aiOpsChatRole = new iam.Role(this, 'AiOpsChatRole', {
      roleName: 'AiOpsChatRole',
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: 'IAM role to be assumed by Bedrock chat integration state machines',
    });
    aiOpsChatRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'));
    aiOpsChatRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess'));
    aiOpsChatRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'));
    aiOpsChatRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "bedrock:RetrieveAndGenerate",
        "bedrock:Retrieve",
        "bedrock:InvokeModel",
        "states:InvokeHTTPEndpoint",
        "events:RetrieveConnectionCredentials",
        "events:PutEvents",
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret",
        "SNS:Publish"
      ],
      resources: ['*']
    }));
    /******************************************************************************* */

    /*** State machine for slack command event integration microservices *****/
    const aiOpsChatSfnLogGroup = new logs.LogGroup(this, 'AiOpsChatSfnLogs', {
      logGroupName: `/aws/vendedlogs/states/AiOpsChatSfnLogs`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const aiOpsChatSfn = new sfn.StateMachine(this, 'AiOpsChatIntegration', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/ai-chat.asl')).toString().trim()),
      definitionSubstitutions: {
        "OpsHealthKnowledgeBaseIdPlaceHolder": opsHealthKnowledgeBase.knowledgeBaseId,
        "InvokeBedRockAgentFunctionNamePlaceholder": invokeAgentFunction.functionName,
        "SlackMeFunctionNamePlaceholder": props.slackMeFunction.functionName,
        "SlackChannelIdPlaceholder": props.slackChannelId,
        "ChatUserSessionsTableNamePlaceholder": chatUserSessionsTable.tableName,
        "LlmModelArnPlaceholder": `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
      },
      tracingEnabled: false,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      role: aiOpsChatRole,
      logs: {
        destination: aiOpsChatSfnLogGroup,
        level: sfn.LogLevel.ERROR,
        includeExecutionData: true,
      }
    });

    const aiOpsChatRule = new events.Rule(this, 'AiOpsChatRule', {
      eventBus: props.aiOpsEventBus,
      eventPattern: {
        source: [`${props.appEventDomainPrefix}.ops-orchestration`],
        detailType: [`Chat.SlackMessageReceived`, `Chat.SendSlackRequested`]
      },
      ruleName: 'AiOpsChatRule',
      description: 'Command event processing integration with external services.',
      targets: [new evtTargets.SfnStateMachine(aiOpsChatSfn)]
    });
    /******************************************************************************* */

  }
}