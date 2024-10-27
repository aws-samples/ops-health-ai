import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from "aws-cdk-lib/aws-events";
import * as evtTargets from "aws-cdk-lib/aws-events-targets";
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as fs from 'fs';
import * as path from 'path';

export interface OpsOrchestrationStackProps extends cdk.StackProps {
  slackChannelId: string
  slackAppVerificationToken: string
  slackAccessToken: string
  eventManagementTableName: string
  transientPayloadsBucketName: string
  aiOpsEventBus: events.IEventBus
  healthEventDomains: string[],
  sechubEventDomains: string[],
  appEventDomainPrefix: string
}

export class OpsOrchestrationStack extends cdk.Stack {
  public readonly restApi: apigw.RestApi
  public readonly slackMeFunction: lambda.Function

  constructor(scope: Construct, id: string, props: OpsOrchestrationStackProps) {
    super(scope, id, props);

    /*** Role to be used by event processing and integration state machines ************/
    const opsOrchestrationRole = new iam.Role(this, 'OpsOrchestrationRole', {
      roleName: 'OpsOrchestrationRole',
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: 'IAM role to be assumed by ops event processing state machines',
    });
    opsOrchestrationRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'));
    opsOrchestrationRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess'));
    opsOrchestrationRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'));
    opsOrchestrationRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
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

    /***************** Rest API and API integration to call Lambda functions ******* */
    // uncomment the below to disable logging when troubleshooting needed
    const logGroup = new logs.LogGroup(this, "ApiGatewayAccessLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.restApi = new apigw.RestApi(this, 'AiOpsRestEndpoints', {
      restApiName: `${cdk.Stack.of(this).stackName}-aiOpsApi`,
      description: `${cdk.Stack.of(this).stackName} Rest API Gateway`,
      cloudWatchRole: true,
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: false, // enable x-ray
        accessLogDestination: new apigw.LogGroupLogDestination(logGroup),
        accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields(),
        loggingLevel: apigw.MethodLoggingLevel.INFO
      },
      defaultCorsPreflightOptions: {
        // allowHeaders: [
        //   'Content-Type',
        //   'X-Amz-Date',
        //   'Authorization',
        //   'X-Api-Key',
        // ],
        allowMethods: ['OPTIONS', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowCredentials: true,
        allowOrigins: ["*"],
      },
      endpointConfiguration: {
        types: [apigw.EndpointType.REGIONAL]
      }
    });
    /******************************************************************************* */


    const lambdaExecutionRole = new iam.Role(this, 'AiOpsLambdaRole', {
      roleName: 'AiOpsLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role to be assumed by AiOps app functions',
    });
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "kms:CreateGrant",
        "events:PutEvents",
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "s3:ListBucket",
        "s3:GetObject",
        "s3:GetBucketLocation",
        "s3:ListMultipartUploadParts",
        "s3:PutObject",
        "states:SendTaskSuccess",
        "states:SendTaskFailure"
      ],
      resources: ['*']
    }));

    // ------------------- HandleSlackComm ---------------------
    const handleSlackCommFunction = new lambda.Function(this, 'HandleSlackComm', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/HandleSlackCommFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      role: lambdaExecutionRole,
      tracing: lambda.Tracing.DISABLED,
      environment: {
        SLACK_APP_VERIFICATION_TOKEN: props.slackAppVerificationToken,
        SLACK_ACCESS_TOKEN: props.slackAccessToken,
        INTEGRATION_EVENT_BUS_NAME: props.aiOpsEventBus.eventBusName,
        EVENT_DOMAIN_PREFIX: props.appEventDomainPrefix,
        PAYLOAD_BUCKET: props.transientPayloadsBucketName
      },
    });

    new logs.LogGroup(this, 'HandleSlackCommLogGroup', {
      logGroupName: `/aws/lambda/${handleSlackCommFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const slackCommApi = this.restApi.root.addResource('handle-slack-comm');
    slackCommApi.addMethod(
      'POST',
      new LambdaIntegration(handleSlackCommFunction, { proxy: true }),
    );
    new cdk.CfnOutput(this, "HandleSlackCommApiUrl", { value: `${this.restApi.url}handle-slack-comm` })
    // -------------------------------------------------------

    // ------------------- SlackMe function ---------------------
    this.slackMeFunction = new lambda.Function(this, 'SlackMe', {
      runtime: lambda.Runtime.PYTHON_3_11,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/SlackMeFunction'),
      handler: 'app.lambda_handler',
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 10,
      role: lambdaExecutionRole,
      tracing: lambda.Tracing.DISABLED,
      environment: {
        SLACK_ACCESS_TOKEN: props.slackAccessToken,
      },
    });

    new logs.LogGroup(this, 'SlackMeLogGroup', {
      logGroupName: `/aws/lambda/${this.slackMeFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -------------------------------------------------------

    /*** Lambda function to serve manual State machine callbacks from human user ***/
    const eventCallbackFunction = new lambda.Function(this, 'EventCallback', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/CallbackEventFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 2,
      role: lambdaExecutionRole,
      tracing: lambda.Tracing.DISABLED,
      environment: {
      },
    });

    new logs.LogGroup(this, 'EventCallbackLogGroup', {
      logGroupName: `/aws/lambda/${eventCallbackFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const eventCallbackApi = this.restApi.root.addResource('event-callback');
    eventCallbackApi.addMethod(
      'GET',
      new LambdaIntegration(eventCallbackFunction, { proxy: true }),
    );
    new cdk.CfnOutput(this, "EventCallbackApiUrl", { value: `${this.restApi.url}event-callback` })
    /******************************************************************************* */

    /********* Main event processing state machine *************************/
    const opsOrchestrationSfnLogGroup = new logs.LogGroup(this, 'OpsOrchestrationSfnLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const opsOrchestrationSfn = new sfn.StateMachine(this, 'OpsOrchestration', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/ops-orchestration.asl')).toString().trim()),
      definitionSubstitutions: {
        "EventManagementTablePlaceHolder": props.eventManagementTableName,
        "AppEventBusPlaceholder": props.aiOpsEventBus.eventBusName,
        "AppEventDomainPrefixPlaceholder": props.appEventDomainPrefix
      },
      tracingEnabled: false,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      role: opsOrchestrationRole,
      logs: {
        destination: opsOrchestrationSfnLogGroup,
        level: sfn.LogLevel.ERROR,
        includeExecutionData: true,
      }
    });

    const opsOrchestrationSubscriptionRule1 = new events.Rule(this, 'OpsOrchestrationSubscription1', {
      eventBus: props.aiOpsEventBus,
      eventPattern: {
        // source: [{ prefix: '' }] as any[]
        source: props.healthEventDomains
      },
      ruleName: 'OpsOrchestrationSubscription1',
      description: 'AiOps main orchestration flow',
      targets: [new evtTargets.SfnStateMachine(opsOrchestrationSfn)]
    });
    const opsOrchestrationSubscriptionRule2 = new events.Rule(this, 'OpsOrchestrationSubscription2', {
      eventBus: props.aiOpsEventBus,
      eventPattern: {
        source: props.sechubEventDomains,
        detail: {
          findings: {
            // Matchers may appear at any level
            WorkflowState: events.Match.exactString("NEW"),
            Severity: {
              Original: [
                "HIGH",
                // 'MEDIUM',
                // "INFORMATIONAL"
              ]
            }
          }
        }
      },
      ruleName: 'OpsOrchestrationSubscription2',
      description: 'AiOps main orchestration flow',
      targets: [new evtTargets.SfnStateMachine(opsOrchestrationSfn)]
    });
    /******************************************************************************* */

    /*** State machine for notification service *****/
    const notificationSfnLogGroup = new logs.LogGroup(this, 'NotificationSfnLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const notificationSfn = new sfn.StateMachine(this, 'OpsNotification', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/ops-notification.asl')).toString().trim()),
      definitionSubstitutions: {
        "EventManagementTablePlaceHolder": props.eventManagementTableName,
        "AppEventBusPlaceholder": props.aiOpsEventBus.eventBusName,
        "AppEventDomainPrefixPlaceholder": props.appEventDomainPrefix,
        "SlackMeFunctionNamePlaceholder": this.slackMeFunction.functionName,
        "EventCallbackUrlPlaceholder": `${this.restApi.url}event-callback`,
        "SlackChannelIdPlaceholder": props.slackChannelId
      },
      tracingEnabled: false,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      role: opsOrchestrationRole,
      logs: {
        destination: notificationSfnLogGroup,
        level: sfn.LogLevel.ERROR,
        includeExecutionData: true,
      }
    });

    const notificationRule = new events.Rule(this, 'OpsNotificationRule', {
      eventBus: props.aiOpsEventBus,
      eventPattern: {
        source: [`${props.appEventDomainPrefix}.ops-orchestration`]
      },
      ruleName: 'OpsNotificationRule',
      description: 'Subscription by AiOps notification service.',
      targets: [new evtTargets.SfnStateMachine(notificationSfn)]
    });
    /******************************************************************************* */

  }
}
