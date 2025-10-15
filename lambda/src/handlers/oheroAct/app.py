import time, boto3, os
from opsAgent.agent import Agent
import json, uuid

s3 = boto3.client('s3')
transient_payload_bucket = os.environ['MEM_BUCKET']

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

def lambda_handler(event, context):
    context.log("Incoming Event : " + json.dumps(event) + "\n")
    ask_user_question_allowed = True if event.get("detail-type") == "Chat.SlackMessageReceived" else False
    prompt = event["detail"]["event"]["text"]
    payload_s3_key = event["detail"]["event"].get("payloadS3Key", None)
    if payload_s3_key:
        # Get the object from S3
        response = s3.get_object(Bucket=transient_payload_bucket, Key=payload_s3_key)
        # Read the content
        prompt = response['Body'].read().decode('utf-8')
        print(f'Getting prompt from event payload stored in S3 with object key={payload_s3_key}')

    try:
        session_id = event["GetUserSession"]["Item"]["AgentSessionID"]["S"]
    except Exception as error:
        session_id = str(uuid.uuid4())
        print('Could not fetch existing session id, using generated instead...')

    agent = Agent(
        session=session_id if session_id else None,
        reasoning_budget=4096,
        conversational=ask_user_question_allowed
    )

    # Run research on a topic
    research_results = agent.plan_and_act(
        prompt,
        max_steps=8
    )

    # print('RAW RESPONSE', json.dumps(research_results, indent=2))
    # Save report as distilled knowledge for future reference or audit
    agent.save_knowledge(summarize_pna(agent.name, research_results))
    # The AI agent will remember previous conversation for at least 20 mins
    session_expires_at = int(time.time() + 20 * 60);
    result = {
        "Output": {
        "Text": research_results.get("final_response", ""),
        },
        "SessionId": session_id,
        "ExpiresAt": str(session_expires_at)
    }

    return result
