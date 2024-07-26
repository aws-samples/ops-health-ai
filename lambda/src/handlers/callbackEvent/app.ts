import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts"
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand, SendTaskSuccessCommandOutput, SendTaskFailureCommandOutput } from "@aws-sdk/client-sfn"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

interface BaseEventStringParams {
  taskToken: string
  rawToken?: string
}

interface SuccessEventParams extends BaseEventStringParams {
  status: "SUCCESS"
}

interface FailureEventParams extends BaseEventStringParams {
  status: "FAILURE";
  error: string;
  cause: string;
}

interface EventParams {
  queryStringParameters: SuccessEventParams | FailureEventParams
}

interface ApiGwResponse {
  isBase64Encoded: true | false,
  headers: {
    'Content-Type': string
    'Access-Control-Allow-Methods': string
    'Access-Control-Allow-Origin': string
  },
  statusCode: Number,
  body: string
}

let credentialProvider = fromNodeProviderChain({})
const sfn = new SFNClient({ credentials: credentialProvider })
const sts = new STSClient({ credentials: credentialProvider });
const getCallerIdentityCommand = new GetCallerIdentityCommand({});
const responseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Origin': '*'
}

export const lambdaHandler = async (event: any, context: any): Promise<ApiGwResponse> => {
  console.log('Event content:', JSON.stringify(event))

  if (!('queryStringParameters' in event) || event.queryStringParameters===null ||!('taskToken' in event.queryStringParameters && 'status' in event.queryStringParameters)){
    return {
      isBase64Encoded: false,
      headers: responseHeaders,
      statusCode: 401,
      body: 'Querystring input does not match input type.'
    }
  }

  console.log('Acquired Status:', JSON.stringify(event.queryStringParameters.status))
  console.log('Acquired TaskToken:', JSON.stringify(event.queryStringParameters.taskToken))
  const callerIdResp = await sts.send(getCallerIdentityCommand);
  console.log('SDK Caller ID: ', callerIdResp['Arn'])

  if (event.queryStringParameters.status === "SUCCESS") {
    const eventParams = event.queryStringParameters as SuccessEventParams
    return {
      isBase64Encoded: false,
      headers: responseHeaders,
      statusCode: 200,
      body: JSON.stringify(await callbackWithSuccess(eventParams))
    }
  } else {
    const eventParams = event.queryStringParameters as FailureEventParams
    return {
      isBase64Encoded: false,
      headers: responseHeaders,
      statusCode: 500,
      body: JSON.stringify(await callbackWithFailure(eventParams))
    }
  }
}

const callbackWithSuccess = async (eventParams: SuccessEventParams): Promise<SendTaskSuccessCommandOutput> => {
  let taskToken = atob(eventParams.taskToken)
  if (eventParams.rawToken) { taskToken = eventParams.rawToken }
  const sendTaskSuccessCommand = new SendTaskSuccessCommand({
    taskToken: taskToken,
    output: JSON.stringify({
      Payload: "SUCCESS"
    })
  })
  return sfn.send(sendTaskSuccessCommand)
    .then(res => {
      console.log('Accepted by operator');
      return res
    })
    .catch(error => error);
}

const callbackWithFailure = async (eventParams: FailureEventParams): Promise<SendTaskFailureCommandOutput> => {
  let taskToken = atob(eventParams.taskToken)
  if (eventParams.rawToken) { taskToken = eventParams.rawToken }
  const sendTaskFailureCommand = new SendTaskFailureCommand({
    taskToken: taskToken,
    error: "RejectedByOperator Error",
    cause: "Rejected by operator"
  })
  return sfn.send(sendTaskFailureCommand)
    .then(res => {
      console.log('Rejected by operator');
      return res
    })
    .catch(error => error);
}
