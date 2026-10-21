// Petit serveur MCP stdio utilisé par les tests et pour essayer les connecteurs.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'opendots-demo', version: '1.0.0' });

server.registerTool(
  'add',
  { description: 'Additionne deux nombres', inputSchema: { a: z.number(), b: z.number() } },
  async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
);

server.registerTool(
  'secret_word',
  { description: 'Renvoie le mot secret du jour', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: `Le mot secret est ${process.env.DEMO_SECRET ?? 'papillon'}` }] }),
);

await server.connect(new StdioServerTransport());
