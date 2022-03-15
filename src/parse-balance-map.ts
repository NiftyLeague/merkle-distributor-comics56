import { BigNumber, utils } from 'ethers';
import BalanceTree from './balance-tree';

const { isAddress, getAddress } = utils;

// This is the blob that gets distributed and pinned to IPFS.
// It is completely sufficient for recreating the entire merkle tree.
// Anyone can verify that all air drops are included in the tree,
// and the tree has no additional distributions.
interface MerkleDistributorInfo {
  merkleRoot: string;
  tokenTotal0: string;
  tokenTotal1: string;
  claims: {
    [account: string]: {
      index: number;
      amount0: string;
      amount1: string;
      proof: string[];
    };
  };
}

type Format = { address: string; p5: number | string; p6: number | string };

export function parseBalanceMap(balances: Format[]): MerkleDistributorInfo {
  const dataByAddress = balances.reduce<{
    [address: string]: { amount0: BigNumber; amount1: BigNumber };
  }>((memo, { address: account, p5, p6 }) => {
    if (!isAddress(account)) {
      throw new Error(`Found invalid address: ${account}`);
    }
    const parsed = getAddress(account);
    if (memo[parsed]) throw new Error(`Duplicate address: ${parsed}`);
    const parsedNum0 = BigNumber.from(p5);
    if (parsedNum0.lt(0)) throw new Error(`Invalid amount for account: ${account}`);
    const parsedNum1 = BigNumber.from(p6);
    if (parsedNum1.lt(0)) throw new Error(`Invalid amount for account: ${account}`);

    memo[parsed] = { amount0: parsedNum0, amount1: parsedNum1 };
    return memo;
  }, {});

  const sortedAddresses = Object.keys(dataByAddress).sort();

  // construct a tree
  const tree = new BalanceTree(
    sortedAddresses.map((address) => ({ account: address, amount0: dataByAddress[address].amount0, amount1: dataByAddress[address].amount1 }))
  );

  // generate claims
  const claims = sortedAddresses.reduce<{
    [address: string]: { amount0: string; amount1: string; index: number; proof: string[] };
  }>((memo, address, index) => {
    const { amount0, amount1 } = dataByAddress[address];
    memo[address] = {
      index,
      amount0: amount0.toHexString(),
      amount1: amount1.toHexString(),
      proof: tree.getProof(index, address, amount0, amount1),
    };
    return memo;
  }, {});

  const tokenTotal0: BigNumber = sortedAddresses.reduce<BigNumber>(
    (memo, key) => memo.add(dataByAddress[key].amount0),
    BigNumber.from(0)
  );

  const tokenTotal1: BigNumber = sortedAddresses.reduce<BigNumber>(
    (memo, key) => memo.add(dataByAddress[key].amount1),
    BigNumber.from(0)
  );

  return {
    merkleRoot: tree.getHexRoot(),
    tokenTotal0: tokenTotal0.toHexString(),
    tokenTotal1: tokenTotal1.toHexString(),
    claims,
  };
}
