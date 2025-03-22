import boto3, os, time, json, uuid
import llm_utils
from pathlib import Path

region = os.environ['AWS_REGION']
bucket = os.environ['MEM_BUCKET']

s3 = boto3.client('s3')

class AgentOps:

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

        # Read system prompt from Markdown file
        system_md_path = Path(__file__).parent / "prompts" / "system.md"
        with open(system_md_path, 'r') as f:
            system_content = f.read()

        # Replace $tools$ placeholder with actual tool descriptions
        system_content = system_content.replace("$tools$", self.tool_descriptions)

        self.system_prompt = [{
            "text": system_content
        }]

    def load_memory(self):
        if self.session_id is None:
            self.session_id = str(uuid.uuid4())
            return []
        else:
            try:
                response = s3.get_object(Bucket=bucket, Key=f"{self.name}-memory/{self.session_id}.json")
                file_content = json.loads(response['Body'].read().decode('utf-8'))
                print(f'{self.name} memory exists and loaded from {self.session_id}.json')
                return file_content['conversation_history']
            except Exception as e:
                print(f"Error loading session {self.session_id}: {str(e)}")
                return []

    def save_memory(self, dialogue):
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
                Key=f"{self.name}-memory/{self.session_id}.json",
                Body=json.dumps(memory),
                ContentType='application/json'
            )
        except Exception as e:
            print(f"Error writing to S3 (key={self.session_id}.json): {str(e)}")

    def save_audit(self, summary):
        try:
            s3.put_object(
                Bucket=bucket,
                Key=f"{self.name}-memory/{self.session_id}.md",
                Body=summary,
                ContentType='text/markdown'
            )
        except Exception as e:
            print(f"Error writing to S3 (key={self.session_id}.md): {str(e)}")

    def plan_and_act(self, query, max_steps=5):
        print(f"Starting research on: {query}")

        # Format the initial prompt
        initial_prompt = f"""
        Please help me handle the following ask:

        {query}

        Think carefully about what information you need to gather and which tools would be most helpful.
        Develop an optimized research plan by 1. using multiple tools at the same step whenever possible, e.g. acknowledge_event tool can be used at the same time of using other tools. 2. planning dependent steps as early as possible, e.g. search_tickets_by_event_key can happen earlier than create_ticket or update_ticket. 3. no need to use ask_aws tool if no ticket needs to be created.

        Then execute the plan step by step using the available tools.

        Provide a comprehensive response that synthesizes the information you gather.
        Include in your response the specific sources used in your research. Use the following format for each of the sources used: [Source #: Source Title - Source Link].
        """

        if self.conversation_history:
            memory_content = ",\n".join([
                f"{json.dumps(item, indent=2)}"
                for item in self.conversation_history
            ])

            current_prompt = f"""
            Please help me handle the following ask:

            {query}

            Look carefully at history conversation and extract any information that is helpful for the current query.
            Summarize the extracted information as part of your response.
            Think carefully about what additional information you need to gather and which tools would be most helpful.
            Develop an optimized research plan by 1. using multiple tools at the same step whenever possible, e.g. acknowledge_event tool can be used at the same time of using other tools. 2. planning dependent steps as early as possible, e.g. search_tickets_by_event_key can happen earlier than create_ticket or update_ticket. 3. no need to use ask_aws tool if no ticket needs to be created.

            Then execute the plan step by step using the available tools.

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
            # print(f"Debug current step prompt: {current_prompt}")

            # Invoke Claude with the current prompt
            response = llm_utils.invoke_claude_with_tools(
                current_prompt,
                self.system_prompt,
                self.tools,
                4096
            )

            # # ======== try with extended thinking capabilities, slower and higher cost =========
            # response = llm_utils.invoke_claude_extended_thinking_with_tools(
            #     current_prompt,
            #     self.system_prompt,
            #     self.tools,
            #     self.reasoning_budget,
            #     1000
            # )
            # # ==================================================================================

            # Display the response
            results = llm_utils.display_claude_tool_response(response)
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
            Here are the results from the tools you used in your previous response:

            {tool_summary}

            Here are the previous conversations:
            {conversation_context}

            Based on these results, please continue your research. You may use the tools again if needed. If no further step needed, provide a comprehensive response that synthesizes the information you gather.
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