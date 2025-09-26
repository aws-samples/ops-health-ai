import { APIGatewayProxyEventV2 } from "aws-lambda"
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts"
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge"
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

interface ApiGwResponse {
  headers: {
    'Content-Type': string,
    'Access-Control-Allow-Methods': string,
    'Access-Control-Allow-Origin': string
  },
  statusCode: Number,
  body: string
}

interface WebChatMessage {
  connectionId: string
  userId?: string
  text: string
  timestamp: string
  threadId?: string
  messageType?: string
  payloadS3Key?: string
}

interface WebChatEvent {
  requestContext: {
    connectionId: string
    routeKey: string
  }
  body: string
}

let credentialProvider = fromNodeProviderChain({})
const evt = new EventBridgeClient({ credentials: credentialProvider })
const sts = new STSClient({ credentials: credentialProvider });
const dynamodb = new DynamoDBClient({ credentials: credentialProvider });
const getCallerIdentityCommand = new GetCallerIdentityCommand({});
const responseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Origin': '*'
}

const handleTeamChannelsRequest = async (connectionId: string): Promise<ApiGwResponse> => {
  try {
    // Scan the team management table to get all team channels
    const scanCommand = new ScanCommand({
      TableName: process.env.TEAM_MANAGEMENT_TABLE_NAME,
      ProjectionExpression: 'PK, ChannelName, SlackChannelId'
    });

    const result = await dynamodb.send(scanCommand);

    const teamChannels = result.Items?.map(item => ({
      PK: item.PK?.S || '',
      ChannelName: item.ChannelName?.S || '',
      SlackChannelId: item.SlackChannelId?.S || ''
    })) || [];

    console.log(`Retrieved ${teamChannels.length} team channels for connection: ${connectionId}`);

    // Send response back through WebSocket using API Gateway Management API
    const apiGatewayManagementApi = new ApiGatewayManagementApiClient({
      credentials: credentialProvider,
      endpoint: process.env.WEBSOCKET_API_ENDPOINT
    });

    const responseMessage = {
      type: 'teamChannels',
      data: teamChannels,
      timestamp: new Date().toISOString()
    };

    await apiGatewayManagementApi.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(responseMessage)
      })
    );

    return {
      headers: responseHeaders,
      statusCode: 200,
      body: JSON.stringify({ message: 'Team channels sent successfully' })
    };

  } catch (error) {
    console.error('Error handling team channels request:', error);

    // Try to send error message back to client
    try {
      const apiGatewayManagementApi = new ApiGatewayManagementApiClient({
        credentials: credentialProvider,
        endpoint: process.env.WEBSOCKET_API_ENDPOINT
      });

      const errorMessage = {
        type: 'error',
        message: 'Failed to retrieve team channels',
        timestamp: new Date().toISOString()
      };

      await apiGatewayManagementApi.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: JSON.stringify(errorMessage)
        })
      );
    } catch (sendError) {
      console.error('Error sending error message:', sendError);
    }

    return {
      headers: responseHeaders,
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to retrieve team channels' })
    };
  }
};

const dispatchWebChatMessage = async (webChatEvent: WebChatEvent): Promise<ApiGwResponse> => {
  try {
    // Parse the WebSocket message
    const messageData: WebChatMessage = JSON.parse(webChatEvent.body);
    const connectionId = webChatEvent.requestContext.connectionId;

    // Handle ping messages (heartbeat) - just acknowledge and return
    if (messageData.text === undefined && (messageData as any).action === 'ping') {
      console.log(`Heartbeat ping received from connection: ${connectionId}`);
      return {
        headers: responseHeaders,
        statusCode: 200,
        body: JSON.stringify({ message: 'pong' })
      };
    }

    // Handle team channels request - return team management table data
    if (messageData.text === undefined && (messageData as any).action === 'getTeamChannels') {
      console.log(`Team channels request received from connection: ${connectionId}`);
      return await handleTeamChannelsRequest(connectionId);
    }

    // Add connection metadata
    messageData.connectionId = connectionId;
    messageData.timestamp = new Date().toISOString();

    // Clean up input message - remove any leading/trailing whitespace
    if (messageData.text) {
      messageData.text = messageData.text.trim();
    }

    let detailType = 'Chat.SlackMessageReceived';

    // Create event payload
    const eventPayload: {
      event: {
        connectionId: string;
        userId?: string;
        user?: string;
        text: string;
        ts: string;           // Add 'ts' field for AI system compatibility
        timestamp: string;    // Keep timestamp for web chat
        threadId?: string;
        messageType: string;
        channel?: string;     // Add channel field for AI system compatibility
        payloadS3Key?: string;
      };
      source: string;
    } = {
      event: {
        connectionId: connectionId,
        userId: messageData.userId,
        user: messageData.userId || 'anonymous',
        text: messageData.text,
        ts: messageData.threadId || messageData.timestamp, // Use threadId as 'ts' for AI system
        timestamp: messageData.timestamp,
        threadId: messageData.threadId,
        messageType: messageData.messageType || 'message',
        channel: connectionId // Use connectionId as channel equivalent
      },
      source: 'webchat'
    };

    let eventDetail = JSON.stringify(eventPayload);

    // Handle large payloads by storing in S3 (similar to Slack handler)
    if (Buffer.byteLength(eventDetail) > 200000) {
      const key = `ops-event-payloads/webchat-${connectionId}-${Date.now()}`;
      const s3 = new S3Client({ credentials: credentialProvider });
      const params = {
        Bucket: process.env.PAYLOAD_BUCKET,
        Key: key,
        Body: eventDetail
      };
      await s3.send(new PutObjectCommand(params));

      // Create smaller payload with S3 reference
      eventPayload.event.text = '';
      eventPayload.event.payloadS3Key = key;
      eventDetail = JSON.stringify(eventPayload);
    }



    // Send event to EventBridge
    const putEventsCommand = new PutEventsCommand({
      Entries: [
        {
          Time: new Date(),
          Source: `${process.env.EVENT_DOMAIN_PREFIX as string}.ops-orchestration`,
          Resources: [],
          DetailType: detailType,
          Detail: eventDetail,
          EventBusName: process.env.INTEGRATION_EVENT_BUS_NAME as string,
          TraceHeader: process.env.AWS_LAMBDA_FUNCTION_NAME as string,
        },
      ]
    });

    const result = await evt.send(putEventsCommand);

    return {
      headers: responseHeaders,
      statusCode: 200,
      body: JSON.stringify({
        message: 'Message processed successfully',
        eventId: result.Entries?.[0]?.EventId,
        timestamp: messageData.timestamp
      })
    };

  } catch (error) {
    console.error('Error processing web chat message:', error);
    return {
      headers: responseHeaders,
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to process message',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};



const validateApiKey = (event: any): boolean => {
  try {
    // Check for API key in query string parameters
    const queryParams = event.queryStringParameters || {};
    const providedApiKey = queryParams.apiKey || queryParams.api_key;

    // Check for API key in headers (alternative method)
    const headers = event.headers || {};
    const headerApiKey = headers['x-api-key'] || headers['X-API-Key'];

    const apiKeyToValidate = providedApiKey || headerApiKey;
    const expectedApiKey = process.env.WEB_CHAT_API_KEY;

    if (!expectedApiKey) {
      console.warn('WEB_CHAT_API_KEY not configured, allowing connection');
      return true; // Allow connection if no API key is configured
    }

    if (!apiKeyToValidate) {
      console.error('No API key provided in connection request');
      return false;
    }

    const isValid = apiKeyToValidate === expectedApiKey;
    if (!isValid) {
      console.error('Invalid API key provided');
    }

    return isValid;

  } catch (error) {
    console.error('Error validating API key:', error);
    return false;
  }
};

const handleConnect = async (connectionId: string, event: any): Promise<ApiGwResponse> => {
  try {
    // Validate API key first
    if (!validateApiKey(event)) {
      console.log(`Connection rejected for ${connectionId}: Invalid API key`);
      return {
        headers: responseHeaders,
        statusCode: 401,
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'Invalid or missing API key'
        })
      };
    }

    const timestamp = new Date().toISOString();

    // Extract user info from query parameters (optional)
    const queryParams = event.queryStringParameters || {};
    const userId = queryParams.userId || 'anonymous';

    // Store connection in DynamoDB connections table
    if (process.env.CONNECTIONS_TABLE_NAME) {
      const putItemCommand = new PutItemCommand({
        TableName: process.env.CONNECTIONS_TABLE_NAME,
        Item: {
          connectionId: { S: connectionId },
          userId: { S: userId },
          connectedAt: { S: timestamp },
          lastActivity: { S: timestamp },
          // TTL: Auto-cleanup after 24 hours
          ttl: { N: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000).toString() }
        }
      });

      await dynamodb.send(putItemCommand);
      console.log(`WebSocket connection stored: ${connectionId} (user: ${userId})`);
    }

    return {
      headers: responseHeaders,
      statusCode: 200,
      body: JSON.stringify({
        message: 'Connected successfully',
        connectionId: connectionId,
        userId: userId,
        timestamp: timestamp
      })
    };

  } catch (error) {
    console.error('Error handling WebSocket connection:', error);
    return {
      headers: responseHeaders,
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to establish connection',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

const handleDisconnect = async (connectionId: string): Promise<ApiGwResponse> => {
  try {
    // Remove connection from DynamoDB connections table
    if (process.env.CONNECTIONS_TABLE_NAME) {
      const deleteItemCommand = new DeleteItemCommand({
        TableName: process.env.CONNECTIONS_TABLE_NAME,
        Key: {
          connectionId: { S: connectionId }
        }
      });

      await dynamodb.send(deleteItemCommand);
      console.log(`WebSocket connection removed: ${connectionId}`);
    }

    return {
      headers: responseHeaders,
      statusCode: 200,
      body: JSON.stringify({
        message: 'Disconnected successfully',
        connectionId: connectionId
      })
    };

  } catch (error) {
    console.error('Error handling WebSocket disconnection:', error);
    return {
      headers: responseHeaders,
      statusCode: 200, // Return 200 even on error to avoid WebSocket issues
      body: JSON.stringify({
        message: 'Disconnected',
        connectionId: connectionId
      })
    };
  }
};

// Lambda handler for WebSocket events
export const lambdaHandler = async (event: any): Promise<ApiGwResponse> => {
  console.log("Incoming WebSocket event:", JSON.stringify(event));

  const connectionId = event.requestContext?.connectionId;
  const routeKey = event.requestContext?.routeKey;

  if (!connectionId) {
    return {
      headers: responseHeaders,
      statusCode: 400,
      body: JSON.stringify({ error: 'No connection ID found' })
    };
  }

  // Handle different WebSocket route types

  switch (routeKey) {
    case '$connect':
      return handleConnect(connectionId, event);

    case '$disconnect':
      return handleDisconnect(connectionId);

    case 'message':
    case '$default':
      return dispatchWebChatMessage(event);

    default:
      return {
        headers: responseHeaders,
        statusCode: 400,
        body: JSON.stringify({ error: `Unknown route: ${routeKey}` })
      };
  }
};