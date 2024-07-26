import { callClient } from "./qHeloper"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { Credentials } from 'aws-sdk';
import {
  QBusinessClient,
  ChatSyncCommand,
  PutFeedbackCommand,
  PutFeedbackCommandInput,
  MessageUsefulnessReason,
  MessageUsefulness,
  PutFeedbackCommandOutput,
  ChatSyncCommandOutput,
  AttachmentInput
} from '@aws-sdk/client-qbusiness';
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts"
import { v4 as uuid } from 'uuid';



let credentialProvider = fromNodeProviderChain({})
const amazonQ = new QBusinessClient({ credentials: credentialProvider, region: 'us-east-1' })
const sts = new STSClient({ credentials: credentialProvider });
const getCallerIdentityCommand = new GetCallerIdentityCommand({});
const responseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Origin': '*'
}


export const lambdaHandler = async (event: any, context: any): Promise<any> => {
  console.log('Event content:', JSON.stringify(event))

  const input = {
    userId: "seanxw@amazon.com",
    applicationId: process.env.AMAZON_Q_APP_ID,
    clientToken: uuid(),
    userMessage: 'Hello!',
    // ...(attachments.length > 0 && { attachments }),
    ...context
  };

  console.log(`callClient input ${JSON.stringify(input)}`);
  return await amazonQ.send(new ChatSyncCommand(input));

  return {
    isBase64Encoded: false,
    headers: responseHeaders,
    statusCode: 200,
    body: "action completed successfully"
  }
}
