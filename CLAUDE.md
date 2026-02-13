# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainSig.js is a TypeScript library for creating multi-chain transactions and signing them with NEAR's MPC (Multi-Party Computation) service. It provides a unified interface for 7 blockchain networks: EVM chains, Bitcoin, Cosmos, Solana, Aptos, SUI, and XRP Ledger.

## Common Commands

```bash
# Build
npm run build              # Production build (node + browser targets)
npm run watch              # Build in watch mode

# Test
npm run test               # Core unit tests (bitcoin, solana, evm, xrp)
npm run test:bitcoin       # Bitcoin tests only
npm run test:solana        # Solana tests only
npm run test:evm           # EVM tests only
npm run test:cosmos        # Cosmos tests only
npm run test:xrp           # XRP tests only
npm run test:watch         # Watch mode

# Integration tests (require INTEGRATION_TEST=true and funded accounts)
npm run test:integration:all     # All chains
npm run test:integration:evm     # EVM integration
npm run test:integration:bitcoin # Bitcoin integration

# Lint
npm run lint               # Run ESLint
npm run lint:fix           # Auto-fix linting issues

# Documentation
npm run docs:dev           # Vocs dev server
npm run docs:generate      # Generate TypeDoc
```

## Architecture

### Chain Adapter Pattern

All chain implementations extend the abstract `ChainAdapter<TransactionRequest, UnsignedTransaction>` base class (`src/chain-adapters/ChainAdapter.ts`). Each adapter must implement:

- `getBalance(address)` - Get native token balance
- `deriveAddressAndPublicKey(predecessor, path)` - Derive address via MPC KDF
- `prepareTransactionForSigning(request)` - Build transaction, return hashes to sign
- `finalizeTransactionSigning({transaction, rsvSignatures})` - Attach MPC signatures
- `broadcastTx(serialized)` - Submit to network
- `serializeTransaction()` / `deserializeTransaction()` - For persistence

### Key Type by Chain

- **secp256k1 (Ecdsa)**: EVM, Bitcoin, Cosmos, XRP
- **Ed25519 (Eddsa)**: Solana, Aptos, SUI

### MPC Integration

`ChainSignatureContract` (`src/contracts/ChainSignatureContract.ts`) interfaces with NEAR's chain signature contract:
- `sign({payloads, path, keyType, signerAccount})` - Request MPC signatures
- `getDerivedPublicKey({path, predecessor})` - Derive public key for a path
- `getPublicKey()` - Get root MPC public key

### Directory Structure

```
src/
├── chain-adapters/       # Per-chain implementations
│   ├── ChainAdapter.ts   # Abstract base class
│   ├── EVM/
│   ├── Bitcoin/
│   ├── Cosmos/
│   ├── Solana/
│   ├── Aptos/
│   ├── SUI/
│   └── XRP/
├── contracts/            # NEAR MPC contract interface
├── utils/                # Cryptography helpers (signature conversion, key compression)
├── constants.ts          # Environment configs, contract addresses, root pubkeys
├── types.ts              # Core type definitions (RSVSignature, pub key formats)
└── index.ts              # Library exports
```

### Exports

```typescript
import { chainAdapters, contracts, constants, utils } from 'chainsig.js'
// chainAdapters.evm.EVM, chainAdapters.btc.Bitcoin, etc.
// contracts.near.ChainSignatureContract
```

## TypeScript Path Aliases

Defined in `tsconfig.json`:
- `@chain-adapters` → `./src/chain-adapters`
- `@contracts` → `./src/contracts`
- `@utils` → `./src/utils`
- `@constants` → `./src/constants.ts`
- `@types` → `./src/types.ts`

## Build Configuration

Uses `tsup` to produce both Node.js and browser bundles:
- Node: `dist/node/` (ESM + CJS)
- Browser: `dist/browser/` (ESM + CJS)

## Testing Notes

- Jest with ESM support via `--experimental-vm-modules`
- Tests use mocks in `__mocks__/` for cryptography and contracts
- Integration tests require environment variables (NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, etc.)
- Local EVM testing available via `npm run hardhat`
