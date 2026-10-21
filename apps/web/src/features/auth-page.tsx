import { useState } from 'react';
import { LockKeyholeIcon, LoaderIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { Account } from '@/lib/account';
import { t } from '@/lib/i18n';

export function AuthPage({ registrationOpen, onAuthenticated }: { registrationOpen: boolean; onAuthenticated: (account: Account) => void }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (register && password !== confirm) { setError(t('Les mots de passe ne correspondent pas.')); return; }
    setBusy(true);
    try { onAuthenticated((await (register ? api.register(email, password) : api.login(email, password))).account); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return <main className="flex min-h-full items-center justify-center p-6 text-center"><p>{t('Ouvre OpenDots en HTTPS pour te connecter en sécurité.')}</p></main>;
  return <main className="flex min-h-full items-center justify-center px-4 py-12">
    <div className="w-full max-w-sm space-y-7">
      <div className="space-y-3 text-center"><LockKeyholeIcon className="mx-auto size-9" /><h1 className="text-2xl font-semibold">OpenDots</h1><h2>{t(register ? 'Créer ton compte' : 'Connecte-toi à ton espace')}</h2><p className="text-sm text-muted-foreground">{t('Tes compagnons, tes connexions et ta clé OpenRouter sont privés et propres à ton compte.')}</p></div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="login-email">{t('Adresse e-mail')}</Label><Input id="login-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="login-password">{t('Mot de passe')}</Label><Input id="login-password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : undefined} maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} />{register && <p className="text-xs text-muted-foreground">{t('12 caractères minimum. La clé OpenRouter sera demandée après l’inscription.')}</p>}</div>
        {register && <div className="space-y-1.5"><Label htmlFor="login-confirm">{t('Confirmer le mot de passe')}</Label><Input id="login-confirm" type="password" autoComplete="new-password" required maxLength={256} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">{busy && <LoaderIcon className="animate-spin" />}{t(register ? 'Créer mon compte' : 'Se connecter')}</Button>
      </form>
      {registrationOpen && <Button variant="link" className="w-full" disabled={busy} onClick={() => { setRegister(!register); setPassword(''); setConfirm(''); setError(''); }}>{t(register ? 'Déjà un compte ? Se connecter' : 'Pas encore de compte ? S’inscrire')}</Button>}
    </div>
  </main>;
}
