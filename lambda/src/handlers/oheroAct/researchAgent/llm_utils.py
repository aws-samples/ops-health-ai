import boto3
import os
from botocore.config import Config

region = os.environ['AWS_REGION']
config = Config(read_timeout=1000)
bedrock = boto3.client(
    service_name='bedrock-runtime',
    region_name=region,
    config=config
)

CLAUDE_37_SONNET_MODEL_ID = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0'
# CLAUDE_37_SONNET_MODEL_ID = 'anthropic.claude-3-7-sonnet-20250219-v1:0' # some region may not support cross-region inference, use this instead
CLAUDE_35_HAIKU_MODEL_ID = 'us.anthropic.claude-3-5-haiku-20241022-v1:0'
# CLAUDE_35_HAIKU_MODEL_ID = 'anthropic.claude-3-5-haiku-20241022-v1:0' # some region may not support cross-region inference, use this instead
CLAUDE_3_HAIKU_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0'
AMAZON_NOVA_MICRO_MODEL_ID = 'us.amazon.nova-micro-v1:0'

def convert_mcp_tools_to_bedrock_format(mcp_tools):
    """Convert MCP tool specifications to Bedrock tool format"""
    bedrock_tools = []
    for tool in mcp_tools:
        bedrock_tool = {
            "toolSpec": {
                "name": tool["name"],
                "description": tool["description"],
                "inputSchema": {
                    "json": tool["inputSchema"]
                }
            }
        }
        bedrock_tools.append(bedrock_tool)
    return bedrock_tools


def call_bedrock_with_tools(messages, tools, system_prompt=None):
    converse_params = {
        "modelId": CLAUDE_37_SONNET_MODEL_ID,
        "messages": messages,
        "system": [{"text": system_prompt}] if system_prompt else [],
        "inferenceConfig": {
            "temperature": 0.0,
            "maxTokens": 4096
        },
        "toolConfig": {
            "tools": tools
        }
    }

    response = bedrock.converse(**converse_params)

    return response


def execute_tool_calls(tool_use_contents, mcp_client):
    tool_results = []
    for tool_use_content in tool_use_contents:
        tool_use = tool_use_content["toolUse"]
        tool_name = tool_use["name"]
        tool_input = tool_use["input"]
        tool_use_id = tool_use["toolUseId"]

        try:
            result = mcp_client.call_tool(tool_name, tool_input)
            tool_results.append({
                "toolResult": {
                    "toolUseId": tool_use_id,
                    "content": [{"json": result}]
                }
            })
        except Exception as e:
            tool_results.append({
                "toolResult": {
                    "toolUseId": tool_use_id,
                    "content": [{"text": f"Error: {str(e)}"}],
                    "status": "error"
                }
            })

    return tool_results
