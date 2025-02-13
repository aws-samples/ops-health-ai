import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import {
  BedrockAgentRuntimeClient,
  InvokeFlowCommand,
  InvokeFlowRequest,
  InvokeFlowResponse,
  InvokeFlowCommandOutput
} from '@aws-sdk/client-bedrock-agent-runtime';

import { v4 as uuid } from 'uuid';

interface FlowResponse {
  Output: {
    Text: string
  },
  // SessionId: string | undefined
  ExpiresAt: String
}

type ErrorName = 'AiFlowError'
class AiFlowError extends Error {
  name: ErrorName;
  message: string;
  cause: any;
  constructor({
    name,
    message,
    cause
  }: {
    name: ErrorName;
    message: string;
    cause?: any;
  }) {
    super();
    this.name = name;
    this.message = message;
    this.cause = cause;
  }
}

const bedrockAgent = new BedrockAgentRuntimeClient();

// Lambda handler
export const lambdaHandler = async (event: any): Promise<FlowResponse> => {
  console.log("Incoming event:", JSON.stringify(event));

  const sessionExpiresAt = Math.floor((Date.now() + 20 * 60 * 1000) / 1000); // extend TTL of the agent session by 20 mins
  let sessionId = ''
  try {
    sessionId = event.GetUserSession.Item.AgentSessionID.S
  } catch (error) {
    sessionId = uuid()
    console.log('Could not fetch existing session id, using generated...')
  }

  let prompt = event.detail.event.text
  if (event.detail.event.payloadS3Key) {
    const key = event.detail.event.payloadS3Key
    const s3 = new S3Client();
    const params = { Bucket: process.env.PAYLOAD_BUCKET, Key: key };
    const data = await s3.send(new GetObjectCommand(params));
    const fileContent = await data.Body?.transformToString();
    prompt = fileContent;
  }

  const input: InvokeFlowRequest = {
    flowIdentifier: process.env.FLOW_ID,
    flowAliasIdentifier: process.env.FLOW_ALIAS_ID,
    inputs: [
      {
        nodeName: "FlowInputNode", // required
        nodeOutputName: "document", // required
        content: {
          document: prompt,
        },
      },
    ],
  };

  const command: InvokeFlowCommand = new InvokeFlowCommand(input);
  try {
    const response: InvokeFlowResponse = await bedrockAgent.send(command);

    let flowResponse = {};

    for await (const chunkEvent of response.responseStream || []) {
      const { flowOutputEvent, flowCompletionEvent } = chunkEvent;

      if (flowOutputEvent) {
        flowResponse = { ...flowResponse, ...flowOutputEvent };
        console.log("Flow output event:", flowOutputEvent);
      } else if (flowCompletionEvent) {
        flowResponse = { ...flowResponse, ...flowCompletionEvent };
        console.log("Flow completion event:", flowCompletionEvent);
      }
    }
    console.log("Agent flow response:", JSON.stringify(flowResponse));

    // const chunks = [];
    // const completion = response.responseStream || [];
    // for await (const chunk of completion) {
    //   if (chunk) {
    //     chunks.push(chunk);
    //   }
    // }

    // //normalize response
    // const resp = {
    //   Output: {
    //     Text: chunks.join(' ')
    //   },
    //   // SessionId: response.sessionId,
    //   ExpiresAt: sessionExpiresAt.toString()
    // }
    // console.log("Agent flow response: ", JSON.stringify(resp));
    // return resp
  } catch (err) {
    console.log("Invoke flow error occurred.");
    throw new AiFlowError({
      name: 'AiFlowError',
      message: 'AI flow retry-able error',
      cause: err
    })
  }
}
