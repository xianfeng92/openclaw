# Troubleshooting

Common issues and solutions when using OpenClaw.

## Quick Diagnosis

When something goes wrong, check these in order:

1. **Check the logs**: `openclaw logs` or view session files directly
2. **Verify gateway status**: `openclaw gateway status`
3. **Check config**: `openclaw config`
4. **Run diagnostics**: `openclaw doctor`

## Common Issues

### No response to messages

1. Check session logs for `stopReason` and `errorMessage`
2. Verify network connectivity to AI model APIs
3. Check proxy settings if behind a firewall

### Configuration errors

- **API Key validation**: If setting API keys fails with baseUrl errors, ensure your config allows partial provider configuration (fixed in latest versions)

### Desktop App Issues

See [Windows-specific troubleshooting](/troubleshooting/windows) for Electron tray, Settings bridge, and preload issues.

### Channel Issues

See [Channel troubleshooting](/channels/troubleshooting) for platform-specific problems.

## Getting Help

- **Discord**: [https://discord.gg/clawd](https://discord.gg/clawd)
- **GitHub Issues**: [https://github.com/openclaw/openclaw/issues](https://github.com/openclaw/openclaw/issues)
- **Docs**: [https://docs.openclaw.ai](https://docs.openclaw.ai)
