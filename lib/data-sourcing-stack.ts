import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from "aws-cdk-lib/aws-events";
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as evtTargets from "aws-cdk-lib/aws-events-targets";
import { Construct } from 'constructs';

export interface DataSourcingStackProps extends cdk.StackProps {
  opsHealthBucketName: string
  taFindingsBucketName: string
  secFindingsBucketName: string
  healthEventDomains: string[],
  sechubEventDomains: string[],
  targetS3Region: string
  aiOpsEventBus: events.IEventBus
}

export class DataSourcingStack extends cdk.Stack {
  public kbBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataSourcingStackProps) {
    super(scope, id, props);

    // --------- Convert JSON events to txt for better RAG result, save to knowledge base data source function---------------
    const convertEventDlq = new sqs.Queue(this, 'ConvertEventDlq', {
    })
    const convertEventSqs = new sqs.Queue(this, 'ConvertEventSqs', {
      visibilityTimeout: cdk.Duration.seconds(90), //6 times the function timeout, plus the value of MaximumBatchingWindowInSeconds
      deadLetterQueue: {
        queue: convertEventDlq,
        maxReceiveCount: 10
      }
    })

    const eventToKnowledgeBaseFunction = new lambda.Function(this, 'EventToKnowledgeBaseFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/EventToKnowledgeBaseFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      // role: executionRole,
      environment: {
        TARGET_S3_REGION: props.targetS3Region,
        OPS_HEALTH_S3: props.opsHealthBucketName,
        TA_FINDINGS_s3: props.taFindingsBucketName,
        SEC_FINDINGs_S3: props.secFindingsBucketName,
      },
    });

    eventToKnowledgeBaseFunction.addEventSource(new SqsEventSource(convertEventSqs, {
      batchSize: 1,
      maxBatchingWindow: cdk.Duration.minutes(1),
      reportBatchItemFailures: true
    }));

    const eventToKnowledgeBaseLogGroup = new logs.LogGroup(this, 'EventToKnowledgeBaseLogGroup', {
      logGroupName: `/aws/lambda/${eventToKnowledgeBaseFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const eventToKnowledgeBasePolicy = new iam.PolicyStatement({
      actions: [
        "s3:ListBucket",
        "s3:GetObject",
        "s3:GetBucketLocation",
        "s3:ListMultipartUploadParts",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:DeleteObjects"
      ],
      resources: ['arn:aws:s3:::*'],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    eventToKnowledgeBaseFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'aiops-knowledge-base-buckets-policy', {
        statements: [eventToKnowledgeBasePolicy],
      }),
    );

    new events.Rule(this, `AiOpsEventArrivalRule`, {
      eventBus: props.aiOpsEventBus,
      eventPattern: {
        source: [
          ...props.healthEventDomains,
          // ...props.sechubEventDomains
        ],
        detailType: [{ "anything-but": { "suffix": "via CloudTrail" } }] as any[]
      },
      targets: [new evtTargets.SqsQueue(convertEventSqs)]
    });
  }
}