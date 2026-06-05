import { createServer } from 'http';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked } from 'viem';

// Oracle accounts
const NODES = [
  {
    name: 'oracle-node-1',
    port: 3001,
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  },
  {
    name: 'oracle-node-2',
    port: 3002,
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
  },
  {
    name: 'oracle-node-3',
    port: 3003,
    privateKey: '0x5de4111afa73f9c56a67cf4e929d6d245c9ffb2287952db7d6f2982455e8f396'
  }
];

console.log('Starting Decentralized Oracle Network simulation...');

NODES.forEach((node) => {
  const account = privateKeyToAccount(node.privateKey);
  
  const server = createServer((req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/sign') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        try {
          const { campaignId, clickFingerprint } = JSON.parse(body);
          if (!campaignId || !clickFingerprint) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing campaignId or clickFingerprint' }));
            return;
          }

          // Generate message hash keccak256Packed(campaignId, clickFingerprint)
          const packedHash = keccak256(
            encodePacked(
              ['bytes32', 'bytes32'],
              [campaignId, clickFingerprint]
            )
          );

          // Sign message using viem account
          const signature = await account.signMessage({
            message: { raw: packedHash }
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            node: node.name,
            address: account.address,
            signature
          }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(node.port, '127.0.0.1', () => {
    console.log(`[DON] ${node.name} listening on http://127.0.0.1:${node.port} (Address: ${account.address})`);
  });
});
