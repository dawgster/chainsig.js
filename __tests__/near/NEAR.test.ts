import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import { PublicKey as NearPublicKey } from '@near-js/crypto'
import {
  Transaction as NearTransaction,
  SignedTransaction as NearSignedTransaction,
  Action as NearAction,
  Transfer as NearTransfer,
  Signature as NearSignature,
} from '@near-js/transactions'

import type { NearTransactionRequest, NearUnsignedTransaction } from '../../src/chain-adapters/NEAR/types'
import type { ChainSignatureContract } from '../../src/contracts/ChainSignatureContract'

// Create typed mock functions
const mockQuery = jest.fn<(path: string, data: string) => Promise<any>>()
const mockBlock = jest.fn<(params: any) => Promise<any>>()
const mockSendTransaction = jest.fn<(tx: any) => Promise<any>>()

// Mock the JsonRpcProvider before importing NEAR
jest.unstable_mockModule('@near-js/providers', () => ({
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    query: mockQuery,
    block: mockBlock,
    sendTransaction: mockSendTransaction,
  })),
}))

// Import NEAR after the mock is set up
const { NEAR } = await import('../../src/chain-adapters/NEAR/NEAR')

describe('NEAR Chain Adapter', () => {
  let near: InstanceType<typeof NEAR>
  let mockContract: ChainSignatureContract

  const mockPublicKey = 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp'
  const mockAccountId = 'test.testnet'
  const mockBlockHash = 'EHuGQACu4zDquke3NZFAhEakR2KxjnqaUbdVKxEdkCjT'

  beforeEach(() => {
    jest.clearAllMocks()

    mockContract = {
      sign: jest.fn(),
      getPublicKey: jest.fn(),
      getDerivedPublicKey: jest.fn<() => Promise<string>>().mockResolvedValue(mockPublicKey),
      getCurrentSignatureDeposit: jest.fn().mockReturnValue(1),
      contractId: 'v1.signer-prod.testnet',
      networkId: 'testnet',
    } as unknown as ChainSignatureContract

    near = new NEAR({
      rpcUrl: 'https://rpc.testnet.near.org',
      networkId: 'testnet',
      contract: mockContract,
    })
  })

  describe('getBalance', () => {
    it('should get balance for existing account', async () => {
      const mockAmount = '1000000000000000000000000' // 1 NEAR in yoctoNEAR
      mockQuery.mockResolvedValue({ amount: mockAmount })

      const { balance, decimals } = await near.getBalance(mockAccountId)

      expect(balance).toBe(BigInt(mockAmount))
      expect(decimals).toBe(24)
      expect(mockQuery).toHaveBeenCalledWith(`account/${mockAccountId}`, '')
    })

    it('should throw error for non-existent account', async () => {
      mockQuery.mockRejectedValue({
        type: 'AccountDoesNotExist',
        message: "Account doesn't exist",
      })

      await expect(near.getBalance('nonexistent.testnet')).rejects.toThrow(
        /NEAR derived account not found/
      )
    })

    it('should throw original error for other errors', async () => {
      const networkError = new Error('Network error')
      mockQuery.mockRejectedValue(networkError)

      await expect(near.getBalance(mockAccountId)).rejects.toThrow('Network error')
    })
  })

  describe('deriveAddressAndPublicKey', () => {
    it('should derive address and public key', async () => {
      const predecessor = 'controller.testnet'
      const path = 'derived'

      const { address, publicKey } = await near.deriveAddressAndPublicKey(predecessor, path)

      expect(address).toBe(`${path}.${predecessor}`)
      expect(publicKey).toBe(mockPublicKey)
      expect(mockContract.getDerivedPublicKey).toHaveBeenCalledWith({
        path,
        predecessor,
        IsEd25519: true,
      })
    })
  })

  describe('serializeTransaction and deserializeTransaction', () => {
    it('should serialize and deserialize transaction correctly', () => {
      const publicKey = NearPublicKey.fromString(mockPublicKey)
      const actions = [new NearAction({ transfer: new NearTransfer({ deposit: BigInt(1000000) }) })]
      const blockHash = new Uint8Array(32).fill(1)

      const tx = new NearTransaction({
        signerId: mockAccountId,
        publicKey,
        nonce: BigInt(1),
        receiverId: 'recipient.testnet',
        actions,
        blockHash,
      })

      const unsignedTx = { transaction: tx }

      const serialized = near.serializeTransaction(unsignedTx)
      expect(typeof serialized).toBe('string')
      expect(serialized.length).toBeGreaterThan(0)

      const deserialized = near.deserializeTransaction(serialized)
      expect(deserialized.transaction).toBeDefined()
      expect(deserialized.transaction.signerId).toBe(mockAccountId)
      expect(deserialized.transaction.receiverId).toBe('recipient.testnet')
    })
  })

  describe('prepareTransactionForSigning', () => {
    it('should prepare transaction for signing', async () => {
      mockQuery.mockResolvedValue({
        block_hash: mockBlockHash,
        nonce: 5,
        public_key: mockPublicKey,
      })

      mockBlock.mockResolvedValue({
        header: { hash: mockBlockHash },
      })

      const request: NearTransactionRequest = {
        from: mockAccountId,
        to: 'recipient.testnet',
        amount: BigInt(1000000000000000000000000), // 1 NEAR
        publicKey: mockPublicKey,
      }

      const { transaction, hashesToSign } = await near.prepareTransactionForSigning(request)

      expect(transaction).toBeDefined()
      expect(transaction.transaction).toBeDefined()
      expect(transaction.transaction.signerId).toBe(mockAccountId)
      expect(transaction.transaction.receiverId).toBe('recipient.testnet')
      expect(hashesToSign).toHaveLength(1)
      expect(hashesToSign[0]).toHaveLength(32) // SHA-256 hash
    })

    it('should throw error for non-existent sender account', async () => {
      mockQuery.mockRejectedValue({
        type: 'AccountDoesNotExist',
        message: "Account doesn't exist",
      })

      const request: NearTransactionRequest = {
        from: 'nonexistent.testnet',
        to: 'recipient.testnet',
        amount: BigInt(1000000),
        publicKey: mockPublicKey,
      }

      await expect(near.prepareTransactionForSigning(request)).rejects.toThrow(
        /NEAR derived account not found/
      )
    })

    it('should use default nonce of 1 when access key has no nonce', async () => {
      mockQuery.mockResolvedValue({
        block_hash: mockBlockHash,
        public_key: mockPublicKey,
        // No nonce field
      })

      mockBlock.mockResolvedValue({
        header: { hash: mockBlockHash },
      })

      const request: NearTransactionRequest = {
        from: mockAccountId,
        to: 'recipient.testnet',
        amount: BigInt(1000000),
        publicKey: mockPublicKey,
      }

      const { transaction } = await near.prepareTransactionForSigning(request)

      expect(transaction.transaction.nonce).toBe(BigInt(1))
    })
  })

  describe('finalizeTransactionSigning', () => {
    it('should finalize transaction with Ed25519 signature', () => {
      const publicKey = NearPublicKey.fromString(mockPublicKey)
      const actions = [new NearAction({ transfer: new NearTransfer({ deposit: BigInt(1000000) }) })]
      const blockHash = new Uint8Array(32).fill(1)

      const tx = new NearTransaction({
        signerId: mockAccountId,
        publicKey,
        nonce: BigInt(1),
        receiverId: 'recipient.testnet',
        actions,
        blockHash,
      })

      const unsignedTx: NearUnsignedTransaction = { transaction: tx }
      const mockSignature = new Uint8Array(64).fill(42) // Ed25519 signature is 64 bytes

      const signedTxBase64 = near.finalizeTransactionSigning({
        transaction: unsignedTx,
        rsvSignatures: {
          scheme: 'Ed25519',
          signature: Array.from(mockSignature),
        } as any,
      })

      expect(typeof signedTxBase64).toBe('string')
      expect(signedTxBase64.length).toBeGreaterThan(0)

      // Verify it's valid base64
      const decoded = Buffer.from(signedTxBase64, 'base64')
      expect(decoded.length).toBeGreaterThan(0)
    })

    it('should throw error for RSV signature array', () => {
      const publicKey = NearPublicKey.fromString(mockPublicKey)
      const actions = [new NearAction({ transfer: new NearTransfer({ deposit: BigInt(1000000) }) })]
      const blockHash = new Uint8Array(32).fill(1)

      const tx = new NearTransaction({
        signerId: mockAccountId,
        publicKey,
        nonce: BigInt(1),
        receiverId: 'recipient.testnet',
        actions,
        blockHash,
      })

      const unsignedTx: NearUnsignedTransaction = { transaction: tx }

      expect(() =>
        near.finalizeTransactionSigning({
          transaction: unsignedTx,
          rsvSignatures: [{ r: '0x', s: '0x', v: 27 }] as any,
        })
      ).toThrow('NEAR expects an Ed25519 signature object, not RSV array')
    })
  })

  describe('broadcastTx', () => {
    it('should broadcast signed transaction', async () => {
      const mockTxHash = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'

      // Create a valid signed transaction for testing
      const publicKey = NearPublicKey.fromString(mockPublicKey)
      const actions = [new NearAction({ transfer: new NearTransfer({ deposit: BigInt(1000000) }) })]
      const blockHash = new Uint8Array(32).fill(1)

      const tx = new NearTransaction({
        signerId: mockAccountId,
        publicKey,
        nonce: BigInt(1),
        receiverId: 'recipient.testnet',
        actions,
        blockHash,
      })

      const signedTx = new NearSignedTransaction({
        transaction: tx,
        signature: new NearSignature({
          keyType: publicKey.keyType,
          data: new Uint8Array(64).fill(42),
        }),
      })

      const serializedSignedTx = Buffer.from(signedTx.encode()).toString('base64')

      mockSendTransaction.mockResolvedValue({
        transaction: { hash: mockTxHash },
      })

      const result = await near.broadcastTx(serializedSignedTx)

      expect(result.hash).toBe(mockTxHash)
      expect(mockSendTransaction).toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should identify AccountDoesNotExist errors by type field', async () => {
      mockQuery.mockRejectedValue({ type: 'AccountDoesNotExist' })
      await expect(near.getBalance('test.testnet')).rejects.toThrow(/NEAR derived account not found/)
    })

    it('should identify AccountDoesNotExist errors by message with apostrophe', async () => {
      mockQuery.mockRejectedValue({ message: "Account doesn't exist" })
      await expect(near.getBalance('test.testnet')).rejects.toThrow(/NEAR derived account not found/)
    })

    it('should identify AccountDoesNotExist errors by message without apostrophe', async () => {
      mockQuery.mockRejectedValue({ message: 'Account does not exist' })
      await expect(near.getBalance('test.testnet')).rejects.toThrow(/NEAR derived account not found/)
    })
  })
})
