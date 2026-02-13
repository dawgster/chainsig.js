import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import { KeyPair } from '@near-js/crypto'

import { ensureDerivedAccountExists } from '../../src/chain-adapters/NEAR/utils'

// Create typed mock functions
const mockQuery = jest.fn<(path: string, data: string) => Promise<any>>()
const mockSendTransaction = jest.fn<(tx: any) => Promise<any>>()

const mockProvider = {
  query: mockQuery,
  sendTransaction: mockSendTransaction,
}

describe('NEAR Utils', () => {
  const mockPublicKey = 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp'
  const mockBlockHash = 'EHuGQACu4zDquke3NZFAhEakR2KxjnqaUbdVKxEdkCjT'
  const mockControllerAccountId = 'controller.testnet'
  const mockDerivedAccountId = 'derived.controller.testnet'
  let mockControllerKeyPair: KeyPair

  beforeEach(() => {
    jest.clearAllMocks()
    mockControllerKeyPair = KeyPair.fromRandom('ed25519')
  })

  describe('ensureDerivedAccountExists', () => {
    it('should return created: false if account already exists', async () => {
      mockQuery.mockResolvedValue({ amount: '1000000000000000000000000' })

      const result = await ensureDerivedAccountExists({
        provider: mockProvider as any,
        controllerAccountId: mockControllerAccountId,
        controllerKeyPair: mockControllerKeyPair,
        derivedAccountId: mockDerivedAccountId,
        mpcPublicKey: mockPublicKey,
        initialDepositYocto: BigInt(100000000000000000000000), // 0.1 NEAR
      })

      expect(result.created).toBe(false)
      expect(mockQuery).toHaveBeenCalledWith(`account/${mockDerivedAccountId}`, '')
      expect(mockSendTransaction).not.toHaveBeenCalled()
    })

    it('should create account if it does not exist', async () => {
      // First call: check if derived account exists (throws error = not found)
      // Second call: get access key for controller account
      mockQuery
        .mockRejectedValueOnce(new Error('Account not found'))
        .mockResolvedValueOnce({
          block_hash: mockBlockHash,
          nonce: 10,
          public_key: mockControllerKeyPair.getPublicKey().toString(),
        })

      mockSendTransaction.mockResolvedValue({
        transaction: { hash: 'txhash123' },
      })

      const result = await ensureDerivedAccountExists({
        provider: mockProvider as any,
        controllerAccountId: mockControllerAccountId,
        controllerKeyPair: mockControllerKeyPair,
        derivedAccountId: mockDerivedAccountId,
        mpcPublicKey: mockPublicKey,
        initialDepositYocto: BigInt(100000000000000000000000), // 0.1 NEAR
      })

      expect(result.created).toBe(true)
      expect(mockQuery).toHaveBeenCalledTimes(2)
      expect(mockSendTransaction).toHaveBeenCalledTimes(1)
    })

    it('should handle default nonce when not provided', async () => {
      mockQuery
        .mockRejectedValueOnce(new Error('Account not found'))
        .mockResolvedValueOnce({
          block_hash: mockBlockHash,
          // No nonce field - should default to 0 + 1 = 1
          public_key: mockControllerKeyPair.getPublicKey().toString(),
        })

      mockSendTransaction.mockResolvedValue({
        transaction: { hash: 'txhash123' },
      })

      const result = await ensureDerivedAccountExists({
        provider: mockProvider as any,
        controllerAccountId: mockControllerAccountId,
        controllerKeyPair: mockControllerKeyPair,
        derivedAccountId: mockDerivedAccountId,
        mpcPublicKey: mockPublicKey,
        initialDepositYocto: BigInt(100000000000000000000000),
      })

      expect(result.created).toBe(true)
      expect(mockSendTransaction).toHaveBeenCalled()
    })

    it('should create transaction with correct actions', async () => {
      mockQuery
        .mockRejectedValueOnce(new Error('Account not found'))
        .mockResolvedValueOnce({
          block_hash: mockBlockHash,
          nonce: 5,
          public_key: mockControllerKeyPair.getPublicKey().toString(),
        })

      let sentTransaction: any
      mockSendTransaction.mockImplementation(async (tx: any) => {
        sentTransaction = tx
        return { transaction: { hash: 'txhash123' } }
      })

      const initialDeposit = BigInt(100000000000000000000000)

      await ensureDerivedAccountExists({
        provider: mockProvider as any,
        controllerAccountId: mockControllerAccountId,
        controllerKeyPair: mockControllerKeyPair,
        derivedAccountId: mockDerivedAccountId,
        mpcPublicKey: mockPublicKey,
        initialDepositYocto: initialDeposit,
      })

      expect(sentTransaction).toBeDefined()
      // Verify the transaction structure
      expect(sentTransaction.transaction.signerId).toBe(mockControllerAccountId)
      expect(sentTransaction.transaction.receiverId).toBe(mockDerivedAccountId)
      expect(sentTransaction.transaction.actions).toHaveLength(3)

      // Actions should be: createAccount, transfer, addKey
      const actions = sentTransaction.transaction.actions
      expect(actions[0].createAccount).toBeDefined()
      expect(actions[1].transfer).toBeDefined()
      expect(actions[1].transfer.deposit).toBe(initialDeposit)
      expect(actions[2].addKey).toBeDefined()
    })
  })
})
