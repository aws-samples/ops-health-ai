import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as evtTargets from "aws-cdk-lib/aws-events-targets";
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from "aws-cdk-lib/aws-events";
import * as iam from 'aws-cdk-lib/aws-iam';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { Construct } from 'constructs';
import * as fs from 'fs';

import * as path from "path";

export interface ExpertAgentProps extends cdk.StackProps {
  // scopedAccountIds: string[],
  transcriptBucketName: string,
  // healthEventManagementTableName: string
}

export class ExpertAgentStack extends cdk.Stack {
  // public readonly knowledgeBaseBucket: s3.Bucket;
  // public readonly dataSource: bedrock.S3DataSource
  // public readonly knowledgeBase: bedrock.KnowledgeBase
  // public readonly invokeAgentFunction: lambda.IFunction
  // public readonly opsActionGroupFunction: lambda.IFunction
  // public readonly tamActionGroupFunction: lambda.IFunction

  constructor(scope: Construct, id: string, props: ExpertAgentProps) {
    super(scope, id, props);

    // let listOfAcctPrincipals = props.scopedAccountIds.map(id => new iam.AccountPrincipal(id));

    const transcriptBucket = s3.Bucket.fromBucketName(this, 'TranscriptBucket', props.transcriptBucketName);

    const speakerKnowledgeBase = new bedrock.KnowledgeBase(this, 'SpeakerKnowledgeBase', {
      embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V1,
      instruction: `Use this knowledge base answer questions about AWS technical advices.`,
    });

    const speakerDataSource = new bedrock.S3DataSource(this, 'SpeakerDataSource', {
      bucket: transcriptBucket,
      knowledgeBase: speakerKnowledgeBase,
      dataSourceName: 'aws-expert',
      chunkingStrategy: bedrock.ChunkingStrategy.DEFAULT,
      // maxTokens: 500,
      // overlapPercentage: 10,
    });

    new cdk.CfnOutput(this, 'SpeakerKnowledgeBaseIdOutput', {
      value: speakerKnowledgeBase.knowledgeBaseId,
      exportName: 'SpeakerKnowledgeBaseIdOutput',
    });

    const expertAgent = new bedrock.Agent(this, 'SpeakerExpertAgent', {
      name: 'SpeakerExpertAgent',
      description: 'The agent for consultation on architectural advices, best practices.',
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_V2,
      instruction:
        'You are an AWS technical experts that provides technical advices on architecture and best practices.',
      idleSessionTTL: cdk.Duration.minutes(15),
      knowledgeBases: [speakerKnowledgeBase],
      shouldPrepareAgent: false,
      aliasName: 'SpeakerExpertAgent',
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
            basePromptTemplate: fs.readFileSync(path.join(__dirname, '../prompt-templates/expert-agent/preprocessing.xml')).toString(),
            parserMode: bedrock.ParserMode.DEFAULT
          },
        ]
      }
    });

    const bufferKbSyncSqs = new sqs.Queue(this, 'bufferExpertKbSyncSqs', {
      visibilityTimeout: cdk.Duration.seconds(300), //6 times the function timeout, plus the value of MaximumBatchingWindowInSeconds
    })

    const ingestKbFunction = new lambda.Function(this, 'IngestSpeakerKbFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/IngestSpeakerKbFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      environment: {
        KNOWLEDGE_BASE_ID: speakerKnowledgeBase.knowledgeBaseId,
        KB_DATA_SOURCE_ID: speakerDataSource.dataSourceId
      },
    });

    ingestKbFunction.addEventSource(new SqsEventSource(bufferKbSyncSqs, {
      batchSize: 10000,
      maxBatchingWindow: cdk.Duration.minutes(3),
      reportBatchItemFailures: true
    }));

    const ingestKbLogGroup = new logs.LogGroup(this, 'IngestSpeakerKbLogGroup', {
      logGroupName: `/aws/lambda/${ingestKbFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ingestKbPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:StartIngestionJob"
      ],
      resources: [speakerKnowledgeBase.knowledgeBaseArn],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    ingestKbFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'ingest-speaker-knowledge-base-policy', {
        statements: [ingestKbPolicy],
      }),
    );

    new events.Rule(this, `SpeakerKbFileArrivalRule`, {
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
              props.transcriptBucketName
            ]
          }
        }
      },
      targets: [new evtTargets.SqsQueue(bufferKbSyncSqs)]
    });
  }
}