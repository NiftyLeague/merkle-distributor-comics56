import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { Contract, BigNumber, constants } from 'ethers'
import BalanceTree from '../src/balance-tree'

import Distributor from '../build/MerkleDistributor.json'
import TestERC1155 from '../build/TestERC1155.json'
import { parseBalanceMap } from '../src/parse-balance-map'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

describe('MerkleDistributor', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })

  const wallets = provider.getWallets()
  const [wallet0, wallet1, beneficiary] = wallets

  let token: Contract
  let claimableTokenAmount = 10000;
  let tokenAmounts = [claimableTokenAmount, claimableTokenAmount]
  let tokenIds = [5, 6]
  beforeEach('deploy token', async () => {
    token = await deployContract(wallet0, TestERC1155, [wallet0.address, tokenIds, tokenAmounts], overrides)
  })

  describe('#token', () => {
    it('returns the token address', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, claimableTokenAmount, claimableTokenAmount, ZERO_BYTES32, beneficiary.address], overrides)
      expect(await distributor.token()).to.eq(token.address)
    })
  })

  describe('#merkleRoot', () => {
    it('returns the zero merkle root', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, claimableTokenAmount, claimableTokenAmount, ZERO_BYTES32, beneficiary.address], overrides)
      expect(await distributor.merkleRoot()).to.eq(ZERO_BYTES32)
    })
  })

  describe('#claim', () => {
    it('fails for empty proof', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, claimableTokenAmount, claimableTokenAmount, ZERO_BYTES32, beneficiary.address], overrides)
      await expect(distributor.claim(0, wallet0.address, 10, 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    it('fails for invalid index', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, claimableTokenAmount, claimableTokenAmount, ZERO_BYTES32, beneficiary.address], overrides)
      await expect(distributor.claim(0, wallet0.address, 10, 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    describe('two account tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { account: wallet0.address, amount0: BigNumber.from(50), amount1: BigNumber.from(100) },
          { account: wallet1.address, amount0: BigNumber.from(51), amount1: BigNumber.from(102) },
        ])
        distributor = await deployContract(wallet0, Distributor, [token.address, claimableTokenAmount, claimableTokenAmount, tree.getHexRoot(), beneficiary.address], overrides)
        await token.setBalance(distributor.address, tokenIds, tokenAmounts)
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(50), BigNumber.from(100))
        await expect(distributor.claim(0, wallet0.address, 50, 100, proof0, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, wallet0.address)
        const proof1 = tree.getProof(1, wallet1.address, BigNumber.from(51), BigNumber.from(102))
        await expect(distributor.claim(1, wallet1.address, 51, 102, proof1, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(1, wallet1.address)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(50), BigNumber.from(100))
        expect(await token.balanceOf(wallet0.address, 5)).to.eq(0)
        expect(await token.balanceOf(wallet0.address, 6)).to.eq(0)
        await distributor.claim(0, wallet0.address, 50, 100, proof0, overrides)
        expect(await token.balanceOf(wallet0.address, 5)).to.eq(50)
        expect(await token.balanceOf(wallet0.address, 6)).to.eq(100)
      })

      it('must have enough to transfer', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(50), BigNumber.from(100))
        await token.setBalance(distributor.address, tokenIds, [10, 10])
        await expect(distributor.claim(0, wallet0.address, 50, 100, proof0, overrides)).to.be.revertedWith(
          'ERC1155: insufficient balance for transfer'
        )
      })

      it('sets #isClaimed', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(50), BigNumber.from(100))
        expect(await distributor.isClaimed(0)).to.eq(false)
        expect(await distributor.isClaimed(1)).to.eq(false)
        await distributor.claim(0, wallet0.address, 50, 100, proof0, overrides)
        expect(await distributor.isClaimed(0)).to.eq(true)
        expect(await distributor.isClaimed(1)).to.eq(false)
      })

      it('cannot allow two claims', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(50), BigNumber.from(100))
        await distributor.claim(0, wallet0.address, 50, 100, proof0, overrides)
        await expect(distributor.claim(0, wallet0.address, 50, 100, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      })

      it('cannot claim more than once: 0 and then 1', async () => {
        await distributor.claim(
          0,
          wallet0.address,
          50,
          100,
          tree.getProof(0, wallet0.address, BigNumber.from(50), BigNumber.from(100)),
          overrides
        )
        await distributor.claim(
          1,
          wallet1.address,
          51,
          102,
          tree.getProof(1, wallet1.address, BigNumber.from(51), BigNumber.from(102)),          overrides
        )

        await expect(
          distributor.claim(0, wallet0.address, 50, 100, tree.getProof(0, wallet0.address, BigNumber.from(50), BigNumber.from(100)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim more than once: 1 and then 0', async () => {
        await distributor.claim(
          1,
          wallet1.address,
          51,
          102,
          tree.getProof(1, wallet1.address, BigNumber.from(51), BigNumber.from(102)),
          overrides
        )
        await distributor.claim(
          0,
          wallet0.address,
          50,
          100,
          tree.getProof(0, wallet0.address, BigNumber.from(50), BigNumber.from(100)),
          overrides
        )

        await expect(
          distributor.claim(1, wallet1.address, 51, 102, tree.getProof(1, wallet1.address, BigNumber.from(51), BigNumber.from(102)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim for address other than proof', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(50), BigNumber.from(100))
        await expect(distributor.claim(1, wallet1.address, 50, 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('cannot claim more than proof', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(50), BigNumber.from(100))
        await expect(distributor.claim(0, wallet0.address, 50, 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('gas', async () => {
        const proof = tree.getProof(0, wallet0.address, BigNumber.from(50), BigNumber.from(100))
        const tx = await distributor.claim(0, wallet0.address, 50, 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(156799)
      })
    })
    describe('larger tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree(
          wallets.map((wallet, ix) => {
            return { account: wallet.address, amount0: BigNumber.from(ix + 1), amount1: BigNumber.from(ix + 1) }
          })
        )
        distributor = await deployContract(wallet0, Distributor, [token.address, claimableTokenAmount, claimableTokenAmount, tree.getHexRoot(), beneficiary.address], overrides)
        await token.setBalance(distributor.address, tokenIds, tokenAmounts)
      })

      it('claim index 4', async () => {
        const proof = tree.getProof(4, wallets[4].address, BigNumber.from(5), BigNumber.from(5))
        await expect(distributor.claim(4, wallets[4].address, 5, 5, proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(4, wallets[4].address)
      })

      it('claim index 9', async () => {
        const proof = tree.getProof(9, wallets[9].address, BigNumber.from(10), BigNumber.from(10))
        await expect(distributor.claim(9, wallets[9].address, 10, 10, proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(9, wallets[9].address)
      })

      it('gas', async () => {
        const proof = tree.getProof(9, wallets[9].address, BigNumber.from(10), BigNumber.from(10))
        const tx = await distributor.claim(9, wallets[9].address, 10, 10, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(159272)
      })

      it('gas second down about 15k', async () => {
        await distributor.claim(
          0,
          wallets[0].address,
          1,
          1,
          tree.getProof(0, wallets[0].address, BigNumber.from(1), BigNumber.from(1)),
          overrides
        )
        const tx = await distributor.claim(
          1,
          wallets[1].address,
          2,
          2,
          tree.getProof(1, wallets[1].address, BigNumber.from(2), BigNumber.from(2)),
          overrides
        )
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(114252)
      })
    })

    describe('realistic size tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      const NUM_LEAVES = 100_000
      const NUM_SAMPLES = 25
      const elements: { account: string; amount0: BigNumber; amount1: BigNumber }[] = []
      for (let i = 0; i < NUM_LEAVES; i++) {
        const node = { account: wallet0.address, amount0: BigNumber.from(100), amount1: BigNumber.from(200) }
        elements.push(node)
      }
      tree = new BalanceTree(elements)

      it('proof verification works', () => {
        const root = Buffer.from(tree.getHexRoot().slice(2), 'hex')
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree
            .getProof(i, wallet0.address, BigNumber.from(100), BigNumber.from(200))
            .map((el) => Buffer.from(el.slice(2), 'hex'))
          const validProof = BalanceTree.verifyProof(i, wallet0.address, BigNumber.from(100), BigNumber.from(200), proof, root)
          expect(validProof).to.be.true
        }
      })

      beforeEach('deploy', async () => {
        distributor = await deployContract(wallet0, Distributor, [token.address, claimableTokenAmount, claimableTokenAmount, tree.getHexRoot(), beneficiary.address], overrides)
        await token.setBalance(distributor.address, tokenIds, [constants.MaxUint256, constants.MaxUint256])
      })

      it('gas', async () => {
        const proof = tree.getProof(50000, wallet0.address, BigNumber.from(100), BigNumber.from(200))
        const tx = await distributor.claim(50000, wallet0.address, 100, 200, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(169943)
      })
      it('gas deeper node', async () => {
        const proof = tree.getProof(90000, wallet0.address, BigNumber.from(100), BigNumber.from(200))
        const tx = await distributor.claim(90000, wallet0.address, 100, 200, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(170011)
      })
      it('gas average random distribution', async () => {
        let total: BigNumber = BigNumber.from(0)
        let count: number = 0
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100), BigNumber.from(200))
          const tx = await distributor.claim(i, wallet0.address, 100, 200, proof, overrides)
          const receipt = await tx.wait()
          total = total.add(receipt.gasUsed)
          count++
        }
        const average = total.div(count)
        expect(average).to.eq(112364)
      })
      // this is what we gas golfed by packing the bitmap
      it('gas average first 25', async () => {
        let total: BigNumber = BigNumber.from(0)
        let count: number = 0
        for (let i = 0; i < 25; i++) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100), BigNumber.from(200))
          const tx = await distributor.claim(i, wallet0.address, 100, 200, proof, overrides)
          const receipt = await tx.wait()
          total = total.add(receipt.gasUsed)
          count++
        }
        const average = total.div(count)
        expect(average).to.eq(97964)
      })

      it('no double claims in random distribution', async () => {
        for (let i = 0; i < 25; i += Math.floor(Math.random() * (NUM_LEAVES / NUM_SAMPLES))) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100), BigNumber.from(200))
          await distributor.claim(i, wallet0.address, 100, 200, proof, overrides)
          await expect(distributor.claim(i, wallet0.address, 100, 200, proof, overrides)).to.be.revertedWith(
            'MerkleDistributor: Drop already claimed.'
          )
        }
      })
    })
  })

  describe('parseBalanceMap', () => {
    let distributor: Contract
    let claims: {
      [account: string]: {
        index: number
        amount0: string
        amount1: string
        proof: string[]
      }
    }
    beforeEach('deploy', async () => {
      const { claims: innerClaims, merkleRoot, tokenTotal0, tokenTotal1 } = parseBalanceMap([
        { address: wallet0.address, p5: 100, p6: 200 },
        { address: wallet1.address, p5: 150, p6: 300 },
        { address: wallets[2].address, p5: 125, p6: 250 }
      ])
      expect(tokenTotal0).to.eq('0x0177') // 375
      expect(tokenTotal1).to.eq('0x02ee') // 750
      claims = innerClaims
      distributor = await deployContract(wallet0, Distributor, [token.address, claimableTokenAmount, claimableTokenAmount, merkleRoot, beneficiary.address], overrides)
      await token.setBalance(distributor.address, tokenIds, [tokenTotal0, tokenTotal1])
    })

    it('check the proofs is as expected', () => {
      expect(claims).to.deep.eq({
        [wallet0.address]: {
          index: 0,
          amount0: '0x64',
          amount1: '0xc8',
          proof: [
            '0xd85305a105e88b2e1f9197bdcadbf54f14b4cfc9fa4f7bd5befb46d62cce71bf',
            '0xdfa592aa545f4abccb9b07d42bbc3f92fb930019b549bc18f1d1d9c1228b26ce',
          ],
        },
        [wallet1.address]: {
          index: 1,
          amount0: '0x96',
          amount1: '0x012c',
          proof: [
            '0x1ed3f0d55e3b0dc79931fdb8dd4210f6d2dbbf8102b289cadbb90475bcc19fde',
          ],
        },
        [wallets[2].address]: {
          index: 2,
          amount0: '0x7d',
          amount1: '0xfa',
          proof: [
            '0x50b7033f827c24f000c66fd6921c1d6fd719ba7f435806f92af17d68f768b7be',
            '0xdfa592aa545f4abccb9b07d42bbc3f92fb930019b549bc18f1d1d9c1228b26ce',
          ],
        },
      })
    })

    it('all claims work exactly once', async () => {
      for (let account in claims) {
        const claim = claims[account]
        await expect(distributor.claim(claim.index, account, claim.amount0, claim.amount1, claim.proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(claim.index, account)
        await expect(distributor.claim(claim.index, account, claim.amount0, claim.amount1, claim.proof, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      }
      expect(await token.balanceOf(distributor.address, 5)).to.eq(0)
      expect(await token.balanceOf(distributor.address, 6)).to.eq(0)
    })
  })
})
