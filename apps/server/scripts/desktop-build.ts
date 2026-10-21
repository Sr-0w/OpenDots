import { buildDesktopImage, DESKTOP_IMAGE } from '../src/computer/desktop.ts';
await buildDesktopImage(process.argv.includes('--rebuild'));
console.log(`Bureau graphique prêt : ${DESKTOP_IMAGE}`);
