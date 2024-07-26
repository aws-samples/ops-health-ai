import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from "aws-cdk-lib/aws-events";
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface StatefulProps extends cdk.StackProps {
  scopedAccountIds: string[]
  // qAppRoleArn: string
}

export class StatefulStack extends cdk.Stack {
  public readonly transcriptBucket: s3.Bucket;
  public readonly opsHealthBucket: s3.Bucket;
  public readonly secFindingsBucket: s3.Bucket;
  public readonly taFindingsBucket: s3.Bucket;
  public readonly videoTranscriptTable: dynamodb.ITable
  public readonly transcriptTaskTable: dynamodb.ITable
  public readonly eventManagementTable: dynamodb.ITable
  public readonly ticketManagementTable: dynamodb.ITable
  public readonly aiOpsEventBus: events.IEventBus

  constructor(scope: Construct, id: string, props: StatefulProps) {
    super(scope, id, props);

    let listOfAcctPrincipals = props.scopedAccountIds.map(id => new iam.AccountPrincipal(id));

    this.transcriptBucket = new s3.Bucket(this, 'TranscriptBucket', {
      bucketName: `aws-transcript-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      eventBridgeEnabled: true
    });

    this.transcriptBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          ...listOfAcctPrincipals,
          // new iam.ArnPrincipal(props.qAppRoleArn)
        ],
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
          "s3:PutObjectAcl"
        ],
        resources: [this.transcriptBucket.arnForObjects("*"), this.transcriptBucket.bucketArn],
      }),
    );

    this.opsHealthBucket = new s3.Bucket(this, 'OpsHealthBucket', {
      bucketName: `aws-ops-health-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      eventBridgeEnabled: true
    });

    this.opsHealthBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          ...listOfAcctPrincipals,
          // new iam.ArnPrincipal(props.qAppRoleArn)
        ],
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
          "s3:PutObjectAcl"
        ],
        resources: [this.opsHealthBucket.arnForObjects("*"), this.opsHealthBucket.bucketArn],
      }),
    );

    this.secFindingsBucket = new s3.Bucket(this, 'SecFindingsBucket', {
      bucketName: `aws-sec-findings-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      eventBridgeEnabled: true
    });

    this.secFindingsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          ...listOfAcctPrincipals,
          // new iam.ArnPrincipal(props.qAppRoleArn)
        ],
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
          "s3:PutObjectAcl"
        ],
        resources: [this.secFindingsBucket.arnForObjects("*"), this.secFindingsBucket.bucketArn],
      }),
    );

    this.taFindingsBucket = new s3.Bucket(this, 'TaFindingsBucket', {
      bucketName: `aws-ta-findings-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      eventBridgeEnabled: true
    });

    this.taFindingsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          ...listOfAcctPrincipals,
          // new iam.ArnPrincipal(props.qAppRoleArn)
        ],
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
          "s3:PutObjectAcl"
        ],
        resources: [this.taFindingsBucket.arnForObjects("*"), this.taFindingsBucket.bucketArn],
      }),
    );

    /******************* DynamoDB Table to hold channel and video ids to trigger scraping tasks *****************/
    this.transcriptTaskTable = new dynamodb.Table(this, 'TranscriptTaskTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING
      },
    });
    new cdk.CfnOutput(this, "TranscriptTaskTableName", { value: this.transcriptTaskTable.tableName })
    /*************************************************************************************** */

    /****** Dedicated event bus for AiOps integrated events processing microservices*************** */
    this.aiOpsEventBus = new events.EventBus(this, "AiOpsEventBus", {
      eventBusName: `${cdk.Stack.of(this).stackName}AiOpsEventBus`,
    })

    const cfnEventBusResourcePolicy = new events.CfnEventBusPolicy(this, "AiOpsEventBusResourcePolicy", {
      statementId: "AiOpsEventBusResourcePolicy",
      eventBusName: this.aiOpsEventBus.eventBusName,
      statement:
      {
        "Effect": "Allow",
        "Action": [
          "events:PutEvents"
        ],
        "Principal": {
          "AWS": props.scopedAccountIds
        },
        "Resource": this.aiOpsEventBus.eventBusArn
      }
    });

    new cdk.CfnOutput(this, "aiOpsEventBusArn", { value: this.aiOpsEventBus.eventBusArn })
    /******************************************************************************* */

    /******************* DynamoDB Table to hold populated tube video ids *****************/
    this.videoTranscriptTable = new dynamodb.Table(this, 'VideoTranscriptTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "VideoId",
        type: dynamodb.AttributeType.STRING
      },
      // sortKey: {
      //     name: "VideoId",
      //     type: dynamodb.AttributeType.STRING
      // },
    });
    // videoTranscriptTable.addLocalSecondaryIndex({
    //     indexName: 'statusIndex',
    //     sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    //     projectionType: dynamodb.ProjectionType.ALL,
    // });
    new cdk.CfnOutput(this, "VideoTranscriptTableName", { value: this.videoTranscriptTable.tableName })
    /*************************************************************************************** */

    /******************* DynamoDB Table to track event reaction status *****************/
    this.eventManagementTable = new dynamodb.Table(this, 'EventManagementTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING
      },
    });
    /*************************************************************************************** */

    /******************* DynamoDB Table to track issue ticket status *****************/
    this.ticketManagementTable = new dynamodb.Table(this, 'TicketManagementTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING
      },
    });
    /*************************************************************************************** */

  }
}