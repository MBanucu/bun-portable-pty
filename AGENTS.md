# AGENTS.md

## Overview

This document provides guidelines for AI agents operating within the OpenCode.ai ecosystem. The primary goal is to ensure agents handle tasks efficiently, especially when integrating or utilizing external libraries and tools. Agents should prioritize accuracy, adaptability, and up-to-date knowledge to minimize errors and improve code quality.

## Core Guidelines

### Using Subagents for Research Tasks

When performing research—such as internet searches, official documentation lookups, or deep investigation of package/library usage—agents MUST launch a subagent (via the Task tool) with the appropriate `subagent_type` (typically "general" or "explore") rather than performing research directly. This ensures deeper, more thorough, and autonomous exploration leveraging specialized research workflows.

- **Standard Workflow:**
  1. Attempt the task using current knowledge or standard practices.
  2. If any uncertainty exists or an error occurs (e.g., syntax errors, deprecated features, version incompatibilities, unexpected behavior), immediately launch a subagent using the Task tool:
     - Set `subagent_type` to "general" for internet research, or "explore" for codebase lookup.
     - Provide a highly detailed prompt specifying exactly what information is needed and how it will be used.
     - Fetch results from the subagent and incorporate them into further work.
  3. When documentation needs verification or for high-stakes/critical tasks, proactively launch a subagent even if the initial attempt succeeds.
- **Examples:**
  - When integrating a new library: Launch a "general" research subagent to fetch up-to-date official documentation, usage guides, and recent changelogs.
  - When investigating errors or unexpected tool behavior: Launch a "general" research subagent to search forums, GitHub issues, and official docs for troubleshooting.
  - When mapping out code architecture or searching usage: Launch an "explore" subagent for thorough codebase analysis.
  - When verifying third-party tool CLI commands: Launch an internet research subagent to check the latest official usage examples.

Refer to the Task tool documentation for detailed instructions on invoking subagents for research tasks. Always aggregate findings from subagents before proceeding with implementation.

### Researching Documentation for Tools and Libraries

When working on a task that involves using any library, testing tool, linting tool, formatting tool, flake tool (e.g., Flake8), or any other similar tool or library:

- **Initial Attempt:** Proceed with your current knowledge or standard practices to implement the usage.
- **Mandatory Research Step:** Regardless of initial outcome, launch a research subagent using the Task tool whenever:
  - You encounter errors or possible version incompatibilities
  - There is any uncertainty about usage
  - The task is high-stakes, critical, or involves rapidly-evolving libraries
- **Subagent Usage:**
  - Use reliable sources such as:
    - Official project websites (e.g., PyPI pages, GitHub repositories).
    - Documentation hubs like Read the Docs, official API references, or developer portals.
    - Recent release notes or changelogs to identify breaking changes or updates.
  - Instruct the subagent to search for the specific version in use if known, or to assume the latest stable version unless specified otherwise.
  - Incorporate the findings into a revised implementation, citing the source of the updated information for transparency.

This approach ensures the agent stays current with evolving tools and reduces iteration cycles caused by outdated information.

### Running Command-Line Tools

When executing command-line tools such as biome (for linting/formatting JS/TS), bun (for running scripts), rustfmt (for formatting Rust code), or similar CLI tools:

- **Always Use Timeout:** To prevent indefinite hangs or long-running processes, always wrap the command with a timeout utility. The `timeout` command is available in the development environment (via coreutils in the Nix shell).
- **Recommended Timeout:** Use a reasonable timeout based on the expected runtime, such as 30 seconds for quick operations like linting or formatting small files. Adjust if necessary for larger tasks (e.g., 60s for building).
- **Long-Running Commands:** If it is expected for the command to take longer than 30s, the agent should run the command as a background session using the available background session tools.
- **New Bash Sessions and Interactive Input:** If a command is needed to be run in a new bash session, like "nix develop" with interactive input, then the agent should use the background session tools with command "bash" to spawn a background session with interactive terminal.
- **Syntax:** Prefix the command with `timeout <duration>`, where duration is in seconds (e.g., `30s`).
- **Fallback:** If the tool supports built-in timeout options, use those in addition to or instead of the external timeout. Check the tool's documentation for such flags.
- **Error Handling:** If the command times out, log the event and consider retrying with a longer timeout or investigating the cause (e.g., via researching docs as per the previous guideline).

This ensures safe and reliable execution of CLI tools without risking agent stalls.

## Best Practices

- **Proactive Verification:** Even if the first try succeeds, consider a quick doc check for high-stakes tasks or when dealing with rapidly evolving libraries (e.g., those in beta or with frequent updates).
- **Subagent Usage:** Always launch a research subagent for deep research instead of direct internet search or documentation fetching.
- **Documentation Prioritization:** Always favor official docs over secondary sources like forums or blogs, unless the official docs explicitly reference them.
- **Error Reporting:** In your task logs or responses, note any researched updates and how they resolved the issue.
- **Efficiency:** Limit research to what's necessary—focus on the problematic aspect (e.g., installation, configuration, or specific method usage) rather than a full deep dive.

## Examples

- **Scenario: Using a Linting Tool (e.g., biome)**  
  If `timeout 30s biome lint .` fails with an unrecognized option: Launch a research subagent (Task tool, subagent_type="general") to fetch official docs on biome CLI usage, then adjust accordingly.

- **Scenario: Integrating a Library (e.g., portable-pty in Rust)**  
  If spawning a command errors due to deprecated parameters: Launch a research subagent to check docs.rs/portable-pty for current syntax, update implementation, and cite findings.

- **Scenario: Formatting Tool (e.g., rustfmt)**  
  If `timeout 30s rustfmt src/lib.rs` doesn't apply as expected: Launch a research subagent to verify the latest command-line options on rust-lang.github.io/rustfmt.

- **Scenario: Deep codebase exploration**  
  When searching for API endpoints in a large project: Launch a Task subagent with subagent_type="explore" and a prompt specifying which patterns and files to scan for.

By following these guidelines—including mandatory use of subagents for research—agents contribute to robust, maintainable code in OpenCode.ai projects. Updates to this document should be proposed via pull requests.
