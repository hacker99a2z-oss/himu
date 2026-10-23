---
name: AdsGram test and production blocks
description: Keep AdsGram's test block and production rewarded block separate.
---

The user confirmed that `int-41387` is the AdsGram test block. The production rewarded block and Reward URL are configured for `41655`.

**Why:** A test-block no-fill response was mistaken for an incorrect block ID; preserving the distinction avoids replacing the user's test configuration with the production ID.

**How to apply:** Use `int-41387` with AdsGram debug mode only in development to request a test creative. Use `41655` with debug off in production. AdsGram SDK debug mode does not send the server Reward URL callback, so it must not be used to validate production rewards.
