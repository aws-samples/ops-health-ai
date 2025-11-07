import requests
import json
import inspect
from strands import tool
from typing import List, Dict, Any, Callable, Optional


class RemoteMCPClient:
    def __init__(self, base_url):
        self.base_url = base_url.rstrip('/')

    def list_tools(self):
        url = f"{self.base_url}"
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list"
        }

        response = requests.post(url, json=payload, timeout=30)
        response.raise_for_status()
        return response.json()

    def call_tool(self, tool_name, arguments=None):
        url = f"{self.base_url}"
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments or {}
            }
        }

        response = requests.post(url, json=payload, timeout=30)
        response.raise_for_status()
        return response.json()


class MCPToolAdaptor:
    """
    Adaptor to make HTTP-based MCP tools compatible with Strands agents.
    """

    def __init__(self, base_url: str):
        self.client = RemoteMCPClient(base_url)

    def list_tools_sync(self) -> List[Callable]:
        """
        List all available tools from the MCP server.
        """

        response = self.client.list_tools()

        if "result" not in response or "tools" not in response["result"]:
            raise ValueError(f"Invalid response from MCP server: {response}")

        mcp_tools = response["result"]["tools"]
        print(f"Retrieved {len(mcp_tools)} tools from MCP server")

        agent_tools = []
        for mcp_tool in mcp_tools:
            strands_tool = self._convert_to_strands_tool(mcp_tool)
            agent_tools.append(strands_tool)
            # print(f"  - {mcp_tool['name']}: {mcp_tool.get('description', 'No description')}")
            # print(f"DEBUG - Input Schema: {json.dumps(mcp_tool.get('inputSchema', {}), indent=2)}")

        return agent_tools

    def _convert_to_strands_tool(self, mcp_tool: Dict[str, Any]) -> Callable:
        """
        Convert an MCP tool definition to a Strands tool using @tool decorator.
        """
        tool_name = mcp_tool["name"]
        tool_description = mcp_tool.get("description", f"MCP tool: {tool_name}")
        input_schema = mcp_tool.get("inputSchema", {})

        # Create the tool function dynamically
        def create_tool_function(name: str, description: str, schema: Dict[str, Any]):
            """Factory function to create a tool with proper closure."""

            # Extract parameter information from schema
            properties = schema.get("properties", {})
            required = schema.get("required", [])

            # Map JSON schema types to Python types
            type_map = {
                "string": str,
                "integer": int,
                "number": float,
                "boolean": bool,
                "array": list,
                "object": dict
            }

            # Define the base function that accepts **kwargs
            def tool_function(**kwargs):
                """Execute the MCP tool with given arguments."""
                # Validate and convert types based on schema
                validated_params = {}

                for param_name, value in kwargs.items():
                    if value is None:
                        continue

                    if param_name in properties:
                        param_info = properties[param_name]
                        param_type = param_info.get("type", "string")

                        # Convert types
                        try:
                            if param_type == "integer":
                                validated_params[param_name] = int(value)
                            elif param_type == "number":
                                validated_params[param_name] = float(value)
                            elif param_type == "boolean":
                                validated_params[param_name] = bool(value)
                            else:
                                validated_params[param_name] = value
                        except (ValueError, TypeError) as e:
                            return f"Type conversion error for parameter '{param_name}': {str(e)}"
                    else:
                        validated_params[param_name] = value

                # Call the MCP server
                try:
                    response = self.client.call_tool(name, validated_params)

                    if "result" in response:
                        result = response["result"]
                        # Extract content from MCP response
                        if isinstance(result, dict) and "content" in result:
                            content_items = result["content"]
                            if isinstance(content_items, list) and len(content_items) > 0:
                                # Return the text from the first content item
                                first_item = content_items[0]
                                if isinstance(first_item, dict) and "text" in first_item:
                                    return first_item["text"]
                        return json.dumps(result)
                    elif "error" in response:
                        return f"Error: {response['error']}"
                    else:
                        return json.dumps(response)
                except Exception as e:
                    return f"Tool execution failed: {str(e)}"

            # Build function signature
            params = []
            annotations = {}

            # Add required parameters first (no default value)
            for param_name in required:
                if param_name in properties:
                    param_info = properties[param_name]
                    param_type = param_info.get("type", "string")
                    python_type = type_map.get(param_type, str)

                    params.append(
                        inspect.Parameter(
                            param_name,
                            inspect.Parameter.POSITIONAL_OR_KEYWORD,
                            annotation=python_type
                        )
                    )
                    annotations[param_name] = python_type

            # Add optional parameters (with default=None)
            for param_name, param_info in properties.items():
                if param_name not in required:
                    param_type = param_info.get("type", "string")
                    python_type = type_map.get(param_type, str)

                    params.append(
                        inspect.Parameter(
                            param_name,
                            inspect.Parameter.POSITIONAL_OR_KEYWORD,
                            default=None,
                            annotation=Optional[python_type]
                        )
                    )
                    annotations[param_name] = Optional[python_type]

            # Set the new signature
            tool_function.__signature__ = inspect.Signature(params)

            # Set type annotations for Pydantic validation
            annotations['return'] = str  # All tools return strings
            tool_function.__annotations__ = annotations

            # Set function metadata
            tool_function.__name__ = name
            tool_function.__doc__ = description

            # Apply the @tool decorator
            return tool(tool_function)

        return create_tool_function(tool_name, tool_description, input_schema)

    def __enter__(self):
        """Context manager entry - no special setup needed for HTTP client."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - no cleanup needed for HTTP client."""
        pass


def create_knowledge_mcp_client(base_url: str = "https://knowledge-mcp.global.api.aws") -> MCPToolAdaptor:

    return MCPToolAdaptor(base_url)
