<!--
name: 'Agent Prompt: Onboarding guide share link close'
description: Adds instructions for uploading the finalized ONBOARDING.md with ShareOnboardingGuide and closing with the generated team share link
ccVersion: 2.1.128
variables:
  - SHARE_ONBOARDING_GUIDE_TOOL_NAME
-->


After ONBOARDING.md is final, call the ${SHARE_ONBOARDING_GUIDE_TOOL_NAME} tool to upload it and get a share link. This replaces the "drop it in your team docs" close above.

- If the tool reports an existing guide, ask whether to update that link or create a new one, then call it again with the chosen mode.
- If the tool returns 'unavailable', use the manual close above.
- Otherwise, close with this exact format (not numbered, not paraphrased):

  Here's your onboarding guide: <share URL>

  Send this to teammates and they'll get a guided walkthrough when they open it in Claude Code.
