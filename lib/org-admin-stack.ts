import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as events from "aws-cdk-lib/aws-events";
import * as evtTargets from "aws-cdk-lib/aws-events-targets";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface OrgAdminProps extends cdk.StackProps {
  oheroEventBusArn: string
  sourceEventDomains: string[]
  secHubBucketName: string
}

export class OrgAdminOrgStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OrgAdminProps) {
    super(scope, id, props);

    // ----------- Event forwarding ---------------
    new events.Rule(this, `OheroEventHubForwardingRule`, {
      eventPattern: {
        source: props.sourceEventDomains,
        detailType: [{ "anything-but": { "suffix": "via CloudTrail" } }] as any[]
      },
      targets: [new evtTargets.EventBus(events.EventBus.fromEventBusArn(
        this,
        'OheroEventHub',
        props.oheroEventBusArn,
      ),)]
    });

    // ------- UNCOMMENT THE BELOW to create scheduled securityhub reporting that then can be sync'd to security findings knowledge base ---------
    if (cdk.Stack.of(this).region === "ap-southeast-2") { // note the region is the region where you enabled Security Hub
      const secHubReportFunction = new lambda.Function(this, 'SecHubReportFunction', {
        runtime: lambda.Runtime.PYTHON_3_11,
        code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/SecHubReportFunction'),
        handler: 'app.lambda_handler',
        timeout: cdk.Duration.seconds(300),
        memorySize: 128,
        architecture: lambda.Architecture.ARM_64,
        reservedConcurrentExecutions: 1,
        environment: {
          S3_NAME: props.secHubBucketName
        },
      });

      const secHubReportLogGroup = new logs.LogGroup(this, 'SecHubReportLogGroup', {
        logGroupName: `/aws/lambda/${secHubReportFunction.functionName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const secHubReportPolicy = new iam.PolicyStatement({
        actions: [
          "s3:ListBucket",
          "s3:GetObject",
          "s3:GetBucketLocation",
          "s3:ListMultipartUploadParts",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:DeleteObjects",
          "securityhub:GetFindings"
        ],
        resources: ['arn:aws:s3:::*','arn:aws:securityhub:*'],
        effect: cdk.aws_iam.Effect.ALLOW
      });

      secHubReportFunction.role?.attachInlinePolicy(
        new iam.Policy(this, 'securityhub-function-policy', {
          statements: [secHubReportPolicy],
        }),
      );

      new events.Rule(this, `SecurityhubReportRule`, {
        schedule: events.Schedule.cron({
          minute: "0",
          hour: "15",
        }),
        targets: [new evtTargets.LambdaFunction(secHubReportFunction, {
          retryAttempts: 2, // Max number of retries for Lambda invocation
        })]
      });
    }
  }
}
