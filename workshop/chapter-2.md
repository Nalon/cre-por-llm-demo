# Chapter 2: The Mental Model

Before we dive into building, let's establish the mental model for CRE.

## What is CRE?

**Chainlink Runtime Environment (CRE)** is the all-in-one orchestration layer that unlocks institutional-grade smart contracts — data-connected, compliance-ready, privacy-preserving, and interoperable across blockchains and existing systems.

### Key Concepts

As developers, we write **Workflows** using the CRE SDK (available in Go and TypeScript). We use the **CRE CLI** to compile these workflows into WebAssembly (WASM) binaries and simulate them locally before deployment. There are some major benefits to this workflow-based design

- A single workflow can be used with multiple chains, which saves a ton of dev time and infrastructure effort

- Each workflow is orchestrated by a **Workflow DON** that monitors for triggers and coordinates execution

- The workflow can invoke specialized **Capability DONs**—for example, one that fetches offchain data or one that writes to a chain

- During execution, each node in a DON performs the requested task independently

- Their results are then cryptographically verified and aggregated via a **Byzantine Fault Tolerant (BFT) consensus protocol**, guaranteeing a single, correct, and consistent outcome

**Capabilities** are modular, decentralized services that performs a specific task, and each Capability is powered by its own independent Decentralized Oracle Network (DON), which is optimized for that specific task, ensuring security and reliable performance. These are your individual building blocks, or legos, that you piece together to create workflows.

Currently CRE has the following Capabilities:

- Triggers: Event sources that start your workflow executions.
- HTTP: Fetch and post data from external APIs with decentralized consensus.
- EVM Read & Write: Interact with smart contracts on EVM-compatible blockchains with decentralized consensus.

You can read more about all of these [here](https://docs.chain.link/cre/capabilities).

### What You Can Do with CRE

CRE workflows can do much more than what we'll cover in this workshop. Here's a comprehensive overview:

**Blockchain Interactions:**

- **Read from blockchains**: Query contract state, read events, fetch price data, check balances
- **Write to blockchains**: Execute transactions, update contract state, emit events, deploy contracts
- **Multi-chain operations**: Read from one chain, write to another—all in a single workflow
- **Event-driven workflows**: React to onchain events in real-time

**External Data & APIs:**

- **Call APIs**: Fetch data from any HTTP endpoint, authenticated APIs, webhooks
- **Consensus aggregation**: Multiple nodes fetch the same data, results are aggregated via BFT consensus
- **Data transformation**: Process and transform data before writing onchain
- **Multi-source aggregation**: Combine data from multiple APIs with consensus

**Automation & Scheduling:**

- **Cron schedules**: Run workflows on time-based schedules (every minute, hour, day, etc.)
- **Event triggers**: React to onchain events, HTTP requests, or custom triggers
- **Conditional logic**: Build complex workflows with conditional execution paths

**Advanced Capabilities:**

- **Secret management**: Securely store and access API keys, credentials
- **Error handling**: Robust error handling and retry logic
- **Logging & monitoring**: Built-in logging and observability

### The Trigger-and-Callback Model

Workflows use a simple **trigger-and-callback model**:

1. [**A Trigger**](https://docs.chain.link/cre/capabilities/triggers): An event source that starts a workflow execution (e.g., `cron.Trigger`, `http.Trigger`, `evm.LogTrigger`)
2. **A Callback**: A function that contains your business logic
3. **The `cre.handler()`**: The glue that connects a trigger to a callback

```typescript
cre.handler(
  cronTrigger.trigger({ schedule: "0 */10 * * * *" }), // trigger fires every 10 minutes
  onCronTrigger // your callback function
);

function onCronTrigger(runtime: Runtime<Config>): Record<string, never> {
  // Your business logic here
  return {};
}
```

### Built-in Consensus

One of CRE's most powerful features is that **every Capability execution automatically includes consensus**. When your workflow invokes a Capability (like fetching data from an API or reading from a blockchain), multiple independent nodes perform the operation. Their results are validated and aggregated through BFT consensus, ensuring a single, verified outcome.

This means your entire workflow—not just the onchain parts—benefits from the same security and reliability guarantees as blockchain transactions.

### Compiling and Simulating Workflows

The **CRE CLI** is your primary tool for developing workflows:

- **Compile**: Converts your TypeScript/Go code into WASM binaries
- **Simulate**: Runs workflows locally with real API calls and blockchain interactions
- **Deploy**: Deploys workflows to production DONs (Early Access)

```bash
# Compile and simulate a workflow
cre workflow simulate alerts

# The simulator will:
# 1. Compile your workflow to WASM
# 2. Prompt you to select a trigger
# 3. Execute the workflow locally
# 4. Make real calls to APIs and blockchains
```