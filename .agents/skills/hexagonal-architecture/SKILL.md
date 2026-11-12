---
name: hexagonal-architecture
description: Keep provider adapters and portable application contracts separate.
---

# Hexagonal Architecture

Concrete provider code is an outer adapter. It may depend on published portable contracts; portable policy must not depend on provider SDKs. Use injected boundaries for deterministic tests.
