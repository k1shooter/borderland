const { Queue, Worker, QueueEvents } = require('bullmq');
const { ethers } = require('ethers');
const config = require('../config');
const { getRedis } = require('../db/redis');
const { setDeathChainStatus, hashAccount } = require('../storage/repository');

const ABI = [
  'function markDead(bytes32 accountHash, bytes32 walletHash, string username, string cardCode) external',
];

let queue = null;
let worker = null;
let events = null;

function canRunChainQueue() {
  return !!(config.redisUrl && config.rpcUrl && config.deathRegistryAddress);
}

function getConnection() {
  if (!config.redisUrl) return null;
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}

function normalizeWallet(walletAddress) {
  return String(walletAddress || '').trim().toLowerCase();
}

async function processJob(job) {
  const payload = job.data || {};
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const privateKey = process.env.CHAIN_PRIVATE_KEY || '';
  if (!privateKey) throw new Error('CHAIN_PRIVATE_KEY is required');
  const signer = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(config.deathRegistryAddress, ABI, signer);

  const accountHash = ethers.id(String(payload.userId || ''));
  const walletAddress = normalizeWallet(payload.walletAddress);
  const walletHash = walletAddress ? ethers.id(walletAddress) : ethers.ZeroHash;
  const tx = await contract.markDead(
    accountHash,
    walletHash,
    String(payload.username || ''),
    String(payload.cardCode || '')
  );
  const receipt = await tx.wait();
  await setDeathChainStatus(payload.deathId, 'confirmed', receipt.hash, null);
  return { txHash: receipt.hash };
}

function initChainQueue({ withWorker = true } = {}) {
  if (!canRunChainQueue()) return null;
  if (queue) return { queue, worker, events };
  const connection = getConnection();
  if (!connection) return null;
  queue = new Queue('death-chain-write', { connection });
  events = new QueueEvents('death-chain-write', { connection });
  if (withWorker) {
    worker = new Worker('death-chain-write', processJob, {
      connection,
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
    });
    worker.on('failed', async (job, error) => {
      const deathId = job?.data?.deathId;
      if (deathId) {
        await setDeathChainStatus(deathId, 'failed', null, error.message || 'chain_failed');
      }
    });
  }
  return { queue, worker, events };
}

async function enqueueDeathRecord(record) {
  if (!record) return null;
  const context = initChainQueue({ withWorker: true });
  if (!context || !context.queue) return null;
  await context.queue.add(
    'write',
    {
      deathId: record.id,
      userId: record.userId,
      username: record.username,
      cardCode: record.cardCode,
      walletAddress: record.walletAddress,
      accountHash: hashAccount(record.userId),
    },
    {
      removeOnComplete: 200,
      removeOnFail: 200,
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
    }
  );
  return true;
}

module.exports = {
  initChainQueue,
  enqueueDeathRecord,
};
