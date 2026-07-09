import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("mcp");

const TOOLS = [
  {
    name: "room_status",
    description: "ルームの状態を取得する（メンバー、接続状況）",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "room_context",
    description: "チームメイトの最新サマリ一覧を取得する",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "room_messages",
    description: "未読メッセージを取得する",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "room_files",
    description: "共有された成果物の一覧を取得する",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "room_invite",
    description: "LAN上のチームメイトをルームに招待する",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "招待するチームメイトの名前" },
      },
      required: ["name"],
    },
  },
  {
    name: "room_share",
    description: "ルームにメッセージを送信する",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "送信するメッセージ" },
      },
      required: ["message"],
    },
  },
  {
    name: "room_unread",
    description: "未読の@メンションを取得して既読にする",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "room_memory_search",
    description: "チームメモリ（L1）をキーワード検索して詳細を取得する",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "検索キーワード" },
      },
      required: ["query"],
    },
  },
  {
    name: "room_memory_trace",
    description: "チームメモリ L2 原典（会話 excerpt）を slug で取得する",
    inputSchema: {
      type: "object" as const,
      properties: {
        entry_name: { type: "string", description: "チームメモリの slug（例: api-error-handling）" },
      },
      required: ["entry_name"],
    },
  },
  {
    name: "room_dream",
    description: "直近セッションからチーム共有に値する知見候補を抽出する（Mine フェーズ）",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

export interface McpHandlers {
  getStatus: () => Promise<string>;
  getContext: () => Promise<string>;
  getMessages: () => Promise<string>;
  getFiles: () => Promise<string>;
  getUnread: () => Promise<string>;
  memorySearch: (query: string) => Promise<string>;
  memoryTrace: (entryName: string) => Promise<string>;
  dream: () => Promise<string>;
  invite: (name: string) => Promise<string>;
  share: (message: string) => Promise<string>;
}

export async function startMcpServer(handlers: McpHandlers): Promise<void> {
  const server = new Server(
    { name: "cc-room", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: string;
      switch (name) {
        case "room_status":
          result = await handlers.getStatus();
          break;
        case "room_context":
          result = await handlers.getContext();
          break;
        case "room_messages":
          result = await handlers.getMessages();
          break;
        case "room_files":
          result = await handlers.getFiles();
          break;
        case "room_invite":
          result = await handlers.invite((args as { name: string }).name);
          break;
        case "room_share":
          result = await handlers.share((args as { message: string }).message);
          break;
        case "room_unread":
          result = await handlers.getUnread();
          break;
        case "room_memory_search":
          result = await handlers.memorySearch((args as { query: string }).query);
          break;
        case "room_memory_trace":
          result = await handlers.memoryTrace((args as { entry_name: string }).entry_name);
          break;
        case "room_dream":
          result = await handlers.dream();
          break;
        default:
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ tool: name, err }, "Tool call failed");
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server started on stdio");
}
