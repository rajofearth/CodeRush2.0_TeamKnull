# Threat model & approval policy

- Shell: `@anthropic-ai/sandbox-runtime`; workspace (+ scratch) mounts; scrub env.
- Network deny after setup; install egress only with traced approval.
- Approvals: egress, secrets, out-of-repo writes, destructive commands.
- Never allow known secret exfil; emergency process-tree kill + sandbox teardown.
- Demo: prompt-injection secret-upload attempt blocked; denial in JSONL/OTel.
