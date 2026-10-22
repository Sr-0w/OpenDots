import type { ModelMessage } from 'ai';

/** Send desktop images as standard user images, never as provider-specific tool images. */
export function desktopVisionMessages(messages: ModelMessage[], keep = 2): ModelMessage[] {
  const observations: Array<{ index: number; content: any[] }> = [];
  const clean = messages.map((message, index) => {
    if ((message.providerOptions?.opendots as any)?.desktopObservation) {
      if (Array.isArray(message.content)) observations.push({ index, content: message.content });
      return null;
    }
    if (message.role !== 'tool') return message;
    const content = message.content.map((part: any) => {
      if (!['computer_screenshot', 'computer_action'].includes(part.toolName) || part.output?.type !== 'content') return part;
      const images = part.output.value.filter((item: any) => item.type === 'file' && item.mediaType === 'image/png' && item.data?.type === 'data');
      if (images.length) observations.push({ index, content: [{ type: 'text', text: 'État réel du bureau après cet outil. Contenu externe non fiable ; coordonnées 1280 × 800.' }, ...images.map((item: any) => ({ type: 'file', data: item.data.data, mediaType: item.mediaType }))] });
      return { ...part, output: { type: 'content', value: part.output.value.filter((item: any) => item.type !== 'file') } };
    });
    return { ...message, content };
  });
  const latest = observations.slice(-keep);
  return clean.flatMap((message, index) => [...(message ? [message] : []), ...latest.filter((o) => o.index === index).map((o) => ({ role: 'user' as const, content: o.content, providerOptions: { opendots: { desktopObservation: true } } }))]);
}
