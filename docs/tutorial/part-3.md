# Part 3: Configuration

Hard-coding an API key in an environment variable works for development, but it's not a great experience. In this part, we build a proper configuration system — an interactive wizard that walks users through picking a provider and model, entering their API key, and saving it all to disk.

## What you'll build

- An interactive Ink configuration wizard
- Persistent config storage at a standard location (`~/.local/share/protoagent/`)
- Provider definitions with model metadata and pricing
- A `protoagenta configure` subcommand

## Key concepts

- **XDG-style paths** — we store config where the OS expects it, not just dumped in the home directory.
- **Multi-provider support** — defining providers in a registry makes it easy to add new ones later.
- **Ink forms** — building interactive terminal forms with React components. It's more work than raw `inquirer` prompts, but the result is smoother and fits the Ink rendering model.

::: tip
This part is complete. See the full walkthrough in [`DIY_PROTOAGENT_TUTORIAL/PART_3.md`](https://github.com/user/protoagent/blob/main/DIY_PROTOAGENT_TUTORIAL/PART_3.md).
:::
