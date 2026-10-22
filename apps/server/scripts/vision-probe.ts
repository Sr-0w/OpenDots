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
  const target = { x: randomInt(48, 1000), y: randomInt(60, 660), width: 220, height: 80 };
  const image = await sharp(Buffer.from(`<svg width="1280" height="800"><rect width="1280" height="800" fill="#ededed"/><rect x="${target.x}" y="${target.y}" width="${target.width}" height="${target.height}" rx="8" fill="#4cf0d2" stroke="black" stroke-width="3"/><text x="${target.x+15}" y="${target.y+55}" fill="black" font-size="48" font-family="DejaVu Sans">${code}</text></svg>`)).png().toBuffer();
  const picture = { type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } };
  const messages: any[] = [
    { role: 'user', content: 'Read the six digits inside the turquoise rectangle and locate its centre. The screenshot is 1280 by 800 native pixels, origin at the top-left. Reply only with JSON: {"code":"six digits","x":horizontal centre in pixels,"y":vertical centre in pixels}. Do not use normalized coordinates.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'screen', type: 'function', function: { name: 'computer_screenshot', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'screen', content: format === 'tool' ? [picture] : 'Screenshot attached next.' },
    ...(format === 'user' ? [{ role: 'user', content: [picture] }] : []),
  ];
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${process.env.OPENROUTER_VISION_TEST_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, provider: { only: [provider], allow_fallbacks: false }, messages, max_tokens: 512, reasoning: { enabled: false }, temperature: 0 }),
      signal: AbortSignal.timeout(60000),
    });
    const body: any = await response.json();
    let answer: any;
    try { answer = JSON.parse(String(body.choices?.[0]?.message?.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { answer = null; }
    const recognized = response.ok && answer?.code === code;
    const grounded = recognized && typeof answer?.x === 'number' && typeof answer?.y === 'number' && Math.abs(answer.x-target.x-target.width/2) <= 24 && Math.abs(answer.y-target.y-target.height/2) <= 24;
    console.log(JSON.stringify({ format, model, requestedProvider: provider, actualProvider: body.provider ?? null, status: response.status, recognized, grounded }));
    if (!recognized || !grounded) passed = false;
  } catch (error) {
    console.log(JSON.stringify({ format, model, requestedProvider: provider, recognized: false, error: (error as Error).name }));
    passed = false;
  }
}
process.exitCode = passed ? 0 : 1;
