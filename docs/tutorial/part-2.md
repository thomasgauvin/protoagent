# Part 2: AI Integration

Now we make it talk. In this part, we connect to the OpenAI API and stream chat completions to the terminal. By the end, you'll have a working chatbot — type a message, get an AI response, streamed token by token.

We use the OpenAI SDK because most providers (Gemini, Anthropic, Cerebras) offer OpenAI-compatible endpoints. One SDK, multiple providers — no need for separate integrations.

## What you'll build

- OpenAI SDK integration with streaming responses
- Real-time token rendering in the Ink UI as they arrive
- Environment variable configuration for the API key

## Key concepts

- **Streaming** is what makes the interaction feel responsive. Instead of waiting for the full response, tokens appear as the model generates them.
- **Chunk accumulation** — the OpenAI SDK gives you `delta` objects that you need to piece together. It's straightforward once you see it.
- **OpenAI-compatible endpoints** — by targeting the OpenAI format, we get Gemini and Anthropic support for free.

::: tip
This part is complete. See the full walkthrough in [`DIY_PROTOAGENT_TUTORIAL/PART_2.md`](https://github.com/user/protoagent/blob/main/DIY_PROTOAGENT_TUTORIAL/PART_2.md).
:::
