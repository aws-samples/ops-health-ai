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
import * as kendra from 'aws-cdk-lib/aws-kendra';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { Construct } from 'constructs';
import * as fs from 'fs';

import * as path from "path";

export interface OpsHealthAgentProps extends cdk.StackProps {
  // scopedAccountIds: string[],
  opsHealthBucketName: string,
  opsSecHubBucketName: string,
  slackChannelId: string
  slackAccessToken: string
  eventManagementTableName: string
  ticketManagementTableName: string
  aiOpsEventBus: events.IEventBus
  sourceEventDomains: string[]
  appEventDomainPrefix: string
  slackMeFunction: lambda.IFunction
}

export class OpsHealthAgentStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: OpsHealthAgentProps) {
    super(scope, id, props);

    // let listOfAcctPrincipals = props.scopedAccountIds.map(id => new iam.AccountPrincipal(id));

    /******************* DynamoDB Table to manage user chat sessions *****************/
    const chatUserSessionsTable = new dynamodb.Table(this, 'ChatUserSessionsTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // tableName: 'ChatUserSessionsTable',
      // billingMode: dynamodb.BillingMode.PROVISIONED,
      // readCapacity: 1,
      // writeCapacity: 1,
      pointInTimeRecovery: true,
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

    /*** Kendra doc store*************** */
    const indexRole = new cdk.aws_iam.Role(
      this,
      'kendraIndexRole',
      {
        description: 'Role that Kendra uses to push logging and metrics to Amazon Cloudwatch',
        assumedBy: new cdk.aws_iam.ServicePrincipal('kendra.amazonaws.com'),
      },
    );

    indexRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'Kendra',
          },
        },
      }),
    );

    indexRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['logs:DescribeLogGroups'],
        resources: ['*'],
      }),
    );
    indexRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['logs:CreateLogGroup'],
        resources: [`arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/kendra/*`],
      }),
    );
    indexRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          'logs:DescribeLogStreams',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [`arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/kendra/*:log-stream:*`],
      }),
    )
    const cfnIndex = new kendra.CfnIndex(this, 'AiOpsIndex', {
      edition: 'ENTERPRISE_EDITION', //DEVELOPER_EDITION | ENTERPRISE_EDITION
      name: `${cdk.Stack.of(this).stackName}-kendraIndex`,
      roleArn: indexRole.roleArn,
      userContextPolicy: 'ATTRIBUTE_FILTER', //ATTRIBUTE_FILTER | USER_TOKEN
      // userTokenConfigurations: [{
      //   jwtTokenTypeConfiguration: {
      //     keyLocation: 'URL',
      //     url: `https://cognito-idp.${awsRegion}.amazonaws.com/${this.props.CognitoUserPoolId}/.well-known/jwks.json`,
      //     groupAttributeField: 'cognito:groups',
      //     userNameAttributeField: 'cognito:username',
      //   },
      // }],
    });
    cdk.Tags.of(cfnIndex).add('auto-delete', 'no');

    const kendraS3AccessRole = new cdk.aws_iam.Role(
      this,
      'kendraS3AccessRole',
      {
        description: 'Role that Kendra uses to access documents in S3 bucket',
        assumedBy: new cdk.aws_iam.ServicePrincipal('kendra.amazonaws.com'),
      },
    );
    kendraS3AccessRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['s3:GetObject'],
        // resources: [`arn:aws:s3:::${this.props.kendraDataSyncInputBucketName}/*`],
        resources: ['*'],
      }),
    );
    kendraS3AccessRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        // resources: [`arn:aws:s3:::${this.props.kendraDataSyncInputBucketName}`],
        resources: ['*'],
      }),
    );
    kendraS3AccessRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          'kendra:BatchPutDocument',
          'kendra:BatchDeleteDocument',
        ],
        // resources: [`arn:aws:kendra:${awsRegion}:${awsAccountId}:index/${cfnIndex.attrId}`],
        resources: ['*'],
      }),
    );


    // this.kendraDataSource = new kendra.CfnDataSource(this, 'llmdemoIndexDataSource', {
    //   indexId: cfnIndex.attrId,
    //   name: 'llmdemoIndexDataSource',
    //   type: 'S3',
    //   roleArn: kendraS3AccessRole.roleArn,
    //   dataSourceConfiguration: {
    //     s3Configuration: {
    //       bucketName: this.props.kendraDataSyncInputBucketName,
    //       accessControlListConfiguration: {
    //         keyPath: `s3://${this.props.kendraDataSyncInputBucketName}/kendra_acl.json`,
    //       },
    //     },
    //   },
    // });

    const kendraIamDataSource = new kendra.CfnDataSource(this, 'AiOpsIndexIamDataSource', {
      indexId: cfnIndex.attrId,
      name: 'AiOpsIndexIamDocs',
      type: 'WEBCRAWLER', // S3 | SHAREPOINT | SALESFORCE | ONEDRIVE | SERVICENOW | DATABASE | CUSTOM | CONFLUENCE | GOOGLEDRIVE | WEBCRAWLER | WORKDOCS
      roleArn: kendraS3AccessRole.roleArn,
      dataSourceConfiguration: {
        webCrawlerConfiguration: {
          urls: {
            siteMapsConfiguration: {
              siteMaps: ['https://docs.aws.amazon.com/IAM/latest/UserGuide/sitemap.xml']
            }
          },
          crawlDepth: 2,
          maxContentSizePerPageInMegaBytes: 50,
          maxLinksPerPage: 100
        }
        // s3Configuration: {
        //   bucketName: this.props.kendraDataSyncInputBucketName,
        //   accessControlListConfiguration: {
        //     keyPath: `s3://${this.props.kendraDataSyncInputBucketName}/kendra_acl.json`,
        //   },
        // },
      },
    });
    const kendraSecHubDataSource = new kendra.CfnDataSource(this, 'AiOpsIndexSecHubDataSource', {
      indexId: cfnIndex.attrId,
      name: 'AiOpsIndexSecHubDocs',
      type: 'WEBCRAWLER', // S3 | SHAREPOINT | SALESFORCE | ONEDRIVE | SERVICENOW | DATABASE | CUSTOM | CONFLUENCE | GOOGLEDRIVE | WEBCRAWLER | WORKDOCS
      roleArn: kendraS3AccessRole.roleArn,
      dataSourceConfiguration: {
        webCrawlerConfiguration: {
          urls: {
            siteMapsConfiguration: {
              siteMaps: ['https://docs.aws.amazon.com/securityhub/latest/userguide/sitemap.xml']
            }
          },
          crawlDepth: 2,
          maxContentSizePerPageInMegaBytes: 50,
          maxLinksPerPage: 100
        }
      },
    });
    const kendraSsmDataSource = new kendra.CfnDataSource(this, 'AiOpsIndexSsmDataSource', {
      indexId: cfnIndex.attrId,
      name: 'AiOpsIndexSsmDocs',
      type: 'WEBCRAWLER', // S3 | SHAREPOINT | SALESFORCE | ONEDRIVE | SERVICENOW | DATABASE | CUSTOM | CONFLUENCE | GOOGLEDRIVE | WEBCRAWLER | WORKDOCS
      roleArn: kendraS3AccessRole.roleArn,
      dataSourceConfiguration: {
        webCrawlerConfiguration: {
          urls: {
            siteMapsConfiguration: {
              siteMaps: ['https://docs.aws.amazon.com/systems-manager/latest/userguide/sitemap.xml']
            }
          },
          crawlDepth: 2,
          maxContentSizePerPageInMegaBytes: 50,
          maxLinksPerPage: 100
        }
      },
    });

    /************************************************************************************ */

    const opsHealthBucket = s3.Bucket.fromBucketName(this, 'OpsHealthBucket', props.opsHealthBucketName);
    const opsSecHubBucket = s3.Bucket.fromBucketName(this, 'OpsSecHubBucket', props.opsSecHubBucketName);

    const opsHealthKnowledgeBase = new bedrock.KnowledgeBase(this, 'OpsHealthKnowledgeBase', {
      name: 'OpsHealthKnowledgeBase',
      embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V1,
      instruction: `Use this knowledge base for details about operational health events, issues, and lifecycle notifications.`,
    });

    const opsHealthDataSource = new bedrock.S3DataSource(this, 'OpsHealthDataSource', {
      bucket: opsHealthBucket,
      knowledgeBase: opsHealthKnowledgeBase,
      dataSourceName: 'ops-health',
      chunkingStrategy: bedrock.ChunkingStrategy.DEFAULT,
      maxTokens: 1000,
      overlapPercentage: 10,
    });

    const opsSecHubKnowledgeBase = new bedrock.KnowledgeBase(this, 'OpsSecHubKnowledgeBase', {
      name: 'OpsSecHubKnowledgeBase',
      embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V1,
      instruction: `Use this knowledge base for details about security findings, issues, risks, events.`,
    });

    const opsSecHubDataSource = new bedrock.S3DataSource(this, 'OpsSecHubDataSource', {
      bucket: opsSecHubBucket,
      knowledgeBase: opsSecHubKnowledgeBase,
      dataSourceName: 'ops-sechub',
      chunkingStrategy: bedrock.ChunkingStrategy.DEFAULT,
      maxTokens: 1000,
      overlapPercentage: 10,
    });

    const opsHealthAgent = new bedrock.Agent(this, 'OpsHealthAgent', {
      name: 'OpsAgent',
      description: 'The agent for consultation on operational events, issues, and/or security findings',
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_HAIKU_V1_0,
      instruction:
        'You are MyCompany\'s cloud operations assistant that provides details or advice related to operational events, issues, and security findings.',
      idleSessionTTL: cdk.Duration.minutes(15),
      // knowledgeBases: [opsHealthKnowledgeBase, opsSecHubKnowledgeBase],
      shouldPrepareAgent: true,
      aliasName: 'OpsAgent',
      promptOverrideConfiguration: {
        promptConfigurations: [
          {
            promptType: bedrock.PromptType.PRE_PROCESSING,
            inferenceConfiguration: {
              temperature: 0,
              topP: 1,
              topK: 250,
              stopSequences: ['\n\nHuman:'],
              maximumLength: 2048,
            },
            promptCreationMode: bedrock.PromptCreationMode.OVERRIDDEN,
            promptState: bedrock.PromptState.ENABLED,
            basePromptTemplate: fs.readFileSync(path.join(__dirname, '../prompt-templates/ops-agent/preprocessing.xml')).toString(),
            parserMode: bedrock.ParserMode.DEFAULT
          },
          {
            promptType: bedrock.PromptType.ORCHESTRATION,
            inferenceConfiguration: {
              temperature: 0,
              topP: 1,
              topK: 250,
              stopSequences: ['</invoke>', '</answer>', '</error>'],
              maximumLength: 2048,
            },
            promptCreationMode: bedrock.PromptCreationMode.OVERRIDDEN,
            promptState: bedrock.PromptState.ENABLED,
            basePromptTemplate: fs.readFileSync(path.join(__dirname, '../prompt-templates/ops-agent/orchestration.xml')).toString(),
            parserMode: bedrock.ParserMode.DEFAULT
          }
        ]
      }
    });

    const bufferKbSyncSqs = new sqs.Queue(this, 'bufferOpsHealthKbSyncSqs', {
      visibilityTimeout: cdk.Duration.seconds(300), //6 times the function timeout, plus the value of MaximumBatchingWindowInSeconds
    })

    const ingestKbFunction = new lambda.Function(this, 'IngestOpsHealthKbFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/IngestOpsHealthKbFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      environment: {
        KNOWLEDGE_BASE_ID: opsHealthKnowledgeBase.knowledgeBaseId,
        KB_DATA_SOURCE_ID: opsHealthDataSource.dataSourceId
      },
    });

    ingestKbFunction.addEventSource(new SqsEventSource(bufferKbSyncSqs, {
      batchSize: 100,
      maxBatchingWindow: cdk.Duration.minutes(3),
      reportBatchItemFailures: true
    }));

    const ingestKbLogGroup = new logs.LogGroup(this, 'IngestOpsHealthKbLogGroup', {
      logGroupName: `/aws/lambda/${ingestKbFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ingestKbPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:StartIngestionJob"
      ],
      resources: [opsHealthKnowledgeBase.knowledgeBaseArn],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    ingestKbFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'ingest-ops-health-knowledge-base-policy', {
        statements: [ingestKbPolicy],
      }),
    );

    new events.Rule(this, `OpsHealthKbFileArrivalRule`, {
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
              props.opsHealthBucketName
            ]
          }
        }
      },
      targets: [new evtTargets.SqsQueue(bufferKbSyncSqs)]
    });

    /*** Bedrock agent and agent action groups **************/
    const invokeAgentFunction = new lambda.Function(this, 'InvokeAgentFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/InvokeAgentFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(600),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 10,
      environment: {
        AGENT_ID: opsHealthAgent.agentId,
        AGENT_ALIAS_ID: opsHealthAgent.aliasId as string
      },
    });

    const invokeAgentLogGroup = new logs.LogGroup(this, 'InvokeAgentLogGroup', {
      logGroupName: `/aws/lambda/${invokeAgentFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const invokeAgentPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeAgent"
      ],
      resources: ['*'],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    invokeAgentFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'invoke-agent-policy', {
        statements: [invokeAgentPolicy],
      }),
    );

    /*** Operations assistant action group executor function **************/
    const opsHealthActionGroupFunction = new lambda.Function(this, 'OpsHealthActionGroupFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/OpsHealthActionGroupFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(120),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 10,
      environment: {
        EVENT_TABLE: props.eventManagementTableName,
        TICKET_TABLE: props.ticketManagementTableName,
        KENDRA_INDEX_ID: cfnIndex.attrId,
        HEALTH_KB_ID: opsHealthKnowledgeBase.knowledgeBaseId,
        SEC_KB_ID: opsSecHubKnowledgeBase.knowledgeBaseId,
        // LLM_MODEL_ARN: `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/anthropic.claude-v2`,
        LLM_MODEL_ARN: `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
      },
    });

    const opsHealthActionGroupLogGroup = new logs.LogGroup(this, 'OpsHealthActionGroupLogGroup', {
      logGroupName: `/aws/lambda/${opsHealthActionGroupFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const opsHealthActionGroupPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeAgent",
        "bedrock:RetrieveAndGenerate",
        "bedrock:Retrieve",
        "bedrock:InvokeModel",
        "kendra:Retrieve",
        "dynamodb:*",
        "states:SendTaskFailure",
        "states:SendTaskSuccess",
      ],
      resources: [opsHealthAgent.aliasArn as string, opsHealthKnowledgeBase.knowledgeBaseArn, opsSecHubKnowledgeBase.knowledgeBaseArn, cfnIndex.attrArn, `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/*`, 'arn:aws:dynamodb:*', 'arn:aws:states:*'],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    opsHealthActionGroupFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'action-group-ops-health-policy', {
        statements: [opsHealthActionGroupPolicy],
      }),
    );

    const osAgentActionGroup = new bedrock.AgentActionGroup(this, 'OpsHealthAgentActionGroup', {
      actionGroupName: 'OpsHealthAgentActionGroup', // connot have '-' or regex will fail matching
      description: 'The action group for cloud operations assistant agent',
      apiSchema: bedrock.S3ApiSchema.fromAsset(
        path.join(__dirname, './schema/api-ops.json')
      ),
      actionGroupState: 'ENABLED',
      actionGroupExecutor: {
        lambda: opsHealthActionGroupFunction,
      },
    });
    opsHealthAgent.addActionGroup(osAgentActionGroup);

    /*** Role to be used by event processing and integration state machines ************/
    const eventAiProcessingRole = new iam.Role(this, 'EventAiProcessingRole', {
      roleName: 'EventAiProcessingRole',
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: 'IAM role to be assumed by AI agent for event processing state machines',
    });
    eventAiProcessingRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'));
    eventAiProcessingRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess'));
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
    const aiIntegrationSfn = new sfn.StateMachine(this, 'AiAgentIntegration', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/ai-integration.asl')).toString().trim()),
      definitionSubstitutions: {
        // "ConnectionArnPlaceholder": props.connectionArn,
        // "EventCallbackUrlPlaceholder": `${props.restApiUrl}event-callback`,
        // "SlackApiEndpointPlaceholder": props.slackMeUrl,
        "InvokeBedRockAgentFunctionNamePlaceholder": invokeAgentFunction.functionName,

        "EventManagementTablePlaceHolder": props.eventManagementTableName,
        // "AppEventBusPlaceholder": props.aiOpsEventBus.eventBusName,
        // "AppEventDomainPrefixPlaceholder": props.appEventDomainPrefix,
        "SlackMeFunctionNamePlaceholder": props.slackMeFunction.functionName,
        // "EventCallbackUrlPlaceholder": `${this.restApi.url}event-callback`,
        "SlackChannelIdPlaceholder": props.slackChannelId
      },
      tracingEnabled: false,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      role: eventAiProcessingRole
    });

    const integrationRule = new events.Rule(this, 'OpsIntegrationWithAiRule', {
      eventBus: props.aiOpsEventBus,
      eventPattern: {
        source: [`${props.appEventDomainPrefix}.ops-orchestration`],
        detailType: [`Health.EventAdded`, `SecHub.EventAdded`]
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
    //without KMS permissions, startInstance call would not work if instance volume is encrypted by key
    aiOpsChatRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "bedrock:RetrieveAndGenerate",
        "bedrock:Retrieve",
        "bedrock:InvokeModel",
        "kms:CreateGrant",
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
    const aiOpsChatSfn = new sfn.StateMachine(this, 'AiOpsChatIntegration', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/ai-chat.asl')).toString().trim()),
      definitionSubstitutions: {
        // "ConnectionArnPlaceholder": props.connectionArn,
        // "SlackApiEndpointPlaceholder": props.slackMeUrl,
        "OpsHealthKnowledgeBaseIdPlaceHolder": opsHealthKnowledgeBase.knowledgeBaseId,
        "InvokeBedRockAgentFunctionNamePlaceholder": invokeAgentFunction.functionName,
        "SlackMeFunctionNamePlaceholder": props.slackMeFunction.functionName,
        "SlackChannelIdPlaceholder": props.slackChannelId,
        "ChatUserSessionsTableNamePlaceholder": chatUserSessionsTable.tableName,
        // "LlmModelArnPlaceholder": `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/anthropic.claude-3-haiku-v1`,
        "LlmModelArnPlaceholder": `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
      },
      tracingEnabled: false,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      role: aiOpsChatRole
    });

    const aiOpsChatRule = new events.Rule(this, 'AiOpsChatRule', {
      eventBus: props.aiOpsEventBus,
      eventPattern: {
        source: [`${props.appEventDomainPrefix}.ops-orchestration`],
        detailType: [`Chat.SlackMessageReceived`, `Chat.SlackMessageToAgentReceived`]
      },
      ruleName: 'AiOpsChatRule',
      description: 'Command event processing integration with external services.',
      targets: [new evtTargets.SfnStateMachine(aiOpsChatSfn)]
    });
    /******************************************************************************* */

  }
}