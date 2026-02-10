# AGENTS.md

## Overview

This document provides guidelines for AI agents operating within the OpenCode.ai ecosystem. The primary goal is to ensure agents handle tasks efficiently, especially when integrating or utilizing external libraries and tools. Agents should prioritize accuracy, adaptability, and up-to-date knowledge to minimize errors and improve code quality.

## Core Guidelines

### Researching Documentation for Tools and Libraries

When working on a task that involves using any library, testing tool, linting tool, formatting tool, flake tool (e.g., Flake8), or any other similar tool or library:

- **Initial Attempt**: Proceed with your current knowledge or standard practices to implement the usage.
- **Error Handling and Adaptation**: If the first attempt fails (e.g., due to syntax errors, deprecated features, version incompatibilities, or unexpected behavior):
  - Immediately pivot to researching the official documentation online for the latest usage instructions.
  - Use reliable sources such as:
    - Official project websites (e.g., PyPI pages, GitHub repositories).
    - Documentation hubs like Read the Docs, official API references, or developer portals.
    - Recent release notes or changelogs to identify breaking changes or updates.
  - Search for the specific version in use if known, or assume the latest stable version unless specified otherwise.
  - Incorporate the findings into a revised attempt, citing the source of the updated information for transparency.

This approach ensures the agent stays current with evolving tools and reduces iteration cycles caused by outdated information.

### Running Command-Line Tools

When executing command-line tools such as biome (for linting/formatting JS/TS), bun (for running scripts), rustfmt (for formatting Rust code), or similar CLI tools:

- **Always Use Timeout**: To prevent indefinite hangs or long-running processes, always wrap the command with a timeout utility. The `timeout` command is available in the development environment (via coreutils in the Nix shell).
- **Recommended Timeout**: Use a reasonable timeout based on the expected runtime, such as 30 seconds for quick operations like linting or formatting small files. Adjust if necessary for larger tasks (e.g., 60s for building).
- **Long-Running Commands**: If it is expected for the command to take longer than 30s, the agent should run the command as a background session using the available background session tools.
- **New Bash Sessions and Interactive Input**: If a command is needed to be run in a new bash session, like "nix develop" with interactive input, then the agent should use the background session tools with command "bash" to spawn a background session with interactive terminal.
- **Syntax**: Prefix the command with `timeout <duration>`, where duration is in seconds (e.g., `30s`).
- **Fallback**: If the tool supports built-in timeout options, use those in addition to or instead of the external timeout. Check the tool's documentation for such flags.
- **Error Handling**: If the command times out, log the event and consider retrying with a longer timeout or investigating the cause (e.g., via researching docs as per the previous guideline).

This ensures safe and reliable execution of CLI tools without risking agent stalls.

## Best Practices

- **Proactive Verification**: Even if the first try succeeds, consider a quick doc check for high-stakes tasks or when dealing with rapidly evolving libraries (e.g., those in beta or with frequent updates).
- **Documentation Prioritization**: Always favor official docs over secondary sources like forums or blogs, unless the official docs explicitly reference them.
- **Error Reporting**: In your task logs or responses, note any researched updates and how they resolved the issue.
- **Efficiency**: Limit research to what's necessary—focus on the problematic aspect (e.g., installation, configuration, or specific method usage) rather than a full deep dive.

## Examples

- **Scenario: Using a Linting Tool (e.g., biome)**  
  If `timeout 30s biome lint .` fails with an unrecognized option: Research the latest flags on biomejs.dev/docs/cli/lint and adjust accordingly.

- **Scenario: Integrating a Library (e.g., portable-pty in Rust)**  
  If spawning a command errors due to deprecated parameters: Check docs.rs/portable-pty for the current syntax.

- **Scenario: Formatting Tool (e.g., rustfmt)**  
  If `timeout 30s rustfmt src/lib.rs` doesn't apply as expected: Verify the latest command-line options on rust-lang.github.io/rustfmt.

By following these guidelines, agents contribute to robust, maintainable code in OpenCode.ai projects. Updates to this document should be proposed via pull requests.