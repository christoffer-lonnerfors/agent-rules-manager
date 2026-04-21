import * as fs from 'fs';
import * as path from 'path';

const SERVER_NAME = 'agent-rules-manager';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

const TOOL_MANIFEST = {
  tools: [
    {
      name: 'analyzeRulesCoverage',
      description:
        'Returns a JSON coverage report of which AI agent rules apply to each workspace file, with token cost estimates. Use this to identify over-tokenized files and plan rule optimizations. Read the summary field first for a plain-language diagnosis. Accepts optional agentId to filter by agent.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description:
              'Optional: filter by agent. Valid values: cursor, windsurf, kiro, antigravity, augment, claude-code.',
          },
        },
      },
    },
  ],
};

type JsonRpcRequest = {
  jsonrpc: string;
  id?: unknown;
  method?: string;
  params?: unknown;
};

type ToolCallParams = {
  name?: string;
  arguments?: Record<string, unknown>;
};

function send(obj: object): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function rpcResult(id: unknown, result: unknown): object {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: unknown, code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleToolCall(id: unknown, params: ToolCallParams | undefined): Promise<object> {
  if (params?.name !== 'analyzeRulesCoverage') {
    return rpcError(id, -32602, `Unknown tool: ${String(params?.name)}`);
  }

  const coveragePath = path.join(process.cwd(), '.agent-rules', 'coverage.json');
  try {
    const json = fs.readFileSync(coveragePath, 'utf-8');
    return rpcResult(id, {
      content: [{ type: 'text', text: json }],
      isError: false,
    });
  } catch {
    return rpcResult(id, {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error:
              'Coverage report not found. Open the workspace in VS Code with the Agent Rules Manager extension to generate it.',
          }),
        },
      ],
      isError: true,
    });
  }
}

async function handleMessage(line: string): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    send(rpcError(null, -32700, 'Parse error'));
    return;
  }

  const { id = null, method, params } = request;

  if (method === 'initialize') {
    send(
      rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      }),
    );
    return;
  }

  if (method === 'notifications/initialized') {
    return; // notifications require no response
  }

  if (method === 'tools/list') {
    send(rpcResult(id, TOOL_MANIFEST));
    return;
  }

  if (method === 'tools/call') {
    const response = await handleToolCall(id, params as ToolCallParams | undefined);
    send(response);
    return;
  }

  send(rpcError(id, -32601, `Method not found: ${String(method)}`));
}

// ── Entry point ───────────────────────────────────────────────────────────

process.stdin.setEncoding('utf8');
process.stdin.resume();

let buffer = '';
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      handleMessage(trimmed).catch((err) => {
        process.stderr.write(`Agent Rules MCP: ${String(err)}\n`);
      });
    }
  }
});
