import os
import json
import boto3
import uuid
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

    # TESTING MODE: Use hardcoded data if no WebSocket endpoint is configured
    if not websocket_api_endpoint:
        context.log("TESTING MODE: WebSocket API endpoint not configured, using mock data")
        return handle_test_mode(event, context)

    # Extract message and thread info from event
    message = event.get('message', {})
    thread_id = event.get('threadId')

    # Generate thread ID if not provided (Slack timestamp format)
    if not thread_id:
        # Generate Slack-compatible timestamp format: seconds.microseconds
        import time
        current_time = time.time()
        thread_id = f"{current_time:.6f}"

    # Add metadata to message
    message_with_metadata = {
        **message,
        'threadId': thread_id,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'messageId': str(uuid.uuid4())
    }

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
    """Truncate message content if too long (similar to SlackMe function)"""
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

def handle_test_mode(event, context):
    """Handle testing mode with hardcoded data when WebSocket API is not available"""

    # Use provided event data or fallback to test data
    message = event.get('message', {})
    thread_id = event.get('threadId')

    # If no message provided, use test data
    if not message:
        message = {
            "type": "health_event",
            "title": "TEST: Request for triage for a new AWS Health event",
            "eventType": "EC2_INSTANCE_RETIREMENT",
            "status": "open",
            "startTime": "2024-01-15T10:30:00Z",
            "description": "TEST: Your EC2 instance i-1234567890abcdef0 in us-east-1 will be retired on 2024-01-20. Please migrate your workload.",
            "actions": [
                {
                    "type": "button",
                    "text": "Accept event",
                    "action": "accept",
                    "url": "https://api.example.com/event-callback?status=SUCCESS&taskToken=test123",
                    "style": "primary"
                },
                {
                    "type": "button",
                    "text": "Discharge event",
                    "action": "discharge",
                    "url": "https://api.example.com/event-callback?status=FAILURE&taskToken=test123",
                    "style": "danger"
                }
            ]
        }

    # Generate thread ID if not provided (Slack timestamp format)
    if not thread_id:
        # Generate Slack-compatible timestamp format: seconds.microseconds
        import time
        current_time = time.time()
        thread_id = f"{current_time:.6f}"

    # Add metadata to message
    message_with_metadata = {
        **message,
        'threadId': thread_id,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'messageId': f"msg-{int(time.time() * 1000000)}"
    }

    # Mock WebSocket connections for testing
    mock_connections = [
        {"connectionId": "test-conn-001", "userId": "user1"},
        {"connectionId": "test-conn-002", "userId": "user2"},
        {"connectionId": "test-conn-003", "userId": "user3"}
    ]

    context.log("TEST MODE: Simulating broadcast to connections:")
    for conn in mock_connections:
        context.log(f"  -> Would send to connection: {conn['connectionId']} (user: {conn.get('userId', 'anonymous')})")

    context.log(f"TEST MODE: Message that would be sent:")
    context.log(json.dumps(message_with_metadata, indent=2))

    # Return test response
    return {
        'statusCode': 200,
        'body': {
            'threadId': thread_id,
            'messageId': message_with_metadata['messageId'],
            'timestamp': message_with_metadata['timestamp'],
            'successfulSends': len(mock_connections),
            'failedConnections': 0,
            'totalConnections': len(mock_connections),
            'testMode': True,
            'mockConnections': [conn['connectionId'] for conn in mock_connections],
            'messagePreview': message_with_metadata
        }
    }