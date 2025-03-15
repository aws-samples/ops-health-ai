import boto3, os, time, json, uuid
import llm_utils

region = os.environ['AWS_REGION']
bucket = os.environ['MEM_BUCKET']

bedrock, bedrock_runtime = llm_utils.create_bedrock_clients(region)
s3 = boto3.client('s3')

CLAUDE_35_SONNET_MODEL_ID = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
CLAUDE_37_SONNET_MODEL_ID = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0'
CLAUDE_35_HAIKU_MODEL_ID = 'anthropic.claude-3-5-haiku-20241022-v1:0'

class Agent:

    max_tokens=1000

    def __init__(self, session=None, tools=None, reasoning_budget=4096):
        self.name = 'OpsAgent'
        self.tools = tools
        self.reasoning_budget = reasoning_budget
        self.session_id = session
        self.conversation_history = self.load_memory()
        self.tool_descriptions = "\n".join([
            f"- {tool['toolSpec']['name']}: {tool['toolSpec']['description']}"
            for tool in tools
        ])
        self.system_prompt = [{
        "text": f"""You're a helpful AI assistant with the ability to use tools.

You have access to the following tools:
{self.tool_descriptions}

When a user's request requires using one of these tools:
1. First think through what information you need and which tool would be appropriate
2. Then provide a clear explanation to the user about your approach
3. Finally use the appropriate tool by including the necessary parameters

Important: If a question requires calculation, getting weather data, or searching for information,
always use the appropriate tool rather than trying to answer from your knowledge."""
    }]

    def load_memory(self):
        if self.session_id is None:
            self.session_id = str(uuid.uuid4())
            return []
        else:
            try:
                response = s3.get_object(Bucket=bucket, Key=f"{self.session_id}.json")
                file_content = json.loads(response['Body'].read().decode('utf-8'))
                return file_content['conversation_history']
            except Exception as e:
                print(f"Error loading session {self.session_id}: {str(e)}")
                return []

    def save_memory(self, dialogue):
        # print('QUERY TO APPEND: ', f'{json.dumps(dialogue, indent=2)}')
        record = {
            'query': dialogue["query"],
            'response': dialogue["final_response"]
        }
        self.conversation_history.append(record)
        memory = {
            'conversation_history': self.conversation_history
        }
        # print('MEMORY TO SAVE: ', json.dumps(memory, indent=2))
        try:
            s3.put_object(
                Bucket=bucket,
                Key=f"{self.session_id}.json",
                Body=json.dumps(memory),
                ContentType='application/json'
            )
        except Exception as e:
            print(f"Error writing to S3 (key={self.session_id}.json): {str(e)}")

    def research(self, query, max_steps=5):
        print(f"Starting research on: {query}")

        # Format the initial prompt
        initial_prompt = f"""
        You are a research assistant. Please help me research the following topic:

        {query}

        Think carefully about what information you need to gather and which tools would be most helpful.
        Develop a research plan, then execute it step by step using the available tools.

        Provide a comprehensive response that synthesizes the information you gather.
        """

        if self.conversation_history:
            memory_content = ",\n".join([
                f"{json.dumps(item, indent=2)}"
                for item in self.conversation_history
            ])

            current_prompt = f"""
            You are a research assistant who has helped me before. Now please help me research the following topic:

            {query}

            Look carefully at history conversation and extract any information that is helpful for the current query.
            Summarize the extracted information as part of your response.
            Think carefully about what additional information you need to gather and which tools would be most helpful.
            Develop a research plan, then execute it step by step using the available tools.

            Provide a comprehensive response that synthesizes the information you gather.

            You can use the following history conversation to help you with your research:
            {memory_content}
            """
        else:
            current_prompt = initial_prompt

        # ========= Run multi-step flow =========
        conversation = []
        for step in range(max_steps):
            print(f"\n--- Step {step+1} of {max_steps} ---\n")

            # Invoke Claude with the current prompt
            print(f"Current step prompt: {current_prompt}")
            response = invoke_claude_with_tools(
                current_prompt,
                self.system_prompt,
                self.tools,
                self.reasoning_budget
            )

            # Display the response
            results = display_claude_tool_response(response)
            if step == 0:
                conversation.append({
                    "prompt": initial_prompt,
                    "response": response,
                    "results": results
                })
            else:
                conversation.append({
                    "prompt": current_prompt,
                    "response": response,
                    "results": results
                })

            conversation_context = ",\n".join([
                f"{json.dumps(item, indent=2)}"
                for item in conversation
            ])
            # print("CONVERSATION TILL NOW: ", conversation_context)
            # Check if tool calls were made
            if not results["tool_calls"]:
                print("\nNo tool calls made. Workflow complete.")
                break

            # Process tool results and create the next prompt
            tool_summary = "\n\nHere are the results from the tools you used:\n\n"
            for tool_response in results["tool_responses"]:
                formatted_output = json.dumps(tool_response['tool_output'], indent=2)
                tool_summary += f"- {tool_response['tool_name']} tool returned:\n```json\n{formatted_output}\n```\n\n"

            current_prompt = f"""
            Thank you for your previous response. Here are the results from the tools you used:

            {tool_summary}

            Here are the previous conversations:
            {conversation_context}

            Based on these results, please continue your research. You may use the tools again if needed.
            """

            # Ask if the user wants to continue to the next step
            if step < max_steps - 1:
                print("\nContinuing to next step...\n")

        print("\nWorkflow complete.")

        # Extract the final results
        if conversation:
            final_step = conversation[-1]
            final_response = final_step.get("results", {}).get("text_response", "No response generated")

            # Create a summary of all tool calls
            tool_calls_summary = []
            for step in conversation:
                for tool_call in step.get("results", {}).get("tool_calls", []):
                    tool_calls_summary.append({
                        "tool": tool_call["tool_name"],
                        "input": tool_call["tool_input"]
                    })

            result =  {
                "query": query,
                "steps": len(conversation),
                "final_response": final_response,
                "tool_calls": tool_calls_summary,
                "full_conversation": conversation
            }
        else:
            result = {
                "query": query,
                "steps": 0,
                "final_response": "Research could not be completed",
                "tool_calls": [],
                "full_conversation": []
            }

        self.save_memory(result)
        return result

def summarize_research(results):
    if not results:
        return "No research results available."

    summary = f"""
    # Research Summary: {results['query']}

    ## Overview
    - Research steps: {results['steps']}
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
        for i, call in enumerate(calls[:3], 1):  # Show up to 3 examples
            summary += f"- Example {i}: `{json.dumps(call)}`\n"
        if len(calls) > 3:
            summary += f"- ...and {len(calls) - 3} more\n"

    # Add the final response
    summary += f"\n## Final Response\n\n{results['final_response']}\n"

    return summary

def invoke_claude_with_tools(prompt, system_prompt, tools, reasoning_budget=4096, max_tokens=1000):
    # Create messages
    messages = [
        {
            "role": "user",
            "content": [{"text": prompt}]
        }
    ]

    # Base request parameters
    request_params = {
        "modelId": CLAUDE_35_HAIKU_MODEL_ID,
        "messages": messages,
        "system": system_prompt,
        "inferenceConfig": {
            "temperature": 1.0,  # Must be 1.0 when reasoning is enabled
            "maxTokens": max(reasoning_budget + 1, max_tokens)
        },
        # "additionalModelRequestFields": {
        #     "reasoning_config": {
        #         "type": "enabled",
        #         "budget_tokens": reasoning_budget
        #     }
        # },
        "toolConfig": {
            "tools": tools
        }
    }

    # Invoke the model
    start_time = time.time()
    response = bedrock_runtime.converse(**request_params)
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

    Args:
        tool_responses (list): List of tool responses

    Returns:
        str: Formatted display of tool responses
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

def display_claude_tool_response(response):
    """
    Display Claude's response with detailed tool calls and results

    Args:
        response (dict): The API response from Claude
    """
    # Extract metrics
    elapsed_time = response.get('_elapsed_time', 0)
    input_tokens = response.get('usage', {}).get('inputTokens', 0)
    output_tokens = response.get('usage', {}).get('outputTokens', 0)
    total_tokens = response.get('usage', {}).get('totalTokens', 0)

    input_cost = input_tokens * 0.000003  # $3 per million tokens
    output_cost = output_tokens * 0.000015  # $5 per million tokens
    total_cost = input_cost + output_cost

    # Display metrics
    print(f"### Response (in {elapsed_time:.2f} seconds)")
    print(f"**Tokens**: {total_tokens:,} total ({input_tokens:,} input, {output_tokens:,} output)")
    print(f"**Estimated cost**: ${total_cost:.5f}")

    # Extract the text response
    result_text = "No response content found"
    if response.get('output', {}).get('message', {}).get('content'):
        content_blocks = response['output']['message']['content']
        for block in content_blocks:
            if 'text' in block:
                result_text = block['text']
                break

    # Display Claude's response
    print("### Claude's Response:")
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
                print("\n**Note**: Found tool use in content block instead of in toolUses")
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
            print(f"**Tool ID**: `{tool_id}`")
            print("**JSON Input**:")
            print(f"```json\n{formatted_input}\n```")

            # Process the tool call
            tool_output = llm_utils.handle_tool_call(tool_name, tool_input)

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
        print("1. Claude chose not to use any tools for this query")
        print("2. There's an issue with how tool calls are structured in the response")

        # Print more details about the response structure to help diagnose issues
        if 'output' in response and 'message' in response['output']:
            message_keys = list(response['output']['message'].keys())
            print(f"Message keys available: {message_keys}")

    return {
        "text_response": result_text,
        "tool_calls": tool_calls,
        "tool_responses": tool_responses
    }