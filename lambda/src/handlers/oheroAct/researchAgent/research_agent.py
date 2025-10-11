import json
import os
from .llm_utils import convert_mcp_tools_to_bedrock_format, call_bedrock_with_tools, execute_tool_calls
from .mcp_client import RemoteMCPClient


class ResearchAgent:
    """Agent that performs research using MCP tools and Bedrock LLM"""

    def __init__(self):
        self.name = 'AwsAdvisorAgent'
        self.aws_knowledge_mcp_client = RemoteMCPClient('https://knowledge-mcp.global.api.aws')
        self.bedrock_tools = None
        self.conversation_history = []

        current_dir = os.path.dirname(os.path.abspath(__file__))
        system_prompt_path = os.path.join(current_dir, 'system.md')
        with open(system_prompt_path, 'r') as f:
            self.system_prompt = f.read().strip()

    def _initialize_tools(self):
        """Initialize and convert MCP tools to Bedrock format"""
        try:
            tools_response = self.aws_knowledge_mcp_client.list_tools()
            mcp_tools = tools_response.get("result", {}).get("tools", [])
        except Exception as e:
            error_msg = f"{self.name} failed to connect to MCP server: {str(e)}"
            print(f"ERROR: {error_msg}")
            return {
                "error": "MCP_SERVER_UNAVAILABLE",
                "message": error_msg,
                "response": f"I apologize, but I'm unable to access the required tools to answer your question. The MCP server is currently unavailable due to: {str(e)}. Please try again later or contact support if the issue persists."
            }

        # Convert to Bedrock format
        self.bedrock_tools = convert_mcp_tools_to_bedrock_format(mcp_tools)
        print(f"{self.name} has tools: {[tool['name'] for tool in mcp_tools]}")

        return None

    def _process_iteration(self, messages):
        """
        Process a single iteration of the agent loop.

        Args:
            messages: Current conversation messages

        Returns:
            Tuple of (should_continue, final_response)
        """

        response = call_bedrock_with_tools(messages, self.bedrock_tools, self.system_prompt)

        stop_reason = response["stopReason"]

        if stop_reason == "end_turn":
            # finished without using tools
            final_response = response["output"]["message"]["content"]
            return False, final_response

        elif stop_reason == "tool_use":
            # LLM wants to use tools
            assistant_message = response["output"]["message"]
            messages.append(assistant_message)

            # Extract tool uses
            tool_uses = [
                content for content in assistant_message["content"]
                if "toolUse" in content
            ]

            # Log LLM's reasoning (if any text content before tool use)
            text_content = [_.get("text", "") for _ in assistant_message["content"] if "text" in _]
            if text_content:
                reasoning = " ".join(text_content)
                print(f"{self.name}'s reasoning: {reasoning}")

            print(f"Tools to use: {len(tool_uses)}")
            for tool_use_content in tool_uses:
                tool_use = tool_use_content["toolUse"]
                print(f"    Tool: {tool_use['name']}")
                print(f"    Input: {json.dumps(tool_use['input'], indent=6)}")

            tool_results = execute_tool_calls(tool_uses, self.aws_knowledge_mcp_client)

            print(f"Tool Results:")
            for result in tool_results:
                tool_result = result["toolResult"]
                status = tool_result.get("status", "success")
                print(f"  - Status: {status}")
                if status == "error":
                    error_content = [_.get("text", "") for _ in tool_result["content"] if "text" in _]
                    print(f"    Error: {error_content[0] if error_content else 'Unknown error'}")

            # Add tool results to conversation
            messages.append({
                "role": "user",
                "content": tool_results
            })

            return True, None

        else:
            # Unexpected stop reason
            final_response = response["output"]["message"]["content"]
            print(f"{self.name} unexpected stop reason: {stop_reason}")
            return False, final_response

    def plan_and_act(self, prompt, max_steps=10):
        """
        Main agent loop that plans and acts on the user prompt.

        Args:
            prompt: The user's prompt/question
            max_steps: Maximum number of agent loop steps (default: 10)

        Returns:
            Dictionary containing the response and metadata
        """
        # Reset conversation history for new execution
        self.conversation_history = []
        tool_calls_summary = []

        # Initialize tools
        error_result = self._initialize_tools()
        if error_result:
            return {
                "query": prompt,
                "steps": 0,
                "final_response": error_result.get("response", ""),
                "tool_calls": [],
                "full_conversation": [],
                "error": error_result.get("error"),
                "message": error_result.get("message")
            }

        # Initialize conversation
        messages = [
            {
                "role": "user",
                "content": [{"text": prompt}]
            }
        ]

        # Store initial user message in conversation history
        self.conversation_history.append(messages[0])

        print(f"Initial user prompt: {prompt}\n")

        iteration = 0
        final_response = None

        # Main agent loop
        while iteration < max_steps:
            iteration += 1
            print(f"\n--- Step {iteration} ---")

            should_continue, response = self._process_iteration(messages)

            # Track tool calls from assistant messages
            if len(messages) > 1:
                last_message = messages[-2] if len(messages) >= 2 else None
                if last_message and last_message.get("role") == "assistant":
                    for content in last_message.get("content", []):
                        if "toolUse" in content:
                            tool_use = content["toolUse"]
                            tool_calls_summary.append({
                                "tool_name": tool_use["name"],
                                "tool_input": tool_use["input"]
                            })

            if not should_continue:
                final_response = response
                break

        # Store complete conversation history
        self.conversation_history = messages.copy()

        # Extract final text response
        if final_response:
            text_content = [_.get("text", "") for _ in final_response if "text" in _]
            final_response_text = " ".join(text_content)

            return {
                "query": prompt,
                "steps": iteration,
                "final_response": final_response_text,
                "tool_calls": tool_calls_summary,
                "full_conversation": self.conversation_history
            }
        else:
            # Max steps reached without completion
            print(f"\nWARNING: Reached maximum steps ({max_steps}) without completing")
            error_message = f"I apologize, but I was unable to complete my research within the allowed depth limit ({max_steps} steps). This may indicate that the question requires more complex reasoning than currently supported, or there were repeated tool failures. Please try rephrasing your question or breaking it into smaller parts."

            return {
                "query": prompt,
                "steps": iteration,
                "final_response": error_message,
                "tool_calls": tool_calls_summary,
                "full_conversation": self.conversation_history,
                "error": "MAX_STEPS_EXCEEDED",
                "message": f"Agent reached maximum research depth of {max_steps} steps without completing"
            }
