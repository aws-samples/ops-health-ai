import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
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

let credentialProvider = fromNodeProviderChain({})
const sts = new STSClient({ credentials: credentialProvider });
const getCallerIdentityCommand = new GetCallerIdentityCommand({});
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

  const prompt = event.detail.event.text

  const input: InvokeAgentRequest = {
    // sessionState: {
    //   sessionAttributes,
    //   promptSessionAttributes,
    // },
    agentId: process.env.AGENT_ID,
    agentAliasId: process.env.AGENT_ALIAS_ID,
    sessionId: sessionId,
    inputText: prompt,
  };

  const command: InvokeAgentCommand = new InvokeAgentCommand(input);
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
}
