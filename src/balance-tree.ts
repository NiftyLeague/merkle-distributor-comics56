import MerkleTree from './merkle-tree'
import { BigNumber, utils } from 'ethers'

export default class BalanceTree {
  private readonly tree: MerkleTree
  constructor(balances: { account: string; amount0: BigNumber; amount1: BigNumber }[]) {
    this.tree = new MerkleTree(
      balances.map(({ account, amount0, amount1 }, index) => {
        return BalanceTree.toNode(index, account, amount0, amount1)
      })
    )
  }

  public static verifyProof(
    index: number | BigNumber,
    account: string,
    amount0: BigNumber,
    amount1: BigNumber,
    proof: Buffer[],
    root: Buffer
  ): boolean {
    let pair = BalanceTree.toNode(index, account, amount0, amount1)
    for (const item of proof) {
      pair = MerkleTree.combinedHash(pair, item)
    }

    return pair.equals(root)
  }

  // keccak256(abi.encode(index, account, amount))
  public static toNode(index: number | BigNumber, account: string, amount0: BigNumber, amount1: BigNumber): Buffer {
    return Buffer.from(
      utils.solidityKeccak256(['uint256', 'address', 'uint256', 'uint256'], [index, account, amount0, amount1]).substr(2),
      'hex'
    )
  }

  public getHexRoot(): string {
    return this.tree.getHexRoot()
  }

  // returns the hex bytes32 values of the proof
  public getProof(index: number | BigNumber, account: string, amount0: BigNumber, amount1: BigNumber): string[] {
    return this.tree.getHexProof(BalanceTree.toNode(index, account, amount0, amount1))
  }
}
