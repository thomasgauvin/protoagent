# Discoveries

Notes from building a production-style Ink CLI and reverse-engineering how Gemini CLI and Claude Code solve the same problems.

---

## Ink fundamentals

### What Ink actually does

Ink renders a React tree to a string on every state change, then uses `log-update` to erase the previous output and write the new string. The "managed region" is the last N lines of the terminal — Ink tracks the line count and moves the cursor up by that many lines to overwrite.

Yoga (the CSS layout engine from React Native) handles layout. The root node's width is set to `process.stdout.columns` at render time and recalculated on resize.

### The `<Static>` component

`<Static>` renders children _once_, writes them directly above Ink's managed region into the scrollback buffer, and never touches them again. Ink removes them from the live re-render cycle entirely.

This is the right tool for completed/immutable items: finished messages, log lines, past commands. It is **not** compatible with `rerender()` — static content doesn't update and leaves ghost lines.

### The stdout/Ink split pattern

The cleanest pattern for a streaming agent UI:

- Completed messages → print directly to `process.stdout` (plain ANSI, lands in scrollback, always selectable)
- Active stream → render inside Ink (small live region)
- On stream complete → flush to stdout, clear Ink state

This is what real tools use. Ink's managed region stays small; scrollback history is always accessible.

---

## Resize and ghosting

### Why `width="100%"` doesn't reflow

Yoga caches the terminal width at startup. `width="100%"` resolves at mount time and stays fixed. To reflow on resize you must re-trigger layout, either by calling Ink's internal `resized()` method (which calls `calculateLayout()` then `onRender()`) or by storing `process.stdout.columns` in React state and updating it on resize.

### The ghosting problem

Ink clears only the lines it thinks it owns, based on its internal line count. If a re-render produces fewer lines than the previous one, old lines below the new output are not erased — they ghost. This is a fundamental consequence of Ink's erase-by-line-count strategy.

### Adding your own resize listener is dangerous

Ink registers its own `stdout.on('resize')` listener internally. Adding a second listener from user code creates a race condition. The ccmanager project (PR #209) documented this breaking `useInput` raw mode — Ink's resize handler and the user's fire in an undefined order, and whichever runs second can corrupt terminal state.

The safe pattern: add resize listeners inside a `useEffect` so they are registered after Ink is mounted, and always clean up with `process.stdout.off('resize', handler)` on unmount.

### The unmount/clear/re-render workaround

Before using a fork with real alternate buffer support, the workaround was:

```js
instance.unmount();
process.stdout.write('\x1b[2J\x1b[H'); // clear screen, cursor home
instance = render(<App />, options);
```

This fully resets Ink's internal line counter and avoids ghosting. The cost is a flash on every resize. Not production-quality.

---

## Alternate screen buffer

### What it is

Two separate terminal buffers exist: the main buffer (your shell, scrollback history) and the alternate buffer (a clean slate, no scrollback). Switching is done with ANSI escape sequences:

- Enter: `\x1b[?1049h`
- Exit: `\x1b[?1049l`

Most full-screen TUI programs (vim, less, htop) use the alternate buffer. When they exit, the main buffer is restored exactly as it was.

### `altScreenBuffer: true` in Ink 4.x does nothing

Ink 4.4.1 (the latest published version as of this writing) does not have an `alternateBuffer` or `altScreenBuffer` option. The option is silently ignored. Any alternate screen behavior in older code was either a placebo or implemented manually outside of Ink.

### Published Ink versions and alternate buffer support

| Version              | React peer | alternateBuffer | incrementalRendering |
| -------------------- | ---------- | --------------- | -------------------- |
| 4.4.1                | >=18       | no              | no                   |
| 5.2.1                | >=18       | no              | no                   |
| 6.8.0                | >=19       | no              | no                   |
| @jrichman/ink 6.4.11 | >=19       | yes             | yes                  |

These features exist on Ink's `master` branch (as `alternateScreen: true` and `useWindowSize`) but have not been published to npm.

---

## @jrichman/ink — the Gemini CLI fork

Gemini CLI uses `ink@npm:@jrichman/ink@6.4.11` — a fork by a Google engineer (GitHub: `jacob314/ink`), published under a separate npm scope.

Install:

```
npm install ink@npm:@jrichman/ink@6.4.11 react@^19
```

### What the fork adds

**`alternateBuffer: true`** in `render()` options — real alternate screen entry/exit via ANSI escapes, managed by `log-update.js`.

**`incrementalRendering: true`** in `render()` options — instead of erasing and rewriting the full output on every render, diffs the new frame against the previous one and emits only the changed cells. Same concept as what Claude Code built from scratch in their custom renderer.

**The final frame trick** — on `unmount()`, after exiting the alternate screen, the fork immediately re-writes the last rendered frame into the main buffer:

```js
const exitAlternateBuffer = (stream, lastFrame) => {
	stream.write('\u001B[?7h'); // re-enable line wrap
	stream.write(ansiEscapes.exitAlternativeScreen);
	stream.write(lastFrame); // reprint last frame into scrollback
};
```

This means: when the app quits, the alternate buffer disappears and the last frame appears in the main scrollback — readable, selectable, copyable. No history is lost.

**DEC mode 2026 (synchronized output)** — the fork wraps every render in `\x1b[?2026h` / `\x1b[?2026l` (begin/end synchronized update). Terminals that support this hold off painting until the full frame is ready, eliminating flicker at the terminal level.

### How Gemini CLI uses it

```ts
// interactiveCli.tsx
render(<AppWrapper />, {
	alternateBuffer: useAlternateBuffer,
	incrementalRendering:
		settings.merged.ui.incrementalRendering !== false &&
		useAlternateBuffer &&
		!isShpool,
	exitOnCtrlC: false,
});
```

`incrementalRendering` is only enabled in alternate buffer mode — it doesn't make sense in scrollback mode where lines are already committed.

### The quit-path pattern (AlternateBufferQuittingDisplay)

When the user quits while in alternate buffer mode, Gemini renders the entire chat history as the final frame before unmounting:

```tsx
// App.tsx
if (uiState.quittingMessages) {
	if (isAlternateBuffer) {
		return <AlternateBufferQuittingDisplay />; // full history as last frame
	}
	return <QuittingDisplay />;
}
```

Because of the final frame trick, this history ends up in scrollback after exit. Users get clean rendering during the session _and_ a readable transcript after.

---

## useTerminalSize

Gemini's `useTerminalSize.ts`, copied verbatim:

```js
import {useEffect, useState} from 'react';

export function useTerminalSize() {
	const [size, setSize] = useState({
		columns: process.stdout.columns || 80,
		rows: process.stdout.rows || 24,
	});

	useEffect(() => {
		function updateSize() {
			setSize({
				columns: process.stdout.columns || 80,
				rows: process.stdout.rows || 24,
			});
		}
		process.stdout.on('resize', updateSize);
		return () => {
			process.stdout.off('resize', updateSize);
		};
	}, []);

	return size;
}
```

Use this instead of reading `process.stdout.columns` directly in render — that value is stale after a resize. The `useEffect` listener fires after Ink's own resize handler, so there is no race condition.

---

## Claude Code's renderer

From a HN thread with Anthropic engineer `chrislloyd`:

- Started with Ink, then rewrote the renderer from scratch while keeping React
- Pipeline: React scene graph → Yoga layout → rasterize to 2D screen buffer → **diff against previous frame** → emit only changed ANSI sequences
- Removed `<Static>` entirely — everything re-renders, but with memoization to reduce churn
- Uses scrollback (not alternate buffer) so users can copy history — flickering is the tradeoff
- Contributed DEC mode 2026 (synchronized output) patches to VSCode xterm.js and tmux to eliminate flickering at the terminal level
- Converted screen buffers to TypedArrays to reduce GC pressure

The incremental rendering in `@jrichman/ink` is the same idea, implemented as a layer on top of Ink rather than a full rewrite.
