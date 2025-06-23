import time, boto3, os
import llm_utils
from agent_ops import AgentOps
import json, uuid

s3 = boto3.client('s3')
transient_payload_bucket = os.environ['MEM_BUCKET']

def lambda_handler(event, context):
    context.log("Incoming Event : " + json.dumps(event) + "\n")
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

    tools = llm_utils.get_supported_tools()
    selected_tools=[
        tools["search_ops_events"],
        tools["search_sec_findings"],
        tools["ask_aws_advice"],
        tools["acknowledge_event"],
        tools["create_ticket"],
        tools["update_ticket"],
        tools["search_tickets_by_event_key"]
        ]
    agent = AgentOps(
        session=session_id if session_id else None,
        tools=selected_tools,
        reasoning_budget=4096
    )

    # Run research on a topic
    research_results = agent.plan_and_act(
        prompt,
        max_steps=6
    )

    # print('RAW RESPONSE', json.dumps(research_results, indent=2))
    # Save report as distilled knowledge for future reference or audit
    agent.save_knowledge(llm_utils.summarize_pna(agent.name, research_results))
    # The AI agent will remember previous conversation for at least 20 mins
    session_expires_at = int(time.time() + 20 * 60);
    result = {
        "Output": {
        "Text": research_results.get("final_response", ""),
        },
        "SessionId": session_id,
        "ExpiresAt": str(session_expires_at)
    }
    print('AGENT RESULT:', json.dumps(result, indent=2))
    return result
