import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

export function CodexConnection({ onConnected }: { onConnected?: () => void }) {
  const [connected, setConnected] = useState(false);
  const [login, setLogin] = useState<{ verificationUrl: string; userCode: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const check = async () => { try { const { account, error: loginError } = await api.codexAccount(); if (active) { if (loginError) { setError(loginError); setLogin(null); } setConnected(Boolean(account)); if (account && login) { setLogin(null); onConnected?.(); } } } catch (e) { if (active) setError((e as Error).message); } };
    void check(); const timer = login ? setInterval(() => void check(), 3000) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [login]);
  return <section className="space-y-3 rounded-xl border p-4" aria-label="ChatGPT Codex">
    <p className="font-medium">Codex · abonnement ChatGPT</p>
    <p className="text-xs text-muted-foreground">Utilise le quota Codex de ton abonnement. Les limites de ton offre s’appliquent ; aucune clé API OpenAI n’est nécessaire.</p>
    {connected ? <><p>ChatGPT connecté</p>{onConnected && <Button type="button" onClick={onConnected}>Continuer avec Codex</Button>}<Button type="button" variant="outline" onClick={async () => { try { await api.codexLogout(); setConnected(false); } catch (e) { setError((e as Error).message); } }}>Déconnecter ChatGPT</Button></> : <Button type="button" disabled={busy || Boolean(login)} onClick={async () => { setBusy(true); setError(''); try { setLogin(await api.codexLogin()); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }}>Connecter ChatGPT</Button>}
    {login && <div className="space-y-2"><p>Entre ce code sur la page officielle : <strong className="select-all font-mono">{login.userCode}</strong></p><a className="underline" target="_blank" rel="noreferrer" href={login.verificationUrl}>Ouvrir ChatGPT</a><p className="text-xs">En attente de connexion… Active la connexion par code d’appareil dans les paramètres de sécurité ChatGPT si nécessaire.</p><Button type="button" variant="ghost" onClick={() => setLogin(null)}>Réessayer</Button></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
