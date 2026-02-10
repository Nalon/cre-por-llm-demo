# Build a Custom Proof of Reserve Data Feed With CRE

A CRE workflow that runs on a schedule to: (1) fetch reserve data from an offchain API, (2) read on-chain token total supply, (3) call a Gemini LLM to compute a coverage-based risk score, and (4) submit the report (reserve, supply, risk score) on-chain.

See [main.ts for workflow code](/por/main.ts).

## Important Prerequisites

### Required Setup

- **BunJs v1.3 or higher** - [Download here](https://bun.com/docs/installation)
- **Install CRE CLI** - [Installation instructions](https://docs.chain.link/cre/getting-started/cli-installation)
- **ETH on ETH Sepolia**
- **Gemini LLM API key** - [Get from Google AI Studio](https://aistudio.google.com/app/apikey)

## Testing

### Clone this repo

```bash
git clone https://github.com/Nalon/cre-por-llm-demo.git
cd cre-por-llm-demo
bun install --cwd ./por
```

### Configure `.env` values

```bash
cp .env.sample .env
```

Within the new `.env` file, set your private key and gemini api key accordingly.

### Simulate the workflow

Simulate without broadcasting an on-chain transaction:
```bash
cre workflow simulate por
```

Simulate with broadcast:
```bash
cre workflow simulate por --broadcast
```

## Workshop

[Chapter 1 - CRE CLI Setup](/workshop/chapter-1.md)

[Chapter 2 - CRE Basics](/workshop/chapter-2.md)

[Chapter 3 - PoR Demo](/workshop/chapter-3.md)

