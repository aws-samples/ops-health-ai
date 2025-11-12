# ============================================================================
# Tools for OpsAgent
# ============================================================================
from strands import tool
import boto3
import json
import os
import uuid
from datetime import datetime

# Setting up tool and utility environment
team_table = os.environ.get('TEAM_TABLE')
region = os.environ['AWS_REGION']
ops_knowledge_base_id = os.environ['OPS_KNOWLEDGE_BASE_ID']
sechub_knowledge_base_id = os.environ['SECHUB_KNOWLEDGE_BASE_ID']
ticket_table = os.environ.get('TICKET_TABLE')
message_event_bus_name = os.environ.get('EVENT_BUS_NAME')
message_event_source_name = os.environ.get('EVENT_SOURCE_NAME')

bedrock_agent_runtime = bedrock_agent_runtime = boto3.client(
    service_name='bedrock-agent-runtime',
    region_name=region,
)

dynamodb = dynamodb = boto3.client(
    service_name='dynamodb',
    region_name=region
)

sfn = boto3.client(
    service_name='stepfunctions',
    region_name=region
)

events = boto3.client(
    service_name='events',
    region_name=region
)

@tool
def search_ops_events(query):
    """Search operational health event knowledge base for past operational events using natural language.

    Args:
        query: Search query in natural language (e.g., 'Any known issues with the network that require immediate attention?')

    Returns:
        Dict with search results from the operational events database
    """
    try:
        response = bedrock_agent_runtime.retrieve(
            knowledgeBaseId=ops_knowledge_base_id,
            retrievalQuery={
                'text': query
            },
            retrievalConfiguration={
                'vectorSearchConfiguration': {
                    'numberOfResults': 25,
                    'overrideSearchType': "SEMANTIC",
                    # ---- the below config improves relevance of retrieved but requires botocore>=1.34.71 ----
                    # 'implicitFilterConfiguration': {
                    #     'metadataAttributes': [
                    #         {
                    #             'key': 'eventArn',
                    #             'type': 'STRING',
                    #             'description': 'The unique identifier of a thread of events.',
                    #         },
                    #         {
                    #             'key': 'startTime',
                    #             'type': 'STRING', #"BOOLEAN";"NUMBER";"STRING";"STRING_LIST
                    #             'description': 'The date and time when the event impact starts.',
                    #         },
                    #         {
                    #             'key': 'lastUpdatedTime',
                    #             'type': 'STRING',
                    #             'description': 'The date and time when the event received an update.',
                    #         },
                    #     ],
                    #     'modelArn': f'arn:aws:bedrock:{region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0'
                    # },
                }
            }
        )
        result = {
            "search_ops_events": [
                {
                    "content": chunk['content']['text'],
                    "content_metadata": chunk['metadata']
                }
                for chunk in response['retrievalResults']
            ]
        }
        # print("Ops Knowledge response: ", json.dumps(result, indent=2))
        return result
    except Exception as e:
        print(f"An error occurred: {str(e)}")
        return { "search_ops_events": [] }

@tool
def search_sec_findings(query):
    """Search Security Hub Findings knowledge base for past Security Hub Findings using natural language.

    Args:
        query: Search query in natural language (e.g., 'Any security risks that require immediate attention?')

    Returns:
        Dict with search results from Security Hub findings database
    """
    try:
        response = bedrock_agent_runtime.retrieve(
            knowledgeBaseId=sechub_knowledge_base_id,
            retrievalQuery={
                'text': query
            },
            retrievalConfiguration={
                'vectorSearchConfiguration': {
                    'numberOfResults': 25
                }
            }
        )
        result = {
            "search_sec_findings": [
                {
                    "content": chunk['content']['text'],
                    "content_metadata": chunk['metadata']
                }
                for chunk in response['retrievalResults']
            ]
        }
        # print("SecHub Knowledge response: ", json.dumps(result, indent=2))
        return result
    except Exception as e:
        print(f"An error occurred: {str(e)}")
        return { "search_sec_findings": [] }

@tool
def acknowledge_event(callback_token, action_taken, reason_for_action=None):
    """Acknowledge an operational event and specify the action to take (accept or reject).

    Args:
        callback_token: The token used for callback to confirm the event acknowledgment
        action_taken: The action to take on the event - either "accept" (for further triage) or "reject" (to discharge)
        reason_for_action: Optional reason for the action taken, especially useful when rejecting an event

    Returns:
        Dict with acknowledgment confirmation
    """
    if not callback_token:
        return {
            "acknowledge_event": "success"
        }
    try:
        if not callback_token or not action_taken:
            return {
                "acknowledge_event": {
                    'InputValueError': 'Tool error due to missing required input: callback_token or action_taken.'
                }
            }

        # ====== Testing mockup response ====
        # if action_taken == 'accept':
        #     return {
        #         'acknowledge_event': 'Acknowledged as accepted'
        #     }
        # else:
        #     return {
        #         'acknowledge_event': 'Acknowledged as discharged'
        #     }
        # ==== Mockup response ends here ====

        print(f"Debug callbackToken: {callback_token}")
        print(f"Debug action value: {action_taken}")

        if action_taken == 'accept':
            # Send task success
            response = sfn.send_task_success(
                taskToken=callback_token,
                output=json.dumps({
                    'Payload': 'SUCCESS'
                })
            )
            print('Accepted by operator')
            body = 'Acknowledged as accepted'
        else:
            # Send task failure
            response = sfn.send_task_failure(
                taskToken=callback_token,
                error='RejectedByOperator Error',
                cause='Discharged by operator' if not reason_for_action else reason_for_action
            )
            print('Discharged by operator')
            body = 'Acknowledged as discharged'

        return {
            'acknowledge_event': body
        }
    except Exception as e:
        print(f"Error handling task response: {str(e)}")
        return {
            "acknowledge_event": {
                'ExecutionError': "Acknowledgement failed, please verify if the callback token you used is correct."
                # 'ExecutionError': json.dumps({'error': str(e)})
            }
        }

@tool
def create_ticket(event_pk, ticket_title, ticket_detail='', recommended_action='', event_last_updated_time='', severity='', assignee='', progress='' ):
    """Create a ticket in the system based on an event or a situation description.

    Args:
        event_pk: The primary key (EventPk) of the event associated with this ticket
        ticket_title: The title of the ticket
        recommended_action: Step-by-step guideline and examples on how to remediate the issue or event
        event_last_updated_time: The last updated time of the event associated with this ticket
        severity: Severity level in number ranging from 1-5, with 1 as the lowest and 5 the highest
        assignee: Team ID of the team assigned to the ticket
        progress: Current progress status of the ticket
        ticket_detail: Optional detailed description of the event or issue

    Returns:
        Dict with ticket creation confirmation and ticket ID
    """
    try:
        # Generate a unique ticket ID
        ticket_id = str(uuid.uuid4())

        # look up the team management table to find the SlackChannelId by assignee
        try:
            team_response = dynamodb.get_item(
                TableName=team_table,
                Key={
                    'PK': {'S': assignee}
                }
            )
            team_slack_channel_id = team_response.get('Item', {}).get('SlackChannelId', {}).get('S', '')
        except Exception as event_error:
            print(f"Error finding team channel id: {str(event_error)}, are you sure the team id is correct?")
            return {
            'create_ticket': {
                'ticketId': ticket_id,
                'body': body
            }
        }

        # Prepare parameters for PutItem operation
        create_ticket_params = {
            'TableName': ticket_table,
            'Item': {
                'PK': {'S': ticket_id},
                'EventPk': {'S': event_pk},
                'TicketTitle': {'S': ticket_title},
                'TicketDetail': {'S': ticket_detail},
                'Recommendations': {'S': recommended_action},
                'EventLastUpdatedTime': {'S': event_last_updated_time},
                'Assignee': {'S': assignee},
                'Severity': {'S': severity},
                'Progress': {'S': progress},
                'createdAt': {'S': datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
            }
        }

        # Execute PutItem operation
        response = dynamodb.put_item(**create_ticket_params)
        body = json.dumps(response)

        # Send event to EventBridge to send Slack message to any team's channel
        if team_slack_channel_id:
            try:
                message_body = f"You have just been assigned or copied for a new Ticket.\n TicketID: {ticket_id}\n Ticket Title:: {ticket_title}\n Assigned to: {assignee}\n Ticket Details: {ticket_detail}\n Severity: {severity}\n Recommendations: {recommended_action}\n EventPk: {event_pk}"
                event_response = events.put_events(
                    Entries=[
                        {
                            'Source': message_event_source_name, # The event source the ChatIntegration service listens to
                            'DetailType': 'Chat.SendSlackRequested', # # The event type the ChatIntegration service can handle
                            'Detail': json.dumps({
                                'event': {
                                    'channel': team_slack_channel_id,
                                    'text': message_body,
                                    'ts': ''
                                }
                            }),
                            'EventBusName': message_event_bus_name
                        }
                    ]
                )
            except Exception as event_error:
                print(f"Error sending Slack message event to EventBridge: {str(event_error)}, Return create_ticket result anyway.")
                return {
                'create_ticket': {
                    'ticketId': ticket_id,
                    'body': body
                }
            }

        return {
            'create_ticket': {
                'ticketId': ticket_id,
                'body': body
            }
        }
    except Exception as e:
        print(f"Error creating ticket: {str(e)}")
        return {
            'create_ticket': {
                'ExecutionError': json.dumps({'error': str(e)})
            }
        }

@tool
def update_ticket(ticket_id, ticket_title='', ticket_detail='', recommended_action='', event_last_updated_time='', severity='', assignee='', progress=''):
    """Update an existing ticket in the system with new information.

    Args:
        ticket_id: The unique identifier of the ticket to update
        event_last_updated_time: The last updated time of the event (required)
        ticket_title: The updated title of the ticket (optional)
        ticket_detail: Updated detailed description of the event or issue (optional)
        recommended_action: Updated step-by-step guideline and examples on how to remediate the issue or event (optional)
        severity: Updated severity level in number ranging from 1-5, with 1 as the lowest and 5 the highest (optional)
        assignee: Updated person or team assigned to the ticket (optional)
        progress: Updated progress status of the ticket (optional)

    Returns:
        Dict with ticket update confirmation
    """
    try:
        # Initialize update expression components
        update_expression_parts = []
        expression_attribute_values = {}
        expression_attribute_names = {}

        # Build update expression dynamically based on provided parameters
        if ticket_title:
            update_expression_parts.append("#tt = :tt")
            expression_attribute_names["#tt"] = "TicketTitle"
            expression_attribute_values[":tt"] = {"S": ticket_title}

        if ticket_detail:
            update_expression_parts.append("#td = :td")
            expression_attribute_names["#td"] = "TicketDetail"
            expression_attribute_values[":td"] = {"S": ticket_detail}

        if recommended_action:
            update_expression_parts.append("#ra = :ra")
            expression_attribute_names["#ra"] = "Recommendations"
            expression_attribute_values[":ra"] = {"S": recommended_action}

        if event_last_updated_time:
            update_expression_parts.append("#ela = :ela")
            expression_attribute_names["#ela"] = "EventLastUpdatedTime"
            expression_attribute_values[":ela"] = {"S": event_last_updated_time}

        if severity:
            update_expression_parts.append("#sev = :sev")
            expression_attribute_names["#sev"] = "Severity"
            expression_attribute_values[":sev"] = {"S": severity}

        if assignee:
            update_expression_parts.append("#asg = :asg")
            expression_attribute_names["#asg"] = "Assignee"
            expression_attribute_values[":asg"] = {"S": assignee}

        if progress:
            update_expression_parts.append("#prg = :prg")
            expression_attribute_names["#prg"] = "Progress"
            expression_attribute_values[":prg"] = {"S": progress}

        # Always update the updatedAt timestamp
        update_expression_parts.append("#ua = :ua")
        expression_attribute_names["#ua"] = "updatedAt"
        expression_attribute_values[":ua"] = {"S": datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

        # If no fields to update, return an error
        if not update_expression_parts:
            return {
                'update_ticket': {
                    'ExecutionError': json.dumps({'error': 'No fields to update'})
                }
            }

        # Prepare parameters for UpdateItem operation
        update_ticket_params = {
            'TableName': ticket_table,
            'Key': {
                'PK': {'S': ticket_id}
            },
            'UpdateExpression': 'SET ' + ', '.join(update_expression_parts),
            'ExpressionAttributeNames': expression_attribute_names,
            'ExpressionAttributeValues': expression_attribute_values,
            'ReturnValues': 'ALL_NEW'  # Return the updated item
        }

        # Execute UpdateItem operation
        response = dynamodb.update_item(**update_ticket_params)

        # Return JSON string of the response
        body = json.dumps(response, default=str)  # default=str handles datetime serialization

        return {
            'update_ticket': {
                'ticketId': ticket_id,
                'body': body
            }
        }
    except Exception as e:
        print(f"Error updating ticket: {str(e)}")
        return {
            'update_ticket': {
                'ExecutionError': json.dumps({'error': str(e)})
            }
        }

@tool
def search_tickets_by_event_key(event_pk):
    """Search for tickets associated with a specific event key (eventPk).

    Args:
        event_pk: The eventPk of the event to search tickets for. The eventPk equals the 'eventArn'
                 of an operational health event/issue, or the 'FindingId' of a Security Hub finding/risk.

    Returns:
        Dict with list of tickets associated with the event
    """
    try:
        # Create scan command parameters
        scan_params = {
            'TableName': ticket_table,
            'FilterExpression': 'contains(EventPk, :eventKey)',
            'ExpressionAttributeValues': {
                ':eventKey': {'S': event_pk}
            }
        }

        # Execute scan operation
        response = dynamodb.scan(**scan_params)

        # Return JSON string of the response, similar to the TypeScript implementation
        body = json.dumps(response, default=str)  # default=str handles datetime serialization

        return {
            'search_tickets': body
        }
    except Exception as e:
        print(f"Error searching tickets: {str(e)}")
        return {
            'search_tickets': {
                'ExecutionError': json.dumps({'error': str(e)})
            }
        }

# Cache for the research agent instance (lazy initialization for performance)
_research_agent_cache = None

@tool
def ask_aws(question: str) -> str:
    """Consult the AwsTAM agent to get technical guidance, best practices, and recommendations.

    Use this tool when you need:
    - Technical guidance, best practices, and recommendations related to AWS services
    - Use for: Technical how-to questions, AWS best practices

    Args:
        question: A SPECIFIC question asked in natural language:
        - Use specific technical terms rather than general phrases
        - Include service names to narrow results (e.g., 'S3 bucket versioning' instead of just 'versioning'); Use quotes for exact phrase matching (e.g., 'AWS Lambda function URLs')
        - Good: "What are the recommended steps to migrate from Python 3.9 to Python 3.11 for Lambda functions?"
        - Good: "What are the security implications of the OpenSSL vulnerability CVE-2023-12345?"
        - Bad: "Help me with this event" (too vague)
        - Bad: "Create a ticket for this" (that's YOUR job)

    Returns:
        str: Detailed recommendations from the research agent
    """
    global _research_agent_cache

    try:
        # Lazy initialization: create research agent only when first needed
        if _research_agent_cache is None:
            from agent_utils import create_research_agent, ContextVisualizationHook
            from mcp_client import create_knowledge_mcp_client

            print("[ask_aws tool] Initializing research agent...")

            mcp_client = create_knowledge_mcp_client()

            research_hook = ContextVisualizationHook()

            _research_agent_cache = create_research_agent(hook=research_hook, mcp_client=mcp_client)

            print("[ask_aws tool] Research agent initialized successfully")

        result = _research_agent_cache(question)

        if hasattr(result, 'content') and len(result.content) > 0:
            response_text = ""
            for content_block in result.content:
                if hasattr(content_block, 'text'):
                    response_text += content_block.text
            return response_text if response_text else str(result)
        else:
            return str(result)

    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        return f"Error consulting AwsTAM agent: {str(e)}\n\nDetails:\n{error_details}"