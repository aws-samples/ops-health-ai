// import { SlackEventsEnv } from '@functions/slack-event-handler';
// import { SlackInteractionsEnv } from '@functions/slack-interaction-handler';
// import { makeLogger } from '@src/logging';
import { v4 as uuid } from 'uuid';
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
import { Credentials } from 'aws-sdk';

let amazonQClient: QBusinessClient | null = null;

export const getClient = (iamSessionCreds: Credentials) => {
  if (amazonQClient === null) {
    amazonQClient = new QBusinessClient({
      credentials: iamSessionCreds,
      region: 'us-east-1'
    });
  }

  return amazonQClient;
};

export const callClient = async (
  message: string,
  attachments: AttachmentInput[],
  // env: SlackEventsEnv,
  iamSessionCreds: Credentials,
  amazonQAppId: string,
  context?: {
    conversationId: string;
    parentMessageId: string;
  }
): Promise<ChatSyncCommandOutput> => {
  const input = {
    applicationId: amazonQAppId,
    clientToken: uuid(),
    userMessage: message,
    ...(attachments.length > 0 && { attachments }),
    ...context
  };

  console.log(`callClient input ${JSON.stringify(input)}`);
  return await getClient(iamSessionCreds).send(new ChatSyncCommand(input));
};

export const submitFeedbackRequest = async (
  // env: SlackInteractionsEnv,
  amazonQAppId: string,
  iamSessionCreds: Credentials,
  context: {
    conversationId: string;
    messageId: string;
  },
  usefulness: MessageUsefulness,
  reason: MessageUsefulnessReason,
  submittedAt: string
): Promise<PutFeedbackCommandOutput> => {
  const input: PutFeedbackCommandInput = {
    applicationId: amazonQAppId,
    ...context,
    messageUsefulness: {
      usefulness: usefulness,
      reason: reason,
      // Slack ts format E.g. 1702282895.883219
      submittedAt: new Date(Number(submittedAt) * 1000)
    }
  };

  console.log(`putFeedbackRequest input ${JSON.stringify(input)}`);
  const response = await getClient(iamSessionCreds).send(new PutFeedbackCommand(input));
  console.log(`putFeedbackRequest output ${JSON.stringify(response)}`);

  return response;
};