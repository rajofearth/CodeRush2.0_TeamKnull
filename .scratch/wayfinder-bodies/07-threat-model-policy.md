## Question

What is the threat model and permission/approval policy for CLAI (sandbox, network, secrets, approval gates, emergency kill) that we will demo as a blocked or gated action?

## Constraints

- Safety boundary from AE-01: only participant-controlled repos/credentials; no host secret exfil.
- Sandbox adapter is `@anthropic-ai/sandbox-runtime`.
- Must satisfy shared eval “safety and governance” evidence.
