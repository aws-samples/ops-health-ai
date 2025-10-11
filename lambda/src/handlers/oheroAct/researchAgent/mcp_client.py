import requests
import json

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
