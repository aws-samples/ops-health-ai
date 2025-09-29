import os
import json
import boto3
import uuid
import time
from datetime import datetime

# Initialize AWS clients
dynamodb_client = boto3.client('dynamodb')
apigateway_client = None  # Will be initialized when needed

# Environment variables
connections_table_name = os.environ.get('CONNECTIONS_TABLE_NAME', 'WebSocketConnections')
websocket_api_endpoint = os.environ.get('WEBSOCKET_API_ENDPOINT')


def get_apigateway_client():
    """Initialize API Gateway client with WebSocket endpoint"""
    global apigateway_client
    if apigateway_client is None and websocket_api_endpoint:
        apigateway_client = boto3.client('apigatewaymanagementapi',
            endpoint_url=websocket_api_endpoint)
    return apigateway_client



def lambda_handler(event, context):
    """Send messages to all active WebSocket connections"""

    context.log("Incoming Event: " + json.dumps(event) + "\n")

    # Validate WebSocket endpoint configuration
    if not websocket_api_endpoint:
        context.log("ERROR: WebSocket API endpoint not configured")
        return {
            'statusCode': 500,
            'body': {
                'error': 'WebSocket API endpoint not configured',
                'threadId': event.get('threadId')
            }
        }

    # Extract message and thread info from event
    message = event.get('message', {})
    thread_id = event.get('threadId')

    # Extract channel from message (if present) and pass it through
    channel = message.get('channel')

    # Normalize thread ID - handle DynamoDB format {"S": "value"} or plain string
    if thread_id:
        if isinstance(thread_id, dict):
            # Handle DynamoDB format - extract string value or generate new if not string type
            if 'S' in thread_id:
                thread_id = thread_id['S']
            else:
                # DynamoDB object but not string type - generate new threadId
                current_time = time.time()
                thread_id = f"{current_time:.6f}"
        # If it's already a string, keep it as-is
    else:
        # Generate thread ID if not provided (Slack timestamp format)
        current_time = time.time()
        thread_id = f"{current_time:.6f}"

    # Add metadata to message
    message_with_metadata = {
        **message,
        'threadId': thread_id,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'messageId': str(uuid.uuid4())
    }

    # Add channel information if present
    if channel:
        message_with_metadata['channel'] = channel

    try:
        # Get all active WebSocket connections using DynamoDB client
        response = dynamodb_client.scan(TableName=connections_table_name)
        connections = response.get('Items', [])

        if not connections:
            context.log("No active WebSocket connections found")
            return {
                'statusCode': 200,
                'body': {
                    'threadId': thread_id,
                    'successfulSends': 0,
                    'failedConnections': 0,
                    'message': 'No active connections'
                }
            }

        # Get API Gateway client
        client = get_apigateway_client()
        if not client:
            raise Exception("WebSocket API endpoint not configured")

        # Broadcast to all connections
        successful_sends = []
        failed_connections = []

        for connection in connections:
            # Extract connectionId from DynamoDB item format
            connection_id = connection['connectionId']['S']
            try:
                client.post_to_connection(
                    ConnectionId=connection_id,
                    Data=json.dumps(message_with_metadata)
                )
                successful_sends.append(connection_id)
                context.log(f"Message sent successfully to connection: {connection_id}")

            except client.exceptions.GoneException:
                # Connection is stale, mark for cleanup
                failed_connections.append(connection_id)
                context.log(f"Connection gone, marking for cleanup: {connection_id}")

            except Exception as e:
                # Other errors, also mark for cleanup
                failed_connections.append(connection_id)
                context.log(f"Error sending to connection {connection_id}: {str(e)}")

        # Clean up stale connections using DynamoDB client
        for failed_conn in failed_connections:
            try:
                dynamodb_client.delete_item(
                    TableName=connections_table_name,
                    Key={'connectionId': {'S': failed_conn}}
                )
                context.log(f"Cleaned up stale connection: {failed_conn}")
            except Exception as e:
                context.log(f"Error cleaning up connection {failed_conn}: {str(e)}")

        # Return success response
        return {
            'statusCode': 200,
            'body': {
                'threadId': thread_id,
                'messageId': message_with_metadata['messageId'],
                'timestamp': message_with_metadata['timestamp'],
                'successfulSends': len(successful_sends),
                'failedConnections': len(failed_connections),
                'totalConnections': len(connections)
            }
        }

    except Exception as e:
        context.log(f"Error in WebChatMe function: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'threadId': thread_id
            }
        }

def truncate_message(message_obj, max_length=4000):
    """Truncate message content if too long"""
    if isinstance(message_obj, dict) and 'text' in message_obj:
        text = message_obj['text']
        if len(text) > max_length:
            words = text.split(' ')
            output = []

            for word in words:
                if len(' '.join(output + [word])) > max_length:
                    break
                output.append(word)

            truncated = ' '.join(output)
            if len(truncated) < len(text):
                truncated += "..."

            message_obj['text'] = truncated

    return message_obj

