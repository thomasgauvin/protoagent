/**
 * ProtoAgent TUI — OpenTUI-based terminal interface.
 */
import {
  createCliRenderer,
  Box,
  Text,
  Input,
  ScrollBox,
  useInput,
  TextAttributes,
} from '@opentui/core';
import { ProtoAgentClient } from './client.js';
import type { EventEnvelope } from '../protoagent-core/src/bus/bus-event.js';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: Array<{
    name: string;
    status: 'running' | 'done' | 'error';
    result?: string;
  }>;
}

interface AppState {
  sessionId: string;
  messages: Message[];
  input: string;
  isLoading: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    contextPercent: number;
    estimatedCost: number;
  };
  subAgents: Map<string, { tool: string; status: string }>;
}

export async function runTui(config: {
  provider: string;
  model: string;
  apiKey: string;
  serverUrl: string;
}) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
  });

  const client = new ProtoAgentClient({
    serverUrl: config.serverUrl,
    apiKey: config.apiKey,
  });

  // Create session
  const session = await client.createSession({
    title: 'New Session',
    model: config.model,
    provider: config.provider,
  });

  const state: AppState = {
    sessionId: session.id,
    messages: [],
    input: '',
    isLoading: false,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      contextPercent: 0,
      estimatedCost: 0,
    },
    subAgents: new Map(),
  };

  // Connect to event stream
  client.connect(session.id);
  client.onEvent((event: EventEnvelope) => {
    handleEvent(event, state, renderer);
  });

  // Build UI
  const header = Box(
    {
      width: '100%',
      height: 3,
      backgroundColor: '#1a1b26',
      flexDirection: 'column',
      paddingLeft: 1,
      paddingRight: 1,
    },
    Text({
      content: 'ProtoAgent',
      fg: '#09A469',
      attributes: TextAttributes.BOLD,
    }),
    Text({
      content: `${config.provider} / ${config.model} | Session: ${session.id.slice(0, 8)}`,
      fg: '#565f89',
    })
  );

  const messagesScrollBox = ScrollBox({
    id: 'messages',
    width: '100%',
    flexGrow: 1,
    backgroundColor: '#24283b',
  });

  const inputBox = Box(
    {
      width: '100%',
      height: 3,
      backgroundColor: '#1a1b26',
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 1,
      paddingRight: 1,
    },
    Text({ content: '> ', fg: '#09A469' }),
    Input({
      id: 'main-input',
      placeholder: 'Type a message...',
      flexGrow: 1,
      onSubmit: async (value) => {
        if (!value.trim() || state.isLoading) return;

        // Add user message
        state.messages.push({
          id: `msg-${Date.now()}`,
          role: 'user',
          content: value,
        });

        state.input = '';
        state.isLoading = true;
        updateMessages(messagesScrollBox, state);

        // Send to server
        await client.sendMessage(state.sessionId, value, {
          provider: config.provider,
          model: config.model,
          apiKey: config.apiKey,
        });
      },
    })
  );

  const statusBar = Box(
    {
      width: '100%',
      height: 1,
      backgroundColor: '#16161e',
      flexDirection: 'row',
      paddingLeft: 1,
      paddingRight: 1,
    },
    Text({
      id: 'status-text',
      content: () =>
        `tokens: ${state.usage.inputTokens}↓ ${state.usage.outputTokens}↑ | ctx: ${state.usage.contextPercent}% | $${state.usage.estimatedCost.toFixed(2)}`,
      fg: '#565f89',
    })
  );

  // Main layout
  renderer.root.add(
    Box(
      {
        width: '100%',
        height: '100%',
        flexDirection: 'column',
      },
      header,
      messagesScrollBox,
      inputBox,
      statusBar
    )
  );

  // Focus input
  const input = messagesScrollBox.getRenderable?.('main-input') as any;
  input?.focus?.();
}

function handleEvent(
  event: EventEnvelope,
  state: AppState,
  renderer: any
) {
  const { type, payload } = event;

  switch (type) {
    case 'agent.text_delta': {
      // Append to current assistant message or create new one
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg?.role === 'assistant' && !lastMsg.toolCalls) {
        lastMsg.content += payload.content;
      } else {
        state.messages.push({
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: payload.content,
        });
      }
      break;
    }

    case 'agent.tool_call': {
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg?.role === 'assistant') {
        lastMsg.toolCalls = lastMsg.toolCalls || [];
        lastMsg.toolCalls.push({
          name: payload.name,
          status: 'running',
        });
      }
      break;
    }

    case 'agent.tool_result': {
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg?.toolCalls) {
        const toolCall = lastMsg.toolCalls.find(
          (t) => t.name === payload.toolCallId
        );
        if (toolCall) {
          toolCall.status = payload.status === 'success' ? 'done' : 'error';
          toolCall.result = payload.result;
        }
      }
      break;
    }

    case 'agent.sub_agent.start': {
      state.subAgents.set(payload.subAgentId, {
        tool: 'sub_agent',
        status: 'running',
      });
      break;
    }

    case 'agent.sub_agent.progress': {
      state.subAgents.set(payload.subAgentId, {
        tool: payload.tool,
        status: payload.status,
      });
      break;
    }

    case 'agent.sub_agent.complete': {
      state.subAgents.delete(payload.subAgentId);
      break;
    }

    case 'agent.complete': {
      state.isLoading = false;
      state.usage = payload.usage;
      break;
    }

    case 'agent.error': {
      state.isLoading = false;
      state.messages.push({
        id: `msg-${Date.now()}`,
        role: 'system',
        content: `Error: ${payload.error}`,
      });
      break;
    }
  }
}

function updateMessages(scrollBox: any, state: AppState) {
  // Clear and rebuild message list
  // This is a simplified version - OpenTUI would manage this more efficiently
}
