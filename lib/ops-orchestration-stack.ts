import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from "aws-cdk-lib/aws-events";
import * as evtTargets from "aws-cdk-lib/aws-events-targets";
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
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
  oheroEventBus: events.IEventBus
  healthEventDomains: string[],
  sechubEventDomains: string[],
  appEventDomainPrefix: string
  webChatApiKey?: string
  webSocketConnectionsTableName: string
  teamManagementTableName: string
  notificationChannel: 'slack' | 'webchat'
}

export class OpsOrchestrationStack extends cdk.Stack {
  public readonly restApi: apigw.RestApi
  public readonly webSocketApi: apigwv2.WebSocketApi

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
      logGroupName: `/aws/vendedlogs/apigateway/OheroRestEndpointsLogs`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create execution log group explicitly to ensure cleanup
    const executionLogGroup = new logs.LogGroup(this, "ApiGatewayExecutionLogs", {
      logGroupName: `/aws/apigateway/execution-logs`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.restApi = new apigw.RestApi(this, 'OheroRestEndpoints', {
      restApiName: `${cdk.Stack.of(this).stackName}-oheroApi`,
      description: `${cdk.Stack.of(this).stackName} Rest API Gateway`,
      cloudWatchRole: true,
      cloudWatchRoleRemovalPolicy: cdk.RemovalPolicy.DESTROY,
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

    /***************** WebSocket API for web chat ******* */
    // Create WebSocket API log group
    const webSocketLogGroup = new logs.LogGroup(this, "WebSocketApiAccessLogs", {
      logGroupName: `/aws/vendedlogs/apigateway/OheroWebSocketApiLogs`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create WebSocket API
    this.webSocketApi = new apigwv2.WebSocketApi(this, 'OheroWebSocketApi', {
      apiName: `${cdk.Stack.of(this).stackName}-webSocketApi`,
      description: `${cdk.Stack.of(this).stackName} WebSocket API for web chat`,
      // Routes will be added after function creation
    });

    // Create WebSocket API stage
    const webSocketStage = new apigwv2.WebSocketStage(this, 'OheroWebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Routes will be configured after function creation
    /******************************************************************************* */

    const lambdaExecutionRole = new iam.Role(this, 'OheroLambdaRole', {
      roleName: 'OheroLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role to be assumed by Ohero app functions',
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
        "states:SendTaskFailure",
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Scan",
        "dynamodb:Query"
      ],
      resources: ['*']
    }));

    // ------------------- HandleSlackComm ---------------------
    const handleSlackCommFunction = new lambda.Function(this, 'HandleSlackComm', {
      runtime: lambda.Runtime.NODEJS_20_X,
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
        INTEGRATION_EVENT_BUS_NAME: props.oheroEventBus.eventBusName,
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
    const slackMeFunction = new lambda.Function(this, 'SlackMe', {
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
        SLACK_CHANNEL_ID: props.slackChannelId
      },
    });

    new logs.LogGroup(this, 'SlackMeLogGroup', {
      logGroupName: `/aws/lambda/${slackMeFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -------------------------------------------------------

    // ------------------- WebChatMe function ---------------------
    const webChatMeFunction = new lambda.Function(this, 'WebChatMe', {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/WebChatMeFunction'),
      handler: 'app.lambda_handler',
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 10,
      role: lambdaExecutionRole,
      tracing: lambda.Tracing.DISABLED,
      environment: {
        CONNECTIONS_TABLE_NAME: props.webSocketConnectionsTableName,
        // WEBSOCKET_API_ENDPOINT will be set below after WebSocket API creation
      },
    });

    new logs.LogGroup(this, 'WebChatMeLogGroup', {
      logGroupName: `/aws/lambda/${webChatMeFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -------------------------------------------------------

    // ------------------- HandleWebChatComm function ---------------------
    const handleWebChatCommFunction = new lambda.Function(this, 'HandleWebChatComm', {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/HandleWebChatCommFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 5,
      role: lambdaExecutionRole,
      tracing: lambda.Tracing.DISABLED,
      environment: {
        CONNECTIONS_TABLE_NAME: props.webSocketConnectionsTableName,
        EVENT_DOMAIN_PREFIX: props.appEventDomainPrefix,
        INTEGRATION_EVENT_BUS_NAME: props.oheroEventBus.eventBusName,
        PAYLOAD_BUCKET: props.transientPayloadsBucketName,
        WEB_CHAT_API_KEY: props.webChatApiKey || '', // API key for authentication
        TEAM_MANAGEMENT_TABLE_NAME: props.teamManagementTableName,
      },
    });

    new logs.LogGroup(this, 'HandleWebChatCommLogGroup', {
      logGroupName: `/aws/lambda/${handleWebChatCommFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -------------------------------------------------------

    /***************** Configure WebSocket API routes ******* */
    // Add WebSocket routes with the actual function
    this.webSocketApi.addRoute('$connect', {
      integration: new apigwv2Integrations.WebSocketLambdaIntegration(
        'ConnectIntegration',
        handleWebChatCommFunction
      ),
    });

    this.webSocketApi.addRoute('$disconnect', {
      integration: new apigwv2Integrations.WebSocketLambdaIntegration(
        'DisconnectIntegration',
        handleWebChatCommFunction
      ),
    });

    this.webSocketApi.addRoute('$default', {
      integration: new apigwv2Integrations.WebSocketLambdaIntegration(
        'DefaultIntegration',
        handleWebChatCommFunction
      ),
    });

    this.webSocketApi.addRoute('message', {
      integration: new apigwv2Integrations.WebSocketLambdaIntegration(
        'MessageIntegration',
        handleWebChatCommFunction
      ),
    });

    // Update WebChatMe function with WebSocket API endpoint
    webChatMeFunction.addEnvironment(
      'WEBSOCKET_API_ENDPOINT',
      `https://${this.webSocketApi.apiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${webSocketStage.stageName}`
    );

    // Grant WebSocket API permissions to invoke the function
    handleWebChatCommFunction.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));

    // Grant WebChatMe function permission to post to WebSocket connections
    webChatMeFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${this.webSocketApi.apiId}/*/*`]
    }));

    // Output WebSocket API URL
    new cdk.CfnOutput(this, "WebSocketApiUrl", {
      value: `wss://${this.webSocketApi.apiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${webSocketStage.stageName}`
    });

    // Output active notification channel
    new cdk.CfnOutput(this, "ActiveNotificationChannel", {
      value: props.notificationChannel,
      description: "Currently active notification channel (slack or webchat)"
    });
    /******************************************************************************* */

    /*** Lambda function to serve manual State machine callbacks from human user ***/
    const eventCallbackFunction = new lambda.Function(this, 'EventCallback', {
      runtime: lambda.Runtime.NODEJS_20_X,
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
    const opsOrchestrationSfnLogGroup = new logs.LogGroup(this, 'OheroOpsOrchestrationSfnLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      logGroupName: `/aws/vendedlogs/states/OheroOpsOrchestrationSfnLogs`,
    });
    const opsOrchestrationSfn = new sfn.StateMachine(this, 'OheroOpsOrchestration', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/ops-orchestration.asl')).toString().trim()),
      definitionSubstitutions: {
        "EventManagementTablePlaceHolder": props.eventManagementTableName,
        "AppEventBusPlaceholder": props.oheroEventBus.eventBusName,
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
      eventBus: props.oheroEventBus,
      eventPattern: {
        // source: [{ prefix: '' }] as any[]
        source: props.healthEventDomains
      },
      ruleName: 'OpsOrchestrationSubscription1',
      description: 'Ohero main orchestration flow',
      targets: [new evtTargets.SfnStateMachine(opsOrchestrationSfn)]
    });
    const opsOrchestrationSubscriptionRule2 = new events.Rule(this, 'OpsOrchestrationSubscription2', {
      eventBus: props.oheroEventBus,
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
      description: 'Ohero main orchestration flow',
      targets: [new evtTargets.SfnStateMachine(opsOrchestrationSfn)]
    });
    /******************************************************************************* */

    /*** State machine for notification service *****/
    const notificationSfnLogGroup = new logs.LogGroup(this, 'OheroNotificationSfnLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      logGroupName: `/aws/vendedlogs/states/OheroNotificationSfnLogs`,
    });
    const notificationSfn = new sfn.StateMachine(this, 'OheroNotification', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/ops-notification.asl')).toString().trim()),
      definitionSubstitutions: {
        "EventManagementTablePlaceHolder": props.eventManagementTableName,
        "AppEventBusPlaceholder": props.oheroEventBus.eventBusName,
        "AppEventDomainPrefixPlaceholder": props.appEventDomainPrefix,
        "SlackMeFunctionNamePlaceholder": slackMeFunction.functionName,
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

    // Conditional EventBridge rule for Slack notifications
    if (props.notificationChannel === 'slack') {
      const notificationRule = new events.Rule(this, 'OheroNotificationRule', {
        eventBus: props.oheroEventBus,
        eventPattern: {
          source: [
            `${props.appEventDomainPrefix}.ops-orchestration`,
            `${props.appEventDomainPrefix}.ai-integration`,
            `${props.appEventDomainPrefix}.ai-chat`
          ]
        },
        ruleName: 'OpsNotificationRule',
        description: 'Subscription by Ohero Slack notification service.',
        targets: [new evtTargets.SfnStateMachine(notificationSfn)]
      });
    }
    /******************************************************************************* */

    /*** State machine for web chat notification service *****/
    const webChatNotificationSfnLogGroup = new logs.LogGroup(this, 'OheroWebChatNotificationSfnLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      logGroupName: `/aws/vendedlogs/states/OheroWebChatNotificationSfnLogs`,
    });
    const webChatNotificationSfn = new sfn.StateMachine(this, 'OheroWebChatNotification', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/ops-notification-web.asl')).toString().trim()),
      definitionSubstitutions: {
        "EventManagementTablePlaceHolder": props.eventManagementTableName,
        "AppEventBusPlaceholder": props.oheroEventBus.eventBusName,
        "AppEventDomainPrefixPlaceholder": props.appEventDomainPrefix,
        "WebChatMeFunctionNamePlaceholder": webChatMeFunction.functionName,
        "EventCallbackUrlPlaceholder": `${this.restApi.url}event-callback`
      },
      tracingEnabled: false,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      role: opsOrchestrationRole,
      logs: {
        destination: webChatNotificationSfnLogGroup,
        level: sfn.LogLevel.ERROR,
        includeExecutionData: true,
      }
    });

    // Conditional EventBridge rule for Web Chat notifications
    if (props.notificationChannel === 'webchat') {
      const webChatNotificationRule = new events.Rule(this, 'OheroWebChatNotificationRule', {
        eventBus: props.oheroEventBus,
        eventPattern: {
          source: [
            `${props.appEventDomainPrefix}.ops-orchestration`,
            `${props.appEventDomainPrefix}.ai-integration`,
            `${props.appEventDomainPrefix}.ai-chat`
          ]
        },
        ruleName: 'OpsWebChatNotificationRule',
        description: 'Subscription by Ohero web chat notification service.',
        targets: [new evtTargets.SfnStateMachine(webChatNotificationSfn)]
      });
    }
    /******************************************************************************* */

  }
}
