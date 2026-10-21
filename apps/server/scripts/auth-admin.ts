import { promoteAdmin, closeAuthStore } from '../src/auth/store.ts';

const email = process.argv[2];
if (!email) throw new Error('Usage : pnpm auth:admin adresse@example.com (inscris d’abord ce compte dans l’interface).');
try { await promoteAdmin(email); console.log('Le compte a les droits d’administrateur du déploiement.'); }
finally { await closeAuthStore(); }
