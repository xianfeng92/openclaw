# Messaging Rules

## Scope

Apply these rules for:

- message routing or delivery work
- external channel reply behavior
- agent session log inspection tasks

## Delivery Rules

- Never send streaming or partial replies to external messaging channels.
- Only final replies should be delivered to external surfaces such as WhatsApp or Telegram.

## Session Inspection

- When asked to inspect an agent session file, prefer `~/.openclaw/agents/<agentId>/sessions/*.jsonl`.
- Do not assume generic session files are the source of truth when agent-specific session logs exist.
