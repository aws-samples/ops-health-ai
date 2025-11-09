import os, boto3, json
import uuid
from datetime import datetime
from agent_utils import (
    ContextVisualizationHook,
    save_knowledge,
    save_agent_memory,
    load_agent_memory,
    create_ops_agent
)

transient_payload_bucket = os.environ['MEM_BUCKET']
s3_client = boto3.client('s3')

def lambda_handler(event, context):

    context.log("Incoming Event : " + json.dumps(event) + "\n")

    # Determine if user interaction is allowed
    ask_user_question_allowed = True if event.get("detail-type") == "Chat.SlackMessageReceived" else False

    try:
        session_id = event["GetUserSession"]["Item"]["AgentSessionID"]["S"]
    except Exception as error:
        session_id = str(uuid.uuid4())
        print('Could not fetch existing session id, using generated instead...')

    hook = ContextVisualizationHook()

    ops_agent = create_ops_agent(hook, ask_user_question_allowed)

    # Load conversation history from S3 if previous session exists
    load_agent_memory(ops_agent, session_id)

    # Extract query from event payload
    task = event["detail"]["event"]["text"]
    payload_s3_key = event["detail"]["event"].get("payloadS3Key", None)
    if payload_s3_key:
        response = s3_client.get_object(Bucket=transient_payload_bucket, Key=payload_s3_key)
        task = response['Body'].read().decode('utf-8')
        print(f'Getting prompt from event payload stored in S3 with object key={payload_s3_key}')

    result = ops_agent(task)

    # Save knowledge and agent memory
    save_knowledge(ops_agent, result, task, session_id)
    save_agent_memory(ops_agent, session_id)

    session_expires_at = int(datetime.now().timestamp() + 20 * 60)
    final_response = {
        "Output": {
            "Text": str(result).strip(),
        },
        "SessionId": session_id,
        "ExpiresAt": str(session_expires_at)
    }

    return final_response
