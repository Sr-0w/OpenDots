import { expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { interruptedMessage, reportUnhandledRejection } from '../src/agents/interruption.ts';
it('un vrai rejet AbortError non géré ne termine pas le processus Node', async () => {
 const script = `import {reportUnhandledRejection} from ${JSON.stringify(new URL('../src/agents/interruption.ts', import.meta.url).href)};
 process.on('unhandledRejection', reportUnhandledRejection);
 Promise.reject(new DOMException('stop-by-user', 'AbortError'));
 setTimeout(() => console.log('PROCESS_ALIVE'), 100);`;
 const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script]);
 expect(result.stdout).toContain('PROCESS_ALIVE'); expect(result.stderr).toBe('');
});
it('finalise seulement les appels inachevés sans perdre les actions exécutées', () => {
 const message: any = { id:'x', role:'assistant', parts:[{type:'tool-computer_action',toolCallId:'done',state:'output-available',output:{ok:true}}, {type:'tool-computer_screenshot',toolCallId:'pending',state:'input-available',input:{}}] };
 const result: any = interruptedMessage(message, [], 'x');
 expect(result.parts[0].state).toBe('output-available'); expect(result.parts[1]).toMatchObject({state:'output-error',errorText:'Interrompu par l’utilisateur.'});
 expect(message.parts[1].state).toBe('input-available');
});
it('récupère aussi les entrées et le texte si le SDK ne finit pas son message', () => {
 const result: any = interruptedMessage(null, [{type:'tool-input-start',toolName:'computer_action',toolCallId:'pending'}, {type:'text-delta',id:'text',delta:'En cours'}], 'x');
 expect(result.parts[0].state).toBe('output-error'); expect(result.parts[1].text).toBe('En cours');
});
it('ignore les annulations attendues et journalise les autres rejets avec leur erreur', () => {
 const debug=vi.spyOn(console,'debug').mockImplementation(()=>{}), error=vi.spyOn(console,'error').mockImplementation(()=>{});
 reportUnhandledRejection(new DOMException('stop','AbortError')); expect(error).not.toHaveBeenCalled(); expect(debug).toHaveBeenCalledOnce();
 const failure=new Error('unexpected'); reportUnhandledRejection(failure); expect(error).toHaveBeenCalledWith('[unhandledRejection]',failure); vi.restoreAllMocks();
});
