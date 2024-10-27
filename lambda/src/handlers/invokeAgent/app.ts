import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  InvokeAgentRequest,
  InvokeAgentResponse,
} from '@aws-sdk/client-bedrock-agent-runtime';

import { v4 as uuid } from 'uuid';

interface AgentResponse {
  Output: {
    Text: string
  },
  SessionId: string | undefined
  ExpiresAt: String
}

type ErrorName = 'AiAgentError'
class AiAgentError extends Error {
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
export const lambdaHandler = async (event: any): Promise<AgentResponse> => {
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

  const input: InvokeAgentRequest = {
    agentId: process.env.AGENT_ID,
    agentAliasId: process.env.AGENT_ALIAS_ID,
    sessionId: sessionId,
    inputText: prompt,
  };

  const command: InvokeAgentCommand = new InvokeAgentCommand(input);
  try {
    const response: InvokeAgentResponse = await bedrockAgent.send(command);

    const chunks = [];
    const completion = response.completion || [];
    for await (const chunk of completion) {
      if (chunk.chunk && chunk.chunk.bytes) {
        const output = Buffer.from(chunk.chunk.bytes).toString('utf-8');
        chunks.push(output);
      }
    }

    //normalize response
    const resp = {
      Output: {
        Text: chunks.join(' ')
      },
      SessionId: response.sessionId,
      ExpiresAt: sessionExpiresAt.toString()
    }
    console.log("Agent response: ", JSON.stringify(resp));
    return resp
  } catch (err) {
    console.log("Invoke Agent error occurred.");
    throw new AiAgentError({
      name: 'AiAgentError',
      message: 'AI agent retry-able error',
      cause: err
    })
  }
}
