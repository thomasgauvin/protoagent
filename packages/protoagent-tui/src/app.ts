/**
 * ProtoAgent TUI — OpenTUI-based terminal interface.
 */
import {
  createCliRenderer,
  Box,
  Text,
  Input,
  InputRenderableEvents,
  ScrollBox,
  TextAttributes,
} from '@opentui/core';
import { ProtoAgentClient, type MessageContent, type ImageAttachment } from './client.js';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: ImageAttachment[];
}

interface AppState {
  sessionId: string;
  messages: Message[];
  isLoading: boolean;
  currentStreamText: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    contextPercent: number;
    estimatedCost: number;
  };
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
    isLoading: false,
    currentStreamText: '',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      contextPercent: 0,
      estimatedCost: 0,
    },
  };

  // Connect to event stream
  client.connect(session.id);
  client.onEvent((event: any) => {
    handleEvent(event, state, messagesBox, statusText);
  });

  // Header
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

  // Messages area
  const messagesBox = Box({
    id: 'messages-box',
    width: '100%',
    flexGrow: 1,
    backgroundColor: '#24283b',
    flexDirection: 'column',
    padding: 1,
  });

  const messagesScroll = ScrollBox(
    {
      width: '100%',
      flexGrow: 1,
    },
    messagesBox
  );

  // Status bar
  const statusText = Text({
    id: 'status-text',
    content: 'Ready',
    fg: '#565f89',
  });

  const statusBar = Box(
    {
      width: '100%',
      height: 1,
      backgroundColor: '#16161e',
      flexDirection: 'row',
      paddingLeft: 1,
      paddingRight: 1,
    },
    statusText
  );

  // Input area
  const inputPrompt = Text({ content: '> ', fg: '#09A469' });

  const input = Input({
    id: 'main-input',
    placeholder: 'Type a message... (Ctrl+V to paste image)',
    flexGrow: 1,
    backgroundColor: '#1a1b26',
    focusedBackgroundColor: '#24283b',
    textColor: '#c0caf5',
    cursorColor: '#09A469',
  });

  // Handle Enter key
  input.on(InputRenderableEvents.ENTER, async (value: string) => {
    if (!value.trim() || state.isLoading) return;

    // Add user message to UI
    addMessage(state, messagesBox, { role: 'user', content: value });

    // Clear input
    input.value = '';
    state.isLoading = true;
    state.currentStreamText = '';
    updateStatus(statusText, state);

    // Send to server
    try {
      await client.sendMessage(state.sessionId, value, {
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
      });
    } catch (err: any) {
      addMessage(state, messagesBox, {
        role: 'system',
        content: `Error: ${err.message}`,
      });
      state.isLoading = false;
      updateStatus(statusText, state);
    }
  });

  // Handle Ctrl+V for image paste
  renderer.keyInput.on('keypress', async (key) => {
    // Check for Ctrl+V or Cmd+V
    if ((key.ctrl || key.meta) && key.name === 'v') {
      try {
        const { readImageFromClipboard } = await import('./client.js');
        const image = await readImageFromClipboard();
        if (image) {
          // Add message with image
          addMessage(state, messagesBox, {
            role: 'user',
            content: `[Image pasted from clipboard]`,
            images: [image],
          });

          // Send image to server
          const content: MessageContent[] = [
            { type: 'text', text: 'What do you see in this image?' },
            {
              type: 'image',
              source: 'clipboard',
              mimeType: image.mimeType,
              base64Data: image.base64Data,
            },
          ];

          state.isLoading = true;
          updateStatus(statusText, state);

          await client.sendMessage(state.sessionId, content, {
            provider: config.provider,
            model: config.model,
            apiKey: config.apiKey,
          });
        }
      } catch (err: any) {
        addMessage(state, messagesBox, {
          role: 'system',
          content: `Failed to paste image: ${err.message}`,
        });
      }
    }
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
    inputPrompt,
    input
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
      messagesScroll,
      inputBox,
      statusBar
    )
  );

  // Focus input
  input.focus();
}

function addMessage(
  state: AppState,
  messagesBox: any,
  msg: { role: 'user' | 'assistant' | 'system'; content: string; images?: ImageAttachment[] }
) {
  const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.messages.push({ id, ...msg });

  // Create message component
  const prefix = msg.role === 'user' ? '> ' : msg.role === 'assistant' ? 'AI: ' : '! ';
  const fg = msg.role === 'user' ? '#7aa2f7' : msg.role === 'assistant' ? '#c0caf5' : '#f7768e';

  const messageText = Text({
    content: `${prefix}${msg.content}`,
    fg,
    width: '100%',
  });

  messagesBox.add(messageText);
}

function handleEvent(
  event: any,
  state: AppState,
  messagesBox: any,
  statusText: any
) {
  const { type, payload } = event;

  switch (type) {
    case 'agent.text_delta': {
      state.currentStreamText += payload.content;
      // Update the last assistant message or create one
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg?.role === 'assistant' && !lastMsg.images) {
        // Update existing streaming message
        // In a real implementation, we'd update the component directly
      } else {
        addMessage(state, messagesBox, {
          role: 'assistant',
          content: state.currentStreamText,
        });
      }
      break;
    }

    case 'agent.tool_call': {
      addMessage(state, messagesBox, {
        role: 'system',
        content: `Running ${payload.name}...`,
      });
      break;
    }

    case 'agent.tool_result': {
      const status = payload.status === 'success' ? '✓' : '✗';
      addMessage(state, messagesBox, {
        role: 'system',
        content: `${status} ${payload.result.slice(0, 100)}${payload.result.length > 100 ? '...' : ''}`,
      });
      break;
    }

    case 'agent.complete': {
      state.isLoading = false;
      state.usage = payload.usage;
      state.currentStreamText = '';
      updateStatus(statusText, state);
      break;
    }

    case 'agent.error': {
      state.isLoading = false;
      addMessage(state, messagesBox, {
        role: 'system',
        content: `Error: ${payload.error}`,
      });
      updateStatus(statusText, state);
      break;
    }

    case 'queue.message_queued': {
      updateStatus(statusText, state, `Queued (position: ${payload.queuePosition})`);
      break;
    }
  }
}

function updateStatus(statusText: any, state: AppState, extra?: string) {
  if (extra) {
    statusText.content = extra;
  } else if (state.isLoading) {
    statusText.content = 'Thinking...';
  } else {
    const { inputTokens, outputTokens, contextPercent, estimatedCost } = state.usage;
    statusText.content = `tokens: ${inputTokens}↓ ${outputTokens}↑ | ctx: ${contextPercent}% | $${estimatedCost.toFixed(2)}`;
  }
}
