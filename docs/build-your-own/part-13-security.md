---

## Security Considerations

This final part brings together all the security mechanisms we've built throughout the tutorial. Here's a comprehensive overview of ProtoAgent's security model.

### Security Architecture Overview

ProtoAgent implements defense in depth—multiple overlapping security layers:

1. **User Interface Layer**: Approval prompts, visual indicators
2. **Agentic Loop**: Iteration limits, abort handling, context compaction
3. **Tools Layer**: Path validation, command filtering, ReDoS protection, SSRF blocking
4. **MCP Servers**: Approval required, command validation, environment filtering
5. **Persistence Layer**: Credential redaction, file permissions, atomic writes

### Key Security Principles

**Defense in Depth**: Multiple overlapping protections—if one fails, others protect the system.

**Fail Closed**: Default to denial. Unknown commands require approval, invalid paths throw errors.

**Least Privilege**: Minimal necessary permissions. MCP servers get limited env vars, file access is restricted.

**Explicit Over Implicit**: User must explicitly approve risky operations. No silent execution.

### Security Checklist for Production

**Environment:**
- [ ] Run in Docker/VM for isolation
- [ ] Use dedicated user with minimal permissions
- [ ] Set filesystem quotas
- [ ] Configure network egress filtering

**Configuration:**
- [ ] Review all MCP servers
- [ ] Pin MCP versions (not `latest`)
- [ ] Use `apiKeyEnvVar` not hardcoded keys
- [ ] Set appropriate limits

**Operational:**
- [ ] Monitor token usage
- [ ] Review session files
- [ ] Rotate API keys
- [ ] Update dependencies

### Summary

ProtoAgent's security model prioritizes safety over convenience, explicit control, defense in depth, and transparency. Every security control is visible and documented, helping you understand trade-offs and make informed decisions.

Remember: Security is a process, not a product.
