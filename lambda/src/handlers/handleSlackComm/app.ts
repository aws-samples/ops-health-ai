import { APIGatewayProxyEventV2 } from "aws-lambda"
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts"
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { WebClient } from '@slack/web-api';

interface ApiGwResponse {
  headers: {
    'Content-Type': string,
    'Access-Control-Allow-Methods': string,
    'Access-Control-Allow-Origin': string
  },
  statusCode: Number,
  body: string
}

interface VerificationRequest {
  token: string
  challenge: string
}

let credentialProvider = fromNodeProviderChain({})
const evt = new EventBridgeClient({ credentials: credentialProvider })
const sts = new STSClient({ credentials: credentialProvider });
const getCallerIdentityCommand = new GetCallerIdentityCommand({});
const responseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Origin': '*'
}

const verifyToken = async (requestParams: VerificationRequest): Promise<ApiGwResponse> => {
  if (requestParams.token === process.env.SLACK_APP_VERIFICATION_TOKEN as string) {
    return {
      headers: responseHeaders,
      statusCode: 200,
      body: requestParams.challenge
    }
  } else {
    return {
      headers: responseHeaders,
      statusCode: 400,
      body: "Slack app token verification failed."
    }
  }
}
const slack = new WebClient(process.env.SLACK_ACCESS_TOKEN as string);
const dispatchRequest = async (requestParams: any): Promise<ApiGwResponse> => {
  /* Clean up input message */
  try {
    requestParams.event.text = requestParams.event.text.replace(`<@${requestParams.authorizations[0].user_id}>`, ' ')
  } catch (err) {
    console.log(`Could not cleanup Slack payload: `, JSON.stringify(requestParams));
    throw err;
  }
  /* strip any leading spaces and then get the leading 8 chars of the string */
  const parsedMessageType = requestParams.event.text.trim().slice(0, 8);
  let detailType = 'Chat.SlackMessageReceived'
  if (parsedMessageType === '@history') {
    const input = [];
    let slackResp = await slack.conversations.replies({
      channel: requestParams.event.channel,
      ts: requestParams.event.thread_ts
    });
    if (slackResp.ok && slackResp.messages) {
      const promptConversationHistory = [];
      // The last message in the threadHistory result is also the current message, so
      // to avoid duplicating chatHistory with the current message we skip the
      // last element in threadHistory message array.
      for (const m of slackResp.messages.slice(0, -1)) {
        if (!m.user) {
          continue;
        }
        promptConversationHistory.push({
          name: requestParams.event.user,
          message: m.text,
          date: m.ts ? new Date(Number(m.ts) * 1000).toISOString() : undefined
        });
      }

      if (promptConversationHistory.length > 0)
        input.push(
          `Given the following conversation thread history in JSON:\n${JSON.stringify(
            promptConversationHistory
          )}`
        );
    }
    requestParams.event.text = requestParams.event.text.replace(`@history`, `${input.join(`\n${'-'.repeat(10)}\n`)}\n The user query is: `)
  }

  const putEventsCommand = new PutEventsCommand({
    Entries: [
      {
        Time: new Date("TIMESTAMP"),
        Source: `${process.env.EVENT_DOMAIN_PREFIX as string}.ops-orchestration`,
        Resources: [],
        DetailType: detailType,
        Detail: JSON.stringify(requestParams),
        EventBusName: process.env.INTEGRATION_EVENT_BUS_NAME as string,
        TraceHeader: process.env.AWS_LAMBDA_FUNCTION_NAME as string,
      },
    ]
  })
  return evt.send(putEventsCommand)
    .then(res => {
      return {
        headers: responseHeaders,
        statusCode: 200,
        body: JSON.stringify(res)
      }
    })
    .catch(error => {
      console.log(error)
      return {
        headers: responseHeaders,
        statusCode: 400,
        body: error as string
      }
    });
}

// Lambda handler
export const lambdaHandler = async (event: APIGatewayProxyEventV2): Promise<ApiGwResponse> => {
  console.log("Incoming event:", JSON.stringify(event));
  let payload = event.body ? JSON.parse(event.body) : ''

  switch (payload.type) {
    case "url_verification": { return verifyToken(payload) };
    case "event_callback": { return dispatchRequest(payload) };
    default: return {
      headers: responseHeaders,
      statusCode: 400,
      body: "Unknown type of request"
    };
  }
}