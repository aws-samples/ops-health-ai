import boto3
from botocore.exceptions import ClientError
import time
import json
import math
import os
import re
import copy
import uuid
from datetime import datetime
from boto3 import client
from botocore.config import Config

# Setting up tool and utility environment
team_table = os.environ.get('TEAM_TABLE')
region = os.environ['AWS_REGION']
ops_knowledge_base_id = os.environ['OPS_KNOWLEDGE_BASE_ID']
sechub_knowledge_base_id = os.environ['SECHUB_KNOWLEDGE_BASE_ID']
ticket_table = os.environ.get('TICKET_TABLE')
message_event_bus_name = os.environ.get('EVENT_BUS_NAME')
message_event_source_name = os.environ.get('EVENT_SOURCE_NAME')
bedrock_guardrail_id = os.environ.get('BEDROCK_GUARDRAIL_ID')
bedrock_guardrail_ver = os.environ.get('BEDROCK_GUARDRAIL_VER')

CLAUDE_37_SONNET_MODEL_ID = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0'
# CLAUDE_37_SONNET_MODEL_ID = 'anthropic.claude-3-7-sonnet-20250219-v1:0' # some region may not support cross-region inference, use this instead
CLAUDE_35_HAIKU_MODEL_ID = 'us.anthropic.claude-3-5-haiku-20241022-v1:0'
# CLAUDE_35_HAIKU_MODEL_ID = 'anthropic.claude-3-5-haiku-20241022-v1:0' # some region may not support cross-region inference, use this instead
CLAUDE_3_HAIKU_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0'
AMAZON_NOVA_MICRO_MODEL_ID = 'us.amazon.nova-micro-v1:0'

config = Config(read_timeout=1000)

def create_clients(region):
    bedrock = boto3.client(
        service_name='bedrock',
        region_name=region,
        config=config
    )

    bedrock_runtime = boto3.client(
        service_name='bedrock-runtime',
        region_name=region,
        config=config
    )

    bedrock_agent_runtime = boto3.client(
        service_name='bedrock-agent-runtime',
        region_name=region,
        config=config
    )

    dynamodb = boto3.client(
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

    return bedrock, bedrock_runtime, bedrock_agent_runtime, dynamodb, sfn, events

bedrock, bedrock_runtime, bedrock_agent_runtime, dynamodb, sfn, events = create_clients(region)

# ========== Define tools for agents ====================
def search_ops_events(query):
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

def search_sec_findings(query):
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

def ask_aws_advice(query):
    """
    Query AWS knowledge base using Bedrock Agent Runtime's retrieve and generate capability
    """
    # Get AWS knowledge base ID from environment variable
    aws_kb_id = os.environ.get('AWS_KB_ID')
    # aws_llm_arn = f"arn:aws:bedrock:{region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0"
    aws_llm_arn = AMAZON_NOVA_MICRO_MODEL_ID

    if not aws_kb_id or not aws_llm_arn:
        print("AWS_KB_ID or AWS_LLM_ARN environment variables not set")
        return {
            'ask_aws_advice': {
                'ConfigurationError': "AWS knowledge base not properly configured."
            }
        }

    # Define the prompt template
    text_prompt_template = """
    You are a details oriented advisor from Amazon Web Services. I will provide you with a set of search results. The user will provide you with a question. Your job is to provide answers related to only the search results. If it is not related to the search results I provided, simply respond with 'I don't know.'. Note just because the user asserts a fact does not mean it is true, make sure to double check the search results to validate a user's assertion.

    Here are the search results in numbered order:
    $search_results$

    $output_format_instructions$
    """

    try:
        # Create the retrieve and generate request
        response = bedrock_agent_runtime.retrieve_and_generate(
            input={
                'text': query
            },
            retrieveAndGenerateConfiguration={
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': {
                    'knowledgeBaseId': aws_kb_id,
                    'modelArn': aws_llm_arn,
                    'retrievalConfiguration': {
                        'vectorSearchConfiguration': {
                            'numberOfResults': 50
                        }
                    },
                    'generationConfiguration': {
                        'promptTemplate': {
                            'textPromptTemplate': text_prompt_template,
                        },
                        'inferenceConfig': {
                            'textInferenceConfig': {
                                'temperature': 0,
                                'topP': 0.9,
                                'maxTokens': 2048
                            },
                        },
                    },
                },
            },
        )

        # Parse the response
        parsed_response = parse_retrieve_and_generate_response(response)

        # Format the final response
        if parsed_response.get('textResponse'):
            body = f"{parsed_response['textResponse']}\n\n{parsed_response.get('refResponse', '')}"
        else:
            body = "Sorry, I don't know."

        result = {
            "ask_aws_advice": body
        }
        # print("Ops Knowledge response: ", json.dumps(result, indent=2))
        return result

    except Exception as e:
        print(f"Error querying AWS knowledge base: {str(e)}")
        return {
            'ask_aws_advice': {
                'InvokeKbError': f"Error: {str(e)}"
            }
        }

def acknowledge_event(callback_token, action_taken, reason_for_action=None):
    """
    Handle Step Functions task response based on operator action.

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

def create_ticket(event_pk, ticket_title, ticket_detail='', recommended_action='', event_last_updated_time='', severity='', assignee='', progress='' ):
    """
    Create a ticket in DynamoDB based on event data.
    Also sends an event to EventBridge event bus.
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

def update_ticket(ticket_id, ticket_title='', ticket_detail='', recommended_action='', event_last_updated_time='', severity='', assignee='', progress=''):
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

def search_tickets_by_event_key(event_pk):
    """
    Search for tickets in DynamoDB where EventPk contains the specified event key.
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

# ========== Agent utilities ====================
def define_tool(name, description, parameters):
    """
    Define a tool specification that llm can use
    """
    return {
        "toolSpec": {
            "name": name,
            "description": description,
            "inputSchema": {
                "json": parameters
            }
        }
    }

def handle_tool_call(tool_name, tool_input):
    """
    Handle tool calls by executing the appropriate function
    """
    try:
        if tool_name == "search_ops_events":
            return search_ops_events(tool_input["query"])
        elif tool_name == "search_sec_findings":
            return search_sec_findings(tool_input["query"])
        elif tool_name == "ask_aws_advice":
            return ask_aws_advice(tool_input["query"])
        elif tool_name == "acknowledge_event":
            return acknowledge_event(tool_input["callback_token"], tool_input["action_taken"], tool_input.get("reason_for_action"))
        elif tool_name == "create_ticket":
            return create_ticket(
                tool_input["event_pk"],
                tool_input["ticket_title"],
                tool_input.get("ticket_detail", ""),
                tool_input.get("recommended_action", ""),
                tool_input.get("event_last_updated_time", ""),
                tool_input.get("severity", ""),
                tool_input.get("assignee", ""),
                tool_input.get("progress", "")
            )
        elif tool_name == "update_ticket":
            return update_ticket(
                tool_input["ticket_id"],
                tool_input.get("ticket_title", ""),
                tool_input.get("ticket_detail", ""),
                tool_input.get("recommended_action", ""),
                tool_input.get("event_last_updated_time", ""),
                tool_input.get("severity", ""),
                tool_input.get("assignee", ""),
                tool_input.get("progress", "")
            )
        elif tool_name == "search_tickets_by_event_key":
            return search_tickets_by_event_key(tool_input["event_pk"])
        else:
            return {"error": f"Unknown tool: {tool_name}"}
    except Exception as e:
        print(f'Error executing {tool_name} with input {json.dumps(tool_input, indent=2)}')
        return {"error": f"Error executing {tool_name}: {str(e)}"}

def get_supported_tools():
    """
    Read tool specifications from tool_specs.json and define all supported tools
    """
    # Get the directory of the current file
    current_dir = os.path.dirname(os.path.abspath(__file__))
    # Path to the tool_specs.json file
    json_path = os.path.join(current_dir, 'tool_specs.json')

    # Initialize the tools dictionary
    tools = {}

    try:
        # Read and parse the JSON file
        with open(json_path, 'r') as file:
            tool_specs = json.load(file)

        # Iterate through all supported tools
        for tool_spec in tool_specs.get('SupportedTools', []):
            name = tool_spec.get('name')
            description = tool_spec.get('description')
            parameters = tool_spec.get('parameters')

            # Define the tool using the existing function
            if name and description and parameters:
                tools[name] = define_tool(name, description, parameters)

        return tools
    except Exception as e:
        print(f"Error loading tool specifications: {str(e)}")
        return {}

def parse_retrieve_and_generate_response(rag_output):
    """
    Parse the response from Bedrock Agent Runtime's retrieve and generate capability
    """
    citations = rag_output.get('citations', [])
    text_response = ''
    ref_response = ''
    ref_index = 0

    if citations:
        for citation in citations:
            # Extract text response part
            generated_response_part = citation.get('generatedResponsePart', {})
            text_response_part = generated_response_part.get('textResponsePart', {}).get('text', '')
            text_response += text_response_part

            # Process retrieved references
            retrieved_references = citation.get('retrievedReferences', [])

            for retrieved_reference in retrieved_references:
                ref_index += 1
                ref_url = None

                # Check for web location
                location = retrieved_reference.get('location', {})
                if 'webLocation' in location:
                    ref_url = location.get('webLocation', {}).get('url')
                # Check for S3 location
                elif 's3Location' in location:
                    ref_url = location.get('s3Location', {}).get('uri')

                # Add reference marker and URL
                if ref_url:
                    text_response += f"[{ref_index}]"
                    ref_response += f"[{ref_index}]: {ref_url}\n"

            # Add newline if there were references
            if retrieved_references:
                text_response += '\n'

    return {
        'textResponse': text_response,
        'refResponse': ref_response
    }

def summarize_pna(agent_id, results):
    if not results:
        return "No PlanAndAct results available."

    summary = f"""
# {agent_id} PlanAndAct Summary
## User Query
{results['query']}

## Overview
- PlanAndAct steps: {results['steps']}
- Tools used: {len(results['tool_calls'])}

## Tools Used
"""

    # Group tool calls by tool type
    tool_usage = {}
    for call in results['tool_calls']:
        tool_name = call['tool']
        if tool_name not in tool_usage:
            tool_usage[tool_name] = []
        tool_usage[tool_name].append(call['input'])

    # Add tool usage to summary
    for tool_name, calls in tool_usage.items():
        summary += f"\n### {tool_name.capitalize()}\n"
        summary += f"- Used {len(calls)} times\n"
        for i, call in enumerate(calls, 1):
            summary += f"- Call {i} Parameters: `{json.dumps(call)}`\n"
        if len(calls) > 3:
            summary += f"- ...and {len(calls) - 3} more\n"

    # Add the final response
    summary += f"\n## Final Response\n\n{results['final_response']}\n"

    return summary

def invoke_claude_with_cache(messages, system_prompt, tools, cache=False, max_tokens=4096):
    # Create cache check point
    messages_with_cache = copy.deepcopy(messages)
    if cache:
        messages_with_cache[-1]["content"].append({"cachePoint": {"type": "default"}})

    # Base request parameters
    request_params = {
        "modelId": CLAUDE_37_SONNET_MODEL_ID,
        "messages": messages_with_cache,
        "system": system_prompt,
        "inferenceConfig": {
            "temperature": 0.0,
            "maxTokens": max_tokens
        },
        "toolConfig": {
            "tools": tools
        },
        # uncomment the below to apply Bedrock Guardrails
        # "guardrailConfig": {
        #     "guardrailIdentifier": bedrock_guardrail_id,
        #     "guardrailVersion": bedrock_guardrail_ver,
        #     "trace": "enabled"
        # }
    }

    # Invoke the model
    start_time = time.time()
    max_retries = 5
    retry_count = 0
    while True:
        try:
            response = bedrock_runtime.converse(**request_params) # to handle ThrottlingException
            break  # Success, exit the loop
        except ClientError as error:
            retry_count += 1
            if retry_count > max_retries:
                raise  # Re-raise if max retries exceeded
            print(f"{error.response['Error']['Code'] } encountered. Retrying in 30 seconds... (Attempt {retry_count}/{max_retries})")
            time.sleep(30)

    elapsed_time = time.time() - start_time

    # Add elapsed time to response for reference
    response["_elapsed_time"] = elapsed_time

    # Debug: print the raw response structure to help diagnose parsing issues
    print("Response structure:")
    print(f"Keys in response: {list(response.keys())}")
    if 'output' in response:
        print(f"Keys in response['output']: {list(response['output'].keys())}")
        if 'message' in response['output']:
            print(f"Keys in response['output']['message']: {list(response['output']['message'].keys())}")
            if 'toolUses' in response['output']['message']:
                print(f"Number of tool uses mentioned in response message: {len(response['output']['message']['toolUses'])}")
            else:
                if 'content' in response['output']['message']:
                    # Look for potential tool use blocks in content
                    tool_uses = [block['toolUse'] for block in response['output']['message']['content'] if 'toolUse' in block]
                    print(f"Number of tool uses mentioned in response content blocks: {len(tool_uses)}")
                else:
                    print("No 'toolUses' key found anywhere.")

    return response

def invoke_claude_extended_thinking_with_tools(prompt, system_prompt, tools, reasoning_budget=4096, max_tokens=1000):
    # Create messages
    messages = [
        {
            "role": "user",
            "content": [{"text": prompt}]
        }
    ]

    # Base request parameters
    request_params = {
        "modelId": CLAUDE_37_SONNET_MODEL_ID,
        "messages": messages,
        "system": system_prompt,
        "inferenceConfig": {
            "temperature": 1.0,  # Must be 1.0 when reasoning is enabled
            "maxTokens": max(reasoning_budget + 1, max_tokens)
        },
        "additionalModelRequestFields": {
            "reasoning_config": {
                "type": "enabled",
                "budget_tokens": reasoning_budget
            }
        },
        "toolConfig": {
            "tools": tools
        },
        # uncomment the below to apply Bedrock Guardrails
        # "guardrailConfig": {
        #     "guardrailIdentifier": bedrock_guardrail_id,
        #     "guardrailVersion": bedrock_guardrail_ver,
        #     "trace": "enabled"
        # }
    }

    # Invoke the model
    start_time = time.time()
    max_retries = 5
    retry_count = 0
    while True:
        try:
            response = bedrock_runtime.converse(**request_params) # to handle ThrottlingException
            break  # Success, exit the loop
        except ClientError as error:
            retry_count += 1
            if retry_count > max_retries:
                raise  # Re-raise if max retries exceeded
            print(f"{error.response['Error']['Code'] } encountered. Retrying in 30 seconds... (Attempt {retry_count}/{max_retries})")
            time.sleep(30)

    elapsed_time = time.time() - start_time

    # Add elapsed time to response for reference
    response["_elapsed_time"] = elapsed_time

    # Debug: print the raw response structure to help diagnose parsing issues
    # print("User prompt:", prompt)
    print("Response structure:")
    print(f"Keys in response: {list(response.keys())}")
    if 'output' in response:
        print(f"Keys in response['output']: {list(response['output'].keys())}")
        if 'message' in response['output']:
            print(f"Keys in response['output']['message']: {list(response['output']['message'].keys())}")
            if 'toolUses' in response['output']['message']:
                print(f"Number of tool uses mentioned in response message: {len(response['output']['message']['toolUses'])}")
            else:
                if 'content' in response['output']['message']:
                    # Look for potential tool use blocks in content
                    tool_uses = [block['toolUse'] for block in response['output']['message']['content'] if 'toolUse' in block]
                    print(f"Number of tool uses mentioned in response content blocks: {len(tool_uses)}")
                else:
                    print("No 'toolUses' key found anywhere.")

    return response

def process_tool_outputs(tool_responses):
    """
    Process tool outputs for display
    """
    if not tool_responses:
        return "No tool calls made."

    output = "### Tool Results\n\n"
    for i, response in enumerate(tool_responses, 1):
        output += f"**Tool Call {i}: {response['tool_name']}**\n\n"
        output += f"Input: `{json.dumps(response['tool_input'])}`\n\n"
        if "error" in response["tool_output"]:
            output += f"Error: {response['tool_output']['error']}\n\n"
        else:
            output += f"Output: `{json.dumps(response['tool_output'], indent=2)}`\n\n"

def generate_knowledge_metadata(summary):
    """
    Generate metadata for knowledge base entries using Nova LLM
    """
    current_time = datetime.now()
    metadata_prompt = f"""Extract key metadata from this conversation summary for knowledge base indexing. Do not add a key if you are not >70% sure about the value. Return only valid JSON with these fields:
- "category":type of event, either operational issue, planned change, security, cost, or others
- "services": array of AWS services mentioned
- "timeOheroTriaged": {current_time.isoformat()}
- "timeOfEvent": the start time of the event in ISO format

Summary: {summary[:450000]}"""

    try:
        metadata_response = bedrock_runtime.converse(
            modelId=AMAZON_NOVA_MICRO_MODEL_ID,
            messages=[{"role": "user", "content": [{"text": metadata_prompt}]}],
            inferenceConfig={"temperature": 0.0, "maxTokens": 1000}
        )

        metadata_text = metadata_response['output']['message']['content'][0]['text']
        print(f"Auto-generated metadata for knowledge: {metadata_text}")

        # Extract JSON using regex
        json_match = re.search(r'\{.*\}', metadata_text, re.DOTALL)
        if not json_match:
            raise ValueError("No JSON found in response")

        return json.dumps({
            "metadataAttributes": json.loads(json_match.group())
        })
    except Exception as e:
        print(f"Generating knowledge metadata failed: {str(e)}")
        return None

def handle_claude_tool_response(response):
    """
    Display Claude's response with detailed tool calls and results
    """
    # Extract metrics
    elapsed_time = response.get('_elapsed_time', 0)
    input_tokens = response.get('usage', {}).get('inputTokens', 0)
    output_tokens = response.get('usage', {}).get('outputTokens', 0)
    total_tokens = response.get('usage', {}).get('totalTokens', 0)
    cached_read_tokens = response.get('usage', {}).get("cacheReadInputTokens", 0)
    cached_write_tokens = response.get('usage', {}).get("cacheWriteInputTokens", 0)

    input_cost = input_tokens * 0.0000008  # $$0.0008 per 1000 tokens https://aws.amazon.com/bedrock/pricing/
    output_cost = output_tokens * 0.0000025  # $0.0025 per 1000 tokens https://aws.amazon.com/bedrock/pricing/
    total_cost = input_cost + output_cost

    # Display metrics
    print(f"### Response (in {elapsed_time:.2f} seconds)")
    print(f"**CachedTokens**: {cached_read_tokens:,} read, {cached_write_tokens:,} write")
    print(f"**Tokens**: {total_tokens:,} total ({input_tokens:,} input, {output_tokens:,} output)")
    print(f"**Estimated cost (assuming Claude 3.5 Haiku)**: ${total_cost:.5f}")

    # Extract the text response
    result_text = "No response content found"
    if response.get('output', {}).get('message', {}).get('content'):
        content_blocks = response['output']['message']['content']
        for block in content_blocks:
            if 'text' in block:
                result_text = block['text']
                break

    print("### LLM Response:")
    print(result_text)

    # Extract tool calls if any
    tool_calls = []
    tool_responses = []

    # Look for tool calls in the response
    message = response.get('output', {}).get('message', {})

    # Check for potential alternative ways tool use might be structured in the response
    tool_uses = message.get('toolUses', [])
    if not tool_uses and 'content' in message:
        # Look for potential tool use blocks in content
        for block in message['content']:
            if 'toolUse' in block:
                print("\n**Note**: Found 'toolUse' in content block instead of in 'toolUses' block")
                # Extract information from the content block
                tool_use_block = block['toolUse']
                tool_name = tool_use_block.get('name', 'Unknown tool')
                tool_input = tool_use_block.get('input', {})
                tool_id = tool_use_block.get('toolUseId', 'unknown-id')

                tool_uses.append({
                    'name': tool_name,
                    'input': tool_input,
                    'toolUseId': tool_id
                })

    if tool_uses:
        # Display detailed tool call information
        print("\n### 🛠️ Tool Calls Details")

        for i, tool_use in enumerate(tool_uses, 1):
            tool_name = tool_use.get('name', 'Unknown tool')
            tool_input = tool_use.get('input', {})
            tool_id = tool_use.get('toolUseId', 'unknown-id')

            # Format the JSON input with proper indentation for better readability
            formatted_input = json.dumps(tool_input, indent=2)

            # Display detailed tool information in a code block
            print(f"#### Tool Call {i}: `{tool_name}`")
            print(f"**Tool Use ID**: `{tool_id}`")
            print("**JSON Input**:")
            # print(f"```json\n{formatted_input}\n```")
            print(formatted_input)

            # Process the tool call
            tool_output = handle_tool_call(tool_name, tool_input)

            # Format the tool output
            if isinstance(tool_output, dict):
                formatted_output = json.dumps(tool_output, indent=2)
                print("**Tool Output**:")
                print(f"```json\n{formatted_output}\n```")
            else:
                print(f"**Tool Output**: {tool_output}")

            # Add to our tracking lists
            tool_calls.append({
                "tool_name": tool_name,
                "tool_input": tool_input,
                "tool_id": tool_id
            })

            tool_responses.append({
                "tool_name": tool_name,
                "tool_input": tool_input,
                "tool_output": tool_output,
                "tool_id": tool_id
            })
    else:
        print("\n### No Tool Calls Found in Response")
        print("Note: This might indicate that either:")
        print("1. LLM chose not to use any tools for this query")
        print("2. There's an issue with how tool calls are structured in the response")

        # Print more details about the response structure to help diagnose issues
        if 'output' in response and 'message' in response['output']:
            message_keys = list(response['output']['message'].keys())
            print(f"Message keys in LLM response: {message_keys}")

    return {
        "text_response": result_text,
        "tool_uses": tool_uses,
        "tool_calls": tool_calls,
        "tool_responses": tool_responses
    }