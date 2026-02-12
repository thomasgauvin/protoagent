# Part 11: Polish & UI

The difference between a project that works and a project that's pleasant to use comes down to polish. This part covers the small things that add up — better tool call display, loading states, error recovery, markdown rendering.

## What you'll build

- Tool call display with name, status (running/done/error), and abbreviated results
- A loading spinner while the agent is thinking
- Markdown rendering for assistant responses
- Error recovery — when a tool fails, the error gets fed back to the model so it can try a different approach
- Updated provider list with current models

## Key concepts

- **Ink rendering** — React components map to terminal output. Understanding how Ink re-renders is important for getting smooth streaming and status updates.
- **Graceful error handling** — tools fail. APIs return 429s. The agent should recover, not crash. Feeding errors back to the model as tool results lets it adapt.
- **User experience** — things like truncating long tool outputs, showing progress spinners, and formatting responses as markdown make a real difference in daily use.

::: warning
This part is not yet written. See the [specification](/reference/spec) for the full design.
:::
