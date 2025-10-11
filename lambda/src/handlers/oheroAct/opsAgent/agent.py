import boto3, os, re, json, uuid
from datetime import datetime
import llm_utils
from pathlib import Path

region = os.environ['AWS_REGION']
mem_bucket = os.environ['MEM_BUCKET']
knowledge_bucket = os.environ['KNOWLEDGE_BUCKET']

s3 = boto3.client('s3')

class Agent:

    def __init__(self, session=None, tools=None, reasoning_budget=4096, conversational=False):
        self.name = 'OheroAgent'
        self.tools = tools
        self.reasoning_budget = reasoning_budget
        self.session_id = session
        self.conversation_history = self.load_memory()
        self.conversational = conversational # whether the agent is able to ask user questions
        self.tool_descriptions = "\n".join([
            f"- {tool['toolSpec']['name']}: {tool['toolSpec']['description']}"
            for tool in tools
        ])

        # Set up the rules directory path
        rules_dir = Path(__file__).parent / "rules"

        # Check if component files exist in the rules directory
        component_files_exist = all(
            (rules_dir / filename).exists()
            for filename in ["system.md", "acknowledge.md", "consult.md", "triage.md"]
        )

        # Load the system.md file
        system_md_path = rules_dir / "system.md"
        with open(system_md_path, 'r') as f:
            system_content = f.read()

        # If component files exist, use the modular structure
        if component_files_exist:
            print("Using modular prompt structure")

            # Define the component files to load
            stage_files = {
                "acknowledge.md": "",
                "consult.md": "",
                "triage.md": "",
                "organization_data.md": "",
                "references.md": ""
            }

            # Load each component file
            for filename, content in stage_files.items():
                try:
                    with open(rules_dir / filename, 'r') as f:
                        stage_files[filename] = f.read()
                except Exception as e:
                    print(f"Error loading {filename}: {str(e)}")
                    stage_files[filename] = f"[ERROR: Could not load {filename}]"

            # Replace placeholders with file contents
            for filename, content in stage_files.items():
                placeholder = f"{{{{import:{filename}}}}}"
                if placeholder in system_content:
                    system_content = system_content.replace(placeholder, content)
        else:
            # Using the original monolithic structure
            print("Using original monolithic prompt structure")

        # Replace placeholders with actual values
        system_content = system_content.replace("$tools$", self.tool_descriptions)
        system_content = system_content.replace("{{currentDateTime}}", datetime.now().isoformat())
        system_content = system_content.replace("{{USER_INTERACTION_ALLOWED_SETTING}}", str(self.conversational))

        self.system_prompt = [{
            "text": system_content
        }]

    def load_memory(self):
        if self.session_id is None:
            self.session_id = str(uuid.uuid4())
            return []
        else:
            try:
                response = s3.get_object(Bucket=mem_bucket, Key=f"{self.name}-memory/{self.session_id}.json")
                file_content = json.loads(response['Body'].read().decode('utf-8'))
                print(f"{self.name} memory exists and loaded from {self.session_id}.json")
                return file_content.get('conversation_history', [])
            except Exception as e:
                print(f"Error loading session {self.session_id}: {str(e)}")
                return []

    def save_memory(self, dialogue):
        self.conversation_history = dialogue
        memory = {
            'conversation_history': self.conversation_history
        }

        try:
            s3.put_object(
                Bucket=mem_bucket,
                Key=f"{self.name}-memory/{self.session_id}.json",
                Body=json.dumps(memory),
                ContentType='application/json'
            )
        except Exception as e:
            print(f"Error writing to S3 (key={self.session_id}.json): {str(e)}")

    def save_knowledge(self, summary):
        metadata = llm_utils.generate_knowledge_metadata(summary)
        if metadata:
            s3.put_object(
                Bucket=knowledge_bucket,
                Key=f"{self.name}-knowledge/{self.session_id}.md.metadata.json",
                Body=metadata
            )
        try:
            s3.put_object(
                Bucket=knowledge_bucket,
                Key=f"{self.name}-knowledge/{self.session_id}.md",
                Body=summary,
                ContentType='text/markdown'
            )
        except Exception as e:
            print(f"Saving knowledge failed: {str(e)}")

    def plan_and_act(self, query, max_steps=6):
        print(f"Starting research on: {query}")

        # Format the initial prompt
        initial_prompt = f"""
        Please help me handle the following ask:
        {query}

        First evaluate all possible paths in the current OheroACT stage and identify 1 and only 1 applicable path, explain why you chose the path, then develop an optimized plan following the right order of steps the path, then execute the plan step by step using the available tools. NEVER assume if there is no explicit callback token mentioned, use empty string instead for the token.
        """

        if self.conversation_history:
            conversation = self.conversation_history
            conversation.append({
                "role": "user", "content": [{"text": query}]
            })
        else:
            conversation = [{
                "role": "user", "content": [{"text": initial_prompt}]
            }]

        # ========= Run multi-step flow =========
        tool_calls_history = []
        for step in range(max_steps):
            print(f"\n--- Step {step+1} of {max_steps} ---\n")

            # Invoke Claude with cache, max number of cache blocks is 4
            cache = True if step < 4 else False
            response = llm_utils.invoke_claude_with_cache(
                conversation,
                self.system_prompt,
                self.tools,
                cache,
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

            # Process the response
            results = llm_utils.handle_claude_tool_response(response)

            # Check if tool calls were made
            if not results["tool_calls"]:
                # print("\nNo tool calls made. Going for last step.")
                conversation.append({
                    "role": "assistant", "content": [{"text": results['text_response']}]
                })
                # conversation.append({
                #     "role": "user", "content": [{"text": f"In light of the user query: {query}\n Provide a succinct response that synthesizes the information you gather"}]
                # })
                # final_step = True
                print("\nNo tool calls made. Workflow complete.")
                break

            # Add assistant's response with tool uses to conversation
            assistant_content = [{"text": results['text_response']}]

            # Add tool use blocks to assistant content
            for tool_use in results["tool_uses"]:
                assistant_content.append({
                    "toolUse": {
                        "toolUseId": tool_use["toolUseId"],
                        "name": tool_use["name"],
                        "input": tool_use["input"]
                    }
                })

            conversation.append({
                "role": "assistant",
                "content": assistant_content
            })

            # Add tool results as user message
            tool_results_content = []
            for tool_response in results["tool_responses"]:
                tool_results_content.append({
                    "toolResult": {
                        "toolUseId": tool_response["tool_id"],
                        "content": [{"text": json.dumps(tool_response['tool_output'])}]
                    }
                })

            # Add continuation prompt
            tool_results_content.append({
                "text": "Please continue your research. You may use the tools again if needed. If no further step needed, provide a succinct response that synthesizes the information you gather in light of the original user query"
            })

            conversation.append({
                "role": "user",
                "content": tool_results_content
            })

            tool_calls_history.extend(results["tool_calls"])


        # Extract the final results
        if conversation:
            final_step = conversation[-1]
            final_response = final_step.get("content")[0]["text"]

            # Create a summary of all tool calls
            print("TOOL CALLS HISTORY: ", [call['tool_name'] for call in tool_calls_history])
            tool_calls_summary = []
            for tool_call in tool_calls_history:
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
            self.save_memory(conversation)
        else:
            result = {
                "query": query,
                "steps": 0,
                "final_response": "Research could not be completed",
                "tool_calls": [],
                "full_conversation": []
            }

        return result
