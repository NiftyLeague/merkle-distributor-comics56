import { ethers, tenderly, run } from 'hardhat';
import { Contract } from '@ethersproject/contracts';
import fs from 'fs';
import ethProvider from 'eth-provider';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

const COMIC_5_CLAIMABLE_TOKEN_AMOUNT = 9900;
const COMIC_6_CLAIMABLE_TOKEN_AMOUNT = 1200;
const IDS = [5, 6];
const CLAIMABLE_AMOUNTS = [COMIC_5_CLAIMABLE_TOKEN_AMOUNT, COMIC_6_CLAIMABLE_TOKEN_AMOUNT];

const NIFTY_DAO_SAFE = '0xd06Ae6fB7EaDe890f3e295D69A6679380C9456c1';

const targetNetwork = process.env.HARDHAT_NETWORK as string;

const getLedgerSigner = async () => {
  const frame = ethProvider('frame');
  const ledgerSigner = (await frame.request({ method: 'eth_requestAccounts' }))[0];
  const { Web3Provider } = ethers.providers;
  const provider = new Web3Provider(frame);
  return provider.getSigner(ledgerSigner);
};

const getToken = async () => {
  let token;
  const addressPath = `./COMICS/token.${targetNetwork}.address`;
  if (fs.existsSync(addressPath)) {
    const abi = JSON.parse(fs.readFileSync('./COMICS/abi.json', { encoding: 'utf8' }));
    const comicsAddress = fs.readFileSync(addressPath).toString();
    // const signer = (await ethers.getSigners())[0];
    const signer = await getLedgerSigner();
    token = await ethers.getContractAt(abi, comicsAddress, signer);
    await token.deployed();
    console.log('Using token deployed at ', token.address);
  } else {
    const Token = await ethers.getContractFactory('TestERC1155');
    token = await Token.deploy(IDS, CLAIMABLE_AMOUNTS);
    console.log('TestERC1155 was deployed at ', token.address);
  }
  return token;
};

const tenderlyVerify = async ({ contractName, contractAddress }: { contractName: string; contractAddress: string }) => {
  const tenderlyNetworks = ['kovan', 'goerli', 'mainnet', 'rinkeby', 'ropsten', 'matic', 'mumbai', 'xDai', 'POA'];

  if (tenderlyNetworks.includes(targetNetwork)) {
    console.log(` 📁 Attempting tenderly verification of ${contractName} on ${targetNetwork}`);
    await tenderly.persistArtifacts({
      name: contractName,
      address: contractAddress,
    });
    const verification = await tenderly.verify({
      name: contractName,
      address: contractAddress,
      network: targetNetwork,
    });
    return verification;
  }
  console.log(` 🧐 Contract verification not supported on ${targetNetwork}`);
};

const deployDistributor = async (token: Contract) => {
  const Distributor = await ethers.getContractFactory('MerkleDistributor', {
    // ...(targetNetwork !== 'localhost' && { signer: (await ethers.getSigners())[0] }),
    ...(targetNetwork !== 'localhost' && { signer: await getLedgerSigner() }),
  });
  const tree = JSON.parse(fs.readFileSync('data/result.json', { encoding: 'utf8' }));
  console.log('token.address:', token.address);
  console.log('tree.merkleRoot:', tree.merkleRoot);
  const distributor = await Distributor.deploy(
    token.address,
    COMIC_5_CLAIMABLE_TOKEN_AMOUNT,
    COMIC_6_CLAIMABLE_TOKEN_AMOUNT,
    tree.merkleRoot,
    NIFTY_DAO_SAFE
  );
  console.log(` 🛰  MerkleDistributor Deployed to: ${targetNetwork} ${distributor.address}`);
  if (targetNetwork !== 'localhost') {
    await distributor.deployTransaction.wait(5);
    console.log(` 📁 Attempting etherscan verification of ${distributor.address} on ${targetNetwork}`);
    await run('verify:verify', {
      address: distributor.address,
      constructorArguments: [
        token.address,
        COMIC_5_CLAIMABLE_TOKEN_AMOUNT,
        COMIC_6_CLAIMABLE_TOKEN_AMOUNT,
        tree.merkleRoot,
        NIFTY_DAO_SAFE,
      ],
    });
    await tenderlyVerify({ contractName: 'MerkleDistributor', contractAddress: distributor.address });
  }
  return distributor;
};

const postDeploy = async (distributor: Contract, token: Contract) => {
  const { chainId } = await ethers.provider.getNetwork();
  let currentAddresses = {};
  if (fs.existsSync(`${__dirname}/../addresses.json`)) {
    currentAddresses = JSON.parse(fs.readFileSync(`${__dirname}/../addresses.json`).toString());
  }
  const newAddresses = {
    ...currentAddresses,
    [chainId]: { MerkleDistributor: distributor.address, token: token.address },
  };
  fs.writeFileSync(`${__dirname}/../addresses.json`, JSON.stringify(newAddresses));
};

async function main() {
  // let accounts: SignerWithAddress[] = await ethers.getSigners();
  // console.log('deployer address: ', accounts[0].address);

  const token = await getToken();
  if (token) {
    const distributor = await deployDistributor(token);
    await postDeploy(distributor, token);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
