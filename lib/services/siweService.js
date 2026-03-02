const { randomBytes } = require('crypto');
const { SiweMessage } = require('siwe');
const { getAddress } = require('ethers');
const config = require('../config');
const {
  createSiweNonce,
  consumeSiweNonce,
  getUserByWallet,
  createUser,
  linkWallet,
} = require('../storage/repository');

function nonce() {
  return randomBytes(16).toString('hex');
}

function normalizeWallet(walletAddress) {
  try {
    return getAddress(String(walletAddress || '').trim());
  } catch (_error) {
    return '';
  }
}

function buildMessage({ walletAddress, chainId, domain, uri, nonceValue }) {
  const message = new SiweMessage({
    domain,
    address: walletAddress,
    statement: 'Sign in to Borderland WebApp',
    uri,
    version: '1',
    chainId,
    nonce: nonceValue,
    issuedAt: new Date().toISOString(),
  });
  return message.prepareMessage();
}

async function createNonceMessage({ walletAddress, chainId, domain, uri }) {
  const wallet = normalizeWallet(walletAddress);
  const parsedChainId = parseInt(chainId, 10) || config.chainId;
  if (!wallet) throw new Error('wallet required');
  if (!config.siweAllowedChainIds.includes(parsedChainId)) {
    throw new Error('unsupported chain');
  }
  const nonceValue = nonce();
  const message = buildMessage({
    walletAddress: wallet,
    chainId: parsedChainId,
    domain,
    uri,
    nonceValue,
  });
  const expiresAt = Date.now() + 5 * 60 * 1000;
  await createSiweNonce({
    walletAddress: wallet,
    chainId: parsedChainId,
    nonce: nonceValue,
    message,
    expiresAt,
  });
  return { nonce: nonceValue, message, expiresAt };
}

async function verifySignature({ message, signature, walletAddress }) {
  const verified = await verifySiweSignature({ message, signature, walletAddress });
  const wallet = verified.walletAddress;
  let user = await getUserByWallet(wallet, verified.chainId);
  if (!user) {
    const username = `wallet_${wallet.slice(2, 10)}`;
    const password = randomBytes(16).toString('hex');
    user = await createUser({ username, password, walletAddress: wallet });
  }
  await linkWallet(user.id, wallet, verified.chainId, true);
  return { user, walletAddress: wallet };
}

async function verifySiweSignature({ message, signature, walletAddress }) {
  const siwe = new SiweMessage(message);
  const wallet = normalizeWallet(walletAddress || siwe.address);
  if (!config.siweAllowedChainIds.includes(parseInt(siwe.chainId, 10))) {
    throw new Error('unsupported chain');
  }
  const nonceValue = siwe.nonce;
  const nonceRow = await consumeSiweNonce({ walletAddress: wallet, nonce: nonceValue });
  if (!nonceRow) throw new Error('nonce invalid');
  const verify = await siwe.verify({ signature, nonce: nonceValue });
  if (!verify.success) throw new Error('siwe verify failed');
  if (normalizeWallet(siwe.address) !== wallet) throw new Error('wallet mismatch');
  return {
    walletAddress: wallet,
    chainId: siwe.chainId,
    nonce: nonceValue,
  };
}

module.exports = {
  createNonceMessage,
  verifySignature,
  verifySiweSignature,
};
