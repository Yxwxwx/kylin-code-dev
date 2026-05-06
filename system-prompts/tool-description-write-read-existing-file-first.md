<!--
name: 'Tool Description: Write (read existing file first)'
description: Tool description for Write in environments where existing files must be read before overwrite
ccVersion: 2.1.120
variables:
  - READ_TOOL_NAME
-->
Writes a file to the local filesystem. Overwrites if the file exists.

- If the file already exists, you must ${READ_TOOL_NAME} it first in this conversation or the call will fail.
- Prefer Edit for modifying existing files — it only sends the diff.
