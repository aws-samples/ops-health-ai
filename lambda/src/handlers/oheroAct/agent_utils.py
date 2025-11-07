from strands import Agent
import boto3
from strands.models import BedrockModel
from strands.hooks import HookProvider, HookRegistry, BeforeModelCallEvent, AfterModelCallEvent
import json, os
from datetime import datetime
from tools import (
    search_ops_events,
    search_sec_findings,
    acknowledge_event,
    create_ticket,
    update_ticket,
    search_tickets_by_event_key,
    ask_aws
)
from botocore.config import Config

# custom boto3 retry config to be used by Bedrock calls
retry_config = Config(
    retries={
        'max_attempts': 1,
        'mode': 'standard'
    }
)

mem_bucket = os.environ['MEM_BUCKET']
knowledge_bucket = os.environ['KNOWLEDGE_BUCKET']
s3_client = boto3.client('s3')

class ResilientAgent(Agent):
    """Overridden Agent with automatic model fallback and retry logic."""

    def __init__(self, model_idx=0, max_retries_per_model=2, retry_delay=2.0,
                 enable_cache_prompt=False, enable_cache_tools=False, **kwargs):

        self.supported_models = [
            BedrockModel(
                model_id="us.amazon.nova-pro-v1:0",
                temperature=0.0,
                streaming=False,
                # boto_session=session,
                boto_client_config=retry_config,
                cache_prompt="default" if enable_cache_prompt else None,
                cache_tools="default" if enable_cache_tools else None
            ), # 4698ms
            BedrockModel(
                model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0",
                temperature=0.0,
                # max_tokens=2048,
                streaming=False,
                # boto_session=session,
                boto_client_config=retry_config,
                cache_prompt="default" if enable_cache_prompt else None,
                cache_tools="default" if enable_cache_tools else None
            ), # 8642ms
            BedrockModel(
                model_id="global.anthropic.claude-sonnet-4-20250514-v1:0",
                temperature=0.0,
                # max_tokens=2048,
                streaming=False,
                # boto_session=session,
                boto_client_config=retry_config,
                cache_prompt="default" if enable_cache_prompt else None,
                cache_tools="default" if enable_cache_tools else None
            ), # 13984ms
            BedrockModel(
                model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
                temperature=0.0,
                # max_tokens=2048,
                streaming=False,
                # boto_session=session,
                boto_client_config=retry_config,
                cache_prompt="default" if enable_cache_prompt else None,
                cache_tools="default" if enable_cache_tools else None
            ), # 13984ms
            BedrockModel(
                model_id="global.anthropic.claude-sonnet-4-5-20250929-v1:0",
                temperature=0.0,
                # max_tokens=2048,
                streaming=False,
                # boto_session=session,
                boto_client_config=retry_config,
                cache_prompt="default" if enable_cache_prompt else None,
                cache_tools="default" if enable_cache_tools else None
            ), # 22273ms
        ]

        self.model_idx = model_idx
        self.max_retries_per_model = max_retries_per_model
        self.retry_delay = retry_delay

        primary = self.supported_models[model_idx]
        super().__init__(model=primary, **kwargs)

    async def invoke_async(self, prompt=None, **kwargs):
        """
        Override invoke_async method with retry-then-fallback logic.
        """
        import asyncio
        last_error = None

        # Iterate through models starting from model_idx
        for model_offset in range(len(self.supported_models)):
            idx = (self.model_idx + model_offset) % len(self.supported_models)
            model = self.supported_models[idx]
            model_id = model.config.get('model_id', 'unknown') if hasattr(model, 'config') else 'unknown'

            # Try current model with retries
            for retry_attempt in range(self.max_retries_per_model):
                try:
                    self.model = model

                    if model_offset > 0 or retry_attempt > 0:
                        print(f"[Retry] Model {model_offset + 1}/{len(self.supported_models)}, "
                              f"Attempt {retry_attempt + 1}/{self.max_retries_per_model}: {model_id}")

                    result = await super().invoke_async(prompt, **kwargs)

                    if model_offset > 0 or retry_attempt > 0:
                        print(f"[Success] ✓ {model_id}")

                    return result

                except Exception as e:
                    last_error = e
                    error_type = type(e).__name__
                    print(f"[Failed] ✗ {model_id}: {error_type}")

                    if retry_attempt < self.max_retries_per_model - 1:
                        print(f"[Wait] Retrying in {self.retry_delay}s...")
                        await asyncio.sleep(self.retry_delay)

                    elif model_offset < len(self.supported_models) - 1:
                        print(f"[Fallback] Moving to next model...")
                        break

            if model_offset < len(self.supported_models) - 1:
                continue

        # All models and retries exhausted
        print(f"[Error] All models exhausted. Last error: {type(last_error).__name__}")
        raise last_error

class ContextVisualizationHook(HookProvider):
    """Hook to visualize what context is sent to each agent's LLM and accumulate complete history."""

    def __init__(self, display_chars=5000):
        self.call_count = 0
        self.display_chars = display_chars
        # Accumulate complete conversation history per agent
        self.agent_histories = {}  # {agent_name: [all_messages]}

    def register_hooks(self, registry: HookRegistry) -> None:
        """Register hook callbacks with the registry."""
        registry.add_callback(BeforeModelCallEvent, self.on_before_model_call)
        registry.add_callback(AfterModelCallEvent, self.on_after_model_call)

    def get_complete_history(self, agent_name: str):
        """Get complete accumulated conversation history for an agent."""
        return self.agent_histories.get(agent_name, [])

    def on_before_model_call(self, event: BeforeModelCallEvent):
        self.call_count += 1

        agent_name = event.agent.name

        if agent_name not in self.agent_histories:
            self.agent_histories[agent_name] = []

        for msg in event.agent.messages:
            if msg not in self.agent_histories[agent_name]:
                self.agent_histories[agent_name].append(msg)

        # Get model ID from the agent's model
        model_id = "unknown"
        if hasattr(event.agent, 'model') and hasattr(event.agent.model, 'config'):
            model_id = event.agent.model.config.get('model_id', 'unknown')

        print("\n" + "=" * 80)
        print(f"LLM CALL #{self.call_count} by AGENT: {event.agent.name} - MODEL: {model_id}")
        print("=" * 80)

        # Extract and display the messages being sent to the LLM
        messages = event.agent.messages

        print(f"\nTotal Messages Being Sent: {len(messages)}")

        for i, msg in enumerate(messages, 1):
            role = msg.get('role', 'unknown')
            content = msg.get('content', [])

            print(f"[Message {i}] Role: {role.upper()}")

            if isinstance(content, list):
                for j, block in enumerate(content, 1):
                    if isinstance(block, dict):
                        if 'text' in block:
                            text = block['text']
                            # Truncate very long text for readability
                            if len(text) > self.display_chars:
                                print(f"Block {j} (text): {text[:self.display_chars]}...")
                                print(f"... (truncated, total length: {len(text)} chars)")
                            else:
                                print(f"Block {j} (text): {text}")
                        elif 'toolUse' in block:
                            tool_use = block['toolUse']
                            print(f"Block {j} (toolUse): {tool_use.get('name', 'unknown')}")
                            print(f"Input: {json.dumps(tool_use.get('input', {}), indent=2)}")
                        elif 'toolResult' in block:
                            tool_result = block['toolResult']
                            print(f"Block {j} (toolResult): {tool_result.get('toolUseId', 'unknown')}")
                            result_content = tool_result.get('content', [])
                            if result_content and isinstance(result_content, list):
                                for result_block in result_content:
                                    if isinstance(result_block, dict) and 'text' in result_block:
                                        result_text = result_block['text']
                                        if len(result_text) > 500:
                                            print(f"Tool Result: {result_text[:500]}...")
                                        else:
                                            print(f"Tool Result: {result_text}")
            elif isinstance(content, str):
                if len(content) > self.display_chars:
                    print(f"Content: {content[:self.display_chars]}...")
                    print(f"... (truncated, total length: {len(content)} chars)")
                else:
                    print(f"Content: {content}")

        print("\n" + "-" * 80)
        print("Waiting for LLM response...")
        print("-" * 80 + "\n")

    def on_after_model_call(self, event: AfterModelCallEvent):
        """Called after each LLM invocation."""
        print("\n" + "-" * 80)
        print(f"LLM CALL #{self.call_count} COMPLETED RESPONSE - AGENT: {event.agent.name}")

        if event.stop_response and event.stop_response.message:
            response = event.stop_response.message
            content = response.get('content', [])

            print("\nLLM Response:")
            print("-" * 80)

            if isinstance(content, list) and len(content) > 0:
                for i, block in enumerate(content, 1):
                    if isinstance(block, dict):
                        # Handle different content block formats
                        if 'text' in block:
                            text = block['text']
                            print(f"\nResponse Block {i} (text):")
                            if len(text) > self.display_chars:
                                print(f"{text[:self.display_chars]}...")
                                print(f"... (truncated, total length: {len(text)} chars)")
                            else:
                                print(text)
                        elif 'toolUse' in block:
                            tool_use = block['toolUse']
                            print(f"\nResponse Block {i} (toolUse):")
                            print(f"Tool: {tool_use.get('name', 'unknown')}")
                            print(f"Input: {json.dumps(tool_use.get('input', {}), indent=2)}")
                        elif block.get('type') == 'text':
                            text = block.get('text', '')
                            print(f"\nResponse Block {i} (text):")
                            if len(text) > self.display_chars:
                                print(f"{text[:self.display_chars]}...")
                                print(f"... (truncated, total length: {len(text)} chars)")
                            else:
                                print(text)
                        elif block.get('type') == 'tool_use':
                            print(f"\nResponse Block {i} (tool_use):")
                            print(f"Tool: {block.get('name')}")
                            print(f"Input: {json.dumps(block.get('input', {}), indent=2)}")
            else:
                print("(No content blocks in response)")

        if event.exception:
            print(f"\n❌ Exception: {event.exception}")

        print("-" * 80)
        print("\n" + "=" * 80 + "\n")


def create_ops_agent(hook, conversational) -> ResilientAgent:
    """Create the OpsAgent with operational tools."""
    # Load system prompt from modular files
    prompts_dir = os.path.join(os.path.dirname(__file__), "ops_agent")

    # Load the system.md file
    system_md_path = os.path.join(prompts_dir, "system.md")
    with open(system_md_path, 'r') as f:
        system_content = f.read()

    # Check if component files exist
    component_files = {
        "references.md": "",
        "organization_data.md": "",
        "acknowledge.md": "",
        "consult.md": "",
        "triage.md": ""
    }

    # Load each component file
    for filename in component_files.keys():
        try:
            filepath = os.path.join(prompts_dir, filename)
            with open(filepath, 'r') as f:
                component_files[filename] = f.read()
        except Exception as e:
            print(f"Error loading {filename}: {str(e)}")
            component_files[filename] = f"[ERROR: Could not load {filename}]"

    # Replace placeholders with file contents
    for filename, content in component_files.items():
        placeholder = f"{{{{import:{filename}}}}}"
        if placeholder in system_content:
            system_content = system_content.replace(placeholder, content)

    # Replace other placeholders with actual values
    system_content = system_content.replace("{{currentDateTime}}", datetime.now().isoformat())
    system_content = system_content.replace("{{USER_INTERACTION_ALLOWED_SETTING}}", str(conversational))

    return ResilientAgent(
        name="ops_agent",
        model_idx=2, # points to the preferred model in list of supported models
        enable_cache_prompt=True,
        description="Handles operational events and creates tickets",
        hooks=[hook],
        callback_handler=None,
        system_prompt = system_content,
        tools=[
            search_ops_events,
            search_sec_findings,
            acknowledge_event,
            create_ticket,
            update_ticket,
            search_tickets_by_event_key,
            ask_aws
        ]
    )


def create_research_agent(hook, mcp_client) -> ResilientAgent:
    """Create the ResearchAgent with MCP knowledge tools."""

    print("Loading MCP tools from knowledge server...")
    mcp_tools = mcp_client.list_tools_sync()
    print(f"Successfully loaded {len(mcp_tools)} MCP tools")

    # Load system prompt from file
    prompts_dir = os.path.join(os.path.dirname(__file__), "research_agent")
    system_md_path = os.path.join(prompts_dir, "system.md")
    with open(system_md_path, 'r') as f:
        system_content = f.read()

    return ResilientAgent(
        name="research_agent",
        model_idx=0, # points to the preferred model in list of supported models
        enable_cache_prompt=True,
        enable_cache_tools=True,
        description="Provides technical research and recommendations using knowledge tools",
        hooks=[hook],
        callback_handler=None,
        system_prompt=system_content,
        tools=list(mcp_tools)  # Dynamically loaded MCP tools
    )


def load_agent_memory(agent, session_id: str):
    """Load agent conversation history from S3."""

    s3_key = f"{agent.name}-memory/{session_id}.json"

    try:
        response = s3_client.get_object(Bucket=mem_bucket, Key=s3_key)
        json_content = response['Body'].read().decode('utf-8')
        messages = json.loads(json_content)

        agent.messages.extend(messages)

        print(f"✓ Agent memory loaded from S3: s3://{mem_bucket}/{s3_key}")
        print(f"  - Agent: {agent.name}")
        print(f"  - Messages loaded: {len(messages)}")
        return s3_key

    except s3_client.exceptions.NoSuchKey:
        print(f"ℹ No existing memory found for {agent.name} (session: {session_id})")
        return None
    except Exception as e:
        print(f"✗ Failed to load agent memory from S3: {str(e)}")
        return None


def save_agent_memory(agent, session_id: str, hook):
    """Save agent conversation history to S3 as JSON."""

    s3_key = f"{agent.name}-memory/{session_id}.json"

    complete_history = hook.get_complete_history(agent.name)

    # Save in original format for easy loading
    json_content = json.dumps(complete_history, indent=2)

    try:
        s3_client.put_object(
            Bucket=mem_bucket,
            Key=s3_key,
            Body=json_content.encode('utf-8'),
            ContentType='application/json'
        )
        print(f"✓ Agent memory saved to S3: s3://{mem_bucket}/{s3_key}")
        print(f"  - Agent: {agent.name}")
        print(f"  - Messages: {len(complete_history)}")
        return s3_key
    except Exception as e:
        print(f"✗ Failed to save agent memory to S3: {str(e)}")
        return None


def save_knowledge(agent, result, task: str, session_id: str):
    """Save agent execution results to console and S3 as markdown."""

    s3_key = f"ohero-knowledge/{session_id}.md"

    agent_name = agent.name if hasattr(agent, 'name') else 'unknown_agent'

    markdown_lines = []

    # Header
    markdown_lines.append("# OHERO Process Report")
    markdown_lines.append(f"\n**Timestamp:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}")
    markdown_lines.append(f"\n## Original Task\n\n```\n{task}\n```")
    markdown_lines.append("\n---\n")

    # Execution Summary
    markdown_lines.append("## Execution Summary\n")
    markdown_lines.append(f"- **Mode:** Single Supervisor Agent")
    markdown_lines.append(f"- **Agent Name:** {agent_name}")

    # Add execution metrics from result.metrics if available
    if hasattr(result, 'metrics'):
        metrics = result.metrics

        # Execution count (number of agent iterations/cycles)
        if hasattr(metrics, 'cycle_count'):
            markdown_lines.append(f"- **Execution Count:** {metrics.cycle_count} iterations")

        # Execution time (sum of all cycle durations)
        if hasattr(metrics, 'cycle_durations') and metrics.cycle_durations:
            total_time_sec = sum(metrics.cycle_durations)
            total_time_ms = int(total_time_sec * 1000)
            markdown_lines.append(f"- **Execution Time:** {total_time_ms}ms ({total_time_sec:.2f}s)")

        # Tool execution summary (success rate and total time)
        if hasattr(metrics, 'tool_metrics') and metrics.tool_metrics:
            total_tool_calls = 0
            total_tool_success = 0
            total_tool_time = 0.0

            for tool_name, tool_data in metrics.tool_metrics.items():
                total_tool_calls += tool_data.call_count
                total_tool_success += tool_data.success_count
                total_tool_time += tool_data.total_time

            if total_tool_calls > 0:
                overall_success_rate = (total_tool_success / total_tool_calls) * 100
                markdown_lines.append(f"- **Tool Calls:** {total_tool_calls} total")
                markdown_lines.append(f"  - Success Rate: {overall_success_rate:.1f}% ({total_tool_success}/{total_tool_calls} successful)")
                markdown_lines.append(f"  - Total Tool Time: {total_tool_time:.3f}s")

    # Extract usage statistics
    if hasattr(result, 'metrics') and hasattr(result.metrics, 'accumulated_usage'):
        usage = result.metrics.accumulated_usage
        markdown_lines.append("\n### Token Usage Statistics\n")

        input_tokens = usage.get('inputTokens', 0)
        cache_read_tokens = usage.get('cacheReadInputTokens', 0)
        cache_write_tokens = usage.get('cacheWriteInputTokens', 0)

        output_tokens = usage.get('outputTokens', 0)

        total_tokens = usage.get('totalTokens', 0)

        markdown_lines.append(f"- **Total Tokens:** {total_tokens:,}")
        markdown_lines.append(f"  - Input Tokens: {input_tokens:,}")
        markdown_lines.append(f"  - Output Tokens: {output_tokens:,}")

        # Cache statistics (if any caching occurred)
        if cache_read_tokens > 0 or cache_write_tokens > 0:
            markdown_lines.append(f"\n- **Cache Statistics:**")
            if cache_read_tokens > 0:
                # Calculate cache hit rate
                total_input = input_tokens + cache_read_tokens
                cache_hit_rate = (cache_read_tokens / total_input) * 100 if total_input > 0 else 0
                markdown_lines.append(f"  - Cache Read (Hit): {cache_read_tokens:,} tokens ({cache_hit_rate:.1f}% cache hit rate)")
            if cache_write_tokens > 0:
                markdown_lines.append(f"  - Cache Write: {cache_write_tokens:,} tokens")

            # Cost savings estimate (cache reads are ~90% cheaper)
            if cache_read_tokens > 0:
                savings_estimate = cache_read_tokens * 0.9
                markdown_lines.append(f"  - Estimated Token Savings: ~{savings_estimate:,.0f} tokens (90% discount on cached tokens)")

    markdown_lines.append("\n---\n")

    # Agent Execution History (Tool Usage Order)
    if hasattr(result, 'metrics') and hasattr(result.metrics, 'tool_metrics'):
        tool_metrics = result.metrics.tool_metrics

        if tool_metrics:
            markdown_lines.append("## Agent Execution History\n")
            markdown_lines.append("### Tools Used (in order):\n")

            # Build tool usage list from traces for chronological order
            tool_usage_list = []
            if hasattr(result.metrics, 'traces'):
                for cycle_trace in result.metrics.traces:
                    # Each cycle trace contains child traces for tool calls
                    if hasattr(cycle_trace, 'children'):
                        for child_trace in cycle_trace.children:
                            # Extract tool name from metadata
                            if hasattr(child_trace, 'metadata') and isinstance(child_trace.metadata, dict):
                                tool_name = child_trace.metadata.get('tool_name')
                                tool_use_id = child_trace.metadata.get('toolUseId', 'unknown')
                                if tool_name:
                                    # Get execution time
                                    duration = child_trace.duration() if hasattr(child_trace, 'duration') else None
                                    duration_str = f"{duration:.3f}s" if duration else "N/A"
                                    tool_usage_list.append((tool_name, tool_use_id, duration_str))

            # Display tool usage in chronological order
            if tool_usage_list:
                for i, (tool_name, tool_use_id, duration) in enumerate(tool_usage_list, 1):
                    markdown_lines.append(f"{i}. **{tool_name}** (ID: `{tool_use_id}`, Duration: {duration})")
            else:
                markdown_lines.append("No tools were used in this execution.")

            markdown_lines.append("\n---\n")

    markdown_lines.append("## Final Output\n")
    markdown_lines.append(f"\n### Agent: `{agent_name}`\n")

    if hasattr(result, 'message'):
        message = result.message
        content = message.get('content', [])
        for content_block in content:
            if isinstance(content_block, dict) and 'text' in content_block:
                markdown_lines.append(f"**Output:**\n\n{content_block['text']}\n")
    else:
        markdown_lines.append(f"**Output:**\n\n{result}\n")

    # Combine all lines
    markdown_content = "\n".join(markdown_lines)

    # Print markdown content to console for debug
    print("\n" + markdown_content)

    try:
        s3_client.put_object(
            Bucket=knowledge_bucket,
            Key=s3_key,
            Body=markdown_content.encode('utf-8'),
            ContentType='text/markdown'
        )
        print(f"\nKnowledge saved to S3: s3://{knowledge_bucket}/{s3_key}")
        return s3_key
    except Exception as e:
        print(f"\n✗ Failed to save to S3: {str(e)}")
        return None


