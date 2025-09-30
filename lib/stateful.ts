import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from "aws-cdk-lib/aws-events";
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';

export interface StatefulProps extends cdk.StackProps {
  scopedAccountIds: string[]
}

export class StatefulStack extends cdk.Stack {
  public readonly opsHealthBucket: s3.Bucket;
  public readonly secFindingsBucket: s3.Bucket;
  public readonly opsEventLakeBucket: s3.Bucket;
  public readonly transientPayloadsBucket: s3.Bucket;
  public readonly eventManagementTable: dynamodb.ITable
  public readonly ticketManagementTable: dynamodb.ITable
  public readonly teamManagementTable: dynamodb.ITable
  public readonly webSocketConnectionsTable: dynamodb.ITable
  public readonly oheroEventBus: events.IEventBus
  public readonly bedrockGuardrail: bedrock.CfnGuardrail
  public readonly bedrockGuardrailVersion: bedrock.CfnGuardrailVersion

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
      autoDeleteObjects: true,
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
      eventBridgeEnabled: true,
      autoDeleteObjects: true
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
      eventBridgeEnabled: true,
      autoDeleteObjects: true,
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

    /****************** S3 bucket to hold transient event payloads that are larger than 256k limit **************** */
    this.transientPayloadsBucket = new s3.Bucket(this, 'TransientPayloadsBucket', {
      bucketName: `transient-payloads-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      eventBridgeEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
          enabled: true,
          prefix: `ops-event-payloads`,
          expiration: cdk.Duration.days(2)
        }
      ]
    });

    this.transientPayloadsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [...listOfAcctPrincipals],
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
          "s3:PutObjectAcl"
        ],
        resources: [this.transientPayloadsBucket.arnForObjects("*"), this.transientPayloadsBucket.bucketArn]
      }),
    );
    /******************************************************************************* */

    /****** Dedicated event bus for Ohero integrated events processing microservices*************** */
    this.oheroEventBus = new events.EventBus(this, "OheroEventBus", {
      eventBusName: `${cdk.Stack.of(this).stackName}OheroEventBus`,
    })

    const cfnEventBusResourcePolicy = new events.CfnEventBusPolicy(this, "OheroEventBusResourcePolicy", {
      statementId: "OheroEventBusResourcePolicy",
      eventBusName: this.oheroEventBus.eventBusName,
      statement:
      {
        "Effect": "Allow",
        "Action": [
          "events:PutEvents"
        ],
        "Principal": {
          "AWS": props.scopedAccountIds
        },
        "Resource": this.oheroEventBus.eventBusArn
      }
    });

    new cdk.CfnOutput(this, "oheroEventBusArn", { value: this.oheroEventBus.eventBusArn })
    /******************************************************************************* */

    /******************* DynamoDB Table to track event reaction status *****************/
    this.eventManagementTable = new dynamodb.Table(this, 'EventManagementTable', {
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
    });
    /*************************************************************************************** */

    /******************* DynamoDB Table to team id, team name, and channel id mappings *****************/
    this.teamManagementTable = new dynamodb.Table(this, 'TeamManagementTable', {
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
    });
    new cdk.CfnOutput(this, "TeamManagementTableName", { value: this.teamManagementTable.tableName })
    /*************************************************************************************** */

    /******************* DynamoDB Table to mock up issue ticket tool *****************/
    this.ticketManagementTable = new dynamodb.Table(this, 'TicketManagementTable', {
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
    });
    /*************************************************************************************** */

    /******************* DynamoDB Table for WebSocket connection tracking *****************/
    this.webSocketConnectionsTable = new dynamodb.Table(this, 'WebSocketConnectionsTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "connectionId",
        type: dynamodb.AttributeType.STRING
      },
      timeToLiveAttribute: 'ttl', // Auto-cleanup stale connections
    });
    /*************************************************************************************** */



    /******************* Create a guardrail configuration for the bedrock agents *****************/
    this.bedrockGuardrail = new bedrock.CfnGuardrail(this, 'BedrockGuardrail', {
      name: 'BedrockGuardrail',
      description: 'guardrail configuration for the bedrock agents',
      blockedInputMessaging: 'I cannot accept your prompt by Guardrails.',
      blockedOutputsMessaging:'I cannot answer that as the response has been blocked by Guardrails.',
      contentPolicyConfig: {
        filtersConfig: [
          {
            inputStrength: 'NONE',
            outputStrength: 'NONE',
            type: 'PROMPT_ATTACK'
          },
          {
            inputStrength: 'HIGH',
            outputStrength: 'HIGH',
            type: 'MISCONDUCT'
          },
          {
            inputStrength: 'HIGH',
            outputStrength: 'HIGH',
            type: 'INSULTS'
          },
          {
            inputStrength: 'HIGH',
            outputStrength: 'HIGH',
            type: 'HATE'
          },
          {
            inputStrength: 'HIGH',
            outputStrength: 'HIGH',
            type: 'SEXUAL'
          },
          {
            inputStrength: 'HIGH',
            outputStrength: 'HIGH',
            type: 'VIOLENCE'
          },
        ]
      }
    });

    this.bedrockGuardrailVersion = new bedrock.CfnGuardrailVersion(this, 'BedrockGuardrailVersion', {
      guardrailIdentifier: this.bedrockGuardrail.attrGuardrailId,
      description: "latest version of the guardrail configuration",
    });
    /*************************************************************************************** */

  }
}