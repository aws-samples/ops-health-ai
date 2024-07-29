import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from "aws-cdk-lib/aws-events";
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface StatefulProps extends cdk.StackProps {
  scopedAccountIds: string[]
}

export class StatefulStack extends cdk.Stack {
  public readonly opsHealthBucket: s3.Bucket;
  public readonly secFindingsBucket: s3.Bucket;
  public readonly taFindingsBucket: s3.Bucket;
  public readonly opsEventLakeBucket: s3.Bucket;
  public readonly eventManagementTable: dynamodb.ITable
  public readonly ticketManagementTable: dynamodb.ITable
  public readonly aiOpsEventBus: events.IEventBus

  constructor(scope: Construct, id: string, props: StatefulProps) {
    super(scope, id, props);

    let listOfAcctPrincipals = props.scopedAccountIds.map(id => new iam.AccountPrincipal(id));

    /*** create role QuickSight for event record visualization, QS dashboard is not implemented in this project but foundation is laid for illustration, needs to be changed in QS console settings to make QS use this role. ***/
    const qsRole = new iam.Role(this, 'MyQuickSightServiceRole', {
      assumedBy: new iam.ServicePrincipal('quicksight.amazonaws.com'),
    });
    qsRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: [
        "athena:BatchGetQueryExecution",
        "athena:CancelQueryExecution",
        "athena:GetCatalogs",
        "athena:GetExecutionEngine",
        "athena:GetExecutionEngines",
        "athena:GetNamespace",
        "athena:GetNamespaces",
        "athena:GetQueryExecution",
        "athena:GetQueryExecutions",
        "athena:GetQueryResults",
        "athena:GetQueryResultsStream",
        "athena:GetTable",
        "athena:GetTables",
        "athena:ListQueryExecutions",
        "athena:RunQuery",
        "athena:StartQueryExecution",
        "athena:StopQueryExecution",
        "athena:ListWorkGroups",
        "athena:ListEngineVersions",
        "athena:GetWorkGroup",
        "athena:GetDataCatalog",
        "athena:GetDatabase",
        "athena:GetTableMetadata",
        "athena:ListDataCatalogs",
        "athena:ListDatabases",
        "athena:ListTableMetadata",
        "iam:List*",
        "rds:Describe*",
        "redshift:Describe*",
        "s3:ListBucket",
        "s3:GetObject",
        "glue:*"
      ],
    }));
    /******************************************************************************* */

    /****************** S3 bucket to hold all ops event records**************** */
    this.opsEventLakeBucket = new s3.Bucket(this, 'OpsEventLakeBucket', {
      bucketName: `ops-event-lake-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      eventBridgeEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
          enabled: true,
          prefix: `ops-events`,
          expiration: cdk.Duration.days(2)
        },
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
          enabled: true,
          prefix: 'eventhose-errors',
          expiration: cdk.Duration.days(2)
        },
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
          enabled: true,
          prefix: 'athena-query-results',
          expiration: cdk.Duration.days(2)
        }
      ]
    });

    this.opsEventLakeBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [...listOfAcctPrincipals, qsRole],
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
          "s3:PutObjectAcl"
        ],
        resources: [this.opsEventLakeBucket.arnForObjects("*"), this.opsEventLakeBucket.bucketArn]
      }),
    );
    /******************************************************************************* */

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
          ...listOfAcctPrincipals
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
          ...listOfAcctPrincipals
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
          ...listOfAcctPrincipals
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

    /******************* DynamoDB Table to mock up issue ticket tool *****************/
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