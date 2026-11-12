---
name: ankhorage-project-structure
description: Apply feature ownership and package boundary rules.
---

# Ankhorage Project Structure

Provider adapters are feature-first. Keep concrete provider SDK code at the outer adapter boundary, retain dependency direction toward portable contracts, use `src/index.ts` only as a deliberate public facade, and add no empty architectural layers.
