# Checkpoint Directories

Each `part-N/` directory is a snapshot of the project at the end of that tutorial step.

## Comparing Checkpoints Against Each Other

### diff (recommended — excludes dist/node_modules)
```bash
diff -ru --exclude=dist --exclude=node_modules part-1 part-2
```

### git diff (better formatting)
```bash
git diff --no-index part-1 part-2 | awk '/^diff --git/{skip=0} /^diff --git.*\/(dist|node_modules)\//{skip=1} !skip'
```

### VS Code diff (GUI)
```bash
code --diff part-1/src/App.tsx part-2/src/App.tsx
```

## Useful Flags

| Flag | Description |
|------|-------------|
| `-r` | Recursive (subdirectories) |
| `-u` | Unified format (3 lines context) |
| `-q` | Quick report (files differ / identical only) |
| `-N` | Treat absent files as empty |
| `--exclude=PAT` | Exclude files matching pattern |

## Examples

```bash
# Quick summary between two parts (ignoring dist/node_modules)
diff -rq --exclude=dist --exclude=node_modules part-1 part-2

# Side-by-side (if sdiff is installed)
sdiff part-1/src/App.tsx part-2/src/App.tsx
```
