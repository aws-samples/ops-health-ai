import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
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

export interface QPluginStackProps extends cdk.StackProps {
  // scopedAccountIds: string[],

}

export class QPluginStack extends cdk.Stack {

  public readonly restApi: apigw.RestApi

  constructor(scope: Construct, id: string, props: QPluginStackProps) {
    super(scope, id, props);

    // let listOfAcctPrincipals = props.scopedAccountIds.map(id => new iam.AccountPrincipal(id));

    /***************** Rest API and API integration to call Lambda functions ******* */
    // uncomment the below to enable logging when troubleshooting needed

    // const logGroup = new logs.LogGroup(this, "ApiGatewayAccessLogs", {
    //   retention: logs.RetentionDays.ONE_WEEK,
    //   removalPolicy: cdk.RemovalPolicy.DESTROY,
    // });

    this.restApi = new apigw.RestApi(this, 'AiOpsRestEndpoints', {
      restApiName: `${cdk.Stack.of(this).stackName}-restApi`,
      description: `${cdk.Stack.of(this).stackName} Rest API Gateway`,
      cloudWatchRole: true,
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: false, // enable x-ray
        // accessLogDestination: new apigw.LogGroupLogDestination(logGroup),
        // accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields(),
        // loggingLevel: apigw.MethodLoggingLevel.INFO
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
    new cdk.CfnOutput(this, "AiOpsRestApiUrl", { value: `${this.restApi.url}` })
    /******************************************************************************* */

    const lambdaExecutionRole = new iam.Role(this, 'QPluginLambdaRole', {
      roleName: 'QPluginLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role to be assumed by QPlugin functions',
    });
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "kms:CreateGrant",
        "events:PutEvents"
      ],
      resources: ['*']
    }));

    /*** Lambda function to mimic State machine callbacks from integrated services ***/
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "states:SendTaskSuccess",
        "states:SendTaskFailure"
      ],
      resources: ['*']
    }));

    const qPluginFunction = new lambda.Function(this, 'qPlugin', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/QPluginFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(600),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      role: lambdaExecutionRole,
      tracing: lambda.Tracing.DISABLED,
      environment: {
      },
    });

    new logs.LogGroup(this, 'qPluginLogGroup', {
      logGroupName: `/aws/lambda/${qPluginFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const createTicketApi = this.restApi.root.addResource('create-ticket');
    createTicketApi.addMethod(
      'GET',
      new LambdaIntegration(qPluginFunction, { proxy: true }),
    );

    const consultQApi = this.restApi.root.addResource('consult-q');
    consultQApi.addMethod(
      'GET',
      new LambdaIntegration(qPluginFunction, { proxy: true }),
    );
    /******************************************************************************* */
  }
}