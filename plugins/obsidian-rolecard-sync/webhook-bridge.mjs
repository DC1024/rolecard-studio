import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

/**
 * 独立 Webhook 验签接收端示例（适用于游戏客户端 / 自建游戏后端 / Obsidian Bridge）
 * 验证 X-RoleCard-Signature: sha256=<hex>
 */
export function verifyRoleCardWebhook(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.WEBHOOK_PORT || 4010);
  const secret = process.env.ROLECARD_WEBHOOK_SECRET || '';
  if (!secret) {
    console.error('请设置环境变量 ROLECARD_WEBHOOK_SECRET');
    process.exit(1);
  }

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const sig = String(req.headers['x-rolecard-signature'] || '');
      if (!verifyRoleCardWebhook(rawBody, sig, secret)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'INVALID_SIGNATURE' }));
        return;
      }
      const event = JSON.parse(rawBody);
      console.info('[RoleCard Webhook]', event.eventType, event.targetId, `cursor=${event.cursor}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.info(`RoleCard Webhook Bridge listening on http://127.0.0.1:${port}`);
  });
}
