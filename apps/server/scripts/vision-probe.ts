/** Optional paid provider check. Never reads keys stored in an OpenDots account. */
import { randomInt } from 'node:crypto';
import sharp from 'sharp';
import { setupNetwork } from '../src/net.ts';

if (!process.argv.includes('--paid') || !process.env.OPENROUTER_VISION_TEST_KEY) {
  console.error('Appels payants désactivés. Pour tester : OPENROUTER_VISION_TEST_KEY=… pnpm --filter @opendots/server exec tsx scripts/vision-probe.ts --paid');
  process.exit(2);
}
await setupNetwork();
const model = process.env.OPENDOTS_VISION_TEST_MODEL ?? 'qwen/qwen3.8-27b';
const provider = process.env.OPENDOTS_VISION_TEST_PROVIDER ?? 'Cerebras';
let passed = true;
for (const format of ['tool', 'user'] as const) {
  const code = String(randomInt(100000, 1000000));
  const image = await sharp(Buffer.from(`<svg width="600" height="180"><rect width="600" height="180" fill="white"/><text x="30" y="120" fill="black" font-size="90" font-family="DejaVu Sans">${code}</text></svg>`)).png().toBuffer();
  const picture = { type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } };
  const messages: any[] = [
    { role: 'user', content: 'Read the six digits in the screenshot. Reply with the digits only.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'screen', type: 'function', function: { name: 'computer_screenshot', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'screen', content: format === 'tool' ? [picture] : 'Screenshot attached next.' },
    ...(format === 'user' ? [{ role: 'user', content: [picture] }] : []),
  ];
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${process.env.OPENROUTER_VISION_TEST_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, provider: { only: [provider], allow_fallbacks: false }, messages, max_tokens: 40, temperature: 0 }),
      signal: AbortSignal.timeout(60000),
    });
    const body: any = await response.json();
    const recognized = response.ok && String(body.choices?.[0]?.message?.content ?? '').trim() === code;
    console.log(JSON.stringify({ format, model, requestedProvider: provider, actualProvider: body.provider ?? null, status: response.status, recognized }));
    if (!recognized) passed = false;
  } catch (error) {
    console.log(JSON.stringify({ format, model, requestedProvider: provider, recognized: false, error: (error as Error).name }));
    passed = false;
  }
}
process.exitCode = passed ? 0 : 1;
